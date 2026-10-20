import { z } from 'zod';
import type { ActorKind, ActorOutput, DevelopmentPlan } from './types.js';
export declare const planSchema: z.ZodObject<{
    title: z.ZodString;
    features: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        outcome: z.ZodString;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        sectionIds: z.ZodArray<z.ZodString>;
        checks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            command: z.ZodArray<z.ZodString>;
            cwd: z.ZodOptional<z.ZodString>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    sections: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        featureIds: z.ZodArray<z.ZodString>;
        objective: z.ZodString;
        dependencies: z.ZodArray<z.ZodString>;
        writeScope: z.ZodArray<z.ZodString>;
        acceptanceCriteria: z.ZodArray<z.ZodString>;
        implementation: z.ZodEnum<{
            standard: "standard";
            large: "large";
        }>;
        checks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            command: z.ZodArray<z.ZodString>;
            cwd: z.ZodOptional<z.ZodString>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        subsections: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            objective: z.ZodString;
            acceptanceCriteria: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    assumptions: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const findingSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
    }>;
    invariant: z.ZodString;
    location: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const reviewSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        clean: "clean";
        findings: "findings";
        incomplete: "incomplete";
    }>;
    summary: z.ZodString;
    coverage: z.ZodArray<z.ZodString>;
    limitations: z.ZodArray<z.ZodString>;
    findings: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        body: z.ZodString;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
        }>;
        invariant: z.ZodString;
        location: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const implementationSchema: z.ZodObject<{
    summary: z.ZodString;
    completedCriteria: z.ZodArray<z.ZodString>;
    remainingWork: z.ZodArray<z.ZodString>;
    changedInterfaces: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const selectionSchema: z.ZodObject<{
    lenses: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        focus: z.ZodString;
    }, z.core.$strict>>;
    rationale: z.ZodString;
}, z.core.$strict>;
export declare const adjudicationSchema: z.ZodObject<{
    resolution: z.ZodEnum<{
        "needs-user": "needs-user";
        accept: "accept";
        repair: "repair";
        "more-review": "more-review";
    }>;
    summary: z.ZodString;
    coverageSufficient: z.ZodBoolean;
    dispositions: z.ZodArray<z.ZodObject<{
        findingId: z.ZodString;
        decision: z.ZodEnum<{
            fix: "fix";
            reject: "reject";
            "needs-user": "needs-user";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>>;
    repairInstructions: z.ZodString;
    material: z.ZodBoolean;
    invalidatedSectionIds: z.ZodArray<z.ZodString>;
    missingCoverage: z.ZodArray<z.ZodString>;
    evidenceReuse: z.ZodArray<z.ZodObject<{
        evidenceId: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
    question: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const featureVerificationSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        accepted: "accepted";
        "needs-user": "needs-user";
        repair: "repair";
    }>;
    summary: z.ZodString;
    criteria: z.ZodArray<z.ZodObject<{
        featureId: z.ZodString;
        criterion: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodString>;
        satisfied: z.ZodBoolean;
    }, z.core.$strict>>;
    repairSectionIds: z.ZodArray<z.ZodString>;
    repairInstructions: z.ZodString;
    question: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const diagnosticSchema: z.ZodObject<{
    summary: z.ZodString;
    recommendation: z.ZodEnum<{
        "needs-user": "needs-user";
        retry: "retry";
        "revise-plan": "revise-plan";
    }>;
    instructions: z.ZodString;
    question: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const actorOutputSchemas: {
    planner: z.ZodObject<{
        plan: z.ZodObject<{
            title: z.ZodString;
            features: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodString;
                outcome: z.ZodString;
                acceptanceCriteria: z.ZodArray<z.ZodString>;
                sectionIds: z.ZodArray<z.ZodString>;
                checks: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    command: z.ZodArray<z.ZodString>;
                    cwd: z.ZodOptional<z.ZodString>;
                    timeoutMs: z.ZodOptional<z.ZodNumber>;
                    required: z.ZodBoolean;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            sections: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                title: z.ZodString;
                featureIds: z.ZodArray<z.ZodString>;
                objective: z.ZodString;
                dependencies: z.ZodArray<z.ZodString>;
                writeScope: z.ZodArray<z.ZodString>;
                acceptanceCriteria: z.ZodArray<z.ZodString>;
                implementation: z.ZodEnum<{
                    standard: "standard";
                    large: "large";
                }>;
                checks: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    command: z.ZodArray<z.ZodString>;
                    cwd: z.ZodOptional<z.ZodString>;
                    timeoutMs: z.ZodOptional<z.ZodNumber>;
                    required: z.ZodBoolean;
                }, z.core.$strict>>;
                subsections: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    objective: z.ZodString;
                    acceptanceCriteria: z.ZodArray<z.ZodString>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            assumptions: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        explanation: z.ZodString;
    }, z.core.$strict>;
    'plan-review-a': z.ZodObject<{
        verdict: z.ZodEnum<{
            clean: "clean";
            findings: "findings";
            incomplete: "incomplete";
        }>;
        summary: z.ZodString;
        coverage: z.ZodArray<z.ZodString>;
        limitations: z.ZodArray<z.ZodString>;
        findings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            body: z.ZodString;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
            }>;
            invariant: z.ZodString;
            location: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    'plan-review-b': z.ZodObject<{
        verdict: z.ZodEnum<{
            clean: "clean";
            findings: "findings";
            incomplete: "incomplete";
        }>;
        summary: z.ZodString;
        coverage: z.ZodArray<z.ZodString>;
        limitations: z.ZodArray<z.ZodString>;
        findings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            body: z.ZodString;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
            }>;
            invariant: z.ZodString;
            location: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    implementer: z.ZodObject<{
        summary: z.ZodString;
        completedCriteria: z.ZodArray<z.ZodString>;
        remainingWork: z.ZodArray<z.ZodString>;
        changedInterfaces: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    'review-selector': z.ZodObject<{
        lenses: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            focus: z.ZodString;
        }, z.core.$strict>>;
        rationale: z.ZodString;
    }, z.core.$strict>;
    'reviewer-a': z.ZodObject<{
        verdict: z.ZodEnum<{
            clean: "clean";
            findings: "findings";
            incomplete: "incomplete";
        }>;
        summary: z.ZodString;
        coverage: z.ZodArray<z.ZodString>;
        limitations: z.ZodArray<z.ZodString>;
        findings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            body: z.ZodString;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
            }>;
            invariant: z.ZodString;
            location: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    'reviewer-b': z.ZodObject<{
        verdict: z.ZodEnum<{
            clean: "clean";
            findings: "findings";
            incomplete: "incomplete";
        }>;
        summary: z.ZodString;
        coverage: z.ZodArray<z.ZodString>;
        limitations: z.ZodArray<z.ZodString>;
        findings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            body: z.ZodString;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
            }>;
            invariant: z.ZodString;
            location: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    adjudicator: z.ZodObject<{
        resolution: z.ZodEnum<{
            "needs-user": "needs-user";
            accept: "accept";
            repair: "repair";
            "more-review": "more-review";
        }>;
        summary: z.ZodString;
        coverageSufficient: z.ZodBoolean;
        dispositions: z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            decision: z.ZodEnum<{
                fix: "fix";
                reject: "reject";
                "needs-user": "needs-user";
            }>;
            reason: z.ZodString;
        }, z.core.$strict>>;
        repairInstructions: z.ZodString;
        material: z.ZodBoolean;
        invalidatedSectionIds: z.ZodArray<z.ZodString>;
        missingCoverage: z.ZodArray<z.ZodString>;
        evidenceReuse: z.ZodArray<z.ZodObject<{
            evidenceId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>;
        question: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    'closure-reviewer': z.ZodObject<{
        verdict: z.ZodEnum<{
            clean: "clean";
            findings: "findings";
            incomplete: "incomplete";
        }>;
        summary: z.ZodString;
        coverage: z.ZodArray<z.ZodString>;
        limitations: z.ZodArray<z.ZodString>;
        findings: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            body: z.ZodString;
            severity: z.ZodEnum<{
                critical: "critical";
                major: "major";
                minor: "minor";
            }>;
            invariant: z.ZodString;
            location: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    'feature-verifier': z.ZodObject<{
        verdict: z.ZodEnum<{
            accepted: "accepted";
            "needs-user": "needs-user";
            repair: "repair";
        }>;
        summary: z.ZodString;
        criteria: z.ZodArray<z.ZodObject<{
            featureId: z.ZodString;
            criterion: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            satisfied: z.ZodBoolean;
        }, z.core.$strict>>;
        repairSectionIds: z.ZodArray<z.ZodString>;
        repairInstructions: z.ZodString;
        question: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    diagnostician: z.ZodObject<{
        summary: z.ZodString;
        recommendation: z.ZodEnum<{
            "needs-user": "needs-user";
            retry: "retry";
            "revise-plan": "revise-plan";
        }>;
        instructions: z.ZodString;
        question: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
};
export declare function outputSchemaFor(kind: ActorKind): Record<string, unknown>;
/** A schema proves structure. These checks add bounded, decidable workflow invariants. */
export declare function parseActorOutput(kind: ActorKind, value: unknown): ActorOutput;
export declare function assertUnique(values: string[], label: string): void;
export declare function validatePlan(plan: DevelopmentPlan): void;
