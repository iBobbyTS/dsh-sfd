import type { ActorRunner, RunStore, WorkspacePort } from './ports.js';
import { type CreateRunInput, type DecideInput, type DevelopmentRun } from './types.js';
export interface ControllerOptions {
    store: RunStore;
    actors: ActorRunner;
    workspace: WorkspacePort;
    now?: () => string;
    id?: () => string;
    /** Public stop calls remain bounded; unconfirmed execution keeps its workspace reservation. */
    cleanupTimeoutMs?: number;
}
type Listener = (run: DevelopmentRun) => void;
/** Persistent development controller. No model session owns this state machine. */
export declare class WorkflowController {
    private readonly store;
    private readonly actors;
    private readonly workspace;
    private readonly now;
    private readonly id;
    private readonly cleanupTimeoutMs;
    private readonly listeners;
    private readonly activeActors;
    private readonly activeOperations;
    private readonly drives;
    private disposed;
    constructor(options: ControllerOptions);
    subscribe(listener: Listener): () => void;
    list(): Promise<DevelopmentRun[]>;
    status(id: string): Promise<DevelopmentRun>;
    create(input: CreateRunInput): Promise<DevelopmentRun>;
    start(id: string): Promise<DevelopmentRun>;
    pause(id: string): Promise<DevelopmentRun>;
    resume(id: string): Promise<DevelopmentRun>;
    cancel(id: string): Promise<DevelopmentRun>;
    revise(id: string, goal: string): Promise<DevelopmentRun>;
    decide(id: string, input: DecideInput): Promise<DevelopmentRun>;
    /** Startup never assumes a vanished in-memory handle completed its side effects. */
    recover(): Promise<void>;
    dispose(): Promise<void>;
    private assertOpen;
    private publish;
    private event;
    private change;
    private schedule;
    private driveOnce;
    private drivePlanning;
    private drivePlanReview;
    private driveSections;
    private driveImplementation;
    private driveSelection;
    /** The old Skill re-routes the repair delta before closing A; it does not restart unaffected lenses. */
    private driveReroute;
    private driveA;
    private driveClosure;
    private driveB;
    private driveAdjudication;
    private validateAdjudication;
    private requestRepair;
    private driveDiagnostic;
    private driveFeatureVerification;
    private validateFeatureAcceptance;
    private driveDelivery;
    private contractInput;
    private sectionPlan;
    private currentReviews;
    private candidate;
    private latest;
    private queueActor;
    private launchActor;
    private finishAttempt;
    private admit;
    private completedOperation;
    private operation;
    private block;
    private stopLocal;
    private finishStop;
}
export { WorkflowController as DevelopmentController };
