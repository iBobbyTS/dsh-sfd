import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { createScope,scopeTarget } from '@deepseek-ai/dsh-scope';
import { installScopedHost,membershipFold,MEMBERSHIP_KEY,SKILL } from '../lib/scoped-host.js';

const esName=suffix=>'mcp__external_subagent__'+suffix;
function tool(name){return defineTool({name,description:'Real registry test tool',parameters:{},output:{schema:{type:'json'},render:(_args,result)=>[{type:'text',text:JSON.stringify(result)}]},execute:async()=>({ok:true})});}
async function setup(){
 const ctx=new Context();
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}});
 const tools=new ToolRuntime(ctx);const skills=new SkillRegistry(ctx);new SessionProjectionRegistry(ctx);
 const agents=[];ctx.provide('agents',{list:()=>[...agents]});
 const makeAgent=id=>{const agent={id,session:{id,header:{id},events:[],inheritedEventCount:0,get seq(){return this.events.length;},snapshotEvents(start=0,end=this.events.length){return this.events.slice(start,end);},eventAt(seq){return this.events[seq];}}};const scope=createScope(ctx,agent);agent.ctx=scope.ctx;agent.dispose=()=>scope.dispose();agents.push(agent);return agent;};
 const pluginScope=createScope(ctx,{});const host=installScopedHost(pluginScope.ctx);
 const event=async(agent,e)=>{agent.session.events.push(e);ctx.emit(scopeTarget(agent.session,agent),'session/event',agent.session,e);await new Promise(resolve=>setImmediate(resolve));};
 return {ctx,tools,skills,agents,makeAgent,host,event,pluginScope,dispose:async()=>{await pluginScope.dispose();for(const a of agents)await a.dispose();}};
}
test('membership is pure, supported log events activate only their session',()=>{
 const state={sfdActive:false};assert.equal(membershipFold(state,{type:'tool/call',data:{name:'unrelated'}}),state);
 const active=membershipFold(state,{type:'tool/call',data:{name:'skill',arguments:JSON.stringify({name:SKILL})}});assert.deepEqual(active,{sfdActive:true});
 assert.equal(membershipFold(active,{type:'unknown'}),active);
 assert.deepEqual(membershipFold(state,{type:'user/message',data:{source:{kind:'skill-invocation',name:SKILL}}}),active);
});
test('real Cordis restrictions hide presentation/lookup/dispatch, refresh without recursion, preserve peers and dispose on unload',async()=>{
 const f=await setup();try{
  f.ctx.tools.register(tool(esName('spawn')));f.ctx.tools.register(tool('skill'));
  f.ctx.skills.register({name:'external-subagent',description:'Normal external-subagent skill',source:'test',content:'ES instructions',invocation:{modelInvocable:true,userInvocable:true}});
  const current=f.makeAgent('current'),peer=f.makeAgent('peer');
  await f.event(current,{type:'user/message',seq:0,data:{source:{kind:'skill-invocation',name:SKILL}}});
  await f.host.assertActive(current);
  assert.equal(f.tools.get(esName('spawn'),current),undefined);assert.ok(f.tools.get(esName('spawn'),peer));assert.ok(f.tools.get('skill',current));
  assert.equal(f.tools.schemas(current).some(x=>x.name===esName('spawn')),false);
  const outcome=await f.tools.execute({name:esName('spawn'),arguments:{},callId:'hidden-call',agent:current,signal:new AbortController().signal});
  assert.equal(outcome.isError,true);
  const shadow=await f.skills.get('external-subagent',{scope:current});assert.equal(shadow.content,'');assert.deepEqual(shadow.invocation,{modelInvocable:false,userInvocable:false});
  assert.equal((await f.skills.get('external-subagent',{scope:peer})).invocation.modelInvocable,true);
  f.ctx.tools.register(tool(esName('observe')));assert.equal(f.tools.get(esName('observe'),current),undefined);assert.ok(f.tools.get(esName('observe'),peer));
  assert.equal(f.host.status(current).hidden.length,2);
  await f.pluginScope.dispose();assert.ok(f.tools.get(esName('spawn'),current));assert.equal((await f.skills.get('external-subagent',{scope:current})).invocation.modelInvocable,true);
 }finally{await f.dispose();}
});
test('same-scope tool registration is a capability error, unknown restrict names fail, resume reinstates scoped effects',async()=>{
 const f=await setup();try{
  const agent=f.makeAgent('resumed');agent.ctx.tools.register(tool(esName('local')));
  assert.throws(()=>agent.ctx.tools.restrict({deny:[esName('missing')]}),/unknown|inherited|restrict/i);
  await f.event(agent,{type:'tool/call',seq:0,data:{name:'skill',arguments:JSON.stringify({name:SKILL})}});
  await assert.rejects(()=>f.host.assertActive(agent),/capability error/);
  await agent.dispose();f.ctx.emit('agent/disposed',{agent});assert.equal(f.host.status(agent).active,false);
  const resumed=f.makeAgent('resumed');resumed.session=agent.session;
  f.ctx.tools.register(tool(esName('inherited')));
  await f.ctx.serial(scopeTarget(resumed,resumed),'agent/created',{agent:resumed,source:'resume'});
  await f.host.assertActive(resumed);assert.equal(f.tools.get(esName('inherited'),resumed),undefined);
  const untouched=f.makeAgent('same-repository-other-session');assert.ok(f.tools.get(esName('inherited'),untouched));
 }finally{await f.dispose();}
});
test('inherited membership log prefixes do not activate a new session and duplicate activation registers one shadow',async()=>{
 const f=await setup();try{
  f.ctx.tools.register(tool(esName('spawn')));
  const agent=f.makeAgent('fork');agent.session.inheritedEventCount=1;
  await f.event(agent,{type:'tool/call',seq:0,data:{name:'skill',arguments:JSON.stringify({name:SKILL})}});
  assert.equal(f.host.status(agent).active,false);assert.ok(f.tools.get(esName('spawn'),agent));
  const own={type:'tool/call',seq:1,data:{name:'skill',arguments:JSON.stringify({name:SKILL})}};
  await f.event(agent,own);await f.host.assertActive(agent);await f.host.assertActive(agent);
  assert.equal(f.host.status(agent).hidden.length,1);assert.equal((await f.skills.get('external-subagent',{scope:agent})).invocation.userInvocable,false);
 }finally{await f.dispose();}
});
