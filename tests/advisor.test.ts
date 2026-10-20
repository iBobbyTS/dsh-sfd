import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeAdvisorHandoff } from '../src/dsh/advisor.js';
import { runProcess } from '../src/workspace/process.js';
import type { DevelopmentRun } from '../src/core/types.js';

test('native Advisor ZIP includes request, business evidence and source; secrets stay excluded and missing Feishu is recorded', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'sfd-advisor-native-'));
  t.after(async () => rm(repo, { recursive: true, force: true }));
  async function cmd(...args: string[]) {
    const output = await runProcess(['git', ...args], { cwd: repo, timeoutMs: 10_000 });
    assert.equal(output.exitCode, 0, output.output);
    return output.output.trim();
  }
  await cmd('init', '-b', 'main');
  await cmd('config', 'user.name', 'SFD tests');
  await cmd('config', 'user.email', 'sfd@example.invalid');
  await writeFile(join(repo, 'source.txt'), 'A safe source snapshot\n');
  await cmd('add', 'source.txt'); await cmd('commit', '-m', 'initial');
  const head = await cmd('rev-parse', 'HEAD');
  await writeFile(join(repo, '.env'), 'PRIVATE_VALUE_NEVER_EXPORT\n');
  const run = {
    id: 'test-advisor-001',
    createdAt: '2026-10-20T10:05:00.000Z',
    goal: 'Preserve all validated code and diagnose non-convergence.',
    workspace: { path: repo, branch: 'main', baseCommit: head },
    stage: 'sections',
    requirementsHistory: [{ version: 1, goal: 'Preserve all validated code', at: '2026-10-20T10:05:00.000Z' }],
    decisionHistory: [], sections: {}, attempts: [], reviews: [], decisions: [], featureChecks: [], events: [],
    blockedReason: 'Five material repair waves and bounded recovery exhausted.',
    advisorCase: {
      trigger: 'ADV-01', raisedAt: '2026-10-20T10:05:00.000Z',
      request: 'Full evidence and original lineage must be independently assessed.',
      reportIds: [], status: 'preparing',
    },
  } as unknown as DevelopmentRun;
  const adapter = new NativeAdvisorHandoff(undefined, 'python3', join(repo, 'absent-feishu-config.json'));
  const pack = await adapter.pack(run);
  assert.match(pack.path, /test-advisor-001.*\.zip$/);
  assert.match(pack.sha256, /^[a-f0-9]{64}$/);
  const list = await runProcess(['python3', '-c', 'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', pack.path],
    { cwd: repo, timeoutMs: 10_000 });
  assert.equal(list.exitCode, 0, list.output);
  const names = JSON.parse(list.output) as string[];
  for (const part of ['request/ADVISOR-REQUEST.md', 'request/REQUIREMENTS.json',
    'request/PLAN.json', 'request/RUN-EVIDENCE.json', 'source.txt']) {
    assert.ok(names.some(name => name.endsWith(part)), 'Missing Advisor evidence: ' + part);
  }
  assert.ok(!names.some(name => name.endsWith('/.env')), 'Sensitive names cannot be archived');
  assert.equal(await cmd('rev-parse', 'HEAD'), head, 'Packaging must not change HEAD');
  const owning = { ...run, advisorCase: { ...run.advisorCase!, package: pack } };
  const fields = { project: 'SFD test', feature: 'Export correctness', reason: 'ADV-01: convergence failed.' };
  const first = await adapter.notify(owning, pack, fields);
  assert.equal(first.status, 'failed', 'Do not fabricate a Feishu delivery without credentials');
  const second = await adapter.notify(owning, pack, fields);
  assert.equal(second.status, 'failed');
  assert.ok((await readFile(pack.exclusionsPath, 'utf8')).includes('.env'));
  const config = join(repo, 'fake-feishu-only-for-test.json');
  await writeFile(config, JSON.stringify({ webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/testing',
    secret: 'fixture-secret-not-real', name: 'Bot Fixture' }));
  let payload: Record<string, unknown> | undefined;
  let called = 0;
  const fakePost: typeof fetch = async (url, options) => {
    called++;
    assert.match(String(url), /^https:\/\/open\.feishu\.cn\/open-apis\/bot\//);
    payload = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  };
  const http = new NativeAdvisorHandoff(undefined, 'python3', config, fakePost);
  // The original notice used a failed-delivery receipt; create a second distinct
  // Advisor request directory rather than retrying an already uncertain webhook.
  const fresh = { ...run, id: 'test-advisor-002', advisorCase: { ...run.advisorCase!,
    raisedAt: '2026-10-20T10:06:00.000Z' } };
  const nextPack = await http.pack(fresh);
  const nextRun = { ...fresh, advisorCase: { ...fresh.advisorCase!, package: nextPack } };
  const sent = await http.notify(nextRun, nextPack, fields);
  assert.equal(sent.status, 'sent');
  assert.equal(called, 1);
  assert.ok(payload && typeof payload.timestamp === 'string' && typeof payload.sign === 'string');
  assert.equal(payload.sign, createHmac('sha256', payload.timestamp + '\\n' + 'fixture-secret-not-real').digest('base64'));
  assert.equal(payload.msg_type, 'text');
  const delivered = (payload.content as { text:string }).text;
  assert.ok(delivered.includes('项目：SFD test'));
  assert.ok(delivered.includes('正在实现的功能：Export correctness'));
  assert.ok(delivered.includes('需要 Advisor 的原因：ADV-01: convergence failed.'));
  assert.ok(!delivered.includes(nextPack.path) && !delivered.includes(nextPack.sha256) && !delivered.includes('PRIVATE_VALUE'));
  assert.equal((await http.notify(nextRun, nextPack, fields)).status, 'sent');
  assert.equal(called, 1, 'At-most-once receipt must prevent accidental duplicate sending');
});
