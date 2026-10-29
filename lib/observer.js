/**
 * Tool-traffic observer: turns `tools/post-execute` calls into ledger facts.
 *
 * The plugin does not spawn, gate or schedule anything — the agent drives the
 * external-subagent MCP tools itself, exactly as the skill's dispatch profile
 * says. What the plugin does is *watch*: every spawn/wait/result/close call
 * and every `.agent-work/` file write that happens while a run is active is
 * classified here (pure) and recorded in the ledger by the caller.
 *
 * All extraction is best-effort and defensive: an unparseable result is not
 * an error, it simply yields no fact. Observing must never break a tool call.
 */

const ES_OPS = new Set(['spawn', 'wait', 'result', 'close', 'observe', 'send', 'respond', 'status']);
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'RUNTIME_LOST', 'RESULT_INVALID']);
const NON_TERMINAL_STATUS = new Set(['QUEUED', 'PREPARING', 'RUNNING', 'WAITING_INPUT', 'CANCELLING']);
import { relative as pathRelative } from 'node:path';

/** Classify a tool name into { family, op } or null when uninteresting. */
export function toolFamily(name) {
  const text = String(name ?? '');
  const es = /(?:^|__)external_subagent_([a-z]+)$/.exec(text);
  if (es && ES_OPS.has(es[1])) return { family: 'es', op: es[1] };
  if (text === 'write' || text === 'edit') return { family: 'file', op: text };
  return null;
}

/** Flatten a tool result's content blocks to text (defensive). */
export function resultToText(result) {
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return typeof result?.text === 'string' ? result.text : '';
  return blocks
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('\n');
}

/** First JSON-ish `"key": value` number/string capture in a text blob. */
function capture(text, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"?([A-Za-z0-9_:@.\\-]+)"?`).exec(String(text ?? ''));
  return match ? match[1] : null;
}

/** Role family of a spawn, from the named profile (the skill's sfd-* presets). */
export function roleOfProfile(profile, subagent) {
  const name = String(profile ?? '');
  if (name.includes('plan-review')) return 'plan-review';
  if (name.includes('code-review')) return 'code-review';
  if (name.includes('impl')) return 'impl';
  if (name.includes('advisor')) return 'advisor';
  if (/^sfd-/.test(name)) return 'sfd-other';
  if (!name) return subagent ? 'direct' : 'unknown';
  return 'other';
}

/** Headline of a task prompt: first non-empty line, capped. */
export function promptHeadline(prompt) {
  const line = String(prompt ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/** First `.agent-work/…` path mentioned in a prompt (the report sink). */
export function reportHint(prompt) {
  const match = /\.agent-work\/[^\s"'`)\]}>,]+/.exec(String(prompt ?? ''));
  return match ? match[0] : null;
}

/**
 * Classify one external-subagent call into ledger observations.
 * @returns array of observation records (possibly empty).
 */
export function classifyEs(op, args, resultText) {
  const out = [];
  if (op === 'spawn') {
    const id = capture(resultText, 'agent_id');
    if (id) {
      out.push({
        kind: 'spawn',
        agentId: id,
        profile: typeof args?.profile === 'string' ? args.profile : null,
        role: roleOfProfile(args?.profile, args?.subagent),
        promptHeadline: promptHeadline(args?.prompt),
        reportHint: reportHint(args?.prompt),
        sessionId: capture(resultText, 'session_id'),
      });
    }
    return out;
  }
  if (op === 'wait' || op === 'result' || op === 'close') {
    const ids = [];
    const raw = args?.agent_id;
    if (typeof raw === 'number' || typeof raw === 'string') ids.push(String(raw));
    else if (Array.isArray(raw)) for (const item of raw) ids.push(String(item));
    const outcome = TERMINAL.has(capture(resultText, 'outcome') ?? '') ? capture(resultText, 'outcome') : null;
    const status = NON_TERMINAL_STATUS.has(capture(resultText, 'status') ?? '') ? capture(resultText, 'status').toLowerCase() : null;
    for (const id of ids) {
      out.push({ kind: 'event', agentId: id, event: op, status, outcome });
    }
    return out;
  }
  return out; // observe/send/respond/status carry no ledger fact
}

/** Normalize `.agent-work/` file writes: { path, kind } | null. */
export function classifyFileWrite(args, root, { relative } = {}) {
  const raw = args?.file_path ?? args?.path;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const rel = typeof relative === 'function' ? relative(root, raw) : pathRelative(root, raw);
  if (!rel || rel.startsWith('..') || !rel.startsWith('.agent-work/')) return null;
  const under = rel.slice('.agent-work/'.length);
  const firstSegment = under.split('/')[0];
  const kind = /review/i.test(firstSegment) ? 'reports'
    : /handoff/i.test(firstSegment) ? 'handoffs'
    : /PLAN/i.test(under) ? 'plan'
    : 'other';
  return { path: rel, kind };
}
