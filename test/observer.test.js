/**
 * Observer classification: pure functions turning tool executions into facts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolFamily, classifyEs, classifyFileWrite, resultToText, roleOfProfile, promptHeadline, reportHint } from '../lib/observer.js';

test('toolFamily matches ES tools with and without the MCP prefix', () => {
  assert.deepEqual(toolFamily('external_subagent_spawn'), { family: 'es', op: 'spawn' });
  assert.deepEqual(toolFamily('mcp__external_subagent__external_subagent_wait'), { family: 'es', op: 'wait' });
  assert.deepEqual(toolFamily('external_subagent_result'), { family: 'es', op: 'result' });
  assert.deepEqual(toolFamily('external_subagent_close'), { family: 'es', op: 'close' });
  assert.deepEqual(toolFamily('write'), { family: 'file', op: 'write' });
  assert.deepEqual(toolFamily('edit'), { family: 'file', op: 'edit' });
  assert.deepEqual(toolFamily('external_subagent_status'), { family: 'es', op: 'status' });
  assert.equal(toolFamily('bash'), null);
  assert.equal(toolFamily('read'), null);
  assert.equal(toolFamily('external_subagent_bogus'), null);
});

test('roleOfProfile maps the skill sfd-* presets to role families', () => {
  assert.equal(roleOfProfile('sfd-zcode-plan-review'), 'plan-review');
  assert.equal(roleOfProfile('sfd-codex-plan-review'), 'plan-review');
  assert.equal(roleOfProfile('sfd-zcode-code-review'), 'code-review');
  assert.equal(roleOfProfile('sfd-codex-code-review'), 'code-review');
  assert.equal(roleOfProfile('sfd-dsh-impl-std'), 'impl');
  assert.equal(roleOfProfile('sfd-codex-impl-large'), 'impl');
  assert.equal(roleOfProfile('sfd-agy-impl-std'), 'impl');
  assert.equal(roleOfProfile('sfd-advisor-thing'), 'advisor');
  assert.equal(roleOfProfile('sfd-other'), 'sfd-other');
  assert.equal(roleOfProfile(null, 'zcode'), 'direct');
  assert.equal(roleOfProfile(null, null), 'unknown');
});

test('classifyEs extracts the spawn id, profile and prompt hints from the result text', () => {
  const resultText = JSON.stringify({ ok: true, agent_id: 10001485, session_id: 'sess-1', status: 'running' });
  const obs = classifyEs('spawn', { profile: 'sfd-zcode-plan-review', prompt: 'Review the plan.\nReport to .agent-work/reviews/plan-a.md' }, resultText);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].kind, 'spawn');
  assert.equal(obs[0].agentId, '10001485');
  assert.equal(obs[0].role, 'plan-review');
  assert.equal(obs[0].promptHeadline, 'Review the plan.');
  assert.equal(obs[0].reportHint, '.agent-work/reviews/plan-a.md');
  assert.equal(obs[0].sessionId, 'sess-1');
});

test('classifyEs: a failed spawn yields no fact', () => {
  assert.deepEqual(classifyEs('spawn', { profile: 'x' }, '{"ok":false,"error":{"code":"X"}}'), []);
});

test('classifyEs maps wait/result/close events, including id lists and outcomes', () => {
  const waits = classifyEs('wait', { agent_id: 1001 }, '{"status":"RUNNING"}');
  assert.deepEqual(waits, [{ kind: 'event', agentId: '1001', event: 'wait', status: 'running', outcome: null }]);
  const results = classifyEs('result', { agent_id: [1001, 1002] }, '{"outcome":"COMPLETED"}');
  assert.equal(results.length, 2);
  assert.equal(results[0].outcome, 'COMPLETED');
  const closes = classifyEs('close', { agent_id: '1001' }, '{"ok":true}');
  assert.deepEqual(closes, [{ kind: 'event', agentId: '1001', event: 'close', status: null, outcome: null }]);
  // a queued status is not a terminal fact
  const queued = classifyEs('wait', { agent_id: 1 }, '{"status":"QUEUED"}');
  assert.equal(queued[0].status, 'queued');
  assert.equal(queued[0].outcome, null);
});

test('promptHeadline and reportHint are bounded and defensive', () => {
  assert.equal(promptHeadline(''), null);
  assert.equal(promptHeadline('\n\n  \nshort'), 'short');
  assert.equal(promptHeadline(`x`.repeat(200)).length <= 121, true);
  assert.equal(reportHint('see .agent-work/reviews/b1.md for the report'), '.agent-work/reviews/b1.md');
  assert.equal(reportHint('no path here'), null);
});

test('classifyFileWrite accepts only .agent-work paths under the root', () => {
  const root = '/work/repo';
  const hit = classifyFileWrite({ file_path: '/work/repo/.agent-work/reviews/plan-a.md' }, root, {
    relative: (r, p) => p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null,
  });
  assert.deepEqual(hit, { path: '.agent-work/reviews/plan-a.md', kind: 'reports' });
  const plan = classifyFileWrite({ file_path: '/work/repo/.agent-work/PLAN-FULL.md' }, root, {
    relative: (r, p) => p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null,
  });
  assert.equal(plan.kind, 'plan');
  const handoff = classifyFileWrite({ file_path: '/work/repo/.agent-work/handoffs/s1.md' }, root, {
    relative: (r, p) => p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null,
  });
  assert.equal(handoff.kind, 'handoffs');
  const outside = classifyFileWrite({ file_path: '/work/repo/src/index.js' }, root, {
    relative: (r, p) => p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null,
  });
  assert.equal(outside, null);
  const escaped = classifyFileWrite({ file_path: '/work/other/.agent-work/x.md' }, root, {
    relative: (r, p) => p.startsWith(`${r}/`) ? p.slice(r.length + 1) : null,
  });
  assert.equal(escaped, null);
});

test('resultToText flattens content blocks defensively', () => {
  assert.equal(resultToText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.equal(resultToText({ text: 'plain' }), 'plain');
  assert.equal(resultToText({}), '');
});
