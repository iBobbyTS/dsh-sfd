import { z } from 'zod';
import type { ActorKind, ActorOutput, DevelopmentPlan } from './types.js';

const text = z.string().min(1).max(40_000);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/);
const texts = z.array(text).max(200);
const check = z.strictObject({
  id, command: z.array(z.string().min(1)).min(1).max(100), cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(3_600_000).optional(), required: z.boolean(),
});
export const planSchema = z.strictObject({
  title: text,
  features: z.array(z.strictObject({ id, title: text, outcome: text, acceptanceCriteria: texts.min(1), sectionIds: z.array(id).min(1), checks: z.array(check) })).min(1).max(100),
  sections: z.array(z.strictObject({
    id, title: text, featureIds: z.array(id).min(1), objective: text,
    dependencies: z.array(id), writeScope: texts.min(1), acceptanceCriteria: texts.min(1),
    implementation: z.enum(['standard', 'large']), checks: z.array(check),
    subsections: z.array(z.strictObject({ id, objective: text, acceptanceCriteria: texts.min(1) })),
  })).min(1).max(500),
  assumptions: texts,
});
export const findingSchema = z.strictObject({
  id, title: text, body: text, severity: z.enum(['critical', 'major', 'minor']),
  invariant: text, location: z.string().optional(),
});
export const reviewSchema = z.strictObject({
  verdict: z.enum(['clean', 'findings', 'incomplete']), summary: text,
  coverage: texts, limitations: texts, findings: z.array(findingSchema).max(200),
});
export const implementationSchema = z.strictObject({
  summary: text, completedCriteria: texts, remainingWork: texts, changedInterfaces: texts,
});
export const selectionSchema = z.strictObject({
  lenses: z.array(z.strictObject({ id, name: text, focus: text })).min(1).max(6), rationale: text,
});
export const adjudicationSchema = z.strictObject({
  resolution: z.enum(['accept', 'repair', 'more-review', 'needs-user']), summary: text,
  coverageSufficient: z.boolean(),
  dispositions: z.array(z.strictObject({ findingId: text, decision: z.enum(['fix', 'reject', 'needs-user']), reason: text })),
  repairInstructions: z.string(), material: z.boolean(), invalidatedSectionIds: z.array(id), missingCoverage: texts,
  evidenceReuse: z.array(z.strictObject({ evidenceId: text, reason: text })),
  question: z.string().optional(),
});
export const featureVerificationSchema = z.strictObject({
  verdict: z.enum(['accepted', 'repair', 'needs-user']), summary: text,
  criteria: z.array(z.strictObject({ featureId: id, criterion: text, evidenceIds: z.array(text).min(1), satisfied: z.boolean() })).min(1),
  repairSectionIds: z.array(id), repairInstructions: z.string(), question: z.string().optional(),
});
export const diagnosticSchema = z.strictObject({
  summary: text, recommendation: z.enum(['retry', 'revise-plan', 'needs-user']), instructions: text, question: z.string().optional(),
});
export const actorOutputSchemas = {
  planner: z.strictObject({ plan: planSchema, explanation: text }),
  'plan-review-a': reviewSchema,
  'plan-review-b': reviewSchema,
  implementer: implementationSchema,
  'review-selector': selectionSchema,
  'reviewer-a': reviewSchema,
  'reviewer-b': reviewSchema,
  adjudicator: adjudicationSchema,
  'closure-reviewer': reviewSchema,
  'feature-verifier': featureVerificationSchema,
  diagnostician: diagnosticSchema,
} satisfies Record<ActorKind, z.ZodType>;

export function outputSchemaFor(kind: ActorKind): Record<string, unknown> {
  // DSH's native structured-output validator accepts a deliberate JSON Schema subset.
  // Preserve structural constraints there; full size/range/semantic validation remains
  // authoritative in parseActorOutput after the real execution returns.
  const raw = JSON.parse(JSON.stringify(z.toJSONSchema(actorOutputSchemas[kind]))) as Record<string, unknown>;
  const lower = (node: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const key of ['type', 'required', 'additionalProperties', 'enum', 'const', 'title', 'description']) {
      if (key in node) result[key] = node[key];
    }
    if (node.properties) result.properties = Object.fromEntries(Object.entries(node.properties as Record<string, Record<string, unknown>>).map(([key, value]) => [key, lower(value)]));
    if (node.items) result.items = lower(node.items as Record<string, unknown>);
    if (node.oneOf) result.oneOf = (node.oneOf as Record<string, unknown>[]).map(lower);
    return result;
  };
  return lower(raw);
}

/** A schema proves structure. These checks add bounded, decidable workflow invariants. */
export function parseActorOutput(kind: ActorKind, value: unknown): ActorOutput {
  const result = actorOutputSchemas[kind].parse(value) as ActorOutput;
  if (kind === 'planner') validatePlan((result as { plan: DevelopmentPlan }).plan);
  if ('verdict' in result && 'findings' in result) {
    if (result.verdict === 'clean' && result.findings.length) throw new Error('A clean review cannot contain findings.');
    if (result.verdict === 'findings' && !result.findings.length) throw new Error('A findings review must contain findings.');
    if (result.verdict === 'clean' && !result.coverage.length) throw new Error('A clean review must describe actual coverage.');
    assertUnique(result.findings.map((finding) => finding.id), 'finding');
  }
  if ('lenses' in result) {
    assertUnique(result.lenses.map((lens) => lens.id), 'lens');
    if (!result.lenses.some((lens) => lens.id === 'R01')) throw new Error('Code A requires the independent full behavior baseline R01.');
  }
  return result;
}

export function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} identity.`);
}

export function validatePlan(plan: DevelopmentPlan): void {
  assertUnique(plan.features.map((feature) => feature.id), 'Feature');
  assertUnique(plan.sections.map((section) => section.id), 'Section');
  const sections = new Map(plan.sections.map((section) => [section.id, section]));
  const features = new Map(plan.features.map((feature) => [feature.id, feature]));
  const children = plan.sections.flatMap((section) => section.subsections.map((child) => child.id));
  assertUnique([...sections.keys(), ...children], 'Section/Subsection');
  for (const section of plan.sections) {
    assertUnique(section.acceptanceCriteria, `acceptance criterion in ${section.id}`);
    assertUnique(section.dependencies, 'dependency');
    assertUnique(section.featureIds, 'Feature membership');
    for (const dependency of section.dependencies) {
      if (!sections.has(dependency)) throw new Error(`Section ${section.id} depends on missing or internal unit ${dependency}. Dependencies must identify parent Sections.`);
      if (dependency === section.id) throw new Error(`Section ${section.id} depends on itself.`);
    }
    for (const featureId of section.featureIds) {
      if (!features.get(featureId)?.sectionIds.includes(section.id)) throw new Error(`Feature/Section membership is inconsistent for ${section.id}/${featureId}.`);
    }
    assertUnique(section.checks.map((spec) => spec.id), `check in ${section.id}`);
  }
  for (const feature of plan.features) {
    assertUnique(feature.acceptanceCriteria, `business criterion in ${feature.id}`);
    assertUnique(feature.sectionIds, 'Section membership');
    assertUnique(feature.checks.map((spec) => spec.id), `check in ${feature.id}`);
    for (const sectionId of feature.sectionIds) {
      if (!sections.get(sectionId)?.featureIds.includes(feature.id)) throw new Error(`Feature ${feature.id} references absent or unowned Section ${sectionId}.`);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (sectionId: string): void => {
    if (visiting.has(sectionId)) throw new Error('Section dependency graph contains a cycle.');
    if (visited.has(sectionId)) return;
    visiting.add(sectionId);
    for (const dependency of sections.get(sectionId)!.dependencies) visit(dependency);
    visiting.delete(sectionId);
    visited.add(sectionId);
  };
  for (const section of plan.sections) visit(section.id);
}
