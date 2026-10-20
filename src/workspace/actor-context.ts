import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { ActorTask } from '../core/types.js';
import { buildActorPrompt, visibleActorInput } from '../roles/prompts.js';

export interface PreparedActorPrompt { prompt: string; artifactRefs: string[] }
export interface ActorContextOptions { directory: string; maxCharacters?: number }
interface ArtifactReference { artifactPath: string; characters: number; sha256: string }
const encode = (value: unknown): string => JSON.stringify(value, null, 2) ?? 'null';
const scalarIdentity = ['id', 'featureId', 'sectionId', 'candidateId', 'attemptId', 'lensId', 'stage', 'kind', 'status', 'verdict', 'valid', 'satisfied'] as const;

/**
 * Bound presentation, not the durable task or its requirements. Large evidence is
 * stored outside all source candidates. Readers retrieve the exact immutable data.
 */
export async function prepareActorPrompt(task: ActorTask, options: ActorContextOptions): Promise<PreparedActorPrompt> {
  const maximum = options.maxCharacters ?? 64_000;
  if (!Number.isInteger(maximum) || maximum < 16_000) throw new Error('Actor prompt budget must be at least 16000 characters.');
  if (!isAbsolute(options.directory)) throw new Error('Actor context directory must be absolute.');
  // Filtering precedes disk writes: a blind reader never gets a hidden A report in a full packet artifact.
  const input = visibleActorInput(task);
  const visibleTask = { ...task, input };
  const original = buildActorPrompt(visibleTask);
  if (original.length <= maximum) return { prompt: original, artifactRefs: [] };
  const minimal = buildActorPrompt({ ...task, input: { goal: input.goal, phase: input.phase } });
  if (minimal.length > maximum - 3_000) throw new Error('The current user goal and role contract exceed the bounded actor input. Split the explicitly authorized goal into smaller Runs; the goal was not truncated.');
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const artifacts: string[] = [];
  const persist = async (label: string, value: unknown): Promise<ArtifactReference> => {
    const content = encode(value);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const filename = `${label.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 70)}-${sha256.slice(0, 12)}.json`;
    const artifactPath = join(options.directory, filename);
    try { await writeFile(artifactPath, content, { encoding: 'utf8', mode: 0o444, flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(artifactPath, 'utf8') !== content) throw error;
    }
    artifacts.push(artifactPath);
    return { artifactPath, characters: content.length, sha256 };
  };
  const entry = async (label: string, value: unknown): Promise<unknown> => {
    if (encode(value).length <= 900) return value;
    const reference = await persist(label, value);
    const index: Record<string, unknown> = { ...reference };
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const key of scalarIdentity) if (typeof record[key] === 'string' || typeof record[key] === 'boolean') index[key] = record[key];
      for (const key of ['title', 'name', 'objective', 'criterion', 'question']) {
        if (typeof record[key] === 'string') index[key] = record[key].length <= 220 ? record[key] : `${record[key].slice(0, 220)} [full text in artifact]`;
      }
    }
    return index;
  };
  const compact: Record<string, unknown> = { goal: input.goal };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'goal') continue;
    if (encode(value).length <= 2_000) { compact[key] = value; continue; }
    if (Array.isArray(value)) {
      const index = await Promise.all(value.map((item, number) => entry(`${key}-${number}`, item)));
      compact[key] = encode(index).length <= 10_000 ? index : { count: index.length, index: await persist(`${key}-index`, index) };
    } else if (key === 'candidate' && value !== null && typeof value === 'object') {
      const candidate = value as Record<string, unknown>;
      compact[key] = {
        id: candidate.id, head: candidate.head, treeHash: candidate.treeHash, workspacePath: candidate.workspacePath,
        fullCandidate: await persist('candidate', candidate),
        diff: { ...await persist('candidate-diff', candidate.diff), instruction: 'Read this full diff and the actual source; the diff was not discarded.' },
        changedFiles: await entry('changed-files', candidate.changedFiles),
      };
    } else if (key === 'plan' && value !== null && typeof value === 'object') {
      const plan = value as Record<string, unknown>;
      compact[key] = {
        title: plan.title,
        fullPlan: await persist('plan', plan),
        features: Array.isArray(plan.features) ? await Promise.all(plan.features.map((item, number) => entry(`feature-${number}`, item))) : plan.features,
        sections: Array.isArray(plan.sections) ? await Promise.all(plan.sections.map((item, number) => entry(`section-${number}`, item))) : plan.sections,
      };
    } else compact[key] = await entry(key, value);
  }
  const instructions = `\n\n## Bounded evidence access\nLarge task fields below are exact immutable artifacts, identified by absolute artifactPath and SHA-256. Use the read tool to retrieve their contents (and paginate long files). An index entry is not the full contract or a completed review. Read all applicable acceptance criteria, current user decisions, assigned findings, and necessary evidence before deciding. Missing inspection must be reported as incomplete. The complete current user goal above was retained. Do not infer acceptance from a short index.\n`;
  let prompt = buildActorPrompt({ ...task, input: compact }) + instructions;
  // A very wide plan/history gets a bounded top-level index too, without dropping any field.
  if (prompt.length > maximum) {
    for (const [key, value] of Object.entries(compact)) {
      if (key !== 'goal' && key !== 'phase' && encode(value).length > 900) compact[key] = await persist(`${key}-bounded-index`, value);
    }
    prompt = buildActorPrompt({ ...task, input: compact }) + instructions;
  }
  if (prompt.length > maximum) throw new Error('The current actor contract exceeds its presentation budget even after artifact indexing. The task remains intact; revise its explicit scope before continuing.');
  return { prompt, artifactRefs: [...new Set(artifacts)] };
}
