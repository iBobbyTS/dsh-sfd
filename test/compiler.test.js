import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../lib/compiler.js';
import { label,feature,section,plan } from './plan-fixtures.js';
test('two Features, peer Sections and real child obligations have distinct acceptance boundaries',()=>{
  const text=`# Plan\n### Feature ${feature(1)} — Editor\nEditor journey\n### Feature ${feature(2)} — Export\nExport journey\n`+section(1,{featureId:feature(1)})+section(2,{featureId:feature(1),children:true})+section(3,{featureId:feature(1)})+section(4,{featureId:feature(2)});
  const graph=compilePlan(text);assert.equal(graph.features.length,2);assert.equal(graph.units.length,6);
  assert.equal(graph.units.find(u=>u.parent)?.feature,feature(1));
  assert.ok(graph.nodes[`${label(2)}.A:checkpoint`]);assert.ok(graph.nodes[`${label(2)}:reconcile`]);
  assert.equal(graph.nodes[`${label(2)}.A:blind`],undefined);
  for(let n=1;n<=4;n++){assert.ok(graph.nodes[`${label(n)}:behavior`]);assert.ok(graph.nodes[`${label(n)}:blind`]);}
  assert.deepEqual(graph.nodes[`${feature(2)}:accept`].needs,[`${label(4)}:accept`]);
});
test('portable grammar rejects duplicate/dangling/cyclic/child ownership with source lines',()=>{
  const cases=[
    [plan()+section(1),/duplicate unit/],
    [section(1,{deps:label(3)}),/unknown dependency/],
    [section(1,{deps:label(2)})+section(2,{deps:label(1)}),/cycle/],
    [section(1)+`### ${label(2)}.A — Misowned\n- Implementer: impl_std\n- Depends on: none\n`,/nested below/],
    [section(1).replace('impl_large','unknown'),/explicit impl/],
    [section(1).replace('- Depends on: none',''),/missing dependsOn/],
    [section(1)+'- Implementer: impl_large\n',/duplicate implementer/],
    [section(1,{children:true})+section(2,{deps:label(1)+'.A'}),/external dependencies/],
    [section(1,{children:true}).replace(`Depends on: ${label(1)}.A`,`Depends on: ${label(2)}`)+section(2),/siblings only/],
  ];
  for(const [text,pattern] of cases)assert.throws(()=>compilePlan(text,'plan.md'),error=>error.message.includes('plan.md:')&&pattern.test(error.message));
});
test('fences preserve code examples and legacy one-Feature plans remain valid',()=>{
  const text='```md\n'+section(9)+'\n~~~\n```\n'+plan();
  const graph=compilePlan(text);assert.equal(graph.units.length,1);assert.equal(graph.features[0].id,'business');
  assert.equal(graph.units[0].line,10);
});
