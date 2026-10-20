import { POLICY_VERSION, type WorkflowPolicy } from './types.js';

export function createPolicy(input: Partial<WorkflowPolicy> = {}): WorkflowPolicy {
  const policy: WorkflowPolicy = {
    version: POLICY_VERSION,
    actorTimeoutMs: 30 * 60_000,
    maxParallelReviews: 4,
    maxRepairWaves: 5,
    maxPlanRepairs: 2,
    maxDiagnostics: 1,
    maxInfrastructureRetries: 1,
    commit: false,
    routes: {},
    ...input,
  };
  if (policy.version !== POLICY_VERSION) throw new Error(`Unsupported workflow policy version: ${policy.version}. Explicit migration is required.`);
  for (const [name, maximum] of [
    ['actorTimeoutMs', 24 * 60 * 60_000], ['maxParallelReviews', 6],
    ['maxRepairWaves', 5], ['maxPlanRepairs', 2], ['maxDiagnostics', 2], ['maxInfrastructureRetries', 3],
  ] as const) {
    if (!Number.isInteger(policy[name]) || policy[name] < (name === 'maxInfrastructureRetries' ? 0 : 1) || policy[name] > maximum) {
      throw new Error(`Invalid workflow policy ${name}; expected a bounded positive integer up to ${maximum}.`);
    }
  }
  return policy;
}
