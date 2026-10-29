import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** Names from the shipped DSH Desktop profile that this bundle builds on. */
const BUILT_IN_CLIENT_PACKAGES = new Set([
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
]);

const STAGE_IDS = ['planReviewA', 'planReviewB', 'implementationStandard', 'implementationLarge', 'codeReviewA', 'codeReviewB'];
const STAGE_LABELS = ['Plan Review A', 'Plan Review B', 'Implementation Standard', 'Implementation Large', 'Code Review A', 'Code Review B'];

function loadBundle() {
  const registrations = [];
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => registrations.push(entry) } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  });
  return registrations;
}

const emptyStages = () => Object.fromEntries(STAGE_IDS.map((stage) => [stage, null]));
const catalogValue = () => ({
  probedAtMs: 1,
  subagents: [
    { subagent: 'zcode', models: ['zai/GLM-5.3', 'deepseek/deepseek-flash'], version: '0.17.0' },
    { subagent: 'dsh', models: ['deepseek-official:deepseek-v4-pro'], version: '0.2.1-rc.2' },
  ],
});

function makeLocale(active) {
  const store = {
    snapshot: Object.freeze({ active, revision: 0 }),
    dictionaries: new Map(),
    listeners: new Set(),
    getSnapshot() { return store.snapshot; },
    getLocale() { return store.snapshot; },
    subscribe(listener) { store.listeners.add(listener); return () => store.listeners.delete(listener); },
    register(ns, dictionaries) {
      store.dictionaries.set(ns, dictionaries);
      return () => store.dictionaries.delete(ns);
    },
    bind(ns) {
      return (key, params) => {
        const dictionaries = store.dictionaries.get(ns);
        const dict = { ...(dictionaries?.en ?? {}), ...(dictionaries?.[store.snapshot.active] ?? {}) };
        const template = dict[key] ?? key;
        return params === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
      };
    },
    setLocale(next) {
      store.snapshot = Object.freeze({ active: next, revision: store.snapshot.revision + 1 });
      for (const listener of store.listeners) listener();
    },
  };
  return store;
}

/** Minimal hook runtime: one render pass per call, effects run after it commits. */
function harness({ locale = 'en', settings, catalog } = {}) {
  const calls = [];
  const tabTypes = new Map();
  const components = new Map();
  const state = {
    settings: settings ?? {
      root: '/example/repo',
      global: { stages: emptyStages() },
      project: { stages: emptyStages() },
    },
    catalog: catalog ?? catalogValue(),
  };
  const localeStore = makeLocale(locale);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let activeScope;
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children }; },
    useState(initial) {
      const scope = activeScope;
      const index = scope.index++;
      if (!(index in scope.hooks)) scope.hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = scope.hooks[index];
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useEffect(callback, deps) {
      const scope = activeScope;
      const index = scope.index++;
      const previous = scope.hooks[index];
      if (previous && deps.length === previous.deps.length && deps.every((value, i) => value === previous.deps[i])) return;
      scope.hooks[index] = { deps, cleanup: previous?.cleanup };
      scope.pending.push({ index, callback });
    },
  };
  const rpc = async (method, payload = {}) => {
    calls.push({ method, payload });
    if (method === 'settings') return clone(state.settings);
    if (method === 'catalog') return clone(state.catalog);
    if (method === 'saveSettings') {
      const { scope, stage, selection } = payload;
      if (scope === 'global') state.settings.global.stages[stage] = selection;
      else state.settings.project.stages[stage] = selection;
      return clone(state.settings);
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  const ctx = {
    locale: localeStore,
    effect: (callback) => callback(),
    connection: { rpc: { call: async (_channel, _endpoint, request) => ({ ok: true, value: await rpc(request.method, request.payload) }) } },
    slots: {
      inject: (_key, callback) => callback(),
      register: (options, component) => { components.set(options.name, component); return () => {}; },
    },
    sidebarRightTabs: { register: (definition) => { tabTypes.set(definition.kind, definition); return () => {}; } },
  };
  const registrations = loadBundle();
  const plugin = registrations[0].factory((name) => {
    assert.equal(name, 'react');
    return React;
  });
  plugin.apply(ctx);
  const body = components.get('sidebar.right.pane.tab');
  const mount = { hooks: [], index: 0, pending: [], props: {
    sessionId: 'one',
    useSessions: (selector) => selector({ byId: { one: { cwd: '/example/repo' } } }),
  } };
  function render() {
    mount.index = 0;
    mount.pending = [];
    activeScope = mount;
    const dom = body(mount.props);
    activeScope = undefined;
    for (const { index, callback } of mount.pending) {
      mount.hooks[index].cleanup?.();
      mount.hooks[index].cleanup = callback();
    }
    return dom;
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { calls, tabTypes, components, state, localeStore, plugin, mutations: { mount }, render, settle };
}

const walk = (node, predicate, found = []) => {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, predicate, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children ?? []) walk(child, predicate, found);
  return found;
};

const textOf = (node) => typeof node === 'string' ? node
  : Array.isArray(node) ? node.map(textOf).join(' ')
    : (node?.children ?? []).map(textOf).join(' ');

/** Render with effects resolved. */
async function mounted(options) {
  const h = harness(options);
  h.render();
  await h.settle();
  h.render();
  return h;
}

const tabButton = (dom, id) => walk(dom, (node) => node.type === 'button' && node.props.id === id)[0];
const openConfiguration = (h) => {
  tabButton(h.render(), 'sfd-tab-configuration').props.onClick();
  return h.render();
};
const sectionsOf = (dom) => walk(dom, (node) => node.props?.['data-sfd-section'] !== undefined);
const rowsOf = (scopeNode) => walk(scopeNode, (node) => node.props?.['data-sfd-stage'] !== undefined);
const selectsOf = (dom) => walk(dom, (node) => node.type === 'select');

test('the boot graph materializes the client under its exact package identity', () => {
  const registrations = loadBundle();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, manifest.name);
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.deepEqual(new Set(manifest.dsh.client.inject), BUILT_IN_CLIENT_PACKAGES);
});

test('every ctx service the bundle reads is declared in its inject list', () => {
  const plugin = loadBundle()[0].factory(() => ({ createElement() {} }));
  const read = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
  read.delete('effect'); // Cordis context method, not an injected service.
  assert.deepEqual([...read].sort(), [...plugin.inject].sort());
});

test('the tab type lands under Browser on the guide page and keeps its body mounted', async () => {
  const h = await mounted();
  const definition = h.tabTypes.get('sfdPanel');
  assert.equal(definition.id, '@ibobbyts/dsh-sfd/panel');
  assert.equal(definition.keepMounted, true);
  assert.equal(definition.guide.length, 1);
  assert.equal(definition.guide[0].order, 40, 'below browser (30)');
  assert.equal(definition.guide[0].title(), 'Sectioned Feature Development');
  assert.equal(definition.title(), 'Sectioned Feature Development');
  assert.match(definition.guide[0].description(), /model routing/i);
  assert.equal(typeof definition.guide[0].icon, 'function');
  assert.equal(definition.guide[0].icon({}).type, 'svg');
});

test('the panel opens on an empty Status page with Status and Configuration as page navigation', async () => {
  const h = await mounted();
  const dom = h.render();
  const tabs = walk(dom, (node) => node.props?.role === 'tab');
  assert.deepEqual(tabs.map((tab) => tab.props.id), ['sfd-tab-status', 'sfd-tab-configuration']);
  assert.equal(tabs[0].props['aria-selected'], true);
  assert.equal(tabs[1].props['aria-selected'], false);
  assert.equal(tabs[0].children.join(''), 'Status');
  assert.equal(tabs[1].children.join(''), 'Configuration');
  const status = walk(dom, (node) => node.props?.id === 'sfd-panel-status')[0];
  assert.deepEqual(status.children, [], 'Status stays empty');
});

test('Configuration shows Global and Current Project with every stage row', async () => {
  const h = await mounted();
  const dom = openConfiguration(h);
  const sections = sectionsOf(dom);
  assert.deepEqual(sections.map((section) => section.props['data-sfd-section']), ['global', 'project']);
  for (const section of sections) {
    const rows = rowsOf(section);
    assert.deepEqual(rows.map((row) => row.props['data-sfd-stage']), STAGE_IDS);
    assert.equal(textOf(rows[0]), textOf(rows[0]), 'sanity');
    assert.deepEqual(rows.map((row) => textOf(walk(row, (node) => node.type === 'span' && node.props.className === 'sfd-stage')[0])), STAGE_LABELS);
  }
  assert.equal(selectsOf(dom).length, 12, 'six stages in each of two scopes');
});

test('each row has a disabled native/external switch fixed to external', async () => {
  const h = await mounted();
  const dom = openConfiguration(h);
  const rows = walk(dom, (node) => node.props?.['data-sfd-stage'] !== undefined);
  for (const row of rows) {
    const switches = walk(row, (node) => node.props?.role === 'switch');
    assert.equal(switches.length, 1);
    const [control] = switches;
    assert.equal(control.props.disabled, true);
    assert.equal(control.props['aria-checked'], 'true');
    assert.equal(control.props['data-sfd-mode'], 'external');
    const labels = walk(row, (node) => node.type === 'span' && String(node.props.className ?? '').startsWith('sfd-mode-name'));
    assert.deepEqual(labels.map((label) => label.children.join('')), ['native', 'external']);
    assert.match(labels[1].props.className, /sfd-mode-on/);
  }
});

test('model choices come from the probed external-subagent catalog, grouped by subagent', async () => {
  const h = await mounted();
  const dom = openConfiguration(h);
  const [select] = selectsOf(dom);
  assert.equal(select.props['aria-label'], 'Plan Review A Model');
  assert.equal(select.props.value, '');
  const options = walk(select, (node) => node.type === 'option').map((option) => option.props.value);
  assert.equal(options[0], '', 'not-configured placeholder');
  assert.ok(options.includes('zcode\tzai/GLM-5.3'));
  assert.ok(options.includes('dsh\tdeepseek-official:deepseek-v4-pro'));
  const groups = walk(select, (node) => node.type === 'optgroup').map((group) => group.props.label);
  assert.deepEqual(groups, ['zcode', 'dsh']);
});

test('choosing a model saves that stage in the chosen scope', async () => {
  const h = await mounted();
  let dom = openConfiguration(h);
  const [globalSelect] = selectsOf(dom);
  globalSelect.props.onChange({ target: { value: 'zcode\tzai/GLM-5.3' } });
  await h.settle();
  dom = openConfiguration(h);
  const saved = h.calls.filter((call) => call.method === 'saveSettings');
  assert.equal(saved.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0].payload)), {
    cwd: '/example/repo',
    scope: 'global',
    stage: 'planReviewA',
    selection: { subagent: 'zcode', model: 'zai/GLM-5.3' },
  });
  const [globalAgain] = selectsOf(dom);
  assert.equal(globalAgain.props.value, 'zcode\tzai/GLM-5.3');
  // The project scope writes its own row and says so.
  const projectSelect = walk(dom, (node) => node.type === 'select' && node.props['data-sfd-select'] === 'codeReviewB')[1];
  projectSelect.props.onChange({ target: { value: 'dsh\tdeepseek-official:deepseek-v4-pro' } });
  await h.settle();
  const latest = h.calls.filter((call) => call.method === 'saveSettings').at(-1);
  assert.equal(latest.payload.scope, 'project');
  assert.equal(latest.payload.stage, 'codeReviewB');
});

test('a configured model that left the catalog stays visible', async () => {
  const settings = {
    root: '/example/repo',
    global: { stages: { ...emptyStages(), planReviewA: { subagent: 'agy', model: 'gemini-3-pro' } } },
    project: { stages: emptyStages() },
  };
  const h = await mounted({ settings });
  const dom = openConfiguration(h);
  const [select] = selectsOf(dom);
  assert.equal(select.props.value, 'agy\tgemini-3-pro');
  const labels = walk(select, (node) => node.type === 'optgroup').map((group) => group.props.label);
  assert.deepEqual(labels, ['zcode', 'dsh', 'Configured']);
  const options = walk(select, (node) => node.type === 'option');
  assert.equal(options.at(-1).props.value, 'agy\tgemini-3-pro');
  assert.equal(options.at(-1).children.join(''), 'agy - gemini-3-pro');
});

test('an unset project stage inherits the global choice for that stage', async () => {
  const settings = {
    root: '/example/repo',
    global: { stages: { ...emptyStages(), planReviewA: { subagent: 'zcode', model: 'zai/GLM-5.3' } } },
    project: { stages: emptyStages() },
  };
  const h = await mounted({ settings });
  let dom = openConfiguration(h);
  const projectStage = (stage) => walk(dom, (node) => node.type === 'select' && node.props['data-sfd-select'] === stage)[1];
  const [globalSelect] = walk(dom, (node) => node.type === 'select' && node.props['data-sfd-select'] === 'planReviewA');
  assert.equal(globalSelect.children[0].children.join(''), 'Not configured');
  assert.equal(projectStage('planReviewA').props.value, '');
  assert.equal(projectStage('planReviewA').children[0].children.join(''), 'Inherit Global (zcode - zai/GLM-5.3)');
  assert.equal(projectStage('codeReviewB').children[0].children.join(''), 'Inherit Global (Not configured)');

  projectStage('planReviewA').props.onChange({ target: { value: 'dsh\tdeepseek-official:deepseek-v4-pro' } });
  await h.settle();
  dom = openConfiguration(h);
  assert.equal(projectStage('planReviewA').props.value, 'dsh\tdeepseek-official:deepseek-v4-pro');

  projectStage('planReviewA').props.onChange({ target: { value: '' } });
  await h.settle();
  const last = h.calls.filter((call) => call.method === 'saveSettings').at(-1);
  assert.equal(last.payload.scope, 'project');
  assert.equal(last.payload.stage, 'planReviewA');
  assert.equal(last.payload.selection, null, 'inheriting stores no override');
  dom = openConfiguration(h);
  assert.equal(projectStage('planReviewA').props.value, '');
});

test('the project scope inherits in Simplified Chinese too', async () => {
  const h = await mounted({ locale: 'zh' });
  const dom = openConfiguration(h);
  const projectStage = walk(dom, (node) => node.type === 'select' && node.props['data-sfd-select'] === 'planReviewA')[1];
  assert.equal(projectStage.children[0].children.join(''), '继承 Global (未配置)');
});

test('without a repository the project scope is explained and disabled', async () => {
  const settings = { root: null, global: { stages: emptyStages() }, project: null };
  const h = await mounted({ settings });
  const dom = openConfiguration(h);
  const sections = sectionsOf(dom);
  assert.equal(rowsOf(sections[0]).length, 6, 'global rows remain editable');
  assert.equal(rowsOf(sections[1]).length, 0, 'no project rows without a root');
  assert.match(textOf(sections[1]), /not in a Git repository/);
});

test('an empty spawnable catalog disables selection and says why', async () => {
  const h = await mounted({ catalog: { probedAtMs: 1, subagents: [] } });
  const dom = openConfiguration(h);
  const selects = selectsOf(dom);
  assert.equal(selects.length, 12);
  for (const select of selects) assert.equal(select.props.disabled, true);
  assert.match(textOf(dom), /no spawnable subagent/);
});

test('the refresh control re-probes the catalog', async () => {
  const h = await mounted();
  let dom = openConfiguration(h);
  assert.deepEqual(h.calls.filter((call) => call.method === 'catalog').map((call) => call.payload.force), [false]);
  const refresh = walk(dom, (node) => node.type === 'button' && node.props['aria-label'] === 'Refresh model catalog')[0];
  assert.equal(refresh.props.disabled, false);
  refresh.props.onClick();
  await h.settle();
  dom = openConfiguration(h);
  assert.deepEqual(h.calls.filter((call) => call.method === 'catalog').map((call) => call.payload.force), [false, true]);
});

test('the panel follows the DSH language', async () => {
  const h = await mounted({ locale: 'zh' });
  let dom = openConfiguration(h);
  assert.equal(h.tabTypes.get('sfdPanel').title(), 'Sectioned Feature Development');
  assert.match(textOf(dom), /未配置/);
  assert.match(textOf(dom), /模型来自 external-subagent/);
  assert.equal(tabButton(dom, 'sfd-tab-status').children.join(''), 'Status');
  h.localeStore.setLocale('en');
  dom = openConfiguration(h);
  assert.match(textOf(dom), /Not configured/);
  assert.match(textOf(dom), /Models come from external-subagent/);
});
