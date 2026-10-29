/**
 * Browser half of @ibobbyts/dsh-sfd: the Sectioned Feature Development entry in
 * the right sidebar — a read-only status page.
 *
 * Facts:
 * - The entry is a right-sidebar tab type, not a floating panel. Its guide
 *   entry (`order: 40`) lands directly under Browser (30) on the sidebar's
 *   guide page.
 * - The plugin no longer routes or configures dispatch: the agent spawns
 *   through external-subagent profiles itself, per the bundled skill. The
 *   panel therefore shows what the plugin *observes* — the run ledger,
 *   derived obligations, and the external-subagent daemon status — and edits
 *   nothing.
 * - All data comes from the Host over the panel's RPC route; the browser
 *   cannot read the ledger file or probe the daemon itself.
 */
window.__ModuleLoader__.load({
  id: '@ibobbyts/dsh-sfd',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const TAB_ID = '@ibobbyts/dsh-sfd/panel';
    const TAB_KIND = 'sfdPanel';
    /** Below files (10), terminal (20) and browser (30) on the guide page. */
    const GUIDE_ORDER = 40;
    const LOCALE_NS = 'dshSfd';
    const CHANNEL = '/api';
    const ENDPOINT = 'dsh-sfd';
    const translations = {
      zh: {
        tabTitle: 'Sectioned Feature Development',
        guideDescription: '观察 SFD 运行与评审义务',
        loading: '正在加载…',
        refresh: '刷新状态',
        refreshEs: '重新探测 external-subagent',
        requestFailed: '请求失败',
        noRun: '当前仓库没有 SFD 运行。通过 /sfd 启动。',
        noRepo: '当前会话不在 Git 仓库中。',
        runTitle: '运行',
        runClosed: '已关闭',
        runActive: '进行中',
        runBranch: '分支',
        runTask: '任务',
        phaseLabel: '阶段',
'phase.starting': '准备',
'phase.plan-review': '计划评审',
'phase.implement': '实现',
'phase.code-review': '代码评审',
'phase.closed': '已关闭',
        actorsTitle: '已观察 actor',
        actorsNone: '尚无 actor 派发记录。',
        actorRunning: '运行中',
        actorTerminal: '终态',
        countsTitle: '派发计数',
        reportsTitle: '已观察报告',
        reportsCount: '{count} 个 .agent-work 报告文件',
        obligationsTitle: '义务提醒（注入给主 agent）',
        obligationsNone: '当前无义务提醒。',
        'obl.await-actors': '等待终态：{ids}（external_subagent_wait）',
        'obl.close-actors': '回收 actor：{ids}（external_subagent_close）',
        'obl.plan-coverage': 'PLAN 评审 A→B 两路独立覆盖须在 implementer 派发前关闭（已派发 {dispatched}，终态完成 {done}）',
        'obl.plan-skip-warn': '警告：implementer 已派发 {impl} 个，但 PLAN 覆盖终态完成仅 {done} 个——按 skill 不允许，补救或说明依据',
        'obl.freeze-before-review': '冻结候选（staged+unstaged+untracked 对账）后再派发 Code A；B1 盲审不携带 A 结论/修复史',
        'obl.code-coverage': 'Code A 覆盖关闭后先 B1 盲审、再 B2 核验；预算判定（5 waves/section、plan 2 material）按 skill（已派发 {dispatched}）',
        esTitle: 'external-subagent',
        esOk: 'daemon 在线',
        esFailed: 'daemon 不可用',
        esSpawnable: '可 spawn：{names}',
        esNone: '当前没有可 spawn 的 subagent。',
        esProbe: '状态来自 subagents status --probe。',
        esMissing: '未安装或不在 PATH：安装后 SFD 的外部派发才可用。',
      },
      en: {
        tabTitle: 'Sectioned Feature Development',
        guideDescription: 'Observe the SFD run and review obligations',
        loading: 'Loading…',
        refresh: 'Refresh status',
        refreshEs: 'Re-probe external-subagent',
        requestFailed: 'Request failed',
        noRun: 'No SFD run in this repository. Start one with /sfd.',
        noRepo: 'This Session is not in a Git repository.',
        runTitle: 'Run',
        runClosed: 'closed',
        runActive: 'active',
        runBranch: 'Branch',
        runTask: 'Task',
        phaseLabel: 'Phase',
'phase.starting': 'starting',
'phase.plan-review': 'plan review',
'phase.implement': 'implement',
'phase.code-review': 'code review',
'phase.closed': 'closed',
        actorsTitle: 'Observed actors',
        actorsNone: 'No actor dispatch observed yet.',
        actorRunning: 'running',
        actorTerminal: 'terminal',
        countsTitle: 'Dispatch counts',
        reportsTitle: 'Observed reports',
        reportsCount: '{count} .agent-work report file(s)',
        obligationsTitle: 'Obligation reminders (injected to the main agent)',
        obligationsNone: 'No open obligation reminders.',
        'obl.await-actors': 'Await terminal state: {ids} (external_subagent_wait)',
        'obl.close-actors': 'Close actors: {ids} (external_subagent_close)',
        'obl.plan-coverage': 'PLAN review A→B independent coverages must close before any implementer dispatch (dispatched {dispatched}, completed {done})',
        'obl.plan-skip-warn': 'Warning: {impl} implementer(s) dispatched with only {done} completed PLAN coverage(s) — not allowed by the skill; remediate or justify',
        'obl.freeze-before-review': 'Freeze the candidate (staged+unstaged+untracked) before Code A; B1 stays blind to A findings/repair history',
        'obl.code-coverage': 'After Code A closes: blind B1 then same-head B2; budget rulings (5 waves/section, plan 2 material) follow the skill (dispatched {dispatched})',
        esTitle: 'external-subagent',
        esOk: 'daemon online',
        esFailed: 'daemon unavailable',
        esSpawnable: 'spawnable: {names}',
        esNone: 'No spawnable subagent right now.',
        esProbe: 'Status comes from subagents status --probe.',
        esMissing: 'Not installed or not on PATH: external dispatch for SFD needs it.',
      },
    };
    const CSS = `
      .sfd-panel{height:100%;box-sizing:border-box;padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px;overflow:auto;color:var(--dsw-alias-label-primary);font-size:12px}
      .sfd-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px;flex:none}
      .sfd-refresh{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
      .sfd-refresh:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
      .sfd-refresh:disabled{opacity:.55;cursor:default}
      .sfd-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .sfd-refresh svg{width:14px;height:14px;display:block}
      .sfd-section{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
      .sfd-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
      .sfd-section-title{margin:0;font-size:12px;font-weight:600;white-space:nowrap}
      .sfd-section-note{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:10.5px}
      .sfd-kv{display:flex;flex-direction:column;gap:3px;min-width:0}
      .sfd-kv-row{display:flex;gap:6px;min-width:0;font-size:11.5px}
      .sfd-kv-key{flex:none;color:var(--dsw-alias-label-secondary)}
      .sfd-kv-val{min-width:0;overflow-wrap:anywhere}
      .sfd-kv-val.mono{font:10.5px ui-monospace,Menlo,monospace;direction:rtl;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sfd-actors{display:flex;flex-direction:column;min-width:0}
      .sfd-actor{display:flex;align-items:baseline;gap:6px;padding:5px 0;min-width:0;font:10.5px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
      .sfd-actor + .sfd-actor{border-top:1px solid var(--dsw-alias-border-l1)}
      .sfd-actor-id{flex:none;font-weight:700}
      .sfd-actor-role{flex:none}
      .sfd-actor-outcome{flex:none}
      .sfd-actor-outcome.ok{color:var(--dsw-alias-label-secondary)}
      .sfd-actor-outcome.bad{color:var(--dsw-alias-state-error-primary);font-weight:700}
      .sfd-actor-hint{min-width:0;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sfd-counts{display:flex;flex-wrap:wrap;gap:4px 10px;min-width:0;font-size:11px}
      .sfd-count{font:10.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
      .sfd-obl{display:flex;flex-direction:column;gap:5px;min-width:0}
      .sfd-obl-item{margin:0;padding:6px 8px;border-radius:7px;font-size:11px;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1)}
      .sfd-obl-item[data-severity="warn"]{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary)}
      .sfd-obl-item[data-severity="todo"]{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
      .sfd-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;overflow-wrap:anywhere}
      .sfd-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:11px;overflow-wrap:anywhere}
    `;
    /** Three stacked sections: the guide card's glyph. */
    function GuideIcon(props) {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
        className: props?.className,
      },
      h('rect', { x: 2, y: 2.5, width: 12, height: 2.6, rx: 1.1, fill: 'currentColor' }),
      h('rect', { x: 2, y: 6.9, width: 8.5, height: 2.6, rx: 1.1, fill: 'currentColor' }),
      h('rect', { x: 2, y: 11.3, width: 5, height: 2.6, rx: 1.1, fill: 'currentColor' }));
    }
    /** Refresh glyph, an arrow bent around a point. */
    function RefreshGlyph() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M12.8 6.4A5 5 0 1 0 13 9.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M10.2 6.2h2.9V3.3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS);
      // Bound through wrappers: the locale service is a Cordis Service, so a
      // detached method reference would lose its receiver.
      const subscribeLocale = (listener) => ctx.locale.subscribe(listener);
      const localeSnapshot = () => ctx.locale.getSnapshot();
      ctx.effect(() => ctx.locale.register(LOCALE_NS, translations), 'dsh-sfd: panel copy');
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.dshSfd = 'true';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'dsh-sfd: panel styles');
      /** One Connection RPC, unwrapped to its value. */
      const rpc = async (method, payload) => {
        const result = await ctx.connection.rpc.call(CHANNEL, ENDPOINT, { method, payload: payload ?? {} });
        if (!result.ok) throw new Error(result.error?.message ?? t('requestFailed'));
        return result.value;
      };

      /** The panel: one read-only status page over the observed ledger. */
      function SfdPanel(props) {
        React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
        const sessionId = props.sessionId;
        const cwd = props.useSessions((sessions) => sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd);
        const [status, setStatus] = React.useState(null);
        const [loadError, setLoadError] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [revision, setRevision] = React.useState(0);
        React.useEffect(() => {
          let active = true;
          setStatus(null);
          setLoadError('');
          if (typeof cwd !== 'string' || cwd.length === 0) return () => { active = false; };
          setBusy(true);
          rpc('status', { cwd, force: revision > 0 }).then((value) => { if (active) setStatus(value); },
            (error) => { if (active) setLoadError(error.message); })
            .finally(() => { if (active) setBusy(false); });
          return () => { active = false; };
        }, [cwd, revision]);

        const run = status?.run ?? null;
        const obligations = status?.obligations ?? [];
        const es = status?.es ?? null;
        const spawnable = (es?.subagents ?? []).filter((row) => row.spawnBlocked === null);

        const actorRows = Object.entries(run?.actors ?? {}).map(([id, a]) => h('div', {
          key: id, className: 'sfd-actor', 'data-sfd-actor': id,
        },
        h('span', { className: 'sfd-actor-id' }, `#${id}`),
        h('span', { className: 'sfd-actor-role' }, a.profile ?? a.role),
        h('span', {
          className: `sfd-actor-outcome ${a.status === 'terminal' ? (a.outcome === 'COMPLETED' ? 'ok' : 'bad') : 'ok'}`,
        }, a.status === 'terminal' ? (a.outcome ?? 'TERMINAL') : t('actorRunning')),
        a.reportHint ? h('span', { className: 'sfd-actor-hint', title: a.reportHint }, a.reportHint) : null));

        const sections = [];
        sections.push(h('div', { className: 'sfd-bar' },
          h('span', null, busy ? t('loading') : t('esProbe')),
          h('button', {
            type: 'button', className: 'sfd-refresh', 'aria-label': t('refreshEs'), title: t('refresh'),
            disabled: busy, onClick: () => setRevision((value) => value + 1),
          }, RefreshGlyph())));
        if (loadError !== '') sections.push(h('p', { className: 'sfd-error', role: 'alert' }, loadError));
        if (status === null && loadError === '') sections.push(h('p', { className: 'sfd-hint' }, t('loading')));
        if (status?.noRepo === true) sections.push(h('p', { className: 'sfd-hint' }, t('noRepo')));
        if (run === null && status !== null && status.noRepo !== true) {
          sections.push(h('p', { className: 'sfd-hint' }, t('noRun')));
        }
        if (run !== null) {
          sections.push(runSection(run, status, t), actorsSection(run, t));
        }
        if (obligations.length > 0) sections.push(obligationsSection(obligations, t));
        sections.push(esSection(es, spawnable, t));
        return h('div', { className: 'sfd-panel' }, ...sections);
      }

      function runSection(run, status, t) {
        const rows = [
          h('div', { className: 'sfd-kv-row' },
            h('span', { className: 'sfd-kv-key' }, `${t('phaseLabel')}:`),
            h('span', { className: 'sfd-kv-val' }, t(`phase.${status?.phase ?? 'starting'}`))),
          h('div', { className: 'sfd-kv-row' },
            h('span', { className: 'sfd-kv-key' }, `${t('runBranch')}:`),
            h('span', { className: 'sfd-kv-val mono' }, run.run?.branch ?? '-')),
        ];
        if (run.run?.taskSummary) {
          rows.push(h('div', { className: 'sfd-kv-row' },
            h('span', { className: 'sfd-kv-key' }, `${t('runTask')}:`),
            h('span', { className: 'sfd-kv-val' }, run.run.taskSummary)));
        }
        return h('section', { className: 'sfd-section', 'data-sfd-section': 'run' },
          h('div', { className: 'sfd-section-head' },
            h('h4', { className: 'sfd-section-title' }, t('runTitle')),
            h('span', { className: 'sfd-section-note' },
              run.run?.status === 'closed' ? t('runClosed') : t('runActive'))),
          h('div', { className: 'sfd-kv' }, ...rows));
      }

      function actorsSection(run, t) {
        const actorRows = Object.entries(run.actors ?? {}).map(([id, a]) => h('div', {
          key: id, className: 'sfd-actor', 'data-sfd-actor': id,
        },
        h('span', { className: 'sfd-actor-id' }, `#${id}`),
        h('span', { className: 'sfd-actor-role' }, a.profile ?? a.role),
        h('span', {
          className: `sfd-actor-outcome ${a.status === 'terminal' ? (a.outcome === 'COMPLETED' ? 'ok' : 'bad') : 'ok'}`,
        }, a.status === 'terminal' ? (a.outcome ?? 'TERMINAL') : t('actorRunning')),
        a.reportHint ? h('span', { className: 'sfd-actor-hint', title: a.reportHint }, a.reportHint) : null));
        const counts = Object.entries(run.counts ?? {});
        return h('section', { className: 'sfd-section', 'data-sfd-section': 'actors' },
          h('div', { className: 'sfd-section-head' }, h('h4', { className: 'sfd-section-title' }, t('actorsTitle'))),
          actorRows.length === 0
            ? h('p', { className: 'sfd-hint' }, t('actorsNone'))
            : h('div', { className: 'sfd-actors' }, ...actorRows),
          counts.length > 0
            ? h('div', { className: 'sfd-counts', 'data-sfd-counts': true },
              ...counts.map(([role, n]) => h('span', { key: role, className: 'sfd-count' }, `${role} ${n}`)))
            : null);
      }

      function obligationsSection(obligations, t) {
        return h('section', { className: 'sfd-section', 'data-sfd-section': 'obligations' },
          h('h4', { className: 'sfd-section-title' }, t('obligationsTitle')),
          h('div', { className: 'sfd-obl' },
            ...obligations.map((o, index) => h('p', {
              key: `${o.id}-${index}`, className: 'sfd-obl-item', 'data-severity': o.severity,
            }, t(`obl.${o.id}`, o.params ?? {})))));
      }

      function esSection(es, spawnable, t) {
        let body;
        if (es === null) body = h('p', { className: 'sfd-hint' }, t('loading'));
        else if (es.ok !== true) body = h('p', { className: 'sfd-error' }, `${t('esFailed')}: ${es.error ?? ''}`);
        else body = h('p', { className: 'sfd-hint' },
          spawnable.length === 0 ? t('esNone') : t('esSpawnable', { names: spawnable.map((row) => row.subagent).join(', ') }));
        return h('section', { className: 'sfd-section', 'data-sfd-section': 'es' },
          h('div', { className: 'sfd-section-head' }, h('h4', { className: 'sfd-section-title' }, t('esTitle'))),
          body);
      }

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => t('tabTitle'),
        keepMounted: true,
        guide: [{
          id: 'panel',
          order: GUIDE_ORDER,
          title: () => t('tabTitle'),
          description: () => t('guideDescription'),
          icon: GuideIcon,
        }],
      }), 'dsh-sfd: sidebar type');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: TAB_ID,
      }, SfdPanel)), 'dsh-sfd: sidebar body');
    }
    return { apply, inject: ['slots', 'connection', 'locale', 'sidebarRightTabs'] };
  },
});
