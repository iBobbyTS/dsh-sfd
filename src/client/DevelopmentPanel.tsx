import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CheckEvidence, DevelopmentRun, FeatureVerificationOutput, UserDecision } from '../core/types.js';
import type { DecideRequest } from '../dsh/remote-contract.js';
import { DevelopmentClientController, type RunAction } from './controller.js';
import { availableActions, dateLabel, observedIdentity, phaseLabel, requestedIdentity, ROLE_LABELS, SECTION_LABELS, shorten, STATUS_LABELS } from './presentation.js';
import { PANEL_STYLES } from './styles.js';

export interface SessionCatalog {
  getSnapshot(): SessionListState;
  subscribe(listener: () => void): () => void;
}

export interface DevelopmentPanelInjected {
  controller: DevelopmentClientController;
  sessionCatalog: SessionCatalog;
}

const ACTION_LABELS: Record<RunAction, string> = {
  start: 'Start', pause: 'Pause', resume: 'Resume', cancel: 'Cancel run', recover: 'Reconcile recovery',
};

function Badge({ status, children }: { status: string; children: ReactNode }): ReactNode {
  return <span className="sfd-badge" data-status={status}>{children}</span>;
}

function TextItems({ items }: { items: readonly string[] }): ReactNode {
  return items.length ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null;
}

function Checks({ checks }: { checks: readonly CheckEvidence[] }): ReactNode {
  if (!checks.length) return <p className="sfd-muted">No check results recorded yet.</p>;
  return <div>{checks.map((check) => <details key={check.id}>
    <summary><Badge status={check.status}>{check.status}</Badge> {check.specId} <span className="sfd-muted">· {shorten(check.candidateId)}</span></summary>
    <dl><dt>Evidence</dt><dd><code>{check.id}</code></dd><dt>Finished</dt><dd>{dateLabel(check.endedAt)}</dd><dt>Exit code</dt><dd>{check.exitCode ?? 'Not recorded'}</dd></dl>
    {check.output && <pre>{check.output}</pre>}
  </details>)}</div>;
}

function CreateForm({ controller, workspacePath, busy, onClose }: {
  controller: DevelopmentClientController; workspacePath: string | undefined; busy: boolean; onClose(): void;
}): ReactNode {
  const [goal, setGoal] = useState('');
  const [path, setPath] = useState(workspacePath ?? '');
  const [intent, setIntent] = useState<'execute' | 'plan-handoff' | 'review-only'>('execute');
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const created = await controller.create({ goal: goal.trim(), intent, ...(path.trim() ? { workspacePath: path.trim() } : {}) });
    if (created) onClose();
  };
  return <form className="sfd-card sfd-form" onSubmit={(event) => { void submit(event); }}>
    <h2>New development run</h2>
    <label>Goal and acceptance constraints<textarea required value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Describe the complete outcome, important constraints, and how you will know it works." disabled={busy}/></label>
    <label>Repository path<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="Use the owner conversation's working directory" disabled={busy}/></label>
    <label>Intent<select value={intent} onChange={(event) => setIntent(event.target.value as typeof intent)} disabled={busy}>
      <option value="execute">Implement and commit accepted result</option>
      <option value="plan-handoff">PLAN_HANDOFF — reviewed plan only</option>
      <option value="review-only">REVIEW_ONLY — inspect existing changes without product writes</option>
    </select></label>
    <p>{intent === 'execute' ? 'The accepted candidate is committed on its dedicated non-main branch. This workflow never pushes or merges automatically.' : intent === 'review-only' ? 'REVIEW_ONLY reviews the existing Git changes without product edits or a new branch/commit.' : 'PLAN_HANDOFF runs independent PLAN A/B and delivers the reviewed plan without creating a worktree, editing product code or committing.'}</p>
    <p className="sfd-muted">The selected conversation supplies the execution permissions. The run keeps its own goal, progress, reviews, and recovery state.</p>
    <div className="sfd-row"><button className="sfd-primary" disabled={busy || !goal.trim()} type="submit">Create run</button><button disabled={busy} type="button" onClick={onClose}>Close</button></div>
  </form>;
}

function DecisionForm({ run, decision, busy, controller }: {
  run: DevelopmentRun; decision: UserDecision; busy: boolean; controller: DevelopmentClientController;
}): ReactNode {
  const [answer, setAnswer] = useState('');
  const [action, setAction] = useState<NonNullable<DecideRequest['action']>>('continue');
  const [advisorResult, setAdvisorResult] = useState('');
  const [advisorAdoption, setAdvisorAdoption] = useState<'accept' | 'reject' | 'clarify'>('accept');
  const external = decision.kind === 'advisor';
  return <form className="sfd-notice sfd-form" onSubmit={(event) => {
    event.preventDefault();
    void controller.decide(run.id, decision.id, answer.trim(), action,
      external ? { advisorResult: advisorResult.trim(), advisorAdoption } : undefined);
  }}>
    <h3>Your decision is needed</h3>
    <p>{decision.question}</p>
    {decision.context && <details><summary>Context</summary><p>{decision.context}</p></details>}
    {external && <>
      <p>External human Advisor: {run.advisorCase?.trigger}. Development remains blocked until its actual advice and your separate human disposition have been recorded.</p>
      {run.advisorCase?.package && <p>Verified Advisor ZIP (human review before sharing): <code>{run.advisorCase.package.path}</code> SHA-256 <code>{run.advisorCase.package.sha256}</code></p>}
      {run.advisorCase?.notification && <p>Feishu status: {run.advisorCase.notification.status}{run.advisorCase.notification.failure ? ` — ${run.advisorCase.notification.failure}` : ''}</p>}
      {run.advisorCase?.notice && <p>Project: {run.advisorCase.notice.project}; Feature: {run.advisorCase.notice.feature}; Reason: {run.advisorCase.notice.reason}</p>}
      {run.advisorCase && <details open><summary>Frozen handoff facts</summary>
        <pre>{run.advisorCase.request}</pre><p>Candidate: {run.advisorCase.candidateId ?? 'PLAN'}</p>
      </details>}
      <label>Verbatim external Advisor result<textarea required value={advisorResult} onChange={(event) => setAdvisorResult(event.target.value)} disabled={busy}/></label>
      <label>Your disposition<select value={advisorAdoption} onChange={(event) => setAdvisorAdoption(event.target.value as typeof advisorAdoption)} disabled={busy}>
        <option value="accept">Accept bounded advice</option>
        <option value="reject">Reject (replan or cancel)</option>
        <option value="clarify">Request clarification; keep hold</option>
      </select></label>
    </>}
    <label>Your instruction<textarea required value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={busy}/></label>
    <label>Next step<select value={action} onChange={(event) => setAction(event.target.value as NonNullable<DecideRequest['action']>)} disabled={busy}>
      <option value="continue">Continue with this decision</option><option value="retry">Retry the interrupted task</option><option value="replan">Revise the plan</option><option value="cancel">Cancel the run</option>
    </select></label>
    <div><button className="sfd-primary" type="submit" disabled={busy || !answer.trim() || (external && !advisorResult.trim())}>Record decision</button></div>
  </form>;
}

function FeatureCards({ run }: { run: DevelopmentRun }): ReactNode {
  if (!run.plan) return null;
  const verification = run.attempts.find((attempt) => attempt.id === run.featureVerificationAttemptId)?.admittedOutput as FeatureVerificationOutput | undefined;
  return <section className="sfd-card">
    <h2>Feature outcomes</h2>
    {run.plan.features.map((feature) => {
      const integrated = feature.sectionIds.filter((id) => run.sections[id]?.stage === 'integrated').length;
      return <details key={feature.id} open={run.plan?.features.length === 1}>
        <summary><strong>{feature.title}</strong> <span className="sfd-muted">{integrated}/{feature.sectionIds.length} Sections integrated</span></summary>
        <p>{feature.outcome}</p>
        <ul>{feature.acceptanceCriteria.map((criterion, index) => {
          const evidence = verification?.criteria?.find((entry) => entry.featureId === feature.id && entry.criterion === criterion);
          return <li key={index}>{criterion}{evidence && <><br/><Badge status={evidence.satisfied ? 'passed' : 'failed'}>{evidence.satisfied ? 'Supported by evidence' : 'Not yet satisfied'}</Badge> <span className="sfd-muted">{evidence.evidenceIds.join(', ')}</span></>}</li>;
        })}</ul>
      </details>;
    })}
    {verification?.summary && <p>{verification.summary}</p>}
    <details><summary>Composition checks</summary><Checks checks={run.featureChecks}/></details>
  </section>;
}

function SectionCards({ run }: { run: DevelopmentRun }): ReactNode {
  if (!run.plan) return null;
  return <section className="sfd-card">
    <h2>Sections</h2>
    {run.plan.sections.map((section) => {
      const state = run.sections[section.id];
      if (!state) return null;
      return <details key={section.id} open={run.activeSectionId === section.id}>
        <summary><Badge status={state.stage}>{SECTION_LABELS[state.stage]}</Badge> <strong>{section.id} · {section.title}</strong></summary>
        <div className="sfd-card">
          <p>{section.objective}</p>
          <dl><dt>Depends on</dt><dd>{section.dependencies.length ? section.dependencies.join(', ') : 'Ready from the start'}</dd>
            <dt>Admitted repair waves</dt><dd>{state.materialRepairWaves} / {run.policy.maxRepairWaves} · original lineage <code>{state.lineageId}</code></dd>
            <dt>Write scope</dt><dd>{section.writeScope.join(', ')}</dd>
            <dt>Candidate</dt><dd><code>{state.candidateId ?? 'Not captured yet'}</code></dd>
            {state.lenses.length > 0 && <><dt>A review lenses</dt><dd>{state.lenses.map((lens) => `${lens.id}: ${lens.name}`).join(' · ')}</dd></>}
          </dl>
          <h3>Acceptance criteria</h3><TextItems items={section.acceptanceCriteria}/>
          {section.subsections.length > 0 && <details><summary>Internal checkpoints</summary><ul>{section.subsections.map((child) => <li key={child.id}>{child.objective}</li>)}</ul><p className="sfd-muted">These checkpoints share this Section's acceptance and repair budget.</p></details>}
          {state.repairInstructions && <details open><summary>Admitted repair</summary><p>{state.repairInstructions}</p></details>}
          <details><summary>Verification checks</summary><Checks checks={state.checks}/></details>
        </div>
      </details>;
    })}
  </section>;
}

function Reviews({ run }: { run: DevelopmentRun }): ReactNode {
  return <details className="sfd-card">
    <summary><strong>Review evidence</strong> <span className="sfd-muted">{run.reviews.length} recorded</span></summary>
    {!run.reviews.length && <p className="sfd-muted">Independent results appear here when admitted by the Host.</p>}
    {[...run.reviews].reverse().map((review) => <details key={review.id}>
      <summary><Badge status={review.valid ? review.output.verdict === 'clean' ? 'passed' : 'unknown' : 'unknown'}>{review.valid ? review.output.verdict : 'Superseded'}</Badge> {review.sectionId} · {review.stage === 'b' ? 'Blind B' : review.stage === 'closure' ? 'Closure' : 'A'} · {review.lensId}</summary>
      <p>{review.output.summary}</p>
      <dl><dt>Evidence</dt><dd><code>{review.id}</code></dd><dt>Candidate</dt><dd><code>{review.candidateId}</code></dd></dl>
      <h3>Coverage</h3><TextItems items={review.output.coverage}/>
      {review.output.limitations.length > 0 && <><h3>Limitations</h3><TextItems items={review.output.limitations}/></>}
      {review.output.findings.map((finding) => <div className="sfd-notice" key={finding.id}>
        <strong>{finding.severity}: {finding.title}</strong><p>{finding.body}</p><p className="sfd-muted">Invariant: {finding.invariant}{finding.location ? ` · ${finding.location}` : ''}</p>
      </div>)}
    </details>)}
    {run.decisions.length > 0 && <details><summary>Adjudication and acceptance decisions</summary>{[...run.decisions].reverse().map((decision) => <div className="sfd-card" key={decision.id}>
      <strong>{decision.sectionId ?? 'Feature acceptance'}</strong><p>{decision.output.summary}</p>
      {'dispositions' in decision.output && decision.output.dispositions.map((item) => <p key={item.findingId}><Badge status={item.decision}>{item.decision}</Badge> <code>{item.findingId}</code><br/>{item.reason}</p>)}
      {'missingCoverage' in decision.output && decision.output.missingCoverage.length > 0 && <><h3>Missing coverage</h3><TextItems items={decision.output.missingCoverage}/></>}
      <p className="sfd-muted">{dateLabel(decision.createdAt)} · {shorten(decision.candidateId)}</p>
    </div>)}</details>}
  </details>;
}

function Attempts({ run }: { run: DevelopmentRun }): ReactNode {
  return <details className="sfd-card">
    <summary><strong>Actor attempts</strong> <span className="sfd-muted">{run.attempts.length} recorded</span></summary>
    <p className="sfd-muted">Requested configuration and observed execution are separate facts. An unrecorded route stays unknown.</p>
    <div className="sfd-table"><table><thead><tr><th>Role and task</th><th>State</th><th>Requested</th><th>Observed</th></tr></thead><tbody>
      {[...run.attempts].reverse().map((attempt) => <tr key={attempt.id}>
        <td>{ROLE_LABELS[attempt.task.kind]}{attempt.task.lens && ` · ${attempt.task.lens.id}`}<br/><span className="sfd-muted">{attempt.task.sectionId ?? 'Run'} · {dateLabel(attempt.createdAt)}</span><br/><code>{shorten(attempt.id, 22)}</code></td>
        <td><Badge status={attempt.state}>{attempt.state}</Badge>{attempt.outcome && <><br/>{attempt.outcome.status}</>}
          {(attempt.rejection || attempt.outcome?.error) && <details><summary>Details</summary><p className="sfd-error">{attempt.rejection ?? attempt.outcome?.error}</p></details>}</td>
        <td>{requestedIdentity(attempt)}</td><td>{observedIdentity(attempt)}{attempt.outcome?.identity.sessionId && <><br/><code>{shorten(attempt.outcome.identity.sessionId, 24)}</code></>}</td>
      </tr>)}
    </tbody></table></div>
    {!run.attempts.length && <p className="sfd-muted">No actors have been dispatched.</p>}
  </details>;
}

export function RunDetail({ run, busy, controller }: {
  run: DevelopmentRun; busy: boolean; controller: DevelopmentClientController;
}): ReactNode {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goal, setGoal] = useState(run.goal);
  const active = run.status !== 'completed' && run.status !== 'cancelled';
  const candidate = run.currentCandidateId && run.candidates[run.currentCandidateId];
  const lastFailure = [...run.attempts].reverse().find((attempt) => attempt.outcome?.status === 'failed');
  return <article className="sfd-detail" aria-label="Development run details">
    <section className="sfd-card">
      <div className="sfd-row"><Badge status={run.status}>{STATUS_LABELS[run.status]}</Badge><span>{phaseLabel(run)}</span></div>
      <h2 style={{ marginTop: 14 }}>{run.plan?.title ?? 'Development run'}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{run.goal}</p>
      <dl><dt>Repository</dt><dd><code>{run.workspace.path}</code></dd><dt>Branch</dt><dd><code>{run.workspace.branch}</code></dd><dt>Intent</dt><dd>{run.intent === 'plan-handoff' ? 'PLAN_HANDOFF' : run.intent === 'review-only' ? 'REVIEW_ONLY' : 'EXECUTE_WITH_COMMIT'}</dd><dt>Goal version</dt><dd>{run.inputContractVersion}</dd><dt>Run</dt><dd><code>{run.id}</code></dd></dl>
      <div className="sfd-row">
        {availableActions(run).map((action) => <button key={action} type="button" disabled={busy} className={action === 'cancel' ? 'sfd-danger' : action === 'start' || action === 'resume' ? 'sfd-primary' : ''} onClick={() => { void controller.act(action, run.id); }}>{ACTION_LABELS[action]}</button>)}
        {active && <button disabled={busy} type="button" onClick={() => { setGoal(run.goal); setEditingGoal(!editingGoal); }}>Revise goal</button>}
      </div>
      {run.status === 'pausing' && <p className="sfd-muted">Waiting for active work to stop and settle.</p>}
      {run.blockedReason && <p className="sfd-notice">{run.blockedReason}</p>}
      {editingGoal && <form className="sfd-form" onSubmit={(event) => { event.preventDefault(); void controller.revise(run.id, goal.trim()).then((saved) => { if (saved) setEditingGoal(false); }); }}>
        <label>Revised objective<textarea value={goal} onChange={(event) => setGoal(event.target.value)} disabled={busy}/></label>
        <p className="sfd-muted">This records a new goal version and invalidates work dispatched under the prior task authority.</p>
        <div className="sfd-row"><button disabled={busy || !goal.trim() || goal === run.goal} className="sfd-primary" type="submit">Save revised goal</button><button disabled={busy} type="button" onClick={() => setEditingGoal(false)}>Close</button></div>
      </form>}
      {run.commit && <p>Accepted candidate committed as <code>{run.commit.commit}</code> on <code>{run.commit.branch}</code>.</p>}
      {run.delivery?.mode === 'worktree' && <p>Accepted candidate delivered in <code>{run.delivery.path}</code> on <code>{run.delivery.branch}</code>.</p>}
      {candidate && <details><summary>Current source snapshot</summary><dl><dt>Candidate</dt><dd><code>{candidate.id}</code></dd><dt>Tree</dt><dd><code>{candidate.treeHash}</code></dd><dt>Captured</dt><dd>{dateLabel(candidate.capturedAt)}</dd></dl><TextItems items={candidate.changedFiles}/></details>}
      {lastFailure && <details><summary>Last actor error</summary><p className="sfd-error">{lastFailure.outcome?.error ?? 'No detailed error recorded.'}</p><p className="sfd-muted">{ROLE_LABELS[lastFailure.task.kind]} · {dateLabel(lastFailure.endedAt)}</p></details>}
    </section>
    {run.pendingDecision && <DecisionForm key={run.pendingDecision.id} run={run} decision={run.pendingDecision} busy={busy} controller={controller}/>}
    <FeatureCards run={run}/><SectionCards run={run}/><Reviews run={run}/><Attempts run={run}/>
    <details className="sfd-card"><summary><strong>Recent progress</strong></summary><ol className="sfd-timeline">{run.events.slice(-20).reverse().map((event) => <li key={event.id}>{event.message}<br/><small>{dateLabel(event.at)}{event.sectionId && ` · ${event.sectionId}`}</small></li>)}</ol></details>
    {run.requirementsHistory.length > 1 && <details className="sfd-card"><summary>Goal history</summary>{[...run.requirementsHistory].reverse().map((entry) => <div key={entry.version}><h3>Version {entry.version}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{entry.goal}</p><small>{dateLabel(entry.at)}</small></div>)}</details>}
  </article>;
}

export function DevelopmentPanel({ controller, sessionCatalog }: PropsRuntime<'main'> & DevelopmentPanelInjected): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sessions = useSyncExternalStore((listener) => sessionCatalog.subscribe(listener), () => sessionCatalog.getSnapshot(), () => sessionCatalog.getSnapshot());
  const [creating, setCreating] = useState(false);
  const choices = sessions.ids.map((id) => sessions.byId[id]).filter((session) => session && !session.parentId && session.origin !== 'subagent');
  const selectedSession = choices.find((session) => session.id === state.sessionId);
  const run = state.runs.find((item) => item.id === state.selectedRunId);
  useEffect(() => {
    if (!state.sessionId && choices.length) {
      const current = choices.find((session) => Object.entries(session.retainedBy).some(([source, count]) => source === 'mainView' && count > 0)) ?? choices[0];
      controller.setSession(current.id);
    }
  }, [choices, controller, state.sessionId]);
  return <main className="sfd-workflow">
    <style>{PANEL_STYLES}</style>
    <header className="sfd-head"><div><h1>Development</h1><p className="sfd-muted">Goals, implementation, independent reviews, and recovery in one durable workflow.</p></div><button className="sfd-primary" type="button" disabled={!state.sessionId || state.busy} onClick={() => setCreating(!creating)}>New run</button></header>
    <div className="sfd-toolbar">
      <label className="sfd-owner">Owner conversation<select aria-label="Owner conversation" value={state.sessionId ?? ''} disabled={state.busy} onChange={(event) => { setCreating(false); controller.setSession(event.target.value || undefined); }}>
        {!choices.length && <option value="">No conversation available</option>}
        {choices.map((session) => <option value={session.id} key={session.id}>{session.displayTitle}{session.cwd ? ` · ${session.cwd}` : ''}</option>)}
      </select></label>
      <button type="button" disabled={!state.sessionId || state.loading} onClick={() => { void controller.refresh(); }}>Refresh</button>
      {state.refreshedAt && <small>Updated {dateLabel(state.refreshedAt)}</small>}
    </div>
    {state.error && <p className="sfd-notice sfd-error" role="alert">{state.error}</p>}
    {state.readError && <p className="sfd-notice" role="status">Could not refresh the latest state: {state.readError}. Previously loaded evidence remains visible.</p>}
    {creating && <CreateForm key={state.sessionId} controller={controller} workspacePath={selectedSession?.cwd} busy={state.busy} onClose={() => setCreating(false)}/>}
    {!choices.length ? <p className="sfd-empty">Open a repository conversation in DSH, then create a development run here.</p>
      : state.loading && !state.runs.length ? <p role="status" className="sfd-empty">Loading development runs…</p>
        : !state.runs.length ? <p className="sfd-empty">This conversation has no development runs yet. Create a run with the full outcome you want to deliver.</p>
          : <div className="sfd-layout"><nav className="sfd-run-list" aria-label="Development runs">
            {state.runs.map((item) => <button className="sfd-run" type="button" key={item.id} aria-current={item.id === state.selectedRunId} onClick={() => controller.selectRun(item.id)}>
              <span className="sfd-run-title">{item.plan?.title ?? item.goal}</span><div><Badge status={item.status}>{STATUS_LABELS[item.status]}</Badge></div><small>{phaseLabel(item)}</small>
            </button>)}
          </nav>{run && <RunDetail key={run.id} run={run} controller={controller} busy={state.busy}/>}</div>}
  </main>;
}

export function DevelopmentIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4M8 12l3 3 5-6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
