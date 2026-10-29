/** DSH SFD entry: one command, one durable task graph, model-owned decisions. */
import { detectWork, renderBrief } from './lib/state.js';
import { inspect } from './lib/cleanup.js';
import { makeT } from './lib/i18n.js';
import { registerSfdTools } from './lib/tools.js';
import { registerWorkflowTools } from './lib/workflow-tools.js';
import { sfdSkillProvider } from './lib/skill-provider.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const inject=['commands','agents','userQuestions','gitCommit','workingDirectory','tools','skills'];

export function apply(ctx) {
  ctx.skills.registerProvider(() => sfdSkillProvider);
  const translator=makeT(ctx).catch(()=>key=>key);
  const askCard=async(agent,signal,question)=>{
    const item={id:question.id,question:question.question};
    for(const field of ['header','detail','options'])if(question[field]!==undefined)item[field]=question[field];
    return ctx.userQuestions.ask({agent,signal,questions:[item]});
  };
  ctx.commands.register({
    name:'sfd',description:'Start or resume SFD without resetting the active workflow',recordInput:false,
    handler:async({agent,signal})=>{
      signal?.throwIfAborted();
      const t=await translator;
      if(ctx.agents.get(agent.id)!==agent || !ctx.agents.roots().includes(agent))return{kind:'error',text:t('state.notRootAgent')};
      const cwd=await ctx.workingDirectory.ensure(agent);
      if(!cwd)return{kind:'error',text:t('state.noCwd')};
      let root;try{root=(await inspect(cwd)).root;}catch{return{kind:'error',text:t('state.notGit')};}
      const existing=await detectWork(root);
      const message=existing.kind==='state'?renderBrief(existing.state,t)
        :existing.kind==='legacy-markers'?`${t('state.legacyTitle')}\n${existing.markers.join(', ')}\n${t('state.legacyBody')}`
        :`${t('state.fresh')}\n\n${t('state.handoff')}`;
      // Command result is UI-only: enqueue a copy for the current Main agent.
      agent.followup(createUserMessage({content:[{type:'text',text:message}],source:{kind:'user'}}));
      return{kind:'success',text:message};
    },
  });
  registerSfdTools(ctx,{askCard,t:()=>translator});
  registerWorkflowTools(ctx);
}
