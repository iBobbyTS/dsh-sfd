/**
 * Read-only git fact probes for the SFD start gate.
 *
 * The branch/cleanup decision table used to run here programmatically; it now
 * lives as mandatory instructions in the sectioned-feature-development skill
 * and the `/sfd` handoff text — the main agent performs workspace preparation
 * itself (dirty-workspace handling, branch-base decision, feature-branch
 * creation) and then calls `sfd_start`, which only records the git facts it
 * observes. This module never mutates the repository.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Shell-free git helper (read-only; `sfd_start` performs no git writes). */
export async function git(cwd, args) {
  const { stdout } = await run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Read the working-tree facts `sfd_start` records. Throws on non-repo. */
export async function inspect(cwd) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  let branch;
  let detached = false;
  try {
    branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    detached = true;
    branch = `detached@${(await git(root, ['rev-parse', '--short', 'HEAD'])).trim()}`;
  }
  const status = (await git(root, ['status', '--porcelain'])).length > 0;
  let midMerge = false;
  try {
    await git(root, ['rev-parse', '--verify', 'MERGE_HEAD']);
    midMerge = true;
  } catch { /* not merging */ }
  return { root, branch, detached, dirty: status, midMerge };
}

/** ahead/behind of current branch vs base ref; null when base ref does not exist. */
export async function aheadBehind(root, baseRef = 'main') {
  try {
    const base = (await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${baseRef}`])).trim();
    if (!base) return null;
  } catch {
    return null;
  }
  const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const count = async (range) => Number.parseInt((await git(root, ['rev-list', '--count', range])).trim(), 10);
  const ahead = await count(`${baseRef}..HEAD`);
  const behind = await count(`HEAD..${baseRef}`);
  return { ahead, behind, head, base: head };
}
