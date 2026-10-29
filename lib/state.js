/**
 * SFD state machine: the single canonical machine state for one repository.
 *
 * Facts:
 * - State lives at `<repo>/.agent-work/sfd-state.json`, written only by this
 *   module (atomic tmp+rename). Agents never author this file.
 * - Every transition is journaled with a monotonic seq; `phase`, `hold`, and
 *   per-unit progress are the fields every consumer (command, tools, panel)
 *   reads. Markdown artifacts (REQUIREMENTS/PLAN-FULL/TASK/HANDOFF/reports)
 *   stay the human-readable evidence layer; this JSON is state expression only.
 * - Mutations go through `transition()`: pure patch + journal append + atomic
 *   flush, so a crash leaves either the old or the new complete state.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { renderCounts } from './counts.js';
import { dirname, join } from 'node:path';

export const AGENT_WORK = '.agent-work';
export const STATE_FILE = 'sfd-state.json';
export const PHASES = [
  'CLEANUP', 'PLAN', 'PLAN_REVIEW', 'IMPL', 'COMMIT',
  'CODE_REVIEW', 'ACCEPT', 'ARCHIVE', 'DONE',
];

/** Create the initial empty state for a repository. Pure. */
export function initialState(repoRoot) {
  return {
    schema: 1,
    repoRoot,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    seq: 0,
    phase: 'CLEANUP',
    hold: null, // { kind: 'WAITING_USER'|'WAITING_RETRY'|'WAITING_EXTERNAL'|'BLOCKED', reason, since }
    plan: null, // { file, review: { A: {...}, B: {...} }, materialWaves } — no content hashes; identity is path + git state
    units: {}, // id -> { status, impl, codeReview: {...}, wavesUsed, accepted }
    actors: {}, // esAgentId -> { unit, role, route, attempt, report, state }
    git: { authority: null }, // { startBranch, base, decisions: [{at, choice, detail}] }
    decisions: [], // user/main-agent decisions: { at, by, topic, choice, detail }
    journal: [], // { seq, at, kind, detail }
  };
}

/** Load state from a repository; returns null when no SFD work exists. */
export async function loadState(repoRoot) {
  const file = join(repoRoot, AGENT_WORK, STATE_FILE);
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
    throw new Error(`sfd-state.json is not valid JSON: ${error.message}`);
  }
  if (typeof parsed?.schema !== 'number' || parsed.schema !== 1) {
    throw new Error(`Unsupported sfd-state.json schema: ${String(parsed?.schema)}`);
  }
  return parsed;
}

/** Detect the presence of any SFD work state without loading details. */
export async function detectWork(repoRoot) {
  const state = await loadState(repoRoot);
  if (state) {
    return { present: true, kind: 'state', state };
  }
  // No canonical state, but leftover .agent-work SFD markers still matter:
  // they may be an uncleaned previous run or a pre-plugin manual run.
  const markers = ['PLAN-FULL.md', 'FEATURE-STATE.md', 'REQUIREMENTS.md'];
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

/** Apply one transition: patch(state), journal entry, atomic write. */
export async function transition(state, kind, patch, detail = '') {
  const next = structuredClone(state);
  const seq = (next.seq ?? 0) + 1;
  Object.assign(next, structuredClone(patch ?? {}));
  next.seq = seq;
  next.updatedAt = new Date().toISOString();
  next.journal = [...(next.journal ?? []), { seq, at: next.updatedAt, kind, detail }];
  if (next.journal.length > 500) next.journal = next.journal.slice(-500);
  await flush(next);
  return next;
}

/** Atomic write: tmp file in the same directory, then rename. */
export async function flush(state) {
  const file = join(state.repoRoot, AGENT_WORK, STATE_FILE);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Gate helper: is the state machine blocked or paused? */
export function gate(state) {
  if (state.phase === 'DONE') {
    return { allowed: false, reason: 'The SFD run is complete and archived.' };
  }
  if (state.hold) {
    return { allowed: false, reason: `Hold ${state.hold.kind}: ${state.hold.reason}` };
  }
  return { allowed: true };
}

/** Render the resume/handoff brief: current status only, never the whole flow. */
export function renderBrief(state, t) {
  const lines = [];
  lines.push(`# SFD ${t('state.resume')}`);
  lines.push('');
  lines.push(`- Phase: ${state.phase}`);
  lines.push(`- Updated: ${state.updatedAt ?? state.createdAt}`);
  if (state.hold) lines.push(`- Hold: ${state.hold.kind} — ${state.hold.reason}`);
  if (state.plan) {
    lines.push(`- PLAN: ${state.plan.file ?? '.agent-work/PLAN-FULL.md'}`);
    const r = state.plan.review ?? {};
    for (const slot of ['A', 'B']) {
      const s = r[slot];
      lines.push(`- Plan review ${slot}: ${s ? `${s.state ?? 'pending'}${s.report ? `, report ${s.report}` : ''}` : 'not started'}`);
    }
    lines.push(`- Material plan-repair waves: ${state.plan.materialWaves ?? 0}/2`);
  }
  const unitIds = Object.keys(state.units ?? {});
  if (unitIds.length > 0) {
    lines.push('- Units:');
    for (const id of unitIds) {
      const u = state.units[id];
      lines.push(`  - ${id}: ${u.status}; waves ${u.wavesUsed ?? 0}/5${u.accepted ? '; accepted' : ''}`);
    }
  }
  const actorIds = Object.keys(state.actors ?? {});
  if (actorIds.length > 0) {
    lines.push('- Actors:');
    for (const id of actorIds) {
      const a = state.actors[id];
      const where = a.unit ? ` on ${a.unit}` : '';
      lines.push(`  - ${id}: ${a.role}${where}, ${a.state}${a.report ? `, report ${a.report}` : ''}`);
    }
  }
  const counts = renderCounts(state.counts);
  if (counts !== null) lines.push(`- ${t('ctx.counts', { items: counts })}`);
  const open = (state.decisions ?? []).filter((d) => !d.resolved);
  if (open.length > 0) {
    lines.push('- Open decisions:');
    for (const d of open) lines.push(`  - ${d.topic}: ${d.detail ?? ''}`);
  }
  lines.push('');
  lines.push(t('state.readSkillFirst'));
  return lines.join('\n');
}
