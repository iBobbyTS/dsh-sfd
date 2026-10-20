import type { ActorKind } from '../core/types.js';

/** Knowledge is shipped with the plugin, independent of an installed Skill. */
export const ROLE_PROTOCOL_VERSION = 'sfd-native-roles-2' as const;

export interface RoleSpec {
  readonly presetId: string;
  readonly title: string;
  readonly access: 'reader' | 'writer';
  /** An allowlist, never a claim that these tools are actually installed. */
  readonly toolNames: readonly string[];
}

const READ_TOOLS = ['read', 'read_image', 'glob', 'grep', 'structured_output', 'sfd_knowledge'] as const;
const WRITE_TOOLS = [...READ_TOOLS, 'write', 'edit', 'bash'] as const;

export const ROLE_SPECS = {
  planner: { presetId: 'sfd-planner', title: 'Planner', access: 'reader', toolNames: READ_TOOLS },
  'plan-review-a': { presetId: 'sfd-plan-review-a', title: 'Plan review A', access: 'reader', toolNames: READ_TOOLS },
  'plan-review-b': { presetId: 'sfd-plan-review-b', title: 'Plan review B', access: 'reader', toolNames: READ_TOOLS },
  implementer: { presetId: 'sfd-implementer', title: 'Implementer', access: 'writer', toolNames: WRITE_TOOLS },
  'review-selector': { presetId: 'sfd-review-selector', title: 'Review selection', access: 'reader', toolNames: READ_TOOLS },
  'reviewer-a': { presetId: 'sfd-reviewer-a', title: 'Code review A', access: 'reader', toolNames: READ_TOOLS },
  'reviewer-b': { presetId: 'sfd-reviewer-b', title: 'Code review B', access: 'reader', toolNames: READ_TOOLS },
  adjudicator: { presetId: 'sfd-adjudicator', title: 'Evidence adjudication', access: 'reader', toolNames: READ_TOOLS },
  'closure-reviewer': { presetId: 'sfd-closure-reviewer', title: 'Repair closure', access: 'reader', toolNames: READ_TOOLS },
  'feature-verifier': { presetId: 'sfd-feature-verifier', title: 'Feature acceptance', access: 'reader', toolNames: READ_TOOLS },
  diagnostician: { presetId: 'sfd-diagnostician', title: 'Diagnosis', access: 'reader', toolNames: READ_TOOLS },
  'advisor-notice': { presetId: 'sfd-advisor-notice', title: 'Advisor Notification Fields', access: 'reader', toolNames: ['structured_output'] },
} as const satisfies Record<ActorKind, RoleSpec>;

export const ROLE_PRESETS = Object.fromEntries(
  Object.entries(ROLE_SPECS).map(([kind, spec]) => [kind, spec.presetId]),
) as Record<ActorKind, string>;
