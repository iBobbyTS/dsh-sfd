import type { ActorRoute, ActorTask, DevelopmentRun, RouteTransport } from '../core/types.js';
import type { RunOwner } from './store.js';

/** The requested model family, not the selected chat Host, owns the execution transport. */
export function transportForModel(model: string): RouteTransport {
  const slug = model.trim().split(/[/:]/).at(-1) ?? '';
  if (/^glm(?:[-_.]|$)/i.test(slug)) return 'external-subagent/zcode';
  if (/^gpt(?:[-_.]|$)/i.test(slug)) return 'external-subagent/codex';
  // DeepSeek is explicitly native. Other unassigned families retain DSH's
  // existing native route; no GLM or GPT route ever silently falls back here.
  return 'dsh-native';
}

/** Resolve once at Run creation so routing cannot mutate mid-task with Host config. */
export function freezeModelRoute(
  preset: string,
  owner: Pick<RunOwner, 'provider' | 'model' | 'effort'>,
  override?: { provider: string; model: string; effort?: string },
): ActorRoute {
  const provider = override?.provider ?? owner.provider;
  const model = override?.model ?? owner.model;
  if (!provider.trim() || !model.trim()) throw new Error('A model route needs a real provider and model.');
  const effort = override?.effort ?? (override === undefined ? owner.effort : undefined);
  return { preset, provider, model, ...(effort ? { effort } : {}), transport: transportForModel(model) };
}

export interface ExternalTarget {
  subagent: 'zcode' | 'codex';
  model: string;
  effort?: string;
  permission_mode: 'plan' | 'build' | 'yolo';
}

/** The effective Subsection model tier is frozen by the controller. Older
 * attempts fall back to their authored tier rather than silently using an
 * unrelated parent tier. No large task can fall back to a standard route. */
export function configuredActorRoute(task: ActorTask, run: Pick<DevelopmentRun, 'plan' | 'policy'>): ActorRoute | undefined {
  if (task.kind !== 'implementer') return run.policy.routes[task.kind];
  const legacyTier = task.input.implementation === 'large' || task.input.implementation === 'standard'
    ? task.input.implementation
    : run.plan?.sections.find(section => section.id === task.sectionId)?.implementation ?? 'standard';
  const tier = task.implementationTier ?? legacyTier;
  if (tier === 'large') {
    if (!run.policy.largeImplementerRoute) throw new Error('MODEL_CONFIGURATION_UNVERIFIED: impl_large needs its explicitly authorized model route.');
    return run.policy.largeImplementerRoute;
  }
  return run.policy.routes.implementer;
}

/** Exact public external-subagent spawn tokens, with no new write manifest. */
export function externalTarget(
  route: ActorRoute,
  access: 'reader' | 'writer',
  sandboxMode: RunOwner['sandboxMode'],
): ExternalTarget {
  const expected = transportForModel(route.model ?? '');
  if (route.transport !== expected) throw new Error('MODEL_CONFIGURATION_UNVERIFIED: frozen actor transport does not match its model family.');
  if (expected === 'dsh-native') throw new Error('A DeepSeek/native model must not be sent through external-subagent.');
  if (!route.provider || !route.model) throw new Error('MODEL_CONFIGURATION_UNVERIFIED: external model requires an explicit provider and model.');
  const subagent = expected === 'external-subagent/zcode' ? 'zcode' : 'codex';
  const model = subagent === 'codex'
    ? route.model
    : route.model.includes('/') ? route.model : `${route.provider}/${route.model}`;
  if (model.includes('\0') || !model.trim() || (subagent === 'zcode' && !model.includes('/'))) {
    throw new Error('MODEL_CONFIGURATION_UNVERIFIED: invalid external model token.');
  }
  return {
    subagent, model,
    ...(route.effort ? { effort: route.effort } : {}),
    permission_mode: access === 'reader' ? 'plan' :
      sandboxMode === 'danger-full-access' ? 'yolo' : 'build',
  };
}
