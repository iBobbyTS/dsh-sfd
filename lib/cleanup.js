/**
 * Cleanup decision table (the pre-start gate).
 *
 * Deterministic decision logic only; every human interaction is a question
 * card. The caller supplies `deps` so tests can stub git/gitCommit/ask.
 *
 * Branch creation is the MAIN AGENT's responsibility (it derives the name and
 * handles duplicates). This gate only: commits dirt (via gitCommit), switches
 * the workspace back to main when the user asked to base work on main,
 * executes fast-forwards, and reports the user's intent for the agent.
 *
 * Cards have options only; any text typed into the card's free input is NOT
 * consumed here — it is returned verbatim as `userNote` for the agent.
 *
 * Decision table:
 *  1. dirty -> [stop | auto commit] (typed text -> userNote for agent)
 *  2. clean + on main -> no card; intent create-from-main (agent branches)
 *  3. clean + off main, ahead/behind vs main:
 *       0/0  -> [stop | stay | new from current]
 *       >0/0 -> [stop | stay | new from current | new from main (switch to main) | ff main to current]
 *       0/>0 -> [stop | stay | new from current | new from main (switch to main) | ff to main then new branch]
 *       >0/>0 -> [stop | stay | new from current | new from main (switch to main) | agent merge]
 *  Degenerate (no main / mid-merge / detached HEAD) -> generic card.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Shell-free git helper (mirrors dsh-git-commit's env hygiene closely enough for reads). */
export async function git(cwd, args) {
  const { stdout } = await run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Read the working tree facts the decision table needs. Throws on non-repo. */
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

export const STOP = { action: 'stop' };

/**
 * Run the cleanup gate. deps: { inspect, aheadBehind, ask, gitCommit, git, t }
 * Returns:
 *   { stopped: true, decisions, userNote? }
 *   { ok: true, intent, state: { branch, base, decisions }, userNote?, agentMerge?, agentTask? }
 * `intent` is the machine-resolved user intent; options whose follow-up needs
 * judgment (branch naming, merging) carry an `agentTask` string for the agent.
 * Branch creation is NOT performed here.
 */
export async function runCleanup(deps) {
  const { ask, t } = deps;
  const decisions = [];
  const record = (choice, detail = '') => decisions.push({ at: new Date().toISOString(), choice, detail });

  let facts;
  try {
    facts = await deps.inspect(deps.cwd);
  } catch {
    return { error: 'not-git', message: t('state.notGit') };
  }

    let pendingNote = null;
    for (;;) {
    facts = await deps.inspect(facts.root);
    if (!facts.dirty) break;
    const answer = await ask({
      id: 'sfd-dirty',
      header: t('cleanup.dirtyTitle'),
      question: t('cleanup.dirtyQuestion'),
      options: [
        { label: t('cleanup.autoCommit'), description: t('cleanup.autoCommitDesc') },
        { label: t('cleanup.stop'), description: t('cleanup.stopDesc') },
      ],
    });
    const item = answer?.answers?.[0];
    const typedNote = item?.custom?.trim() || null;
    const choice = item?.selected?.[0] ?? null;
    if (choice === t('cleanup.stop')) {
      record('stop', 'dirty workspace, user stopped');
      return { stopped: true, decisions, ...(typedNote ? { userNote: typedNote } : {}) };
    }
    if (choice === t('cleanup.autoCommit')) {
      const result = await deps.gitCommit.commit({ cwd: facts.root });
      if (!result?.success) {
        const retry = await deps.gitCommit.commit({ cwd: facts.root });
        if (!retry?.success) return { error: 'commit-failed', message: retry?.error ?? 'auto commit failed twice', decisions };
      }
      record('auto-commit', result?.hash ?? '');
      // typed text alongside auto-commit is a note for the agent, not a message
      if (typedNote) pendingNote = typedNote;
      continue;
    }
    // no option selected but text typed: the user's input goes to the agent
    if (typedNote) {
      record('dirty-note-for-agent', typedNote);
      pendingNote = typedNote;
      break; // leave the dirty workspace; the agent decides with the note
    }
    record('stop', 'dirty workspace, no choice');
    return { stopped: true, decisions };
    }
    if (pendingNote) {
      // The workspace may still be dirty — hand the note to the agent as-is.
      return { ok: true, intent: 'note-only', state: { branch: facts.branch, base: null, decisions }, userNote: pendingNote, agentTask: 'userNote' };
    }

  // 2. degenerate states -> generic card
  if (facts.detached || facts.midMerge) {
    const answer = await ask({
      id: 'sfd-degenerate',
      header: t('cleanup.branchTitle'),
      question: facts.detached
        ? t('cleanup.detachedHead', { branch: facts.branch })
        : t('cleanup.midMerge'),
      options: [{ label: t('cleanup.stopLabel') }],
    });
    record('stop', facts.detached ? 'detached HEAD' : 'merge in progress');
    const note = answer?.answers?.[0]?.custom?.trim();
    return { stopped: true, decisions, ...(note ? { userNote: note } : {}) };
  }

  // 3. branch base decision. Branch creation is the agent's job; this gate
  // only switches the workspace where the user's choice requires it.
  if (facts.branch === 'main' || facts.branch === 'master') {
    // On main: nothing to ask or switch — the agent names and creates the branch.
    record('create-from-main', 'branch creation delegated to agent');
    return {
      ok: true,
      intent: 'create-from-main',
      state: { branch: 'main', base: 'main', decisions },
      agentTask: 'createBranchFromMain',
    };
  }

  const ab = await deps.aheadBehind(facts.root, 'main');
  if (!ab) {
    // no main reference
    const answer = await ask({
      id: 'sfd-no-main',
      header: t('cleanup.branchTitle'),
      question: t('cleanup.noMainQuestion'),
      options: [
        { label: t('cleanup.stayCurrent') },
        { label: t('cleanup.stopLabel') },
      ],
    });
    const item = answer?.answers?.[0];
    const choice = item?.selected?.[0] ?? t('cleanup.stopLabel');
    if (choice === t('cleanup.stayCurrent')) {
      record('stay-current', 'no main reference');
      return { ok: true, intent: 'stay-current', state: { branch: facts.branch, base: 'none', decisions }, agentTask: 'createBranchFromCurrent' };
    }
    record('stop', 'no main ref');
    return { stopped: true, decisions, ...(item?.custom?.trim() ? { userNote: item.custom.trim() } : {}) };
  }

  const { ahead, behind } = ab;
  let question; let options;
  if (ahead === 0 && behind === 0) {
    question = t('cleanup.inSync');
    options = [t('cleanup.stayCurrent'), t('cleanup.newFromCurrent')];
  } else if (ahead > 0 && behind === 0) {
    question = t('cleanup.sameBehind');
    options = [t('cleanup.stayCurrent'), t('cleanup.newFromCurrent'), t('cleanup.newFromMain'), t('cleanup.ffToCurrent')];
  } else if (ahead === 0 && behind > 0) {
    question = t('cleanup.sameAhead');
    options = [t('cleanup.stayCurrent'), t('cleanup.newFromCurrent'), t('cleanup.newFromMain'), t('cleanup.ffToMain')];
  } else {
    question = t('cleanup.diverged');
    options = [t('cleanup.stayCurrent'), t('cleanup.newFromCurrent'), t('cleanup.newFromMain'), t('cleanup.agentMerge')];
  }
  options.push(t('cleanup.stop'));
  const answer = await ask({
    id: 'sfd-branch-base',
    header: t('cleanup.branchTitle'),
    question,
    options: options.map((label) => ({ label })),
  });
  const choice = answer?.answers?.[0];
  const userNote = choice?.custom?.trim();
  const picked = choice?.selected?.[0] ?? (userNote ? null : t('cleanup.stop'));

  const baseOut = { decisions, ...(userNote ? { userNote } : {}) };
  const topOut = userNote ? { userNote } : {};

  if (picked === t('cleanup.stop')) {
    record('stop', `${question} user stopped`);
    return { stopped: true, ...baseOut };
  }
  if (picked === null) {
    // text only, no option chosen: hand the note to the agent, change nothing
    record('note-only-for-agent', userNote);
    return { ok: true, intent: 'note-only', state: { branch: facts.branch, base: null, decisions }, userNote, agentTask: 'userNote' };
  }

  if (picked === t('cleanup.stayCurrent')) {
    record('stay-current', `ahead=${ahead} behind=${behind}`);
    return { ok: true, intent: 'stay-current', ...topOut, state: { branch: facts.branch, base: facts.branch, ...baseOut }, agentTask: 'createBranchFromCurrent' };
  }
  if (picked === t('cleanup.newFromCurrent')) {
    record('new-from-current', `from ${facts.branch}`);
    return { ok: true, intent: 'new-from-current', ...topOut, state: { branch: facts.branch, base: facts.branch, ...baseOut }, agentTask: 'createBranchFromCurrent' };
  }
  if (picked === t('cleanup.newFromMain')) {
    // program switches the workspace to main; agent creates the branch
    await deps.git(facts.root, ['switch', 'main']);
    record('switch-to-main', 'user chose to base work on main');
    return { ok: true, intent: 'new-from-main', ...topOut, state: { branch: 'main', base: 'main', ...baseOut }, agentTask: 'createBranchFromMain' };
  }
  if (picked === t('cleanup.ffToCurrent')) {
    // main strictly behind: fast-forward main to current branch, stay here
    await deps.git(facts.root, ['branch', '-f', 'main', 'HEAD']);
    record('ff-main-to-current', `main -> ${facts.branch}`);
    return { ok: true, intent: 'ff-main-to-current', ...topOut, state: { branch: facts.branch, base: 'main', ...baseOut }, agentTask: 'createBranchFromCurrent' };
  }
  if (picked === t('cleanup.ffToMain')) {
    // fast-forward to main, then work on a new branch from main (agent creates it)
    await deps.git(facts.root, ['merge', '--ff-only', 'main']);
    record('ff-to-main', '');
    return { ok: true, intent: 'ff-to-main', ...topOut, state: { branch: facts.branch, base: 'main', ...baseOut }, agentTask: 'createBranchFromMain' };
  }
  if (picked === t('cleanup.agentMerge')) {
    record('agent-merge', 'diverged; delegated to main agent');
    return { ok: true, intent: 'agent-merge', agentMerge: true, ...topOut, state: { branch: facts.branch, base: 'main', ...baseOut }, agentTask: 'mergeThenContinue' };
  }
  record('stop', `unhandled choice: ${picked}`);
  return { stopped: true, ...baseOut };
}
