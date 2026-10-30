/** Public tools: compile the graph, dispatch/wait, and let Main edit progress directly in SFD-GRAPH.json. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createEsTransport } from './es-cli.js';
import * as execution from './execution.js';
import { errorInstruction } from './guidance.js';

const str = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) });
const number = (description, required = false) => ({ type: 'number', description, ...(required ? { required: true } : {}) });
const list = (description, required = false) => ({ type: 'array', items: { type: 'string' }, description, ...(required ? { required: true } : {}) });

export function registerWorkflowTools(ctx, { es = createEsTransport(), host } = {}) {
  const add = (name, description, parameters, handler) => ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      try {
        if (!exec.agent?.session?.id) throw new Error('real current host session required');
        await host?.assertActive(exec.agent);
        const repo = await ctx.workingDirectory.ensure(exec.agent);
        if (!repo) throw new Error('no working directory');
        const session = exec.agent.session.id;
        const rpc = (command, payload) => es(command, payload, { signal: exec.signal });
        return await handler(repo, session, args, rpc);
      } catch (error) {
        return {
          ok: false,
          error: error.message,
          code: error.code ?? 'SFD_CONTRACT',
          locations: error.locations ?? [],
          instruction: errorInstruction(error),
          ...(error.recovery ? { recovery: error.recovery } : {}),
          ...(error.actorId ? { actor_id: error.actorId, message_id: error.messageId } : {}),
        };
      }
    },
  }));

  add('sfd_workflow_compile', 'Compile PLAN-FULL into the editable per-session SFD-GRAPH.json. Back up an existing graph before replacing it; return already-up-to-date when the plan and canonical graph structure are unchanged.', {}, execution.compileWorkflow);

  add('sfd_subagent_spawn', 'Dispatch one or more graph nodes after checking graph prerequisites. The graph is the progress authority; this tool records real actor facts only.', {
    tasks: {
      type: 'array',
      required: true,
      items: { type: 'object', additionalProperties: true },
      description: '1..16 entries: {node, assignment, route?:{profile} OR {subagent,model?,effort?,developer_instructions?}, purpose?:"implementation"|"repair", repair_route?:route}. Reviews always allow fresh spawn; Main decides review sessions. Implementation spawn defaults to a new cycle. For repair the program reuses the cycle large actor, or spawns one large actor for an original std using saved repair_route or the supplied large route. Inspect returned actual IDs/actions. Record arbitrary user step skips in the graph; change functionality in PLAN-FULL then compile.',
    },
  }, execution.spawn);

  add('sfd_subagent_wait', 'Wait for every requested actor and batch peer, return reports and remaining IDs, and explain the next mandatory review. It never marks graph status.', {
    agent_ids: list('1..16 distinct ES IDs', true),
    wait_time: number('0..290 seconds; default 290'),
  }, execution.wait);

  add('sfd_subagent_result', 'Read the next report page for the current actor round; pagination facts are recorded, graph status is untouched.', {
    agent_id: str('ES actor ID', true),
    offset: number('Next result offset'),
    limit: number('Result page size'),
  }, execution.result);

  add('sfd_subagent_send', 'Main selects the review actor freely; no plan/code-review continuity gate. Implementation repair targets are selected by the program from the current cycle, possibly spawning the first escalated large worker instead. Always use the returned actual actor ID. Never changes graph status.', {
    agent_id: str('Main-selected reviewer ID, or an implementation actor identifying the owning unit', true),
    node: str('Optional pending node; must keep task kind and, for implementation, owning unit'),
    content: str('Main-selected bounded follow-up', true),
    mode: str('queue (default) or steer'),
    purpose: { type: 'string', enum: ['implementation', 'repair'], description: 'Implementation only: defaults to repair; implementation explicitly starts a new cycle' },
    route: { type: 'object', additionalProperties: true, description: 'Configured impl_large route for the first std repair when no repair_route was saved; ignored when reusing the cycle actor' },
    repair_route: { type: 'object', additionalProperties: true, description: 'Optional configured impl_large route saved for repairs in a new implementation cycle' },
  }, execution.send);

  add('sfd_subagent_respond', 'Answer a pending user-input request or allow/deny a permission request for a known actor. Preserve ES effective decision and then wait for fresh state; never changes graph completion.', {
    agent_id: str('Existing ES actor ID', true),
    request_id: str('Pending request ID from wait', true),
    decision: { type: 'string', enum: ['allow', 'deny', 'answer'], required: true, description: 'permission: allow or deny; user_input: answer' },
    content: str('Non-empty answer text required for answer; omit for permission decisions'),
  }, execution.respond);

  add('sfd_subagent_cancel', 'Request cancellation of this actor only. It does not change graph status, cancel peers, roll back edits or count as completion; wait for the real outcome.', {
    agent_id: str('ES actor ID', true),
  }, execution.cancel);

  add('sfd_subagent_observe', 'Read actor diagnostics without changing graph or progress; observation never releases a successor.', {
    agent_id: str('ES actor ID', true),
  }, execution.observe);
}
