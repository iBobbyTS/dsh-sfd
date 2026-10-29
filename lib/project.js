/**
 * Project identity for the panel's "Current Project" scope.
 *
 * Facts:
 * - The panel's project scope is repository-wide, not directory-wide: two
 *   Sessions opened in different subdirectories of one repository must share
 *   one stage configuration, which is what `git rev-parse --show-toplevel`
 *   gives. A working directory outside any repository has no project root, and
 *   the panel disables that section rather than inventing a key.
 * - Resolving is read-only and cheap; a failure is a normal answer (`null`),
 *   never an error the panel would show.
 */
import { execFile } from 'node:child_process';

const RESOLVE_TIMEOUT_MS = 5000;

/**
 * Resolve a working directory to its repository root.
 * @param cwd - the session's working directory.
 * @param options.run - root producer override (tests): `(cwd) => Promise<string|null>`.
 * @returns the absolute repository root, or null outside a repository.
 */
export async function resolveProjectRoot(cwd, { run } = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  const produce = run ?? defaultRun;
  try {
    const root = await produce(cwd);
    if (typeof root !== 'string') return null;
    const trimmed = root.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Ask Git for the enclosing work tree; a non-repository exits non-zero. */
function defaultRun(cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: RESOLVE_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
