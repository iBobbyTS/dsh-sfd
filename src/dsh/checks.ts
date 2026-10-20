import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-shell';
import type { CheckExecutor } from '../workspace/git-workspace.js';
import type { ProcessResult } from '../workspace/process.js';
import type { DomainRunStore } from './store.js';
import { nativeAgentOptions, seedAgentPermission } from './actors.js';

/** Bash transports argv literally; it does not evaluate model-owned argument contents. */
export function quoteArgv(argv: readonly string[]): string {
  if (!argv.length || !argv[0] || argv.some(value => value.includes('\0'))) throw new Error('Check command must be a nonempty argv.');
  return argv.map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
}

/** Checks cross the ordinary tool policy pipeline before the sandboxing shell runs them. */
export function nativeCheckExecutor(ctx: Context, store: DomainRunStore): CheckExecutor {
  return async ({ run, spec, cwd, signal, timeoutMs }): Promise<ProcessResult> => {
    const owner = store.ownerOf(run.id);
    if (owner === undefined) throw new Error('A native check requires the Run owner.');
    const shell = ctx.get('shell');
    if (shell === undefined || shell.sandboxMode === undefined) throw new Error('A sandboxing DSH shell is required to execute checks.');
    const deadline = AbortSignal.timeout(timeoutMs);
    const lifetime = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    const checkAgent = await ctx.agents.withoutInitiator(() => ctx.agents.create({
      sessionId: SessionId(`sfd-check-${run.id}-${randomUUID()}`),
      meta: { cwd, parentSession: SessionId(owner.sessionId), origin: 'subagent', delegationDepth: 1 },
      agentOptions: nativeAgentOptions(owner), signal: lifetime,
      setup: (agentCtx, agent) => {
        seedAgentPermission(agent, owner);
        agentCtx.tools.presentAs('native');
        agentCtx.tools.restrict({ allow: [] });
        agentCtx.tools.guard(exec => exec.name === 'sfd_check' ? undefined : 'A check Agent only executes its admitted check.');
        agentCtx.tools.register(defineTool({
          name: 'sfd_check',
          description: 'Execute the admitted development check in an isolated candidate workspace under the captured native permissions.',
          parameters: {
            command: { type: 'array', required: true, items: { type: 'string' } },
            description: { type: 'string', required: true },
          },
          output: {
            schema: { type: 'object', additionalProperties: false, properties: {
              exitCode: { required: true, oneOf: [{ type: 'number' }, { type: 'null' }] },
              output: { type: 'string', required: true }, timedOut: { type: 'boolean', required: true },
              cancelled: { type: 'boolean', required: true }, truncated: { type: 'boolean', required: true },
            } },
            render: (_args, value) => [{ type: 'text', text: value.output }],
          },
          async execute(args, exec) {
            if (exec.agent !== agent) throw new Error('Check Agent identity mismatch.');
            if (JSON.stringify(args.command) !== JSON.stringify(spec.command)) throw new Error('Check command differs from its admitted contract.');
            const execution = await shell.execute(shell.resolve({
              command: quoteArgv(args.command), workdir: cwd, timeoutMs, onExpiry: 'kill', signal: exec.signal,
              sandboxPolicy: ctx.sandboxPolicy.resolve({ session: agent.session }),
            }));
            const value = await execution.result();
            if (value.sandbox === undefined) throw new Error('The check executor returned no sandbox facts.');
            if (value.sandbox.denied || value.sandbox.runnerFailed) throw new Error('The native sandbox could not complete this check.');
            return {
              exitCode: value.exitCode,
              output: `${value.stdout.text}${value.stderr.text ? `\n[stderr]\n${value.stderr.text}` : ''}`,
              timedOut: value.timedOut || (deadline.aborted && !signal?.aborted),
              cancelled: value.aborted && !deadline.aborted,
              truncated: value.stdout.truncated || value.stderr.truncated,
            };
          },
        }));
      },
    }));
    try {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`sfd-check-${randomUUID()}`), name: 'sfd_check', agent: checkAgent.agent,
        arguments: { command: spec.command, description: `Run development check ${spec.id}` }, signal: lifetime,
      });
      if (result.isError) throw new Error(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
      // The native tool schema validates the canonical result before it returns.
      const value = result.value;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed native check result.');
      if ((value.exitCode !== null && typeof value.exitCode !== 'number') || typeof value.output !== 'string'
        || typeof value.timedOut !== 'boolean' || typeof value.cancelled !== 'boolean' || typeof value.truncated !== 'boolean') {
        throw new Error('Malformed native check result.');
      }
      return { exitCode: value.exitCode, output: value.output, timedOut: value.timedOut, cancelled: value.cancelled, truncated: value.truncated };
    } finally { await checkAgent.dispose(); }
  };
}
