import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActorOutput, validatePlan } from '../src/core/contracts.js';
import { createPolicy } from '../src/core/policy.js';
import type { DevelopmentPlan } from '../src/core/types.js';

const plan = (): DevelopmentPlan => ({
  title: 'Workflow', assumptions: [],
  features: [{ id: 'F1', title: 'Feature', outcome: 'User outcome', acceptanceCriteria: ['Real path'], sectionIds: ['S1', 'S2'], checks: [] }],
  sections: [
    { id: 'S1', title: 'Producer', objective: 'Produce contract', featureIds: ['F1'], dependencies: [], writeScope: ['src/a.ts'], acceptanceCriteria: ['Producer works'], implementation: 'standard', checks: [], subsections: [{ id: 'S1a', objective: 'Internal step', acceptanceCriteria: ['Local check'], writeScope: ['src/a.ts'], consumer: 'Parent producer interface', safeIntermediateState: 'Internal producer remains importable', checks: [{id:'local',command:['node','--version'],required:true}] }] },
    { id: 'S2', title: 'Consumer', objective: 'Consume contract', featureIds: ['F1'], dependencies: ['S1'], writeScope: ['src/b.ts'], acceptanceCriteria: ['Composition works'], implementation: 'standard', checks: [], subsections: [] },
  ],
});
test('dependency graph permits parent Sections but never internal Subsections or cycles', () => {
  validatePlan(plan());
  const internal = plan(); internal.sections[1].dependencies = ['S1a'];
  assert.throws(() => validatePlan(internal), /parent Sections/);
  const cycle = plan(); cycle.sections[0].dependencies = ['S2'];
  assert.throws(() => validatePlan(cycle), /cycle/);
});
test('plan structure enforces business Feature ownership in both directions', () => {
  const invalid = plan(); invalid.features[0].sectionIds = ['S1'];
  assert.throws(() => validatePlan(invalid), /membership/);
});
test('clean review and code A lens selection have meaningful bounded contracts', () => {
  assert.throws(() => parseActorOutput('reviewer-a', { verdict: 'clean', summary: 'Fine', coverage: [], limitations: [], findings: [] }), /coverage/);
  assert.throws(() => parseActorOutput('review-selector', { lenses: [{ id: 'R02', name: 'Structure', focus: 'Simplification' }], rationale: 'Small change' }), /R01/);
  assert.throws(() => createPolicy({ maxRepairWaves: 6 }), /maxRepairWaves/);
});

test('one parent Section has exactly one owning Feature, with cross-Feature reuse via dependency', () => {
  const shared = plan();
  shared.features.push({ id: 'F2', title: 'Second feature', outcome: 'Use producer', acceptanceCriteria: ['Consumer journey'], sectionIds: ['S2'], checks: [] });
  shared.sections[1].featureIds = ['F2'];
  shared.features[0].sectionIds = ['S1'];
  validatePlan(shared);
  shared.sections[0].featureIds = ['F1', 'F2'];
  shared.features[1].sectionIds = ['S1', 'S2'];
  assert.throws(() => validatePlan(shared), /exactly one owning Feature/);
});
