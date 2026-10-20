import type { ActorKind } from '../core/types.js';
/** Knowledge is shipped with the plugin, independent of an installed Skill. */
export declare const ROLE_PROTOCOL_VERSION: "sfd-native-roles-1";
export interface RoleSpec {
    readonly presetId: string;
    readonly title: string;
    readonly access: 'reader' | 'writer';
    /** An allowlist, never a claim that these tools are actually installed. */
    readonly toolNames: readonly string[];
}
export declare const ROLE_SPECS: {
    readonly planner: {
        readonly presetId: "sfd-planner";
        readonly title: "Planner";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'plan-review-a': {
        readonly presetId: "sfd-plan-review-a";
        readonly title: "Plan review A";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'plan-review-b': {
        readonly presetId: "sfd-plan-review-b";
        readonly title: "Plan review B";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly implementer: {
        readonly presetId: "sfd-implementer";
        readonly title: "Implementer";
        readonly access: "writer";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output", "write", "edit", "bash"];
    };
    readonly 'review-selector': {
        readonly presetId: "sfd-review-selector";
        readonly title: "Review selection";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'reviewer-a': {
        readonly presetId: "sfd-reviewer-a";
        readonly title: "Code review A";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'reviewer-b': {
        readonly presetId: "sfd-reviewer-b";
        readonly title: "Code review B";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly adjudicator: {
        readonly presetId: "sfd-adjudicator";
        readonly title: "Evidence adjudication";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'closure-reviewer': {
        readonly presetId: "sfd-closure-reviewer";
        readonly title: "Repair closure";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly 'feature-verifier': {
        readonly presetId: "sfd-feature-verifier";
        readonly title: "Feature acceptance";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
    readonly diagnostician: {
        readonly presetId: "sfd-diagnostician";
        readonly title: "Diagnosis";
        readonly access: "reader";
        readonly toolNames: readonly ["read", "read_image", "glob", "grep", "structured_output"];
    };
};
export declare const ROLE_PRESETS: Record<ActorKind, string>;
