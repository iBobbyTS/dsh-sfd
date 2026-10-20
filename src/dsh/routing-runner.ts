import type { Context } from '@deepseek-ai/cordis';
import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorTask } from '../core/types.js';
import { ROLE_PRESETS } from '../roles/specs.js';
import type { DomainRunStore } from './store.js';
import { NativeActorRunner, validateActorRoute } from './actors.js';
import { ExternalSubagentCli, ExternalSubagentRunner, type ExternalSubagentClient } from './external-actor.js';
import { transportForModel } from './model-routing.js';

/** One Host-owned dispatch authority. DeepSeek is native, GLM/GPT are external. */
export class ModelFamilyActorRunner implements ActorRunner {
  private readonly native: NativeActorRunner;
  private readonly external: ExternalSubagentRunner;
  constructor(ctx: Context, private readonly store: DomainRunStore, client: ExternalSubagentClient = new ExternalSubagentCli()) {
    this.native = new NativeActorRunner(ctx, store);
    this.external = new ExternalSubagentRunner(store, client);
  }

  async start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle> {
    const run = await this.store.get(task.runId);
    const owner = this.store.ownerOf(task.runId);
    if (!run || !owner) throw new Error(`SFD actor has no owning Run: ${task.runId}`);
    const section = task.kind === 'implementer' && task.sectionId
      ? run.plan?.sections.find((entry) => entry.id === task.sectionId) : undefined;
    const expected = section?.implementation === 'large'
      ? run.policy.largeImplementerRoute : run.policy.routes[task.kind];
    if (section?.implementation === 'large' && !expected) throw new Error('MODEL_CONFIGURATION_UNVERIFIED: impl_large route is missing.');
    validateActorRoute(task, expected);
    const route = task.route ?? expected ?? { preset: ROLE_PRESETS[task.kind] };
    const model = route.model ?? owner.model;
    const transport = transportForModel(model);
    if (!route.transport || route.transport !== transport) {
      throw new Error('MODEL_CONFIGURATION_UNVERIFIED: Run has no pinned or matching model-family transport; explicitly migrate its policy.');
    }
    return transport === 'dsh-native'
      ? this.native.start(task, signal)
      : this.external.start(task, signal);
  }

  release(runId: string): Promise<void> { return this.native.release(runId); }
  async dispose(): Promise<void> {
    const outcomes = await Promise.allSettled([this.external.dispose(), this.native.dispose()]);
    const failed = outcomes.find((entry) => entry.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
