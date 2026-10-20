import { spawn } from 'node:child_process';

export interface ProcessResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated?: boolean;
}
export interface ProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

/** Shell-free process primitive. Production check execution is supplied by DSH. */
export function runProcess(argv: string[], options: ProcessOptions): Promise<ProcessResult> {
  if (!argv.length || !argv[0] || argv.some((part) => part.includes('\0'))) throw new Error('Invalid command argv.');
  if (options.signal?.aborted) return Promise.resolve({ exitCode: null, output: 'Cancelled before execution.', timedOut: false, cancelled: true });
  return new Promise((resolve, reject) => {
    const limit = options.maxOutputBytes ?? 1_048_576;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd, env: options.env ?? process.env,
      shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer): void => {
      if (bytes < limit) chunks.push(chunk.subarray(0, Math.max(0, limit - bytes)));
      bytes += chunk.length;
      if (bytes > limit) truncated = true;
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const kill = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal); }
    };
    const stop = (): void => {
      kill('SIGTERM');
      escalation ??= setTimeout(() => kill('SIGKILL'), 300);
      escalation.unref();
    };
    const abort = (): void => { cancelled = true; stop(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 60_000);
    timer.unref();
    const cleanup = (): void => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener('abort', abort);
    };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (exitCode) => {
      cleanup();
      resolve({ exitCode, output: Buffer.concat(chunks).toString('utf8') + (truncated ? '\n[Output limit reached.]\n' : ''), timedOut, cancelled, truncated });
    });
    child.stdin.on('error', () => { /* Early command termination can close stdin. */ });
    child.stdin.end(options.input);
  });
}
