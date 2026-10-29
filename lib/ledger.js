/**
 * SFD run ledger: observed facts for one repository, nothing more.
 *
 * Why a ledger and not a state machine: the flow itself — scheduling,
 * admission, acceptance — belongs to the skill and the main agent. What kept
 * going wrong was the agent *skipping* reviews mid-run, and the fix the user
 * chose is injection backed by durable facts, not a plugin-owned scheduler.
 * So this file records only what the plugin could observe:
 *
 *  - the run anchor (task, slug, branch, git facts at start),
 *  - every external-subagent actor the session spawned (profile, role,
 *    status, terminal outcome), with per-role dispatch counts,
 *  - `.agent-work/` artifacts the session wrote (plan, reports, handoffs).
 *
 * Facts:
 * - The ledger lives at `<repo>/.agent-work/sfd-run.json`, written only by
 *   this module (atomic tmp+rename). Agents never author this file; the
 *   pre-plugin `sfd-state.json` is a legacy marker, not read here.
 * - Every transition is journaled with a monotonic `revision` the injector
 *   gates on; a crash leaves either the old or the new complete file.
 * - The ledger never encodes phases, gates or budgets: those judgments stay
 *   with the skill. It only counts and remembers.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const AGENT_WORK = '.agent-work';
export const RUN_FILE = 'sfd-run.json';

/** Actor lifecycle status, mirroring the external-subagent outcome set. */
export const TERMINAL_OUTCOMES = new Set([
  'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'RUNTIME_LOST', 'RESULT_INVALID',
]);

const ARTIFACT_CAP = 50;
const JOURNAL_CAP = 500;

/** Create the initial ledger for a repository. Pure. */
export function initialRun(repoRoot, { taskSummary, slug, branch, git } = {}) {
  const at = new Date().toISOString();
  return {
    schema: 1,
    repoRoot,
    createdAt: at,
    updatedAt: at,
    revision: 1,
    run: {
      status: 'active', // active | closed
      taskSummary: taskSummary ?? '',
      slug: slug ?? null,
      branch: branch ?? null,
      base: git?.base ?? null,
      dirtyAtStart: git?.dirty === true,
      detachedAtStart: git?.detached === true,
      midMergeAtStart: git?.midMerge === true,
    },
    actors: {}, // esAgentId -> { profile, role, promptHeadline, reportHint, sessionId, spawnedAt, lastEventAt, status, terminalAt, outcome, closed }
    counts: {}, // role -> dispatch count (bumped once per observed spawn)
    artifacts: { plan: [], reports: [], handoffs: [], other: [] },
    journal: [{ seq: 1, at, kind: 'start', detail: `run anchored on ${branch ?? 'unknown branch'}` }],
  };
}

/** Load the ledger for a repository; null when no run exists. */
export async function loadRun(repoRoot) {
  const file = join(repoRoot, AGENT_WORK, RUN_FILE);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${RUN_FILE} is not valid JSON: ${error.message}`);
  }
  if (parsed?.schema !== 1) {
    throw new Error(`Unsupported ${RUN_FILE} schema: ${String(parsed?.schema)}`);
  }
  return parsed;
}

/** Detect SFD work: an active/closed run, or legacy markers from older runs. */
export async function detectWork(repoRoot) {
  const run = await loadRun(repoRoot);
  if (run) return { present: true, kind: 'run', run };
  const markers = ['sfd-run.json', 'sfd-state.json', 'PLAN-FULL.md', 'FEATURE-STATE.md', 'REQUIREMENTS.md'];
  const found = [];
  for (const name of markers) {
    try {
      await readFile(join(repoRoot, AGENT_WORK, name), 'utf8');
      found.push(name);
    } catch { /* absent */ }
  }
  if (found.length > 0) return { present: true, kind: 'legacy-markers', markers: found };
  return { present: false };
}

/** Apply one transition: patch(run), journal entry, atomic write. */
export async function commit(run, kind, patch, detail = '') {
  const next = structuredClone(run);
  const seq = (next.revision ?? 0) + 1;
  Object.assign(next, structuredClone(patch ?? {}));
  next.revision = seq;
  next.updatedAt = new Date().toISOString();
  next.journal = [...(next.journal ?? []), { seq, at: next.updatedAt, kind, detail }];
  if (next.journal.length > JOURNAL_CAP) next.journal = next.journal.slice(-JOURNAL_CAP);
  await flush(next);
  return next;
}

/** Atomic write: tmp file in the same directory, then rename. */
export async function flush(run) {
  const file = join(run.repoRoot, AGENT_WORK, RUN_FILE);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Upsert an observed spawn; bumps the role count exactly once per new actor. */
export async function recordSpawn(run, { agentId, profile, role, promptHeadline, reportHint, sessionId }) {
  const id = String(agentId);
  if (run.actors[id]) return run; // a retry of the same observed call: no double count
  const counts = { ...(run.counts ?? {}) };
  counts[role] = (counts[role] ?? 0) + 1;
  const at = new Date().toISOString();
  return commit(run, 'spawn', {
    counts,
    actors: {
      ...run.actors,
      [id]: {
        profile: profile ?? null,
        role,
        promptHeadline: promptHeadline ?? null,
        reportHint: reportHint ?? null,
        sessionId: sessionId ?? null,
        spawnedAt: at,
        lastEventAt: at,
        status: 'running',
        terminalAt: null,
        outcome: null,
        closed: false,
      },
    },
  }, `observed spawn ${id} (${profile ?? 'no profile'}) → ${role}; ${role}=${counts[role]}`);
}

/** Record an observed lifecycle event (wait/result/close/…) for one actor. */
export async function recordEvent(run, { agentId, event, status, outcome }) {
  const id = String(agentId);
  const actor = run.actors[id];
  if (!actor) return run; // not ours (spawned before the run or in another session)
  const nextActor = { ...actor, lastEventAt: new Date().toISOString() };
  if (event) nextActor.lastEvent = event;
  let detail = `observed ${event ?? 'event'} on ${id}`;
  const terminal = TERMINAL_OUTCOMES.has(outcome) ? outcome : null;
  if (terminal && nextActor.status !== 'terminal') {
    nextActor.status = 'terminal';
    nextActor.terminalAt = nextActor.lastEventAt;
    nextActor.outcome = terminal;
    detail += ` → ${terminal}`;
  } else if (status && !terminal) {
    nextActor.status = status; // e.g. 'running' echoed by a wait
  }
  if (event === 'close') nextActor.closed = true;
  // lastEventAt moves on every observation; only material changes journal.
  const material = { ...nextActor, lastEventAt: '' };
  const before = { ...actor, lastEventAt: '' };
  if (JSON.stringify(material) === JSON.stringify(before)) return run;
  return commit(run, 'event', { actors: { ...run.actors, [id]: nextActor } }, detail);
}

/** Record an observed `.agent-work/` file write, classified by path. */
export async function recordArtifact(run, path, kind) {
  const list = run.artifacts?.[kind] ?? [];
  if (list.includes(path) || list.length >= ARTIFACT_CAP) return run;
  return commit(run, 'artifact', {
    artifacts: { ...(run.artifacts ?? {}), [kind]: [...list, path] },
  }, `observed ${kind} artifact ${path}`);
}

/** Close the run: the plugin stops injecting after this. */
export async function closeRun(run, detail = 'run closed') {
  if (run.run?.status === 'closed') return run;
  return commit(run, 'close', { run: { ...run.run, status: 'closed' } }, detail);
}

/** Derive the run phase from observed facts (display + obligation hint only). */
export function derivePhase(run) {
  if (run.run?.status === 'closed') return 'closed';
  const actors = Object.values(run.actors ?? {});
  const impl = actors.filter((a) => a.role === 'impl');
  const review = actors.filter((a) => a.role === 'plan-review' || a.role === 'code-review');
  const planSeen = (run.artifacts?.plan ?? []).length > 0;
  if (actors.length === 0 && !planSeen) return 'starting';
  if (impl.length === 0) return 'plan-review';
  if (review.every((a) => a.role === 'plan-review')) return 'implement';
  return 'code-review';
}
