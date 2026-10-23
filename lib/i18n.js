/**
 * Host-side localization for dsh-sfd.
 *
 * Why this exists: `ctx.locale` (register/bind/dict) is a browser-client
 * service only — host plugins have no locale service, so the original
 * `ctx.locale?.dict?.['dsh-sfd']` lookup always missed and question cards
 * rendered raw keys ("cleanup.dirtyTitle"). The GUI's language preference
 * lives in the Host settings entry `locale` (field `preference`; unset means
 * "follow the system language"), so this module reconstructs the resolution
 * chain on the host:
 *
 *   settings `locale.preference` -> LANG/LC_ALL env -> macOS system language
 *   -> ICU default -> 'en'
 *
 * Dictionaries are the package's own locale/*.json (en base, zh overlay).
 * Unknown keys render as the key itself, never a crash.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

export const SUPPORTED = ['en', 'zh'];

const dictCache = new Map();
let systemLanguageMemo; // cached; a system-language change needs a Host restart

const primary = (tag) => String(tag ?? '').split(/[-_]/)[0]?.toLowerCase() ?? '';

/** Flatten one nested dictionary into dot-key -> string. */
function flatten(value, prefix = '', out = {}) {
  for (const [key, item] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') flatten(item, path, out);
    else if (typeof item === 'string') out[path] = item;
  }
  return out;
}

/** Load (and cache) one flattened dictionary; unknown languages fall back to en. */
export async function loadDict(lang) {
  const use = SUPPORTED.includes(lang) ? lang : 'en';
  if (!dictCache.has(use)) {
    const url = new URL(`../locale/${use}.json`, import.meta.url);
    const text = await readFile(url, 'utf8');
    dictCache.set(use, flatten(JSON.parse(text)));
  }
  return dictCache.get(use);
}

/** macOS system language from the user's GlobalPreferences (cached, may be null). */
async function macSystemLanguage() {
  if (systemLanguageMemo !== undefined) return systemLanguageMemo;
  systemLanguageMemo = null;
  if (process.platform !== 'darwin') return systemLanguageMemo;
  // `defaults export` emits XML plists; plutil's json conversion rejects some
  // plist object types, so extract the first language tag textually.
  try {
    const { stdout } = await run('defaults', ['export', 'NSGlobalDomain', '-'], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const tag = /AppleLanguages<\/key>\s*<array>\s*<string>([^<]+)<\/string>/.exec(stdout)?.[1]
      ?? /AppleLocale<\/key>\s*<string>([^<]+)<\/string>/.exec(stdout)?.[1]
      ?? null;
    if (tag) systemLanguageMemo = tag;
  } catch { /* unreadable is not fatal */ }
  return systemLanguageMemo;
}

/**
 * Pure resolution step so tests need no real environment: first supported
 * primary subtag wins, otherwise 'en'.
 */
export function pickLocale({ preference, envLang, systemLang, icu } = {}) {
  for (const tag of [preference, envLang, systemLang, icu]) {
    const p = primary(tag);
    if (SUPPORTED.includes(p)) return p;
  }
  return 'en';
}

/** Resolve the active UI language for this host. */
export async function resolveLanguage(ctx) {
  let preference;
  try {
    const settings = ctx?.get?.('settings');
    const entry = (settings?.describe?.() ?? []).find((form) => form.ns === 'locale');
    preference = entry?.value?.preference ?? entry?.user?.preference;
  } catch { /* settings service absent: fall through the chain */ }
  const envLang = process.env.LC_ALL || process.env.LANG;
  const systemLang = await macSystemLanguage();
  const icu = Intl.DateTimeFormat().resolvedOptions().locale;
  return pickLocale({ preference, envLang, systemLang, icu });
}

/**
 * Build the translator for one language: (key, params?) -> string. The en
 * dictionary is the base; the chosen language overlays it. Unknown keys
 * return the key; `{placeholder}` interpolates from params.
 */
export async function translator(lang) {
  const dict = { ...(await loadDict('en')), ...(await loadDict(lang)) };
  return (key, params) => {
    let text = dict[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}

/** makeT(ctx): resolve the language for this host, then build the translator. */
export async function makeT(ctx) {
  return translator(await resolveLanguage(ctx));
}
