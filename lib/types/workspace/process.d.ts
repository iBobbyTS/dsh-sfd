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
export declare function runProcess(argv: string[], options: ProcessOptions): Promise<ProcessResult>;
