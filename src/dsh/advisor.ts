/** Native Host Advisor handoff: package evidence locally, notify ONLY three short fields.
 * Neither the agent nor the webhook receives source ZIP, credentials or the local secret file.
 * The legacy exporter remains the full-content secret-filter authority; filtering is best-effort.
 */
import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdvisorNotice, AdvisorNotification, AdvisorPackage, DevelopmentRun } from '../core/types.js';
import type { AdvisorPort } from '../core/ports.js';
import { runProcess } from '../workspace/process.js';

function slug(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!safe || safe.length > 64) throw new Error('Invalid Advisor Run identity.');
  return safe;
}
function requestId(run: DevelopmentRun): string {
  const date = new Date(run.advisorCase?.raisedAt ?? run.createdAt);
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid Advisor request date.');
  const at = date.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return at.slice(0, 8) + '-' + at.slice(8, 12) + '_' + slug(run.id);
}
function evidenceRequest(run: DevelopmentRun): string {
  const info = run.advisorCase;
  if (!info) throw new Error('Advisor evidence is missing.');
  const section = info.sectionId ? run.plan?.sections.find(s => s.id === info.sectionId) : undefined;
  const current = info.candidateId ? run.candidates[info.candidateId] : undefined;
  const lines = [
    '# Advisor Request',
    '- Request ID: ' + requestId(run),
    '- Trigger ID: ' + info.trigger,
    '- Advisor kind: ' + (run.stage.startsWith('plan') || run.stage === 'planning' ? 'PLAN' : 'CODE'),
    '- Exact decision question: ' + (run.blockedReason ?? info.trigger),
    '- Feature / section: ' + (section?.title ?? run.plan?.title ?? run.id),
    '- User requirements and non-goals: See REQUIREMENTS.json in this package.',
    '- Frozen HEAD / status: ' + (current?.head ?? run.workspace.baseCommit) + '; candidate: ' + (current?.treeHash ?? 'plan only'),
    '- Current architecture: See PLAN.json and the source snapshot.',
    '- Native-side reviewer position (if applicable): See RUN-EVIDENCE.json.',
    '- External-side reviewer position (if applicable): See RUN-EVIDENCE.json.',
    '- Deterministic evidence: See RUN-EVIDENCE.json and GIT-EVIDENCE in the package.',
    '- Attempts and repair history: See RUN-EVIDENCE.json.',
    '- Package exclusions (secret-like content omitted): Read PACKAGE-EXCLUSIONS.json and the manifest.',
    '- Options and consequences: Preserve current evidence; human Advisor evaluates bounded recovery or alternative.',
    '- What the Advisor must decide: The specific unresolved question and the smallest evidence-backed intervention.',
    '- What the Advisor must not decide: Do not authorize new product scope, reset repair lineage, share credentials, push, merge, or discard validated work.',
    '',
    '## Complete current Advisor context',
    info.request,
    '',
  ];
  return lines.join('\n');
}
async function writeStable(path: string, content: string): Promise<void> {
  try { await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(path, 'utf8') !== content)
      throw new Error('Advisor evidence changed after freeze; manual reconciliation is required.');
  }
}
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
function safeField(text: string, maximum: number): string {
  const value = text.trim();
  if (!value || value.length > maximum || /[\r\n<>]/.test(value) || /https?:\/\/|(?:secret|token|password)\s*[:=]/i.test(value))
    throw new Error('Advisor notification fields must be short, single-line descriptions without URLs or secrets.');
  return value;
}

export class NativeAdvisorHandoff implements AdvisorPort {
  constructor(private readonly stateRoot?: string, private readonly python = 'python3',
    private readonly secretFile = join(homedir(), '.config', 'feishu-message-sender', 'secret.json')) {}

  private async root(run: DevelopmentRun): Promise<string> {
    const process = await runProcess(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: run.workspace.path, timeoutMs: 10_000,
    });
    if (process.exitCode !== 0 || process.truncated || process.timedOut)
      throw new Error('Unable to resolve the actual Git metadata root for Advisor packaging.');
    const common = resolve(process.output.trim());
    const identity = createHash('sha256').update(common).digest('hex').slice(0, 16);
    const folder = this.stateRoot
      ? join(this.stateRoot, identity, slug(run.id))
      : join(common, 'dsh-sfd', 'runs', slug(run.id));
    return join(folder, 'advisor');
  }

  async pack(run: DevelopmentRun): Promise<AdvisorPackage> {
    const caseFile = run.advisorCase;
    if (!caseFile) throw new Error('Advisor case is not present.');
    const root = await this.root(run);
    const id = requestId(run);
    const dir = join(root, id, 'request');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(join(root, id, 'response'), { recursive: true, mode: 0o700 });
    await writeStable(join(dir, 'ADVISOR-REQUEST.md'), evidenceRequest(run));
    await writeStable(join(dir, 'REQUIREMENTS.json'), JSON.stringify({
      goal: run.goal, history: run.requirementsHistory, humanDecisions: run.decisionHistory,
    }, null, 2) + '\n');
    await writeStable(join(dir, 'PLAN.json'), JSON.stringify(run.plan ?? null, null, 2) + '\n');
    await writeStable(join(dir, 'RUN-EVIDENCE.json'), JSON.stringify({
      runId: run.id, trigger: caseFile.trigger, inputVersion: run.inputContractVersion,
      source: run.workspace, activeSection: caseFile.sectionId, candidate: caseFile.candidateId ? run.candidates[caseFile.candidateId] : null,
      sections: run.sections, retiredSections: run.retiredSections,
      reviews: run.reviews, decisions: run.decisions, attempts: run.attempts.map(a => ({
        id: a.id, kind: a.task.kind, sectionId: a.task.sectionId, state: a.state, startedAt: a.startedAt,
        endedAt: a.endedAt, rejection: a.rejection, observed: a.outcome?.identity, report: a.admittedOutput,
      })), checks: run.featureChecks, events: run.events,
    }, null, 2) + '\n');

    const locations = [
      resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/advisor_pack.py'),
      resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/advisor_pack.py'),
    ];
    let script: string | undefined;
    for (const path of locations) {
      try { await readFile(path, 'utf8'); script = path; break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (!script) throw new Error('The bundled Advisor export helper is unavailable.');
    // Process execution belongs to the Host, never the model. No network or third-party upload.
    const result = await runProcess([this.python, script, '--repo', run.workspace.path,
      '--request', id, '--trigger', caseFile.trigger, '--output-root', root], {
      cwd: run.workspace.path, timeoutMs: 600_000, maxOutputBytes: 512_000,
    });
    if (result.exitCode !== 0 || result.timedOut || result.truncated)
      throw new Error('Advisor pack generation failed; consult the local exporter diagnostics, and keep the Run blocked.');
    let receipt: Record<string, unknown>;
    try { receipt = JSON.parse(result.output.split('\n')[0] ?? '') as Record<string, unknown>; }
    catch { throw new Error('Advisor pack receipt is not valid JSON.'); }
    const path = receipt.path;
    const digest = receipt.sha256;
    if (typeof path !== 'string' || typeof digest !== 'string' || !path.startsWith(dir + '/') ||
      !/^[a-f0-9]{64}$/.test(digest) || await hashFile(path) !== digest)
      throw new Error('Advisor pack path or SHA-256 verification failed.');
    if (receipt.share_status !== 'HUMAN_REVIEW_REQUIRED')
      throw new Error('Advisor pack must explicitly require human sensitive-data inspection.');
    return {
      path, sha256: digest, requestId: id, requestPath: join(dir, 'ADVISOR-REQUEST.md'),
      responsePath: join(root, id, 'response', 'ADVISOR-RESULT.md'),
      exclusionsPath: join(dir, 'PACKAGE-EXCLUSIONS.json'),
      generatedAt: new Date().toISOString(),
      bigFiles: typeof receipt.big_files_total === 'number' ? receipt.big_files_total : 0,
    };
  }

  async notify(run: DevelopmentRun, pack: AdvisorPackage, fields: AdvisorNotice): Promise<AdvisorNotification> {
    const project = safeField(fields.project, 100);
    const feature = safeField(fields.feature, 160);
    const reason = safeField(fields.reason, 500);
    if (!run.advisorCase || run.advisorCase.package?.sha256 !== pack.sha256)
      throw new Error('Advisor notification requires the verified, persistently recorded ZIP.');
    if (await hashFile(pack.path) !== pack.sha256) throw new Error('Advisor pack changed before notification.');
    const path = join(dirname(pack.requestPath), 'FEISHU-NOTIFICATION.json');
    // At-most-once delivery attempt. If the Host dies during POST, do not silently send twice.
    let lock;
    try { lock = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const saved = JSON.parse(await readFile(path, 'utf8')) as { status?: string; attemptedAt?: string; failure?: string };
      if (saved.status === 'sent' || saved.status === 'failed')
        return { status: saved.status, attemptedAt: saved.attemptedAt ?? '', ...(saved.failure ? { failure: saved.failure } : {}) };
      return { status: 'unknown', attemptedAt: saved.attemptedAt ?? '', failure: 'Previous outbound attempt was interrupted; manual check required before resending.' };
    }
    const attemptedAt = new Date().toISOString();
    await lock.writeFile(JSON.stringify({ status: 'started', attemptedAt }));
    await lock.sync(); await lock.close();

    let evidence: AdvisorNotification;
    try {
      const config = JSON.parse(await readFile(this.secretFile, 'utf8')) as Record<string, unknown>;
      const webhook = config.webhook, secret = config.secret, name = config.name;
      if (typeof webhook !== 'string' || typeof secret !== 'string' || typeof name !== 'string' ||
        !webhook || !secret || !name) throw new Error('Feishu credentials are not configured.');
      const url = new URL(webhook);
      if (url.protocol !== 'https:' || !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname))
        throw new Error('Feishu webhook host is not approved.');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sign = createHmac('sha256', timestamp + '\n' + secret).digest('base64');
      const content = '项目：' + project + '\n正在实现的功能：' + feature +
        '\n需要 Advisor 的原因：' + reason;
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ timestamp, sign, msg_type: 'text',
          content: { text: name + ' - ' + new Date().toLocaleString() + ' - ' + project + ':\n' + content } }),
      });
      let code: unknown;
      try { const body = await response.json() as { code?: unknown }; code = body.code; }
      catch { /* Never persist unknown HTTP response bodies. */ }
      evidence = response.ok && (code === undefined || code === 0)
        ? { status: 'sent', attemptedAt }
        : { status: 'failed', attemptedAt, failure: 'Feishu returned a non-success HTTP/API status.' };
    } catch {
      // Never log, persist or expose the secret file, webhook, token or exception.
      evidence = { status: 'failed', attemptedAt, failure: 'Feishu configuration, network or delivery unavailable; notify in the owning DSH conversation.' };
    }
    await writeFile(path, JSON.stringify(evidence), { mode: 0o600 });
    return evidence;
  }
}
