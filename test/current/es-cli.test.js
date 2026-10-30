/** Current process boundary regressions; no real external-subagent daemon calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { createEsTransport,parseEsJson,runEs,resolveBinary,launcherEnvironment } from '../../lib/es-cli.js';
test('GUI minimal PATH resolves configured/known launcher and includes its Node interpreter',async()=>{
 const env={PATH:'/usr/bin:/bin',EXTERNAL_SUBAGENT_BIN:'/chosen/bin/external-subagent'};
 assert.equal(resolveBinary(env),env.EXTERNAL_SUBAGENT_BIN);assert.ok(launcherEnvironment(env).PATH.includes(dirname(process.execPath)));
 let seen;
 const value=await runEs(['status'],{env,invoke:(binary,args,options,callback)=>{seen={binary,args,options};callback(null,'{"ok":true,"result":{}}','');}});
 assert.equal(value,'{"ok":true,"result":{}}');assert.equal(seen.binary,env.EXTERNAL_SUBAGENT_BIN);assert.equal(seen.options.timeout,30000);assert.ok(seen.options.env.PATH.includes('/chosen/bin'));
});
test('CLI envelope errors and launch failures retain honest diagnostics despite exit zero',async()=>{
 assert.throws(()=>parseEsJson('{"ok":false,"error":{"code":"DENIED","message":"No access"}}'),e=>e.code==='DENIED'&&e.message==='No access');
 for(const raw of ['null','[]','not json'])assert.throws(()=>parseEsJson(raw),/document|non-JSON/);
 const rpc=createEsTransport({run:async()=>'{"ok":true}'});await assert.rejects(()=>rpc('spawn',{}),/missing result/);
 await assert.rejects(()=>runEs([],{invoke:(_bin,_args,_options,cb)=>cb(Object.assign(new Error('missing'),{code:'ENOENT'}),'','')}),e=>e.code==='ES_MISSING');
});
test('valid long polls exceed requested daemon wait, flat array and scalar envelopes pass through',async()=>{
 let seen;const response={'10000001':{task:{agent_id:10000001,status:'completed'},pending_requests:[],timed_out:false,result:{outcome:'COMPLETED',final_text:'report',partial:false,offset:0,next_offset:null}}};
 const rpc=createEsTransport({run:async(args,options)=>{seen={args,options};return JSON.stringify({ok:true,product:'external-subagent',command:'wait',result:response});}});
 assert.deepEqual(await rpc('wait',{agent_id:[10000001],wait_time:290}),response);assert.equal(seen.options.timeoutMs,310000);
 assert.equal(JSON.parse(seen.args[2]).wait_time,290);
 await assert.rejects(()=>rpc('wait',{agent_id:Array(17).fill(10000001)}),/1..16/);await assert.rejects(()=>rpc('wait',{agent_id:10000001,wait_time:291}),/0..290/);
 await assert.rejects(()=>rpc('unknown',{}),/unsupported/);
});
