/** Thin SFD graph compiler and session-scoped external-subagent wrapper. */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { installScopedHost, SKILL } from './lib/scoped-host.js';
import { registerWorkflowTools } from './lib/workflow-tools.js';
import { sfdSkillProvider } from './lib/skill-provider.js';
export const inject=['commands','agents','workingDirectory','tools','skills','sessionProjections'];
export function apply(ctx){
  ctx.skills.registerProvider(()=>sfdSkillProvider);
  const host=installScopedHost(ctx);
  registerWorkflowTools(ctx,{host});
  ctx.commands.register({name:'sfd',description:'Load the SFD wrapper in this session; never change Git or install anything.',recordInput:false,
    handler:async({agent,signal})=>{
      signal?.throwIfAborted();
      const text='Read the sectioned-feature-development skill, write or update PLAN-FULL, then call sfd_workflow_compile. Main edits SFD-GRAPH.json progress and owns semantic decisions; mandatory Plan/Code reviews must not be skipped. Other sessions are unaffected.';
      agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'skill-invocation',name:SKILL}}));
      return {kind:'success',text};
    },
  });
}
