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
        replacesSectionId: z.ZodOptional<z.ZodString>;
        subsections: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            objective: z.ZodString;
            acceptanceCriteria: z.ZodArray<z.ZodString>;
            writeScope: z.ZodArray<z.ZodString>;
            safeIntermediateState: z.ZodString;
            consumer: z.ZodString;
            checks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                command: z.ZodArray<z.ZodString>;
                cwd: z.ZodOptional<z.ZodString>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                required: z.ZodBoolean;
            }, z.core.$strict>>;
            implementation: z.ZodOptional<z.ZodEnum<{
                standard: "standard";
                large: "large";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    assumptions: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const advisorTrigger: z.ZodEnum<{
    "ADV-01": "ADV-01";
    "ADV-02": "ADV-02";
    "ADV-03": "ADV-03";
    "ADV-04": "ADV-04";
    "ADV-05": "ADV-05";
    "ADV-06": "ADV-06";
}>;
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
        classification: z.ZodOptional<z.ZodEnum<{
            PLAN_BLOCKER: "PLAN_BLOCKER";
            PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
            OWNER_DECISION: "OWNER_DECISION";
            PLAN_NIT: "PLAN_NIT";
        }>>;
    }, z.core.$strict>>;
    closures: z.ZodOptional<z.ZodArray<z.ZodObject<{
        findingId: z.ZodString;
        status: z.ZodEnum<{
            "verified-closed": "verified-closed";
            "still-open": "still-open";
            regression: "regression";
            "insufficient-evidence": "insufficient-evidence";
        }>;
        evidence: z.ZodString;
    }, z.core.$strict>>>;
    simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
        mechanism: z.ZodString;
        simplerPath: z.ZodString;
        preservedInvariants: z.ZodArray<z.ZodString>;
        preservationOracle: z.ZodString;
        affectedConsumers: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>>;
    advisorTrigger: z.ZodOptional<z.ZodEnum<{
        "ADV-01": "ADV-01";
        "ADV-02": "ADV-02";
        "ADV-03": "ADV-03";
        "ADV-04": "ADV-04";
        "ADV-05": "ADV-05";
        "ADV-06": "ADV-06";
    }>>;
    planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
        attemptId: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>>;
    simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
        actionId: z.ZodString;
        status: z.ZodEnum<{
            preserved: "preserved";
            "insufficient-evidence": "insufficient-evidence";
            regressed: "regressed";
        }>;
        evidence: z.ZodString;
    }, z.core.$strict>>>;
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
    invalidatedLensIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    invalidationReason: z.ZodOptional<z.ZodString>;
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
    simplificationDispositions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        actionId: z.ZodString;
        decision: z.ZodEnum<{
            reject: "reject";
            batch: "batch";
            defer: "defer";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>>>;
    advisorTrigger: z.ZodOptional<z.ZodEnum<{
        "ADV-01": "ADV-01";
        "ADV-02": "ADV-02";
        "ADV-03": "ADV-03";
        "ADV-04": "ADV-04";
        "ADV-05": "ADV-05";
        "ADV-06": "ADV-06";
    }>>;
    question: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const featureVerificationSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        accepted: "accepted";
        "needs-user": "needs-user";
        repair: "repair";
        "integration-review": "integration-review";
    }>;
    summary: z.ZodString;
    criteria: z.ZodArray<z.ZodObject<{
        featureId: z.ZodString;
        criterion: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodString>;
        satisfied: z.ZodBoolean;
    }, z.core.$strict>>;
    unprovenComposition: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        featureId: z.ZodString;
        lens: z.ZodString;
        boundary: z.ZodString;
    }, z.core.$strict>>>;
    integrationDispositions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        findingId: z.ZodString;
        decision: z.ZodEnum<{
            fix: "fix";
            reject: "reject";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>>>;
    repairSectionIds: z.ZodArray<z.ZodString>;
    repairInstructions: z.ZodString;
    question: z.ZodOptional<z.ZodString>;
    advisorTrigger: z.ZodOptional<z.ZodEnum<{
        "ADV-01": "ADV-01";
        "ADV-02": "ADV-02";
        "ADV-03": "ADV-03";
        "ADV-04": "ADV-04";
        "ADV-05": "ADV-05";
        "ADV-06": "ADV-06";
    }>>;
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
    recoveryClass: z.ZodOptional<z.ZodEnum<{
        CONTINUE_CURRENT: "CONTINUE_CURRENT";
        SIMPLIFY_CURRENT: "SIMPLIFY_CURRENT";
        REPAIR_EVIDENCE: "REPAIR_EVIDENCE";
        SPLIT_REMAINING: "SPLIT_REMAINING";
        REBOUND_OWNER: "REBOUND_OWNER";
        RESTART_FROM_BASE: "RESTART_FROM_BASE";
    }>>;
    advisorTrigger: z.ZodOptional<z.ZodEnum<{
        "ADV-01": "ADV-01";
        "ADV-02": "ADV-02";
        "ADV-03": "ADV-03";
        "ADV-04": "ADV-04";
        "ADV-05": "ADV-05";
        "ADV-06": "ADV-06";
    }>>;
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
                replacesSectionId: z.ZodOptional<z.ZodString>;
                subsections: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    objective: z.ZodString;
                    acceptanceCriteria: z.ZodArray<z.ZodString>;
                    writeScope: z.ZodArray<z.ZodString>;
                    safeIntermediateState: z.ZodString;
                    consumer: z.ZodString;
                    checks: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        command: z.ZodArray<z.ZodString>;
                        cwd: z.ZodOptional<z.ZodString>;
                        timeoutMs: z.ZodOptional<z.ZodNumber>;
                        required: z.ZodBoolean;
                    }, z.core.$strict>>;
                    implementation: z.ZodOptional<z.ZodEnum<{
                        standard: "standard";
                        large: "large";
                    }>>;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            assumptions: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        explanation: z.ZodString;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
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
            classification: z.ZodOptional<z.ZodEnum<{
                PLAN_BLOCKER: "PLAN_BLOCKER";
                PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
                OWNER_DECISION: "OWNER_DECISION";
                PLAN_NIT: "PLAN_NIT";
            }>>;
        }, z.core.$strict>>;
        closures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            status: z.ZodEnum<{
                "verified-closed": "verified-closed";
                "still-open": "still-open";
                regression: "regression";
                "insufficient-evidence": "insufficient-evidence";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
        simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            mechanism: z.ZodString;
            simplerPath: z.ZodString;
            preservedInvariants: z.ZodArray<z.ZodString>;
            preservationOracle: z.ZodString;
            affectedConsumers: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
        planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
            attemptId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            status: z.ZodEnum<{
                preserved: "preserved";
                "insufficient-evidence": "insufficient-evidence";
                regressed: "regressed";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
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
            classification: z.ZodOptional<z.ZodEnum<{
                PLAN_BLOCKER: "PLAN_BLOCKER";
                PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
                OWNER_DECISION: "OWNER_DECISION";
                PLAN_NIT: "PLAN_NIT";
            }>>;
        }, z.core.$strict>>;
        closures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            status: z.ZodEnum<{
                "verified-closed": "verified-closed";
                "still-open": "still-open";
                regression: "regression";
                "insufficient-evidence": "insufficient-evidence";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
        simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            mechanism: z.ZodString;
            simplerPath: z.ZodString;
            preservedInvariants: z.ZodArray<z.ZodString>;
            preservationOracle: z.ZodString;
            affectedConsumers: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
        planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
            attemptId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            status: z.ZodEnum<{
                preserved: "preserved";
                "insufficient-evidence": "insufficient-evidence";
                regressed: "regressed";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
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
        invalidatedLensIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        invalidationReason: z.ZodOptional<z.ZodString>;
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
            classification: z.ZodOptional<z.ZodEnum<{
                PLAN_BLOCKER: "PLAN_BLOCKER";
                PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
                OWNER_DECISION: "OWNER_DECISION";
                PLAN_NIT: "PLAN_NIT";
            }>>;
        }, z.core.$strict>>;
        closures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            status: z.ZodEnum<{
                "verified-closed": "verified-closed";
                "still-open": "still-open";
                regression: "regression";
                "insufficient-evidence": "insufficient-evidence";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
        simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            mechanism: z.ZodString;
            simplerPath: z.ZodString;
            preservedInvariants: z.ZodArray<z.ZodString>;
            preservationOracle: z.ZodString;
            affectedConsumers: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
        planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
            attemptId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            status: z.ZodEnum<{
                preserved: "preserved";
                "insufficient-evidence": "insufficient-evidence";
                regressed: "regressed";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
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
            classification: z.ZodOptional<z.ZodEnum<{
                PLAN_BLOCKER: "PLAN_BLOCKER";
                PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
                OWNER_DECISION: "OWNER_DECISION";
                PLAN_NIT: "PLAN_NIT";
            }>>;
        }, z.core.$strict>>;
        closures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            status: z.ZodEnum<{
                "verified-closed": "verified-closed";
                "still-open": "still-open";
                regression: "regression";
                "insufficient-evidence": "insufficient-evidence";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
        simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            mechanism: z.ZodString;
            simplerPath: z.ZodString;
            preservedInvariants: z.ZodArray<z.ZodString>;
            preservationOracle: z.ZodString;
            affectedConsumers: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
        planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
            attemptId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            status: z.ZodEnum<{
                preserved: "preserved";
                "insufficient-evidence": "insufficient-evidence";
                regressed: "regressed";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
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
        simplificationDispositions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            decision: z.ZodEnum<{
                reject: "reject";
                batch: "batch";
                defer: "defer";
            }>;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
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
            classification: z.ZodOptional<z.ZodEnum<{
                PLAN_BLOCKER: "PLAN_BLOCKER";
                PLAN_SCOPE_EXPANSION: "PLAN_SCOPE_EXPANSION";
                OWNER_DECISION: "OWNER_DECISION";
                PLAN_NIT: "PLAN_NIT";
            }>>;
        }, z.core.$strict>>;
        simplifications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            mechanism: z.ZodString;
            simplerPath: z.ZodString;
            preservedInvariants: z.ZodArray<z.ZodString>;
            preservationOracle: z.ZodString;
            affectedConsumers: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
        planEvidenceReuse: z.ZodOptional<z.ZodArray<z.ZodObject<{
            attemptId: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        simplificationClosures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            actionId: z.ZodString;
            status: z.ZodEnum<{
                preserved: "preserved";
                "insufficient-evidence": "insufficient-evidence";
                regressed: "regressed";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>>;
        closures: z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            status: z.ZodEnum<{
                "verified-closed": "verified-closed";
                "still-open": "still-open";
                regression: "regression";
                "insufficient-evidence": "insufficient-evidence";
            }>;
            evidence: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    'feature-verifier': z.ZodObject<{
        verdict: z.ZodEnum<{
            accepted: "accepted";
            "needs-user": "needs-user";
            repair: "repair";
            "integration-review": "integration-review";
        }>;
        summary: z.ZodString;
        criteria: z.ZodArray<z.ZodObject<{
            featureId: z.ZodString;
            criterion: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            satisfied: z.ZodBoolean;
        }, z.core.$strict>>;
        unprovenComposition: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            featureId: z.ZodString;
            lens: z.ZodString;
            boundary: z.ZodString;
        }, z.core.$strict>>>;
        integrationDispositions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            findingId: z.ZodString;
            decision: z.ZodEnum<{
                fix: "fix";
                reject: "reject";
            }>;
            reason: z.ZodString;
        }, z.core.$strict>>>;
        repairSectionIds: z.ZodArray<z.ZodString>;
        repairInstructions: z.ZodString;
        question: z.ZodOptional<z.ZodString>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
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
        recoveryClass: z.ZodOptional<z.ZodEnum<{
            CONTINUE_CURRENT: "CONTINUE_CURRENT";
            SIMPLIFY_CURRENT: "SIMPLIFY_CURRENT";
            REPAIR_EVIDENCE: "REPAIR_EVIDENCE";
            SPLIT_REMAINING: "SPLIT_REMAINING";
            REBOUND_OWNER: "REBOUND_OWNER";
            RESTART_FROM_BASE: "RESTART_FROM_BASE";
        }>>;
        advisorTrigger: z.ZodOptional<z.ZodEnum<{
            "ADV-01": "ADV-01";
            "ADV-02": "ADV-02";
            "ADV-03": "ADV-03";
            "ADV-04": "ADV-04";
            "ADV-05": "ADV-05";
            "ADV-06": "ADV-06";
        }>>;
    }, z.core.$strict>;
};
export declare function outputSchemaFor(kind: ActorKind): Record<string, unknown>;
/** A schema proves structure. These checks add bounded, decidable workflow invariants. */
export declare function parseActorOutput(kind: ActorKind, value: unknown): ActorOutput;
export declare function assertUnique(values: string[], label: string): void;
export declare function validatePlan(plan: DevelopmentPlan): void;
