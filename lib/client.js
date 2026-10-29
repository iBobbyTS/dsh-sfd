/**
 * Browser half of @ibobbyts/dsh-sfd: the Sectioned Feature Development entry in
 * the right sidebar.
 *
 * Facts:
 * - The entry is a right-sidebar tab type, not a floating panel. Its guide
 *   entry (`order: 40`) lands directly under Browser (30) on the sidebar's
 *   guide page, and the tab it opens keeps the panel's two pages.
 * - The panel edits stage model routing only; running stages is the agent's
 *   job. Status stays empty on purpose until the flow exposes live progress.
 * - Model choices come from the Host: the browser cannot spawn
 *   `external-subagent`, so the Host probes `subagents status --probe` and this
 *   file renders what it returns, grouped by subagent.
 * - The native/external switch is deliberately fixed to external and disabled:
 *   the flow routes every stage to external subagents by design, so offering a
 *   choice would misrepresent what runs.
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
    /** Stage ids are the Host's `STAGES`; order is the panel's row order. */
    const STAGES = ['planReviewA', 'planReviewB', 'implementationStandard', 'implementationLarge', 'codeReviewA', 'codeReviewB'];
    const translations = {
      zh: {
        tabTitle: 'Sectioned Feature Development',
        guideDescription: '配置各阶段使用的模型',
        pages: '页面',
        pageStatus: 'Status',
        pageConfiguration: 'Configuration',
        sectionGlobal: 'Global',
        sectionProject: 'Current Project',
        projectUnavailable: '当前会话不在 Git 仓库中，项目级设置不可用。',
        model: '模型',
        modelNone: '未配置',
        configuredGroup: '已配置',
        inherited: '继承 Global ({model})',
        loading: '正在加载…',
        refresh: '刷新模型目录',
        catalogSource: '模型来自 external-subagent 可 spawn 的 subagent。',
        catalogEmpty: 'external-subagent 当前没有可 spawn 的 subagent。',
        catalogFailed: '模型目录不可用',
        saveFailed: '保存失败：{reason}',
        requestFailed: '请求失败',
        modeNative: 'native',
        modeExternal: 'external',
        modeLabel: '固定使用外部 subagent',
        modeTitle: '该阶段固定由外部 subagent 执行',
        'stage.planReviewA': 'Plan Review A',
        'stage.planReviewB': 'Plan Review B',
        'stage.implementationStandard': 'Implementation Standard',
        'stage.implementationLarge': 'Implementation Large',
        'stage.codeReviewA': 'Code Review A',
        'stage.codeReviewB': 'Code Review B',
      },
      en: {
        tabTitle: 'Sectioned Feature Development',
        guideDescription: 'Model routing for each stage',
        pages: 'Pages',
        pageStatus: 'Status',
        pageConfiguration: 'Configuration',
        sectionGlobal: 'Global',
        sectionProject: 'Current Project',
        projectUnavailable: 'This Session is not in a Git repository, so project settings are unavailable.',
        model: 'Model',
        modelNone: 'Not configured',
        configuredGroup: 'Configured',
        inherited: 'Inherit Global ({model})',
        loading: 'Loading…',
        refresh: 'Refresh model catalog',
        catalogSource: 'Models come from external-subagent spawnable subagents.',
        catalogEmpty: 'external-subagent has no spawnable subagent right now.',
        catalogFailed: 'Model catalog unavailable',
        saveFailed: 'Failed to save: {reason}',
        requestFailed: 'Request failed',
        modeNative: 'native',
        modeExternal: 'external',
        modeLabel: 'Always an external subagent',
        modeTitle: 'This stage always runs on an external subagent',
        'stage.planReviewA': 'Plan Review A',
        'stage.planReviewB': 'Plan Review B',
        'stage.implementationStandard': 'Implementation Standard',
        'stage.implementationLarge': 'Implementation Large',
        'stage.codeReviewA': 'Code Review A',
        'stage.codeReviewB': 'Code Review B',
      },
    };
    const CSS = `
      .sfd-panel{height:100%;box-sizing:border-box;padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px;overflow:auto;color:var(--dsw-alias-label-primary);font-size:12px}
      .sfd-tabs{display:flex;gap:4px;padding:3px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;flex:none}
      .sfd-tab{flex:1;min-width:0;padding:7px 10px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;font-weight:600;line-height:1.25;cursor:pointer}
      .sfd-tab[aria-selected="true"]{background:var(--dsw-alias-bg-overlay);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
      .sfd-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .sfd-status{flex:1;min-height:0}
      .sfd-config{display:flex;flex-direction:column;gap:10px;min-width:0}
      .sfd-config-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px}
      .sfd-config-note{min-width:0;overflow-wrap:anywhere}
      .sfd-refresh{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
      .sfd-refresh:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
      .sfd-refresh:disabled{opacity:.55;cursor:default}
      .sfd-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .sfd-refresh svg{width:14px;height:14px;display:block}
      .sfd-section{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
      .sfd-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
      .sfd-section-title{margin:0;font-size:12px;font-weight:600;white-space:nowrap}
      .sfd-section-path{min-width:0;max-width:62%;direction:rtl;text-align:right;font:10.5px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sfd-rows{display:flex;flex-direction:column;min-width:0}
      .sfd-row{display:flex;flex-direction:column;gap:6px;padding:8px 0;min-width:0}
      .sfd-row + .sfd-row{border-top:1px solid var(--dsw-alias-border-l1)}
      .sfd-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
      .sfd-stage{font-size:11.5px;font-weight:600;overflow-wrap:anywhere}
      .sfd-mode{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:10px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
      .sfd-mode-on{color:var(--dsw-alias-label-primary);font-weight:600}
      .sfd-switch{position:relative;width:28px;height:16px;flex:none;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-brand-primary);opacity:.55;cursor:not-allowed}
      .sfd-switch:disabled{opacity:.55;cursor:not-allowed}
      .sfd-switch-knob{position:absolute;top:2px;left:14px;width:12px;height:12px;border-radius:50%;background:#fff}
      .sfd-select{width:100%;box-sizing:border-box;height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11.5px}
      .sfd-select:disabled{opacity:.6;cursor:default}
      .sfd-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
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
    const selectionKey = (selection) => selection ? `${selection.subagent}\t${selection.model}` : '';
    function parseSelection(value) {
      const index = value.indexOf('\t');
      if (index <= 0 || index === value.length - 1) return null;
      return { subagent: value.slice(0, index), model: value.slice(index + 1) };
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

      /** The panel: two pages, and the configuration form of both scopes. */
      function SfdPanel(props) {
        React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
        const sessionId = props.sessionId;
        const cwd = props.useSessions((sessions) => sessionId === undefined ? undefined : sessions.byId[sessionId]?.cwd);
        const [page, setPage] = React.useState('status');
        const [form, setForm] = React.useState(null);
        const [catalog, setCatalog] = React.useState(null);
        const [loadError, setLoadError] = React.useState('');
        const [catalogError, setCatalogError] = React.useState('');
        const [catalogBusy, setCatalogBusy] = React.useState(false);
        const [catalogRevision, setCatalogRevision] = React.useState(0);
        const [saveError, setSaveError] = React.useState('');
        React.useEffect(() => {
          let active = true;
          setForm(null);
          setLoadError('');
          setSaveError('');
          if (typeof cwd !== 'string' || cwd.length === 0) return () => { active = false; };
          rpc('settings', { cwd }).then((value) => { if (active) setForm(value); },
            (error) => { if (active) setLoadError(error.message); });
          return () => { active = false; };
        }, [cwd]);
        React.useEffect(() => {
          let active = true;
          setCatalogError('');
          setCatalogBusy(true);
          rpc('catalog', { force: catalogRevision > 0 }).then((value) => { if (active) setCatalog(value); },
            (error) => { if (active) setCatalogError(error.message); })
            .finally(() => { if (active) setCatalogBusy(false); });
          return () => { active = false; };
        }, [catalogRevision]);

        const save = (scope, stage, selection) => {
          setSaveError('');
          setForm((current) => {
            if (current === null) return current;
            const next = {
              root: current.root,
              global: { stages: { ...current.global.stages } },
              project: current.project === null ? null : { stages: { ...current.project.stages } },
            };
            if (scope === 'project') {
              if (next.project === null) return current;
              next.project.stages[stage] = selection;
            } else next.global.stages[stage] = selection;
            return next;
          });
          void rpc('saveSettings', { cwd, scope, stage, selection }).then((value) => setForm(value),
            (error) => setSaveError(error.message));
        };

        const subagents = catalog?.subagents ?? [];
        const available = new Set();
        for (const group of subagents) for (const model of group.models) available.add(`${group.subagent}\t${model}`);
        /** `zcode - zai/GLM-5.3`, or the unset marker for an unconfigured stage. */
        const describe = (selection) => selection === null ? t('modelNone') : `${selection.subagent} - ${selection.model}`;

        const selectFor = (scope, stage, selection) => {
          const disabled = subagents.length === 0 || (scope === 'project' && form?.project == null);
          const configured = selectionKey(selection);
          const options = [];
          // The empty value clears the stage; in a project it means "inherit
          // Global", so the option names the global choice it would inherit.
          options.push(h('option', { key: 'none', value: '' },
            scope === 'project'
              ? t('inherited', { model: describe(form?.global?.stages?.[stage] ?? null) })
              : t('modelNone')));
          for (const group of subagents) {
            options.push(h('optgroup', { key: `group-${group.subagent}`, label: group.subagent },
              ...group.models.map((model) => h('option', {
                key: `${group.subagent}\t${model}`, value: `${group.subagent}\t${model}`,
              }, model))));
          }
          if (configured !== '' && !available.has(configured)) {
            options.push(h('optgroup', { key: 'group-configured', label: t('configuredGroup') },
              h('option', { key: 'configured', value: configured }, describe(selection))));
          }
          return h('select', {
            className: 'sfd-select',
            'aria-label': `${t(`stage.${stage}`)} ${t('model')}`,
            'data-sfd-select': stage,
            value: configured,
            disabled,
            onChange: (event) => { save(scope, stage, parseSelection(event.target.value)); },
          }, ...options);
        };

        const rowFor = (scope, stage, stages) => h('div', {
          key: `${scope}-${stage}`, className: 'sfd-row', 'data-sfd-stage': stage, 'data-sfd-scope': scope,
        },
        h('div', { className: 'sfd-row-head' },
          h('span', { className: 'sfd-stage' }, t(`stage.${stage}`)),
          h('span', { className: 'sfd-mode' },
            h('span', { className: 'sfd-mode-name' }, t('modeNative')),
            h('button', {
              type: 'button', role: 'switch', className: 'sfd-switch', disabled: true,
              'aria-checked': 'true', 'aria-label': t('modeLabel'), title: t('modeTitle'),
              'data-sfd-mode': 'external',
            }, h('span', { className: 'sfd-switch-knob' })),
            h('span', { className: 'sfd-mode-name sfd-mode-on' }, t('modeExternal')))),
        selectFor(scope, stage, stages?.[stage] ?? null));

        const section = (scope, title) => {
          const available2 = scope === 'project' && form?.project == null;
          return h('section', { key: scope, className: 'sfd-section', 'data-sfd-section': scope },
            h('div', { className: 'sfd-section-head' },
              h('h4', { className: 'sfd-section-title' }, title),
              scope === 'project' && form?.root
                ? h('span', { className: 'sfd-section-path', title: form.root }, form.root)
                : null),
            available2
              ? h('p', { className: 'sfd-hint' }, t('projectUnavailable'))
              : h('div', { className: 'sfd-rows' },
                ...STAGES.map((stage) => rowFor(scope, stage, scope === 'project' ? form?.project?.stages : form?.global.stages))));
        };

        const pageButton = (id, label) => h('button', {
          type: 'button', key: id, role: 'tab', id: `sfd-tab-${id}`, className: 'sfd-tab',
          'aria-selected': page === id, 'aria-controls': `sfd-panel-${id}`, tabIndex: page === id ? 0 : -1,
          onClick: () => setPage(id),
          onKeyDown: (event) => {
            const next = event.key === 'ArrowLeft' ? 'status'
              : event.key === 'ArrowRight' ? 'configuration'
                : event.key === 'Home' ? 'status' : event.key === 'End' ? 'configuration' : null;
            if (next === null) return;
            event.preventDefault();
            setPage(next);
            event.currentTarget.parentElement?.querySelector?.(`#sfd-tab-${next}`)?.focus?.();
          },
        }, label);

        const configuration = h('div', {
          className: 'sfd-config', role: 'tabpanel', id: 'sfd-panel-configuration',
          'aria-labelledby': 'sfd-tab-configuration',
        },
        h('div', { className: 'sfd-config-bar' },
          h('span', { className: 'sfd-config-note' },
            catalogError !== '' ? t('catalogFailed')
              : catalogBusy ? t('loading')
                : subagents.length === 0 ? t('catalogEmpty') : t('catalogSource')),
          h('button', {
            type: 'button', className: 'sfd-refresh', 'aria-label': t('refresh'), title: t('refresh'),
            disabled: catalogBusy, onClick: () => setCatalogRevision((value) => value + 1),
          }, RefreshGlyph())),
        catalogError !== '' ? h('p', { className: 'sfd-error', role: 'alert' }, catalogError) : null,
        loadError !== '' ? h('p', { className: 'sfd-error', role: 'alert' }, loadError) : null,
        form === null && loadError === '' ? h('p', { className: 'sfd-hint' }, t('loading')) : null,
        form === null ? null : section('global', t('sectionGlobal')),
        form === null ? null : section('project', t('sectionProject')),
        saveError !== '' ? h('p', { className: 'sfd-error', role: 'alert' }, t('saveFailed', { reason: saveError })) : null);

        return h('div', { className: 'sfd-panel' },
          h('div', { className: 'sfd-tabs', role: 'tablist', 'aria-label': t('pages') },
            pageButton('status', t('pageStatus')),
            pageButton('configuration', t('pageConfiguration'))),
          page === 'status'
            ? h('div', {
              className: 'sfd-status', role: 'tabpanel', id: 'sfd-panel-status',
              'aria-labelledby': 'sfd-tab-status',
            })
            : configuration);
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
