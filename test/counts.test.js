import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UNIT_LENGTH, bumpCount, checkedUnit, countKey, renderCounts } from '../lib/counts.js';

test('a unit id is trimmed, bounded and kept out of the key separator', () => {
  assert.equal(checkedUnit(undefined), null);
  assert.equal(checkedUnit(null), null);
  assert.equal(checkedUnit('   '), null);
  assert.equal(checkedUnit('  section-auth  '), 'section-auth');
  assert.throws(() => checkedUnit('x'.repeat(MAX_UNIT_LENGTH + 1)), /at most/);
  assert.throws(() => checkedUnit('bad\nunit'), /control/);
  assert.throws(() => checkedUnit('a@b'), /must not contain/);
  assert.throws(() => checkedUnit(7), /must be a string/);
});

test('counts are keyed by stage, and by stage@unit when a unit is named', () => {
  assert.equal(countKey('planReviewA', null), 'planReviewA');
  assert.equal(countKey('codeReviewA', 'section-auth'), 'codeReviewA@section-auth');
});

test('bumping is immutable and tolerates a state written before counters existed', () => {
  const first = bumpCount(undefined, 'planReviewA');
  assert.deepEqual(first, { planReviewA: 1 });
  const second = bumpCount(first, 'planReviewA');
  assert.deepEqual(second, { planReviewA: 2 });
  assert.deepEqual(first, { planReviewA: 1 }, 'the previous map is untouched');
  assert.deepEqual(bumpCount({ planReviewA: 'junk' }, 'planReviewA'), { planReviewA: 1 });
});

test('rendering sorts keys and drops empty counters', () => {
  assert.equal(renderCounts(undefined), null);
  assert.equal(renderCounts({}), null);
  assert.equal(renderCounts({ planReviewA: 0 }), null);
  assert.equal(
    renderCounts({ 'codeReviewA@section-b': 2, planReviewA: 1 }),
    'codeReviewA@section-b 2 · planReviewA 1',
  );
});
