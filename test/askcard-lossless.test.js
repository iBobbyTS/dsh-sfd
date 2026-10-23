import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The user-questions request crosses the Remote gateway, which validates the
 * request body with isRemoteJsonValue: enumerable properties whose value is
 * undefined make the request "not lossless JSON data" and the whole command
 * fails with gateway/internal. askCard must omit absent optional fields.
 */

/** Mirror of dsh-typert-protocol visitJsonValue (boundary contract). */
function visit(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index) || !visit(value[index], ancestors)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      if (Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true || !visit(Reflect.get(value, key), ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

const lossless = (value) => visit(value, new Set());

/** The exact construction askCard in index.js uses. */
function buildItem(question) {
  const item = { id: question.id, question: question.question };
  if (question.header !== undefined) item.header = question.header;
  if (question.detail !== undefined) item.detail = question.detail;
  if (question.options !== undefined) item.options = question.options;
  return item;
}

test('naive spread with undefined detail is not lossless (the regression we guard)', () => {
  const naive = { id: 'x', question: 'q', detail: undefined, options: [{ label: 'a' }] };
  assert.equal(lossless({ questions: [naive] }), false);
});

test('askCard item without detail is lossless', () => {
  const item = buildItem({ id: 'sfd-dirty', question: 'q', header: 'h', options: [{ label: 'a', description: 'd' }] });
  assert.equal(lossless({ questions: [item] }), true);
});

test('askCard item with detail is lossless', () => {
  const item = buildItem({ id: 'sfd-branch-name', question: 'q', header: 'h', detail: 'on main', options: [{ label: 'feature/x' }] });
  assert.equal(lossless({ questions: [item] }), true);
});
