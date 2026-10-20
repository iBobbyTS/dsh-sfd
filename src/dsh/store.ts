import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { RunStore } from '../core/ports.js';
import type { DevelopmentRun } from '../core/types.js';
import { runSchema } from '../core/schemas.js';

/** Authorization is fixed by the native entry point, never by a model result. */
export const ownerSchema = z.object({
  sessionId: z.string().min(1),
  sourceRoot: z.string().min(1),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
  permissionPreset: z.string().optional(),
  provider: z.string().min(1), model: z.string().min(1), effort: z.string().optional(),
}).strict();
export type RunOwner = z.infer<typeof ownerSchema>;
export const runEnvelopeSchema = z.object({ owner: ownerSchema, run: runSchema }).strict();
export const workflowDomain = defineDomain({
  name: 'sfd_development', version: 1, layout: 'single',
  tables: { runs: domainTable(runEnvelopeSchema) },
});

/** One strict, authoritative domain opened once per Host plugin instance. */
export class DomainRunStore implements RunStore {
  private readonly creationOwner = new AsyncLocalStorage<RunOwner>();
  private readonly creating = new Set<string>();
  constructor(private readonly domain: Domain<typeof workflowDomain>) {}

  static async open(facility: DomainFacility): Promise<DomainRunStore> {
    return new DomainRunStore(await facility.open(workflowDomain));
  }

  withOwner<T>(owner: RunOwner, operation: () => Promise<T>): Promise<T> {
    return this.creationOwner.run(ownerSchema.parse(owner), operation);
  }

  ownerOf(id: string): RunOwner | undefined {
    const envelope = this.domain.table('runs').get(id);
    return envelope === undefined ? undefined : structuredClone(envelope.owner);
  }

  async list(): Promise<DevelopmentRun[]> {
    return [...this.domain.table('runs').entries()].map(([, record]) => structuredClone(record.run));
  }

  async get(id: string): Promise<DevelopmentRun | undefined> {
    const record = this.domain.table('runs').get(id);
    return record === undefined ? undefined : structuredClone(record.run);
  }

  async create(run: DevelopmentRun): Promise<void> {
    const owner = this.creationOwner.getStore();
    if (owner === undefined) throw new Error('Creating a Run requires a captured native owner.');
    const next = runEnvelopeSchema.parse({ owner, run });
    const table = this.domain.table('runs');
    if (this.creating.has(run.id) || table.get(run.id) !== undefined) throw new Error(`Run already exists: ${run.id}`);
    this.creating.add(run.id);
    try { await table.put(run.id, next); }
    finally { this.creating.delete(run.id); }
  }

  async update(id: string, transform: (run: DevelopmentRun) => DevelopmentRun): Promise<DevelopmentRun> {
    const saved = await this.domain.table('runs').update(id, current => {
      if (current === undefined) throw new Error(`Unknown Run: ${id}`);
      const run = transform(structuredClone(current.run));
      if (run.id !== id) throw new Error('A Run update cannot change its identity.');
      return runEnvelopeSchema.parse({ owner: current.owner, run });
    });
    if (saved === undefined) throw new Error('Run unexpectedly deleted during update.');
    return structuredClone(saved.run);
  }

  async close(): Promise<void> { await this.domain.close(); }
}
