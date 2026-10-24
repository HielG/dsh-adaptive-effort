/**
 * Adaptive reasoning effort for DeepSeek Harness.
 *
 * Picks the cheapest effort that still fits the turn, then applies it through
 * the `agent/request` waterfall — the same extension point the harness uses
 * for its own model selection. Reasoning is not free: it is output tokens
 * now, and DeepSeek passes a reasoned turn's chain of thought back into later
 * requests, so a needless `max` keeps costing input tokens afterwards.
 *
 * Levels: off | low | high | max (the adapter publishes no "medium").
 *   off  — social turns and acknowledgements: no thinking at all
 *   low  — short factual asks and mechanical file/command requests
 *   high — anything that reads like real work (the harness default)
 *   max  — several complexity cues, complex pasted code, or an explicit ask
 *
 * No imports from harness packages: the module is loaded from the profile
 * directory, where those are not resolvable. Node builtins are fine.
 */

import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULTS = {
  /** Length at or below which a signal-free ask counts as trivial. */
  trivialMaxChars: 160,
  /** Length at or above which two complexity cues escalate to max. */
  longChars: 900,
  /** Complexity cues that escalate to max on their own. */
  complexCues: 3,
  /** Effort for social turns; 'low' if you would rather never disable thinking. */
  socialEffort: 'off',
  /**
   * Concept work is the seed: the vision and framing every later turn inherits,
   * and reasoning passback keeps its chain of thought available to them. Pay once.
   */
  ideationEffort: 'max',
  /** Planning/spec work shapes the build the same way; lower it if plans feel routine. */
  planningEffort: 'max',
  /** Append one line per decision to %TEMP%\dsh-adaptive-effort.log. */
  debug: true,
};

/** Nouns that make an ask intricate. */
const COMPLEXITY = /\b(?:refactor\w*|rewrite|migrat\w*|architect\w*|design\w*|debug\w*|diagnos\w*|root cause|stack trace|traceback|performance|benchmark\w*|profil\w*|concurren\w*|race condition|deadlock|security|vulnerab\w*|audit\w*|algorithm\w*|multi-step|end-to-end|integrat\w*|schema|analy\w*|investigat\w*|evaluat\w*|compar\w*|strateg\w*|prove|proving|deriv\w*|implement\w*|complex|codebase|thorough\w*|trade-?offs?|optimi[sz]\w*)\b/g;

/** Verbs and question forms that mean the turn needs judgment, not just a tool call. */
const JUDGMENT = /\b(?:fix|add|write|create|build|update|change|implement\w*|refactor\w*|migrat\w*|design\w*|debug\w*|explain|review|plan|analy[sz]\w*|compar\w*|evaluat\w*|optimi[sz]\w*|investigat\w*|audit\w*|diagnos\w*|test|install|configure|set up|verif\w*|check\w*|confirm\w*|why|how does|how do|what happens|error\w*|fail\w*|broken|crash\w*)\b/g;

/** Whole-turn social filler: no reasoning budget is warranted. */
const SOCIAL_WORDS = new Set([
  'hi', 'hello', 'hey', 'yo', 'thanks', 'thank you', 'thx', 'ok', 'okay', 'cool',
  'nice', 'great', 'perfect', 'awesome', 'got it', 'done', 'good', 'sure', 'yes',
  'no', 'yep', 'nope',
]);

/** Normalize away punctuation and emoji, then ask whether anything else was said. */
function isSocial(text) {
  const words = text.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return SOCIAL_WORDS.has(words);
}

const WANTS_MAX = /(?:think (?:hard|harder|deeply|carefully)|max(?:imum)? (?:effort|thinking|reasoning)|deep dive|be (?:very )?thorough|exhaustive)/;
const WANTS_LOW = /(?:quick(?:ly)?|simple|one-?liner|short answer|tl;?dr|just tell me)/;

/**
 * Concept work: brainstorming, idealization, positioning, enrichment. These turns
 * produce the seed every later turn inherits, so they earn the deepest budget even
 * when the prompt is short. Weak signals ("what if", "explore") stay out on purpose.
 */
const IDEATION = /\b(?:brainstorm\w*|ideat\w*|idealiz\w*|concept\w*|ideas?|vision|positioning|value proposition|differentiat\w*|narrative|personas?|business models?|go-to-market|pitch\w*|enrich\w*)\b/g;

/** Planning and specification: the same "pay once, inherit afterwards" shape. */
const PLANNING = /\b(?:plan(?:s|ning|ned)?|roadmap\w*|milestone\w*|scope|phases?|architect\w*|blueprint\w*|spec\w*|prd|design docs?|backlog|sequenc\w*|tech stack)\b/g;

/** Count matches of one global pattern; `String.match` ignores `lastIndex`. */
function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

/**
 * Classify one prompt into an adapter reasoning effort.
 * @param text - the latest user prompt.
 * @param config - optional threshold and policy overrides.
 * @returns the chosen level plus a short reason for logs and tests.
 */
export function classify(text, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const trimmed = String(text ?? '').trim();
  if (trimmed.length === 0) return { level: undefined, reason: 'empty' };

  const lower = trimmed.toLowerCase();
  const length = trimmed.length;
  const hasCode = trimmed.includes('```') || /(^|\n)\s{4,}\S/.test(trimmed);
  const complexity = count(lower, COMPLEXITY);
  const judgment = count(lower, JUDGMENT);
  const ideation = count(lower, IDEATION);
  const planning = count(lower, PLANNING);

  if (isSocial(trimmed)) return { level: cfg.socialEffort, reason: 'social' };
  if (WANTS_MAX.test(lower)) return { level: 'max', reason: 'explicit-max' };
  if (complexity >= cfg.complexCues) return { level: 'max', reason: `cues:${complexity}` };
  if (hasCode && complexity >= 1) return { level: 'max', reason: 'code+cue' };
  if (length >= cfg.longChars && complexity >= 2) return { level: 'max', reason: 'long+cues' };
  // Seed work runs before the code check: "plan this" over a paste still plans.
  if (planning > 0) return { level: cfg.planningEffort, reason: 'planning' };
  if (ideation > 0) return { level: cfg.ideationEffort, reason: 'ideation' };
  // Pasted code without a complexity cue still deserves the standard budget.
  if (hasCode) return { level: 'high', reason: 'code' };
  if (WANTS_LOW.test(lower) && complexity === 0) return { level: 'low', reason: 'explicit-low' };
  if (complexity === 0 && judgment === 0 && length <= cfg.trivialMaxChars) {
    return { level: 'low', reason: 'trivial' };
  }
  return { level: 'high', reason: judgment > 0 ? 'work' : 'complexity' };
}

/** Pull the newest user-authored text out of an admitted step batch. */
function latestUserText(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    if (text.trim().length > 0) return text;
  }
  return undefined;
}

/**
 * Plugin entry: one scoped listener pair per agent.
 * @param ctx - the root context that owns this plugin.
 * @param config - optional thresholds from the profile patch row.
 */
export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config || {}) };
  const states = new WeakMap();
  const disposers = new Map();

  const log = (line) => {
    if (!options.debug) return;
    try {
      appendFileSync(join(tmpdir(), 'dsh-adaptive-effort.log'), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Logging is diagnostic only.
    }
  };

  log(`active levels=off/low/high/max social=${options.socialEffort}`);

  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', ({ agent } = {}) => {
      try {
        if (!agent || agent.ctx === undefined || states.has(agent)) return;
        // `applied` remembers our own last override so an explicit user `off`
        // stays untouched while our own `off` can be escalated again.
        const state = { prompt: undefined, level: undefined, applied: undefined };
        states.set(agent, state);

        const dispose = agent.ctx.effect(() => {
          const offStep = agent.ctx.on('agent/pre-step', async (payload, next) => {
            const decision = await next();
            try {
              const text = latestUserText(payload && payload.messages);
              if (text !== undefined && text !== state.prompt) {
                state.prompt = text;
                const verdict = classify(text, options);
                state.level = verdict.level;
                log(`turn=${payload?.turn ?? '?'} level=${verdict.level} reason=${verdict.reason} chars=${text.length}`);
              }
            } catch {
              // Classification must never fail a step.
            }
            return decision;
          }, { prepend: true });

          const offRequest = agent.ctx.on('agent/request', async (_payload, next) => {
            const resolved = await next();
            try {
              const current = resolved && resolved.reasoningEffort;
              const wanted = state.level;
              if (wanted === undefined || current === undefined) return resolved;
              // A user-selected `off` is a deliberate choice; ours is not.
              if (current === 'off' && state.applied !== 'off') return resolved;
              if (wanted === current) {
                state.applied = current;
                return resolved;
              }
              state.applied = wanted;
              return { ...resolved, reasoningEffort: wanted };
            } catch {
              return resolved;
            }
          }, { prepend: true });

          return () => {
            offStep();
            offRequest();
          };
        });
        disposers.set(agent, dispose);
      } catch {
        // Never break agent creation.
      }
    });

    return () => {
      offCreated();
      for (const dispose of disposers.values()) {
        try {
          dispose();
        } catch {
          // A disposed agent context may already have dropped its effects.
        }
      }
      disposers.clear();
    };
  });
}
