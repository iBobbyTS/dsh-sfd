/** Actual actor/round/page facts; progress itself lives in SFD-GRAPH.json. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { graphLocation } from './graph-store.js';

const queues = new Map();

function fresh(repo, sessionId) {
  return { schema: 1, sessionId, repo, actors: {}, groups: {}, instructionRoles: [] };
}

export async function readSession(repo, sessionId) {
  const loc = await graphLocation(repo, sessionId);
  let raw;
  try { raw = await readFile(loc.stateFile, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return fresh(loc.root, sessionId); throw error; }
  let state;
  try { state = JSON.parse(raw); }
  catch (error) { throw new Error(`actor state is not valid JSON: ${error.message}`); }
  if (state?.schema !== 1 || state.sessionId !== sessionId || state.repo !== loc.root) throw new Error('actor state identity/schema mismatch; prior records are preserved');
  state.actors ??= {};
  state.groups ??= {};
  state.instructionRoles ??= [];
  return state;
}

export async function withSession(repo, sessionId, fn) {
  const loc = await graphLocation(repo, sessionId);
  await mkdir(dirname(loc.stateFile), { recursive: true });
  const prior = queues.get(loc.stateFile) ?? Promise.resolve();
  const work = prior.catch(() => {}).then(async () => {
    const state = await readSession(loc.root, sessionId);
    const checkpoint = async () => {
      const temp = `${loc.stateFile}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, loc.stateFile);
    };
    try { return await fn(state, loc.root, { checkpoint }); }
    finally { await checkpoint(); }
  });
  queues.set(loc.stateFile, work);
  try { return await work; }
  finally { if (queues.get(loc.stateFile) === work) queues.delete(loc.stateFile); }
}
