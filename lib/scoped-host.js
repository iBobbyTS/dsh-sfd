/** Public host adapters only. Per-agent effects; logs contain membership, not execution. */
import { z } from 'zod';
export const MEMBERSHIP_KEY='sfd-membership';
export const SKILL='sectioned-feature-development';
const externalName=name=>/^mcp__external_subagent__/.test(name);
const argsOf=value=>{if(typeof value==='string')try{return JSON.parse(value);}catch{return {};}return value??{};};
export function membershipFold(state,event){
  if(state.sfdActive||event.seq<(state.inheritedEventCount??0))return state;
  const data=event.data??event;
  if(event.type==='user/message'&&data.source?.kind==='skill-invocation'&&data.source.name===SKILL)return {...state,sfdActive:true};
  if(event.type==='tool/call'&&data.name==='skill'&&argsOf(data.arguments).name===SKILL)return {...state,sfdActive:true};
  return state;
}
export function installScopedHost(ctx){
  const active=new Map();let disposed=false;
  ctx.sessionProjections.register({key:MEMBERSHIP_KEY,stateVersion:1,stateSchema:z.object({sfdActive:z.boolean(),inheritedEventCount:z.number().optional()}),init:(_header,inheritedEventCount)=>({sfdActive:false,inheritedEventCount}),apply:membershipFold});
  function refresh(agent,record){
    if(record.refreshing||record.disposed||disposed)return;
    record.refreshing=true;
    try{
      if(typeof agent.ctx?.tools?.restrict!=='function')throw new Error('host lacks scoped tools.restrict');
      const names=agent.ctx.tools.schemas(agent).map(t=>t.name).filter(externalName);
      for(const name of names){
        // Already-hidden names are absent. A visible own-layer shadow must be
        // tried again and fail honestly; do not silently trust an old deny set.
        const stop=agent.ctx.tools.restrict({deny:[name]});record.stops.push(stop);record.hidden.add(name);
      }
      const visible=agent.ctx.tools.schemas(agent).map(t=>t.name).filter(externalName);
      if(visible.length)throw new Error(`cannot hide same-scope ES tools: ${visible.join(', ')}`);
      record.error=null;
    }catch(e){record.error=`scoped hiding capability error: ${e.message}`;}
    finally{record.refreshing=false;}
  }
  async function activate(agent){
    if(!agent?.session?.id)throw new Error('host session identity required');
    let record=active.get(agent);
    if(!record){
      record={hidden:new Set(),stops:[],error:null,refreshing:false};active.set(agent,record);
      record.dispose=agent.ctx.effect(()=>()=>{record.disposed=true;active.delete(agent);for(const stop of record.stops.splice(0).reverse())stop();});
      record.ready=(async()=>{try{
        record.stops.push(agent.ctx.skills.register({name:'external-subagent',description:'External subagent access is provided by the active SFD wrapper.',source:'plugin:@ibobbyts/dsh-sfd:scoped-shadow',content:'',invocation:{modelInvocable:false,userInvocable:false}}));
        const shadow=await agent.ctx.skills.get('external-subagent',{scope:agent});
        if(!shadow||shadow.invocation?.modelInvocable!==false||shadow.invocation?.userInvocable!==false)throw new Error('same-layer skill shadow did not win');
      }catch(e){record.error=`scoped skill capability error: ${e.message}`;record.skillError=record.error;}})();
    }
    await record.ready;
    refresh(agent,record);if(record.skillError)record.error=record.skillError;
    return record;
  }
  const recover=async agent=>{try{if(ctx.sessionProjections.stateOf(agent.session,MEMBERSHIP_KEY)?.sfdActive)await activate(agent);}catch(e){const r=active.get(agent);if(r)r.error=e.message;}};
  ctx.on('agent/created',async({agent})=>{await recover(agent);}); // serial: never throw
  ctx.on('agent/disposed',({agent})=>{const record=active.get(agent);if(record){record.dispose();active.delete(agent);}});
  ctx.on('tools/change',()=>{for(const [agent,record] of active)refresh(agent,record);});
  ctx.on('session/event',(session)=>{for(const agent of ctx.agents.list())if(agent.session===session)void recover(agent);});
  ctx.on('tools/pre-execute',async(exec,next)=>{
    if(exec.agent&&exec.name==='skill'&&argsOf(exec.arguments).name===SKILL)await activate(exec.agent);
    if(exec.agent&&externalName(exec.name)&&active.has(exec.agent))return {kind:'deny',reason:'Use active SFD wrapper tools.'};
    return next();
  });
  ctx.effect(()=>()=>{disposed=true;for(const r of [...active.values()])r.dispose();active.clear();});
  // Existing agents are restored from the host's replayable projection only.
  for(const agent of ctx.agents.list())void recover(agent);
  return {
    async assertActive(agent){
      if(!active.has(agent)&&ctx.sessionProjections.stateOf(agent.session,MEMBERSHIP_KEY)?.sfdActive)await activate(agent);
      const record=active.get(agent);if(!record)throw new Error('load sectioned-feature-development skill in this session first');
      await record.ready;refresh(agent,record);if(record.skillError||record.error)throw new Error(record.skillError??record.error);
    },
    status(agent){const r=active.get(agent);return {active:!!r,hidden:[...(r?.hidden??[])],capabilityError:r?.skillError??r?.error??null};},
  };
}
