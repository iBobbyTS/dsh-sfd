import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, STAGE_ROLE, roleOf } from '../lib/roles.js';
import { STAGES } from '../lib/models.js';

test('every configured stage maps to a role, and nothing else maps at all', () => {
  assert.deepEqual(Object.keys(STAGE_ROLE).sort(), [...STAGES].sort());
  assert.deepEqual([...new Set(Object.values(STAGE_ROLE))], ['planReview', 'implementation', 'codeReview']);
  assert.equal(roleOf('planReviewB'), ROLES.planReview);
  assert.equal(roleOf('implementationLarge'), ROLES.implementation);
  assert.equal(roleOf('codeReviewB'), ROLES.codeReview);
  assert.equal(roleOf('planReviewC'), undefined);
});

test('reviewers run read-only and implementers run in build mode', () => {
  assert.equal(ROLES.planReview.permissionMode, 'plan');
  assert.equal(ROLES.codeReview.permissionMode, 'plan');
  assert.equal(ROLES.implementation.permissionMode, 'build');
});

test('the role text keeps the reviewed invariants the retired profiles carried', () => {
  for (const [role, definition] of Object.entries(ROLES)) {
    assert.ok(definition.instructions.length > 1500, `${role} text is suspiciously short`);
    assert.match(definition.instructions, /Work only from the bounded TASK and source evidence\./);
    assert.match(definition.instructions, /Never report a tool\/test as run without evidence\./);
    assert.match(definition.instructions, /Only the parent admits findings and releases successors\./);
    assert.match(definition.instructions, /write only your dispatched report file/);
  }
  assert.match(ROLES.planReview.instructions, /never author or implement the plan and never code-review this feature/i);
  assert.match(ROLES.codeReview.instructions, /B1 blind independent full-diff discovery/);
  assert.match(ROLES.implementation.instructions, /Implement only the approved owner\/write boundary/);
});

test('effort stays a per-subagent knob with valid ES tokens', () => {
  for (const [role, definition] of Object.entries(ROLES)) {
    for (const [subagent, effort] of Object.entries(definition.effort)) {
      assert.match(effort, /^[a-z0-9_]+$/, `${role}/${subagent} effort token`);
    }
    assert.deepEqual(Object.keys(definition.effort).sort(), ['agy', 'codex', 'dsh', 'zcode'], role);
  }
  // The retired profiles tuned these two roles differently for codex.
  assert.equal(ROLES.planReview.effort.codex, 'xhigh');
  assert.equal(ROLES.codeReview.effort.codex, 'high');
  assert.equal(ROLES.planReview.effort.zcode, 'max');
});
