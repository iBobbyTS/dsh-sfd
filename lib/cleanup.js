/**
 * Cleanup decision table (the pre-start gate).
 *
 * Deterministic decision logic only; every human interaction is a question
 * card. The caller supplies `deps` so tests can stub git/gitCommit/ask.
 *
 * Decision table (from REQUIREMENTS.md §3):
 *  1. dirty -> [stop | auto commit | custom message]
 *  2. clean + on main -> create feature branch (confirm name)
 *  3. clean + off main:
 *     ahead/behind vs main:
 *       0/0 -> [stop | stay | new from current]
 *       >0/0 -> [stop | stay | new from current | new from main | ff main to current]
 *       0/>0 -> [stop | stay | new from current | new from main | ff to main | custom merge]
 *       >0/>0 -> [stop | stay | new from current | new from main | agent merge]
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
 * Run the cleanup gate. deps: { inspect, aheadBehind, ask, gitCommit, git, t, slug }
 * Returns { stopped: true } | { ok: true, state: {startBranch, base, decisions[]} }
 * Every user choice is recorded verbatim in decisions.
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

  // 1. dirty gate (loops until clean, stop, or error)
  for (;;) {
    facts = await deps.inspect(facts.root);
    if (!facts.dirty) break;
    const answer = await ask({
      id: 'sfd-dirty',
      header: t('cleanup.dirtyTitle'),
      question: t('cleanup.dirtyQuestion'),
      options: [
        { label: t('cleanup.autoCommit'), description: 'dsh-git-commit AI message' },
        { label: t('cleanup.customCommit'), description: 'free text' },
        { label: t('cleanup.stop'), description: 'abort SFD start' },
      ],
    });
    const item = answer?.answers?.[0];
    const choice = item?.selected?.[0] ?? t('cleanup.stop');
    if (choice === t('cleanup.stop') && !item?.custom) {
      record('stop', 'dirty workspace, user stopped');
      return { stopped: true, decisions };
    }
    if (choice === t('cleanup.autoCommit')) {
      const result = await deps.gitCommit.commit({ cwd: facts.root });
      if (!result?.success) {
        const retry = await deps.gitCommit.commit({ cwd: facts.root });
        if (!retry?.success) return { error: 'commit-failed', message: retry?.error ?? 'auto commit failed twice', decisions };
      }
      record('auto-commit', result?.hash ?? '');
      continue;
    }
    // custom message (typed text or chose the custom option with input)
    const message = item?.custom?.trim();
    if (!message) {
      record('stop', 'dirty workspace, empty custom message');
      return { stopped: true, decisions };
    }
    const result = await deps.gitCommit.commit({ cwd: facts.root, message });
    if (!result?.success) return { error: 'commit-failed', message: result?.error ?? 'commit with custom message failed', decisions };
    record('custom-commit', `${result?.hash ?? ''} message=${message}`);
    // loop re-inspects
  }

  // 2. degenerate states -> generic card
  if (facts.detached || facts.midMerge) {
    const answer = await ask({
      id: 'sfd-degenerate',
      header: t('cleanup.branchTitle'),
      question: facts.detached
        ? `Detached HEAD at ${facts.branch}. ${t('cleanup.noMainQuestion')}`
        : `Merge in progress. ${t('cleanup.noMainQuestion')}`,
      options: [{ label: t('cleanup.stopLabel') }],
    });
    record('stop', facts.detached ? 'detached HEAD' : 'merge in progress');
    return { stopped: true, decisions };
  }

  // 3. branch base decision
  if (facts.branch === 'main' || facts.branch === 'master') {
    const slug = (deps.slug ?? 'feature').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'feature';
    const suggested = `feature/${slug}`;
    const answer = await ask({
      id: 'sfd-branch-name',
      header: t('cleanup.branchName'),
      question: t('cleanup.branchNameQuestion'),
      detail: t('cleanup.onMain'),
      options: [{ label: suggested, description: t('cleanup.branchName') }],
    });
    const item = answer?.answers?.[0];
    const name = (item?.custom?.trim() || item?.selected?.[0] || suggested);
    if (item?.selected?.[0] === t('cleanup.stop')) { record('stop', 'on main, stopped'); return { stopped: true, decisions }; }
    await deps.git(facts.root, ['switch', '-c', name]);
    record('create-branch-from-main', name);
    return { ok: true, state: { startBranch: name, base: 'main', decisions } };
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
    if (choice === t('cleanup.stopLabel') || !choice) { record('stop', 'no main ref'); return { stopped: true, decisions }; }
    record('stay-current', 'no main reference');
    return { ok: true, state: { startBranch: facts.branch, base: 'none', decisions } };
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
    options = [t('cleanup.stayCurrent'), t('cleanup.newFromCurrent'), t('cleanup.newFromMain'), t('cleanup.ffToMain'), t('cleanup.customMerge')];
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
  const picked = choice?.selected?.[0] ?? t('cleanup.stop');
  const custom = choice?.custom?.trim();

  if (picked === t('cleanup.stop')) { record('stop', `${question} user stopped`); return { stopped: true, decisions }; }

  if (picked === t('cleanup.stayCurrent')) {
    record('stay-current', `ahead=${ahead} behind=${behind}`);
    return { ok: true, state: { startBranch: facts.branch, base: facts.branch, decisions } };
  }
  if (picked === t('cleanup.newFromCurrent')) {
    const name = custom || `feature/${deps.slug ?? 'feature'}`;
    await deps.git(facts.root, ['switch', '-c', name]);
    record('create-branch-from-current', `${name} from ${facts.branch}`);
    return { ok: true, state: { startBranch: name, base: facts.branch, decisions } };
  }
  if (picked === t('cleanup.newFromMain')) {
    const name = custom || `feature/${deps.slug ?? 'feature'}`;
    await deps.git(facts.root, ['switch', '-c', name, 'main']);
    record('create-branch-from-main', name);
    return { ok: true, state: { startBranch: name, base: 'main', decisions } };
  }
  if (picked === t('cleanup.ffToCurrent')) {
    // main strictly behind: fast-forward main to current branch, then work here
    await deps.git(facts.root, ['branch', '-f', 'main', 'HEAD']);
    record('ff-main-to-current', `main -> ${facts.branch}`);
    return { ok: true, state: { startBranch: facts.branch, base: 'main', decisions } };
  }
  if (picked === t('cleanup.ffToMain')) {
    await deps.git(facts.root, ['merge', '--ff-only', 'main']);
    record('ff-to-main', '');
    return { ok: true, state: { startBranch: facts.branch, base: 'main', decisions } };
  }
  if (picked === t('cleanup.customMerge')) {
    if (!custom) { record('stop', 'empty merge message'); return { stopped: true, decisions }; }
    await deps.git(facts.root, ['merge', 'main', '-m', custom]);
    record('custom-merge', custom);
    return { ok: true, state: { startBranch: facts.branch, base: 'main', decisions } };
  }
  if (picked === t('cleanup.agentMerge')) {
    record('agent-merge', 'diverged; delegated to main agent');
    return { ok: true, agentMerge: true, state: { startBranch: facts.branch, base: 'main', decisions } };
  }
  record('stop', `unhandled choice: ${picked}`);
  return { stopped: true, decisions };
}
