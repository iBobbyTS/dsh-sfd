import type { DevelopmentRun } from '../core/types.js';
import type { CreateRequest, DecideRequest, DevelopmentWorkflowRemote, RunRequest } from '../dsh/remote-contract.js';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';

export type RunAction = 'start' | 'pause' | 'resume' | 'cancel' | 'recover';

export interface DevelopmentViewState {
  readonly sessionId: string | undefined;
  readonly selectedRunId: string | undefined;
  readonly runs: readonly DevelopmentRun[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly readError: string | undefined;
  readonly refreshedAt: string | undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`);
  return result.value;
}

/** Read-only observation lifetime is independent of the Host Run's lifetime. */
export class DevelopmentClientController {
  private snapshot: DevelopmentViewState = {
    sessionId: undefined, selectedRunId: undefined, runs: [], loading: false,
    busy: false, error: undefined, readError: undefined, refreshedAt: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private mutationEpoch = 0;
  private read: Promise<void> | undefined;
  private readAgain = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly remote: DevelopmentWorkflowRemote, private readonly pollMs = 2_000) {}

  readonly getSnapshot = (): DevelopmentViewState => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      void this.refresh();
      this.schedule();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.clearTimer();
    };
  };

  private publish(patch: Partial<DevelopmentViewState>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.listeners.size || this.pollMs <= 0) return;
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => this.schedule());
    }, this.pollMs);
  }

  /** Changing the visible owner does not reassign or mutate a Run. */
  setSession(sessionId: string | undefined): void {
    if (sessionId === this.snapshot.sessionId) return;
    if (this.snapshot.busy) throw new Error('Wait for the current action to settle before changing its owner session.');
    this.epoch += 1;
    this.publish({ sessionId, selectedRunId: undefined, runs: [], loading: !!sessionId,
      error: undefined, readError: undefined, refreshedAt: undefined });
    void this.refresh();
  }

  selectRun(runId: string): void {
    if (!this.snapshot.runs.some((run) => run.id === runId)) return;
    this.publish({ selectedRunId: runId, error: undefined });
  }

  /** Coalesce reads and fence responses across owner changes and admitted mutations. */
  refresh(): Promise<void> {
    if (this.disposed || !this.snapshot.sessionId) return Promise.resolve();
    if (this.read) { this.readAgain = true; return this.read; }
    const sessionId = this.snapshot.sessionId;
    const epoch = this.epoch;
    const mutationEpoch = this.mutationEpoch;
    const current = (): boolean => !this.disposed && this.epoch === epoch && this.mutationEpoch === mutationEpoch;
    const work = async (): Promise<void> => {
      try {
        const rows = value(await this.remote.list({ sessionId }));
        if (!current()) return;
        const existing = new Map(this.snapshot.runs.map((run) => [run.id, run]));
        const runs = rows.map((run) => {
          const prior = existing.get(run.id);
          return prior && prior.revision > run.revision ? prior : run;
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const selected = runs.some((run) => run.id === this.snapshot.selectedRunId)
          ? this.snapshot.selectedRunId : runs[0]?.id;
        this.publish({ runs, selectedRunId: selected, readError: undefined, refreshedAt: new Date().toISOString() });
      } catch (error) {
        if (current()) this.publish({ readError: message(error) });
      } finally {
        if (this.epoch === epoch) this.publish({ loading: false });
      }
    };
    this.read = work().finally(() => {
      this.read = undefined;
      if (this.readAgain) { this.readAgain = false; void this.refresh(); }
    });
    return this.read;
  }

  private owner(): string {
    const sessionId = this.snapshot.sessionId;
    if (!sessionId) throw new Error('Choose the conversation that owns this work.');
    return sessionId;
  }

  private request(runId: string): RunRequest {
    if (!this.snapshot.runs.some((run) => run.id === runId)) throw new Error('The selected Run is no longer in this owner session. Refresh the list.');
    return { sessionId: this.owner(), runId };
  }

  private async mutate(action: () => Promise<RemoteResult<DevelopmentRun>>): Promise<boolean> {
    if (this.snapshot.busy || this.disposed) return false;
    this.mutationEpoch += 1;
    const epoch = this.epoch;
    this.publish({ busy: true, error: undefined });
    try {
      const run = value(await action());
      if (this.disposed || epoch !== this.epoch) return false;
      const previous = this.snapshot.runs.find((item) => item.id === run.id);
      const actual = previous && previous.revision > run.revision ? previous : run;
      this.publish({ runs: [actual, ...this.snapshot.runs.filter((item) => item.id !== run.id)], selectedRunId: run.id });
      return true;
    } catch (error) {
      if (epoch === this.epoch) this.publish({ error: message(error) });
      return false;
    } finally {
      this.mutationEpoch += 1;
      if (epoch === this.epoch) this.publish({ busy: false });
      // A failed read after a successful mutation does not become a failed action.
      void this.refresh();
    }
  }

  create(input: Omit<CreateRequest, 'sessionId'>): Promise<boolean> {
    return this.mutate(() => this.remote.create({ ...input, sessionId: this.owner() }));
  }

  act(action: RunAction, runId: string): Promise<boolean> {
    return this.mutate(() => this.remote[action](this.request(runId)));
  }

  decide(runId: string, decisionId: string, answer: string, action: DecideRequest['action'],
    advisor?: Pick<DecideRequest, 'advisorResult' | 'advisorAdoption'>): Promise<boolean> {
    return this.mutate(() => this.remote.decide({ ...this.request(runId), decisionId, answer,
      ...(action ? { action } : {}), ...advisor }));
  }

  revise(runId: string, goal: string): Promise<boolean> {
    return this.mutate(() => this.remote.revise({ ...this.request(runId), goal }));
  }

  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    this.clearTimer();
    this.listeners.clear();
  }
}
