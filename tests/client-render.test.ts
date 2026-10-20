import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPolicy } from '../src/core/policy.js';
import type { DevelopmentRun } from '../src/core/types.js';
import { DevelopmentClientController } from '../src/client/controller.js';
import { RunDetail } from '../src/client/DevelopmentPanel.js';
import type { DevelopmentWorkflowRemote } from '../src/dsh/remote-contract.js';

test('run view explains actual Sections, decisions and escaped evidence without dumping state JSON', () => {
  const at = '2026-10-19T09:00:00.000Z';
  const run: DevelopmentRun = {
    id: 'run-view', schemaVersion: 1, workflowVersion: '1.0.0', revision: 8, controlEpoch: 2,
    inputContractVersion: 1, createdAt: at, updatedAt: at, goal: 'Preserve the real workflow outcome.',
    requirementsHistory: [{ version: 1, goal: 'Preserve the real workflow outcome.', at }],
    workspace: { path: '/repo', branch: 'sfd/run-view', baseCommit: 'base' }, policy: createPolicy(),
    status: 'waiting-user', stage: 'sections', planRevision: 1, planRepairs: 0, planFeedback: [], activeSectionId: 'S01',
    plan: { title: 'Reliable development', assumptions: [],
      features: [{ id: 'F01', title: 'Restartable task', outcome: 'A task recovers its goal.', acceptanceCriteria: ['No lost objective'], sectionIds: ['S01'], checks: [] }],
      sections: [{ id: 'S01', title: 'Durable controller', objective: 'Persist task authority.', featureIds: ['F01'], dependencies: [], writeScope: ['src/core'],
        acceptanceCriteria: ['Reject old control epochs'], implementation: 'standard', checks: [], subsections: [] }] },
    sections: { S01: { id: 'S01', stage: 'repairing', inputContractVersion: 1, lineageId: 'original-section', materialRepairWaves: 3, diagnosticCount: 0,
      lenses: [], checks: [], reviewIds: ['review-one'], decisionIds: [], aCoverageEvidenceIds: [], repairInstructions: 'Retain the requirement version.' } },
    candidates: {}, attempts: [], operations: [], decisions: [], featureChecks: [], decisionHistory: [], events: [],
    reviews: [{ id: 'review-one', attemptId: 'attempt-review', candidateId: 'candidate-one', sectionId: 'S01', stage: 'a', lensId: 'R01', valid: true,
      output: { verdict: 'findings', summary: 'A missing epoch fence was found.', coverage: ['Pause and late result admission'], limitations: ['External runner unavailable'],
        findings: [{ id: 'f1', title: 'Stale transition', body: '<script>maliciousArtifact()</script>', severity: 'major', invariant: 'Paused work cannot advance', location: 'controller.ts' }] } }],
    pendingDecision: { id: 'decision-one', kind: 'semantic', question: 'Which behavior should the resumed task preserve?', context: 'Two requirements conflict.', createdAt: at },
  };
  const noWire = async (): Promise<never> => { throw new Error('Rendering must not invoke Remote methods'); };
  const remote: DevelopmentWorkflowRemote = { list: noWire, create: noWire, status: noWire, start: noWire, pause: noWire, resume: noWire, cancel: noWire, recover: noWire, decide: noWire, revise: noWire };
  const controller = new DevelopmentClientController(remote, 0);
  const html = renderToStaticMarkup(createElement(RunDetail, { run, busy: false, controller }));
  assert.ok(html.includes('Durable controller'));
  assert.ok(html.includes('3 / 5'));
  assert.ok(html.includes('original-section'));
  assert.ok(html.includes('Which behavior should the resumed task preserve?'));
  assert.ok(html.includes('External runner unavailable'));
  assert.ok(html.includes('&lt;script&gt;maliciousArtifact()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>maliciousArtifact()'));
  assert.ok(!html.includes('"schemaVersion"'));
  assert.ok(!html.includes('>Resume</button>'));
  controller.dispose();
});
