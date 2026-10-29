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

function loadBundle() {
  const registrations = [];
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => registrations.push(entry) } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  });
  return registrations;
}

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

const runLedger = () => ({
  revision: 7,
  run: { status: 'active', slug: 'dark-mode', branch: 'sfd/dark-mode', taskSummary: 'Add dark mode', base: 'main' },
  actors: {
    '1001': { profile: 'sfd-zcode-plan-review', role: 'plan-review', status: 'terminal', outcome: 'COMPLETED', closed: false, reportHint: '.agent-work/reviews/plan-a.md' },
    '1002': { profile: 'sfd-dsh-impl-std', role: 'impl', status: 'running', outcome: null, closed: false, reportHint: null },
  },
  counts: { 'plan-review': 1, impl: 1 },
  artifacts: { plan: ['.agent-work/PLAN-FULL.md'], reports: ['.agent-work/reviews/plan-a.md'], handoffs: [], other: [] },
});

const statusValue = () => ({
  run: runLedger(),
  phase: 'implement',
  obligations: [
    { id: 'await-actors', severity: 'todo', params: { ids: '1002' } },
    { id: 'plan-skip-warn', severity: 'warn', params: { impl: 1, done: 1 } },
  ],
  es: { ok: true, subagents: [
    { subagent: 'zcode', enabled: true, spawnSupported: true, spawnBlocked: null, version: '0.17.0' },
    { subagent: 'codex', enabled: true, spawnSupported: true, spawnBlocked: null, version: null },
    { subagent: 'dsh', enabled: true, spawnSupported: true, spawnBlocked: 'transport', version: null },
  ], probedAtMs: 1 },
});

/** Minimal hook runtime: one render pass per call, effects run after it commits. */
function harness({ locale = 'en', status } = {}) {
  const calls = [];
  const tabTypes = new Map();
  const components = new Map();
  const state = { status: status ?? statusValue() };
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
    if (method === 'status') return clone(state.status);
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
  return { calls, tabTypes, components, state, localeStore, plugin, render, settle };
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
  assert.match(definition.guide[0].description(), /observe/i);
  assert.equal(typeof definition.guide[0].icon, 'function');
  assert.equal(definition.guide[0].icon({}).type, 'svg');
});

test('the status page shows run facts, actors, obligations and spawnable subagents', async () => {
  const h = await mounted();
  const dom = h.render();
  const sections = walk(dom, (node) => node.props?.['data-sfd-section'] !== undefined);
  assert.deepEqual(sections.map((section) => section.props['data-sfd-section']), ['run', 'actors', 'obligations', 'es']);
  const text = textOf(dom);
  assert.match(text, /Phase: implement/);
  assert.match(text, /sfd\/dark-mode/);
  assert.match(text, /Add dark mode/);
  assert.match(text, /sfd-zcode-plan-review/);
  assert.match(text, /COMPLETED/);
  assert.match(text, /plan-review 1/);
  const obligations = walk(dom, (node) => node.props?.['data-severity'] !== undefined);
  assert.deepEqual(obligations.map((o) => o.props['data-severity']), ['todo', 'warn']);
  assert.match(textOf(obligations[1]), /implementer\(s\) dispatched/);
  // only spawnable rows are listed
  assert.match(text, /zcode, codex/);
  assert.doesNotMatch(text, /dsh, /);
  assert.equal(h.calls.filter((call) => call.method === 'status').length > 0, true);
  assert.equal(h.calls.every((call) => call.method === 'status'), true, 'the panel makes no other RPC');
});

test('without a run the panel says so and renders only the ES section', async () => {
  const h = await mounted({ status: { run: null, phase: null, obligations: [], es: statusValue().es } });
  const dom = h.render();
  const sections = walk(dom, (node) => node.props?.['data-sfd-section'] !== undefined);
  assert.deepEqual(sections.map((section) => section.props['data-sfd-section']), ['es']);
  assert.match(textOf(dom), /No SFD run/);
});

test('a session outside a repository shows the noRepo hint', async () => {
  const h = await mounted({ status: { noRepo: true, run: null, phase: null, obligations: [], es: statusValue().es } });
  assert.match(textOf(h.render()), /not in a Git repository/);
});

test('zh copy renders the warning obligation', async () => {
  const h = await mounted({ locale: 'zh' });
  const warn = walk(h.render(), (node) => node.props?.['data-severity'] === 'warn')[0];
  assert.match(textOf(warn), /警告/);
});
