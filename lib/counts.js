/**
 * Review round counting: the one piece of bookkeeping the plugin keeps even
 * though the flow itself belongs to the agent.
 *
 * Facts:
 * - A counter changes exactly when an actor is dispatched, so the spawn tool can
 *   increment and record it in the same atomic state write. No report, verdict
 *   or LLM summary is needed to count, which is why this stays reliable while
 *   the flow does not.
 * - Counts are keyed by stage, and by `stage@unit` when the caller names the
 *   unit/section the actor works on. A run-wide number alone cannot answer "is
 *   this section out of waves"; a per-unit number alone loses the run total.
 * - Keys are bounded and validated: a unit id becomes part of a persisted key,
 *   so it is trimmed, length-capped, and rejected when it contains control
 *   characters or the `@` separator itself.
 */

/** Longest accepted unit/section id, in characters. */
export const MAX_UNIT_LENGTH = 120;

/** Separator between a stage and its unit in a count key. */
export const UNIT_SEPARATOR = '@';

/**
 * Validate an optional unit/section id.
 * @param unit - caller-supplied value.
 * @returns the trimmed id, or null when none was given.
 * @throws {Error} when the id could not be stored as a key.
 */
export function checkedUnit(unit) {
  if (unit === undefined || unit === null) return null;
  if (typeof unit !== 'string') throw new Error('unit must be a string');
  const trimmed = unit.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_UNIT_LENGTH) throw new Error(`unit must be at most ${MAX_UNIT_LENGTH} characters`);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error('unit must not contain control characters');
  if (trimmed.includes(UNIT_SEPARATOR)) throw new Error(`unit must not contain "${UNIT_SEPARATOR}"`);
  return trimmed;
}

/**
 * The persisted key for one stage/unit pair.
 * @param stage - configured stage id.
 * @param unit - validated unit id, or null.
 */
export function countKey(stage, unit) {
  return unit === null || unit === undefined ? stage : `${stage}${UNIT_SEPARATOR}${unit}`;
}

/**
 * Increment one counter, immutably.
 * @param counts - the state's current counts map.
 * @param key - a {@link countKey} value.
 * @returns a new map with that key incremented.
 */
export function bumpCount(counts, key) {
  const current = counts !== null && typeof counts === 'object' ? counts : {};
  const previous = Number.isInteger(current[key]) ? current[key] : 0;
  return { ...current, [key]: previous + 1 };
}

/**
 * Render counts for the injected context and the resume brief.
 * @param counts - the state's counts map.
 * @returns `key n · key n`, or null when nothing was counted yet.
 */
export function renderCounts(counts) {
  if (counts === null || typeof counts !== 'object') return null;
  const entries = Object.entries(counts)
    .filter(([, value]) => Number.isInteger(value) && value > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key} ${value}`).join(' · ');
}
