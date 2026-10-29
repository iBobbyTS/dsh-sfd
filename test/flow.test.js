import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlow,ready,revise,mark,admitReview,closeFindings,acceptSection,recheckCandidate} from '../lib/flow.js';

const actor=(f,id,task,head='code:1',lens='R01')=>{
 f.actors[id]={id,task,candidate:head,lens,status:'completed',report:'.agent-work/reviews/'+id+'.md'};
};
const clean=(f,id,actorId,head='code:1',lens='R01')=>{
 actor(f,actorId,id,head,lens);return admitReview(f,id,actorId,'clean',lens,head);
};
const plan=f=>clean(clean(f,'plan:A','10000001','plan:1'),'plan:B','10000002','plan:1');
const imp=(f,id,actorId,head='code:1')=>{actor(f,actorId,id,head);return mark(f,id,{actorId,explanation:'tests passed'},head)};

test('Subsection R01 checkpoint blocks dependent Subsection and final A',()=>{
 let f=plan(createFlow([{id:'S01',subsections:['A','B']}]));
 assert.throws(()=>ready(f,'S01/B:impl'),/checkpoint/);
 f=imp(f,'S01/A:impl','10000003');
 assert.throws(()=>ready(f,'S01/B:impl'),/checkpoint/);
 f=clean(f,'S01/A:checkpoint','10000004');
 assert.equal(ready(f,'S01/B:impl').type,'impl');
 assert.throws(()=>ready(f,'S01:A'),/S01:impl/);
 f=imp(f,'S01/B:impl','10000005');f=clean(f,'S01/B:checkpoint','10000006');
 f=mark(f,'S01:impl',{candidate:'code:1',explanation:'joint reconciliation'},'code:1');
 assert.equal(ready(f,'S01:A').route,'codeA');
});
test('Code A convergence gates independent B1 and B2 gates acceptance',()=>{
 let f=plan(createFlow([{id:'S01'}]));f=imp(f,'S01:impl','10000003');
 assert.throws(()=>ready(f,'S01:B1'),/S01:A/);
 f=clean(f,'S01:A','10000004');
 assert.equal(ready(f,'S01:B1').type,'review');
 assert.throws(()=>ready(f,'S01:accept'),/B2/);
 f=clean(f,'S01:B1','10000005');
 assert.throws(()=>ready(f,'S01:accept'),/B2/);
 f=mark(f,'S01:B2',{candidate:'code:1',explanation:'same head impact reconciliation'},'code:1');
 f=acceptSection(f,'S01','code:1','tested actual feature journey');
 assert.equal(f.tasks['S01:accept'].status,'done');
});
test('user can waive Code B without losing Code A, and restore B later',()=>{
 let f=plan(createFlow([{id:'S01'},{id:'S02',dependsOn:['S01']}]));
 f=revise(f,{action:'waive_code_b',authorization:'user',reason:'no B in remaining run'});
 assert.deepEqual(['S01:B1','S01:B2','S02:B1','S02:B2'].map(k=>f.tasks[k].status),['waived','waived','waived','waived']);
 assert.throws(()=>ready(f,'S01:accept'),/S01:A/);
 f=imp(f,'S01:impl','10000003');f=clean(f,'S01:A','10000004');
 f=acceptSection(f,'S01','code:1','tested under explicit waiver');
 assert.equal(f.tasks['S01:accept'].evidence.waiver.by,'user');
 f=revise(f,{action:'restore_code_b',section:'S01',authorization:'user',reason:'restore independent B'});
 assert.equal(f.tasks['S01:accept'].status,'pending');
 assert.equal(f.tasks['S01:B1'].status,'pending');
});
test('agent cannot silently waive Code B; active reviewer must settle first',()=>{
 let f=createFlow([{id:'S01'}]);
 assert.throws(()=>revise(f,{action:'waive_code_b',authorization:'agent',reason:'cheaper'}),/user-authorized/);
 assert.throws(()=>revise(f,{action:'waive_code_b',authorization:'user'}),/user-authorized/);
 f.actors['10000001']={task:'S01:B1',status:'running'};
 assert.throws(()=>revise(f,{action:'waive_code_b',authorization:'user',reason:'skip'}),/cancel active/);
});
test('material findings block A/B pending verified closure',()=>{
 let f=plan(createFlow([{id:'S01'}]));f=imp(f,'S01:impl','10000003');
 actor(f,'10000004','S01:A');
 f=admitReview(f,'S01:A','10000004','material','R01','code:1',[{id:'BUG01',description:'auth regression'}]);
 assert.throws(()=>ready(f,'S01:B1'),/S01:A/);
 f=closeFindings(f,['BUG01'],'independent closure','code:2');
 f=clean(f,'S01:A','10000005','code:2');
 assert.equal(ready(f,'S01:B1').type,'review');
});
test('cannot forge a review actor or omit a required risk lens',()=>{
 let f=plan(createFlow([{id:'S01',lenses:['R02']}]));f=imp(f,'S01:impl','10000003');
 assert.throws(()=>admitReview(f,'S01:A','made-up','clean','R01','code:1'),/no terminal/);
 f=clean(f,'S01:A','10000004');assert.equal(f.tasks['S01:A'].status,'pending');
 f=clean(f,'S01:A','10000005','code:1','R02');
 assert.equal(f.tasks['S01:A'].status,'done');
});
test('candidate drift invalidates active A/B, not accepted predecessor',()=>{
 let f=plan(createFlow([{id:'S01'},{id:'S02',dependsOn:['S01']}]));
 f=imp(f,'S01:impl','10000003');f=clean(f,'S01:A','10000004');
 f=clean(f,'S01:B1','10000005');
 f=mark(f,'S01:B2',{candidate:'code:1',explanation:'same head'},'code:1');
 f=acceptSection(f,'S01','code:1','tested');
 assert.deepEqual(recheckCandidate(f,'code:2','plan:1'),[]);
 f=imp(f,'S02:impl','10000006','code:2');f=clean(f,'S02:A','10000007','code:2');
 assert.deepEqual(recheckCandidate(f,'code:3','plan:1'),['S02:A']);
 assert.equal(f.tasks['S02:A'].status,'pending');
 assert.equal(f.tasks['S01:accept'].status,'done');
});
test('new task inserts prerequisite without removing mandatory dependencies',()=>{
 let f=plan(createFlow([{id:'S01'}]));
 f=revise(f,{action:'add_task',id:'windows',dependsOn:['plan:B'],before:['S01:impl']});
 assert.ok(f.tasks['S01:impl'].deps.includes('plan:B'));
 assert.ok(f.tasks['S01:impl'].deps.includes('extra:windows'));
 assert.throws(()=>ready(f,'S01:impl'),/extra:windows/);
 f=mark(f,'extra:windows',{explanation:'Windows fixture'},'code:1');
 assert.equal(ready(f,'S01:impl').type,'impl');
});
test('in-flight Subsection insertion preserves unaffected earlier checkpoint',()=>{
 let f=plan(createFlow([{id:'S01',subsections:['A','C']}]));
 f=imp(f,'S01/A:impl','10000003');f=clean(f,'S01/A:checkpoint','10000004');
 f=revise(f,{action:'add_subsection',section:'S01',subsection:'B',before:'C'});
 assert.equal(f.tasks['S01/A:checkpoint'].status,'done');
 assert.equal(ready(f,'S01/B:impl').type,'impl');
 assert.ok(f.tasks['S01/C:impl'].deps.includes('S01/B:checkpoint'));
});
test('bad dependency or cycle does not create an executable graph',()=>{
 assert.throws(()=>createFlow([{id:'S01',dependsOn:['S02']},{id:'S02',dependsOn:['S01']}]),/cyclic/);
 assert.throws(()=>createFlow([{id:'S01',dependsOn:['S09']}]),/invalid section/);
 assert.throws(()=>createFlow([{id:'S01'},{id:'S01'}]),/duplicate section/);
});