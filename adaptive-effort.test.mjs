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
  ['refactor the auth module', 'high'],
  ['why does the server drop connections under load?', 'high'],
  ['```js\nconst a = 1\n```', 'high'],
  ['```js\nconst a = 1\n``` refactor this into a hook', 'max'],
  ['refactor, migrate, and audit the schema', 'max'],
  ['think hard: what is the root cause of the deadlock?', 'max'],
  [`${'x'.repeat(900)} refactor the migration`, 'max'],
  ['brainstorm ideas for the trading app', 'high'],
  ['help me enrich the concept for NetMechanic Connect', 'high'],
  ["let's idealize the onboarding flow", 'high'],
  ['what should our positioning be for the resort project?', 'high'],
  ['enrich this concept: a local delivery network for small farms', 'high'],
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

console.log(`\nfailures: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
