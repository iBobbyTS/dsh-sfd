/**
 * The one process boundary between this plugin and external-subagent.
 *
 * Facts:
 * - ES is a local daemon reached through the `external-subagent` launcher; its
 *   MCP server is one client of that daemon. The plugin must not depend on an
 *   MCP client being mounted in the Host, so it calls the CLI directly.
 * - ES reports failures as `{"ok":false,...}` on stdout **with exit status 0**.
 *   Every call therefore decodes and checks `ok` instead of trusting the exit
 *   code; a non-zero exit is a launcher/runtime failure and is reported with
 *   its stderr tail.
 * - The binary is resolved per call: `EXTERNAL_SUBAGENT_BIN`, then known install
 *   locations, then `PATH`. A GUI-launched Host can inherit a minimal `PATH`.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';

/** Default bound for an ES call that is not a spawn. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** An ES call that did not produce a usable answer. */
export class EsError extends Error {
  /**
   * @param message - human-readable reason.
   * @param options.code - ES error code when the daemon named one.
   * @param options.detail - the daemon's error object, unmodified.
   */
  constructor(message, { code = 'ES_ERROR', detail = null } = {}) {
    super(message);
    this.name = 'EsError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Locate the ES launcher.
 * @param env - environment to read (tests).
 * @returns an absolute path when a known install exists, else the bare name.
 */
export function resolveBinary(env = process.env) {
  if (typeof env.EXTERNAL_SUBAGENT_BIN === 'string' && env.EXTERNAL_SUBAGENT_BIN.length > 0) return env.EXTERNAL_SUBAGENT_BIN;
  const candidates = [
    '/opt/homebrew/bin/external-subagent',
    '/usr/local/bin/external-subagent',
    join(homedir(), '.local/bin/external-subagent'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'external-subagent';
}

/**
 * Run one ES command.
 * @param args - argv after the binary name.
 * @param options.timeoutMs - wall-clock bound.
 * @param options.signal - aborts the child process.
 * @returns raw stdout.
 */
export function launcherEnvironment(env=process.env,bin=resolveBinary(env)){
  const paths=[dirname(process.execPath),...(bin.includes('/')?[dirname(bin)]:[]),'/opt/homebrew/bin','/usr/local/bin',env.PATH??'/usr/bin:/bin'];
  return {...env,PATH:[...new Set(paths)].join(delimiter)};
}
export function runEs(args, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, env=process.env, invoke=execFile } = {}) {
  const bin = resolveBinary(env);
  return new Promise((resolve, reject) => {
    invoke(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: launcherEnvironment(env,bin), signal }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError') {
          reject(new EsError('external-subagent call was aborted', { code: 'ES_ABORTED' }));
          return;
        }
        const detail = String(stderr || error.message).trim().slice(0, 600);
        reject(new EsError(
          error.code === 'ENOENT'
            ? 'external-subagent CLI not found; install it to run SFD stages'
            : `external-subagent ${args[0] ?? 'call'} failed: ${detail}`,
          { code: error.code === 'ENOENT' ? 'ES_MISSING' : 'ES_LAUNCH' },
        ));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Decode one ES JSON answer.
 * @param stdout - the command's stdout.
 * @returns the decoded document, always with `ok: true`.
 * @throws {EsError} on non-JSON output or an `ok:false` answer.
 */
export function parseEsJson(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new EsError(`external-subagent returned non-JSON output: ${String(stdout).trim().slice(0, 200)}`, { code: 'ES_OUTPUT' });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EsError('external-subagent returned an unexpected document', { code: 'ES_OUTPUT' });
  }
  if (value.ok !== true) {
    const error = value.error !== null && typeof value.error === 'object' ? value.error : {};
    throw new EsError(String(error.message ?? 'external-subagent rejected the call'), {
      code: String(error.code ?? 'ES_ERROR'),
      detail: error,
    });
  }
  return value;
}

/**
 * Run one ES command and decode its envelope.
 * @param args - argv after the binary name.
 * @param options - passthrough to {@link runEs}.
 */
export async function runEsJson(args, options) {
  return parseEsJson(await runEs(args, options));
}

/** Public CLI transport. Wait's process deadline exceeds its daemon deadline. */
export function createEsTransport({run=runEs}={}) {
  return async (command,args={},options={})=>{
    if(!['spawn','wait','send','observe','result','cancel','respond'].includes(command))throw new EsError('unsupported wrapper command');
    if(command==='wait'){
      const ids=Array.isArray(args.agent_id)?args.agent_id:[args.agent_id];
      if(ids.length<1||ids.length>16)throw new EsError('wait requires 1..16 IDs');
      if(!Number.isInteger(args.wait_time??290)||(args.wait_time??290)<0||(args.wait_time??290)>290)throw new EsError('wait_time must be 0..290');
    }
    const timeoutMs=command==='wait'?((args.wait_time??290)+20)*1000:command==='spawn'?120000:30000;
    const envelope=parseEsJson(await run([command,'--json',JSON.stringify(args)],{...options,timeoutMs}));
    if(!envelope.result||typeof envelope.result!=='object')throw new EsError('missing result in CLI envelope',{code:'ES_OUTPUT'});
    return envelope.result;
  };
}
