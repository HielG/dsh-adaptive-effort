import { classify, apply } from './adaptive-effort.js';

const cases = [
  ['hi', 'off'],
  ['thanks!', 'off'],
  ['ok 👍', 'off'],
  ["what's the latest version?", 'low'],
  ['rename the folder to old', 'low'],
  ['quick question — what time is it?', 'low'],
  ['fix the bug in main.js', 'high'],
  ['add a download button to the header', 'high'],
  ['restarted, please verify', 'max'],
  ['review the payment module', 'max'],
  ['audit the authentication flow', 'max'],
  ['please verify the migration output', 'max'],
  ['check if the server is still running', 'high'],
  ['confirm the output folder is correct', 'high'],
  ['refactor the auth module', 'high'],
  ['why does the server drop connections under load?', 'high'],
  ['```js\nconst a = 1\n```', 'high'],
  ['```js\nconst a = 1\n``` refactor this into a hook', 'max'],
  ['refactor, migrate, and audit the schema', 'max'],
  ['think hard: what is the root cause of the deadlock?', 'max'],
  [`${'x'.repeat(900)} refactor the migration`, 'max'],
  ['brainstorm ideas for the trading app', 'max'],
  ['help me enrich the concept for NetMechanic Connect', 'max'],
  ["let's idealize the onboarding flow", 'max'],
  ['what should our positioning be for the resort project?', 'max'],
  ['enrich this concept: a local delivery network for small farms', 'max'],
  ['plan the migration of the payments service', 'max'],
  ['write a roadmap for Q1 with milestones', 'max'],
  ['draft the spec for the onboarding flow', 'max'],
  ['be specific about the output format', 'low'],
  ['the planned outage is tomorrow', 'low'],
  ['draw a sequence diagram for the handshake', 'low'],
];

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
};

for (const [text, expected] of cases) {
  const { level, reason } = classify(text);
  check(level === expected, `${JSON.stringify(text).slice(0, 58).padEnd(60)} -> ${level} [${reason}] (expected ${expected})`);
}

// --- listener simulation: stub the two cordis contexts -----------------------
const rootHandlers = new Map();
const rootCtx = {
  effect(run) {
    const dispose = run();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  on(name, listener) {
    const list = rootHandlers.get(name) ?? [];
    list.push(listener);
    rootHandlers.set(name, list);
    return () => {};
  },
};

apply(rootCtx, { debug: false });
check(rootHandlers.get('agent/created')?.length === 1, 'plugin registers agent/created');

function newAgent() {
  const handlers = new Map();
  rootHandlers.get('agent/created')[0]({
    agent: {
      ctx: {
        effect(run) {
          const dispose = run();
          return typeof dispose === 'function' ? dispose : () => {};
        },
        on(name, listener) {
          const list = handlers.get(name) ?? [];
          list.push(listener);
          handlers.set(name, list);
          return () => {};
        },
      },
    },
  });
  return { preStep: handlers.get('agent/pre-step')[0], request: handlers.get('agent/request')[0] };
}

const main = newAgent();
check(Boolean(main.preStep && main.request), 'agent listeners registered');

async function turn(agent, text, base) {
  await agent.preStep(
    { turn: 1, messages: [{ role: 'user', content: [{ type: 'text', text }] }], step: 1 },
    async () => ({ kind: 'enter', messages: [] }),
  );
  return agent.request({}, async () => ({ provider: 'p', model: 'm', reasoningEffort: base }));
}

check((await turn(main, 'hi', 'high')).reasoningEffort === 'off', 'social turn downgrades high -> off');
check((await turn(main, 'fix the bug', 'off')).reasoningEffort === 'high', 'our own off can be escalated again');
check((await turn(main, 'hi', 'low')).reasoningEffort === 'off', 'social turn overrides a low selection with off');
check((await turn(main, "what's 2+2?", 'low')).reasoningEffort === 'low', 'trivial turn keeps an already-low level');
check((await turn(main, 'refactor x', 'high')).reasoningEffort === 'high', 'single cue stays high');

const fresh = newAgent();
const untouched = await fresh.request({}, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'off' }));
check(untouched.reasoningEffort === 'off', 'a user-selected off on a fresh agent is respected');

const noStep = newAgent();
const noStepResult = await noStep.request({}, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }));
check(noStepResult.reasoningEffort === 'high', 'agent without a classified step keeps its effort');

// An attachment-only turn must not inherit the previous turn's low budget.
const attach = newAgent();
await attach.preStep(
  { turn: 1, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], step: 1 },
  async () => ({ kind: 'enter', messages: [] }),
);
check((await attach.request({}, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'high' }))).reasoningEffort === 'off', 'social turn sets off before the attachment turn');
await attach.preStep(
  { turn: 2, messages: [{ role: 'user', content: [{ type: 'image' }] }], step: 1 },
  async () => ({ kind: 'enter', messages: [] }),
);
check((await attach.request({}, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'off' }))).reasoningEffort === 'high', 'attachment-only turn falls back to high');

// Unrecognized effort values must never reach the adapter.
check(classify('hi', { socialEffort: 'offf' }).level === 'off', 'invalid socialEffort falls back to the default');
check(classify('brainstorm ideas', { ideationEffort: 'ultra' }).level === 'max', 'invalid ideationEffort falls back to the default');
check(classify('plan the release', { planningEffort: 'EXTREME' }).level === 'max', 'invalid planningEffort falls back to the default');
check(classify('review the diff', { reviewEffort: 'high' }).level === 'high', 'reviewEffort high makes reviews cheap');
check(classify('review the diff', { reviewEffort: 'nope' }).level === 'max', 'invalid reviewEffort falls back to the default');

console.log(`\nfailures: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
