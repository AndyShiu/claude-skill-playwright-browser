#!/usr/bin/env node
// playwright-browser skill runtime.
// Subcommands: inspect | shot | audit | run | login | diff | sessions | clean
// Every command prints a single JSON object on stdout (last line) so the agent can parse it;
// human-oriented progress goes to stderr.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium, firefox, webkit, expect, AxeBuilder, pixelmatch, PNG;
try {
  ({ chromium, firefox, webkit, expect } = await import('@playwright/test'));
  AxeBuilder = (await import('@axe-core/playwright')).default;
  pixelmatch = (await import('pixelmatch')).default;
  ({ PNG } = await import('pngjs'));
} catch (e) {
  const setup = `node "${path.join(SKILL_DIR, 'scripts', 'setup.mjs')}"`;
  console.log(JSON.stringify({ error: `runtime not installed (${e.message.split('\n')[0]})`, hint: `first-time setup needed — run: ${setup}  (npm deps into the skill dir + Chromium, ~150 MB, once)` }));
  process.exit(1);
}

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = { _: [] };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s);
    const next = argv[i + 1];
    if (v !== undefined) push(k, v);
    else if (next !== undefined && !next.startsWith('--')) { push(k, next); i++; }
    else push(k, true);
  } else opts._.push(a);
}
// Git Bash on Windows rewrites arguments that start with "/" into Windows paths
// (--until-url /dashboard -> C:/Program Files/Git/dashboard). Undo that for our options.
const MSYS_MANGLED = /^[A-Za-z]:[\\/](?:Program Files(?: \(x86\))?[\\/])?Git(?:[\\/](?:usr|mingw64))?(?=[\\/]|$)/i;
function unmangle(v) {
  if (process.platform !== 'win32' || typeof v !== 'string' || !MSYS_MANGLED.test(v)) return v;
  return v.replace(MSYS_MANGLED, '').replace(/\\/g, '/') || '/';
}
function push(k, v) {
  if (['until-url', 'click', 'wait-for', 'selector', 'mask'].includes(k)) v = unmangle(v);
  if (opts[k] === undefined) opts[k] = v;
  else opts[k] = [].concat(opts[k], v);
}
const list = (k) => (opts[k] === undefined ? [] : [].concat(opts[k]).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean));
const num = (k, d) => (opts[k] === undefined ? d : Number(opts[k]));
const log = (...m) => console.error('[pw]', ...m);

// ---------------------------------------------------------------- paths
const ROOT = process.env.PW_SKILL_HOME || path.join(os.homedir(), '.claude', 'playwright');
const TMP_ROOT = path.join(os.tmpdir(), 'claude-playwright');
const KEEP_DAYS = num('keep-days', 7);

function projectSlug() {
  if (opts.project) return String(opts.project);
  let dir = process.cwd();
  try { dir = execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  return path.basename(dir).replace(/[^\w.-]+/g, '_');
}
const sessionFile = (name) => path.join(ROOT, 'sessions', projectSlug(), `${name}.json`);
const sessionHosts = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return [...new Set([...d.origins.map((o) => new URL(o.origin).host), ...d.cookies.map((c) => c.domain.replace(/^\./, ''))])]; } catch { return []; } };
// Sessions live under the project they were created in; if this cwd is a different project,
// fall back to a same-named session in another project that covers the target host.
function resolveSession(name) {
  const own = sessionFile(name);
  if (fs.existsSync(own)) return own;
  const url = list('url').concat(opts._)[0];
  const host = url ? (() => { try { return new URL(url).host; } catch { return null; } })() : null;
  const base = path.join(ROOT, 'sessions');
  const hits = [];
  if (fs.existsSync(base)) for (const p of fs.readdirSync(base)) {
    const f = path.join(base, p, `${name}.json`);
    if (fs.existsSync(f) && (!host || sessionHosts(f).some((h) => host === h || host.endsWith('.' + h)))) hits.push(f);
  }
  if (hits.length === 1) { log(`using session ${hits[0]}`); return hits[0]; }
  throw new Error(hits.length > 1 ? `session "${name}" exists in several projects (${hits.join(', ')}) — pass --project <slug>` : `session "${name}" not found (looked in ${own}${host ? ' and for any project covering ' + host : ''}) — list with: pw.mjs sessions; create with: pw.mjs login --session ${name} --url <login-url>`);
}
const baselineDir = () => (opts['baseline-dir'] ? path.resolve(String(opts['baseline-dir'])) : path.join(ROOT, 'baselines', projectSlug()));

function cleanTemp(days = KEEP_DAYS) {
  if (!fs.existsSync(TMP_ROOT)) return 0;
  const cutoff = Date.now() - days * 86400e3;
  let n = 0;
  for (const d of fs.readdirSync(TMP_ROOT)) {
    const p = path.join(TMP_ROOT, d);
    try { if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { recursive: true, force: true }); n++; } } catch {}
  }
  return n;
}
function newRunDir(label) {
  cleanTemp();
  if (opts.out) { const dir = path.resolve(String(opts.out)); fs.mkdirSync(dir, { recursive: true }); return dir; }
  // Timestamp + random suffix: parallel agents running the same command in the same second
  // must never share (and overwrite) a run dir. mkdtemp guarantees uniqueness.
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return fs.mkdtempSync(path.join(TMP_ROOT, `${ts}_${label}_`));
}

// ---------------------------------------------------------------- viewports
const PRESETS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};
function viewports() {
  const v = list('viewport').concat(list('viewports'));
  const names = v.length ? v : ['desktop'];
  return names.flatMap((n) => {
    if (n === 'all') return Object.entries(PRESETS).map(([k, p]) => ({ name: k, ...p }));
    if (PRESETS[n]) return [{ name: n, ...PRESETS[n] }];
    const m = n.match(/^(\d+)x(\d+)$/);
    if (m) return [{ name: n, width: +m[1], height: +m[2] }];
    throw new Error(`unknown viewport "${n}" (use desktop|laptop|tablet|mobile|all|WxH)`);
  });
}

// ---------------------------------------------------------------- browser
async function openContext(vp) {
  const engine = { chromium, firefox, webkit }[opts.browser || 'chromium'];
  if (!engine) throw new Error('--browser must be chromium|firefox|webkit');
  const browser = await engine.launch({ headless: !opts.headed, slowMo: num('slowmo', 0) });
  const ctxOpts = {
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor || 1,
    isMobile: engine === firefox ? undefined : vp.isMobile,
    hasTouch: vp.hasTouch,
    ignoreHTTPSErrors: !!opts.insecure,
    locale: opts.locale ? String(opts.locale) : undefined,
  };
  const sessionPath = opts.session ? resolveSession(String(opts.session)) : null;
  if (sessionPath) ctxOpts.storageState = sessionPath;
  const extra = list('header').reduce((h, kv) => { const i = kv.indexOf(':'); if (i > 0) h[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); return h; }, {});
  if (Object.keys(extra).length) ctxOpts.extraHTTPHeaders = extra;
  const context = await browser.newContext(ctxOpts);
  context.setDefaultTimeout(num('timeout', 30000));
  context.__sessionPath = sessionPath;
  return { browser, context };
}

// Apps rotate tokens while you use them (short-lived access token + refresh token). Write the
// refreshed state back after each run so a session keeps working as long as it's used —
// but only while still logged in, so an expired session never overwrites a good one.
async function persistSession(context, page) {
  const f = context.__sessionPath;
  if (!f || opts['no-save-session'] || !page || page.isClosed()) return;
  const w = await pageWarnings(page);
  if (w.some((x) => x.startsWith('login-wall'))) return;
  try { await context.storageState({ path: f }); fs.chmodSync(f, 0o600); } catch {}
}

// Collects console / page errors / failed requests for one page.
function attachCollectors(page) {
  const c = { console: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) c.console.push({ type: m.type(), text: m.text().slice(0, 500), location: m.location()?.url });
  });
  page.on('pageerror', (e) => c.pageErrors.push({ message: e.message.slice(0, 500), stack: (e.stack || '').split('\n').slice(0, 4).join('\n') }));
  page.on('requestfailed', (r) => c.failedRequests.push({ url: r.url(), method: r.method(), type: r.resourceType(), error: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) c.httpErrors.push({ url: r.url(), status: r.status(), type: r.request().resourceType() }); });
  return c;
}

// LCP / CLS observers must exist before the page's own scripts run.
const PERF_INIT = `
  window.__pw_perf = { lcp: 0, lcpEl: null, cls: 0, shifts: [] };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__pw_perf.lcp = e.startTime; window.__pw_perf.lcpEl = e.element ? (e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.trim().split(/\\s+/).slice(0,2).join('.') : '')) : null; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__pw_perf.cls += e.value; window.__pw_perf.shifts.push(Math.round(e.value * 1000) / 1000); } }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
`;

async function gotoAndSettle(page, url) {
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: opts['wait-until'] || 'load' });
  try { await page.waitForLoadState('networkidle', { timeout: num('idle-timeout', 8000) }); } catch {}
  if (opts['wait-for']) await page.locator(String(opts['wait-for'])).first().waitFor();
  if (opts.wait) await page.waitForTimeout(num('wait', 0));
  return { status: resp?.status() ?? null, finalUrl: page.url(), loadMs: Date.now() - t0 };
}

// Cheap heuristics so a login wall or a spinner isn't mistaken for the real page.
async function pageWarnings(page) {
  const w = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
    const pwFields = [...document.querySelectorAll('input[type=password]')].filter(vis);
    const pw = pwFields.length > 0;
    // settings pages with 'current / new password' fields are not login walls
    const changeForm = pwFields.length >= 2 || pwFields.some((e) => /new|current|confirm|change|舊|新|確認|變更/i.test((e.name || '') + (e.id || '') + (e.placeholder || '') + (e.getAttribute('autocomplete') || '')));
    const busy = [...document.querySelectorAll('[aria-busy=true], [role=progressbar]:not([aria-valuenow]), .spinner, .loading, .k-loading-mask, .skeleton, .ant-spin-spinning, .MuiCircularProgress-root')].filter(vis).length;
    return { passwordField: pw, passwordIsChangeForm: changeForm, busyIndicators: busy };
  }).catch(() => ({}));
  const out = [];
  const authPath = /(^|\/)(login|log-in|signin|sign-in|auth|sso|oauth2?)(\/|$)/i.test(new URL(page.url()).pathname);
  if (authPath || (w.passwordField && !w.passwordIsChangeForm)) out.push(opts.session ? 'login-wall: page shows a login form — the session may have expired (run login again)' : 'login-wall: page shows a login form — pass --session <name> if you meant to see the logged-in page');
  if (w.busyIndicators) out.push(`still-loading: ${w.busyIndicators} loading indicator(s) visible — consider --wait-for "<selector of real content>"`);
  return out;
}

async function screenshot(page, file, { full = !!opts.full, selector = opts.selector } = {}) {
  const common = { path: file, animations: 'disabled', caret: 'hide' };
  const masks = list('mask'); if (masks.length) common.mask = masks.map((m) => page.locator(m));
  if (selector) await page.locator(String(selector)).first().screenshot(common);
  else await page.screenshot({ ...common, fullPage: full });
  return file;
}
const safe = (s) => String(s).replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').slice(0, 60);
// Stable, collision-free key for baselines (long URLs sharing a prefix would clash with safe() alone).
const baseKey = (s) => `${safe(s).slice(0, 48)}_${createHash('sha1').update(String(s)).digest('hex').slice(0, 8)}`;
// Keep JSON output small: long arrays are trimmed and their full size reported.
const cap = (arr, n = 20) => (arr.length > n ? [...arr.slice(0, n), { truncated: arr.length - n, total: arr.length }] : arr);

// ---------------------------------------------------------------- analysis helpers
async function layoutCheck(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const offenders = [];
    if (sw > vw + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
          const sel = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
          offenders.push({ selector: sel, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
          if (offenders.length >= 15) break;
        }
      }
    }
    const tinyText = [...document.querySelectorAll('p,span,a,li,td,label,button')].filter((e) => e.offsetParent && e.innerText?.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length;
    const smallTargets = [...document.querySelectorAll('a,button,input,select,[role=button]')].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && (r.width < 24 || r.height < 24); }).length;
    return { viewportWidth: vw, scrollWidth: sw, horizontalOverflow: sw > vw + 1, overflowingElements: offenders, tinyTextElements: tinyText, smallTapTargets: smallTargets };
  });
}

async function brokenImages(page) {
  return page.evaluate(() => [...document.images]
    .filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src))
    .map((i) => ({ src: i.currentSrc || i.src, alt: i.alt })));
}

async function checkLinks(page, context) {
  const origin = new URL(page.url()).origin;
  const includeExternal = !!opts['external-links'];
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  const uniq = [...new Set(hrefs)].filter((h) => /^https?:/.test(h)).map((h) => h.split('#')[0])
    .filter((h, i, a) => h && a.indexOf(h) === i)
    .filter((h) => includeExternal || h.startsWith(origin))
    .slice(0, num('max-links', 100));
  const broken = [];
  let idx = 0;
  const worker = async () => {
    while (idx < uniq.length) {
      const u = uniq[idx++];
      try {
        let r = await context.request.fetch(u, { method: 'HEAD', timeout: 15000, failOnStatusCode: false, maxRedirects: 5 });
        if ([405, 403, 501].includes(r.status())) r = await context.request.get(u, { timeout: 15000, failOnStatusCode: false, maxRedirects: 5 });
        if (r.status() >= 400) broken.push({ url: u, status: r.status() });
      } catch (e) { broken.push({ url: u, error: e.message.split('\n')[0] }); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { checked: uniq.length, broken, scope: includeExternal ? 'all' : 'same-origin' };
}

async function perfMetrics(page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    const p = window.__pw_perf || {};
    const r = (x) => (x == null ? null : Math.round(x));
    return {
      lcpMs: r(p.lcp) || null, lcpElement: p.lcpEl, cls: Math.round((p.cls || 0) * 1000) / 1000,
      ttfbMs: r(nav.responseStart), domContentLoadedMs: r(nav.domContentLoadedEventEnd), loadMs: r(nav.loadEventEnd),
      requests: res.length, transferKB: Math.round(res.reduce((s, e) => s + (e.transferSize || 0), (nav.transferSize || 0)) / 1024),
      largestResources: res.sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).slice(0, 5).map((e) => ({ url: e.name.slice(0, 150), kb: Math.round((e.transferSize || 0) / 1024) })),
    };
  });
}
const rate = (v, good, poor) => (v == null ? 'n/a' : v <= good ? 'good' : v <= poor ? 'needs-improvement' : 'poor');

async function axeCheck(page) {
  const tags = list('axe-tags');
  let b = new AxeBuilder({ page });
  if (tags.length) b = b.withTags(tags);
  const r = await b.analyze();
  return {
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, count: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
    passes: r.passes.length, incomplete: r.incomplete.length,
  };
}

function compareImages(baseFile, curFile, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(baseFile));
  const b = PNG.sync.read(fs.readFileSync(curFile));
  if (a.width !== b.width) return { sizeChanged: true, baseline: `${a.width}x${a.height}`, current: `${b.width}x${b.height}`, mismatchPct: null, note: 'width differs — different viewport or device scale; not comparable' };
  // Full-page shots often differ only in height (a row added/removed): compare the overlapping top part.
  const w = a.width, h = Math.min(a.height, b.height);
  const crop = (img) => { if (img.height === h) return img.data; const out = Buffer.alloc(w * h * 4); img.data.copy(out, 0, 0, w * h * 4); return out; };
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(crop(a), crop(b), diff.data, w, h, { threshold: num('threshold', 0.1) });
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  const res = { mismatchPixels: n, mismatchPct: Math.round((n / (w * h)) * 10000) / 100, diff: diffFile };
  if (a.height !== b.height) Object.assign(res, { heightChanged: `${a.height} → ${b.height}px`, comparedHeight: h });
  return res;
}

// ---------------------------------------------------------------- commands
async function cmdShot() {
  const urls = list('url').concat(opts._);
  if (!urls.length) throw new Error('shot needs --url');
  const runDir = newRunDir('shot');
  const shots = [];
  for (const vp of viewports()) {
    const { browser, context } = await openContext(vp);
    try {
      for (const url of urls) {
        const page = await context.newPage();
        const nav = await gotoAndSettle(page, url);
        const kind = opts.selector ? '_element' : opts.full ? '_full' : '';   // --selector wins over --full
        const file = path.join(runDir, `${safe(opts.name || url)}_${vp.name}${kind}.png`);
        await screenshot(page, file);
        const warnings = await pageWarnings(page);
        shots.push({ url, viewport: vp.name, file, ...nav, ...(warnings.length && { warnings }) });
        await persistSession(context, page);
        await page.close();
      }
    } finally { await browser.close(); }
  }
  return { runDir, shots };
}

async function cmdAudit() {
  const url = list('url').concat(opts._)[0];
  if (!url) throw new Error('audit needs --url');
  const skip = new Set(list('skip')); // console,network,images,links,layout,axe,perf,visual
  const runDir = newRunDir('audit');
  const report = { url, startedAt: new Date().toISOString(), project: projectSlug(), viewports: [] };
  const vps = viewports().length === 1 && !opts.viewport && !opts.viewports ? viewports().concat([{ name: 'tablet', ...PRESETS.tablet }, { name: 'mobile', ...PRESETS.mobile }]) : viewports();
  for (const [i, vp] of vps.entries()) {
    log(`auditing ${url} @ ${vp.name}`);
    const { browser, context } = await openContext(vp);
    try {
      await context.addInitScript(PERF_INIT);
      const page = await context.newPage();
      const col = attachCollectors(page);
      const nav = await gotoAndSettle(page, url);
      const file = path.join(runDir, `${vp.name}_full.png`);
      await screenshot(page, file, { full: true, selector: undefined });
      const r = { viewport: vp.name, size: `${vp.width}x${vp.height}`, screenshot: file, ...nav };
      const warnings = await pageWarnings(page); if (warnings.length) r.warnings = warnings;
      if (!skip.has('layout')) r.layout = await layoutCheck(page);
      if (!skip.has('images')) r.brokenImages = await brokenImages(page);
      if (!skip.has('perf')) {
        const p = await perfMetrics(page);
        p.lcpRating = rate(p.lcpMs, 2500, 4000); p.clsRating = rate(p.cls, 0.1, 0.25);
        r.perf = p;
      }
      // viewport-independent checks only once (first viewport) to save time
      if (i === 0) {
        if (!skip.has('axe')) { try { report.accessibility = await axeCheck(page); } catch (e) { report.accessibility = { error: e.message }; } }
        if (!skip.has('links')) report.links = await checkLinks(page, context);
      }
      if (!skip.has('visual')) {
        const bdir = baselineDir();
        const bfile = path.join(bdir, `${baseKey(opts.name || url)}_${vp.name}.png`);
        if (opts['update-baseline']) { fs.mkdirSync(bdir, { recursive: true }); fs.copyFileSync(file, bfile); r.visual = { baselineUpdated: bfile }; }
        else if (fs.existsSync(bfile)) r.visual = { baseline: bfile, ...compareImages(bfile, file, path.join(runDir, `${vp.name}_diff.png`)) };
        else r.visual = { baseline: null, note: 'no baseline yet — rerun with --update-baseline to create one' };
      }
      if (!skip.has('console')) { r.console = col.console; r.pageErrors = col.pageErrors; }
      if (!skip.has('network')) { r.failedRequests = col.failedRequests; r.httpErrors = col.httpErrors; }
      report.viewports.push(r);
      await persistSession(context, page);
    } finally { await browser.close(); }
  }
  report.summary = summarize(report);
  const ws = [...new Set(report.viewports.flatMap((v) => v.warnings || []))]; if (ws.length) report.summary.warnings = ws;
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));  // full data on disk; stdout stays small
  fs.writeFileSync(path.join(runDir, 'report.md'), toMarkdown(report));
  return { runDir, report: path.join(runDir, 'report.json'), markdown: path.join(runDir, 'report.md'), summary: report.summary };
}

function summarize(rep) {
  const vps = rep.viewports;
  const uniq = (arr, key) => [...new Map(arr.map((x) => [key(x), x])).values()];
  const s = {
    consoleErrors: uniq(vps.flatMap((v) => (v.console || []).filter((c) => c.type === 'error')), (c) => c.text).length,
    consoleWarnings: uniq(vps.flatMap((v) => (v.console || []).filter((c) => c.type === 'warning')), (c) => c.text).length,
    pageErrors: uniq(vps.flatMap((v) => v.pageErrors || []), (e) => e.message).length,
    failedRequests: uniq(vps.flatMap((v) => [...(v.failedRequests || []), ...(v.httpErrors || [])]), (r) => r.url).length,
    brokenImages: uniq(vps.flatMap((v) => v.brokenImages || []), (i) => i.src).length,
    brokenLinks: rep.links ? rep.links.broken.length : null,
    horizontalOverflow: vps.filter((v) => v.layout?.horizontalOverflow).map((v) => v.viewport),
    a11yViolations: rep.accessibility?.violations ? Object.fromEntries(['critical', 'serious', 'moderate', 'minor'].map((k) => [k, rep.accessibility.violations.filter((v) => v.impact === k).length])) : null,
    perf: Object.fromEntries(vps.filter((v) => v.perf).map((v) => [v.viewport, { lcpMs: v.perf.lcpMs, lcp: v.perf.lcpRating, cls: v.perf.cls, clsRating: v.perf.clsRating }])),
    visual: Object.fromEntries(vps.filter((v) => v.visual).map((v) => [v.viewport, v.visual.mismatchPct != null ? (v.visual.heightChanged ? `${v.visual.mismatchPct}% (height ${v.visual.heightChanged})` : v.visual.mismatchPct) : (v.visual.sizeChanged ? 'size-changed' : v.visual.baselineUpdated ? 'baseline-updated' : 'no-baseline')])),
  };
  return s;
}

function toMarkdown(rep) {
  const s = rep.summary;
  const L = [];
  L.push(`# Audit: ${rep.url}`, '', `- Project: ${rep.project}`, `- Time: ${rep.startedAt}`, '');
  if (s.warnings) L.push('> **Warnings:** ' + s.warnings.join(' · '), '');
  L.push('## Summary', '', '| Check | Result |', '|---|---|');
  L.push(`| Console errors / warnings | ${s.consoleErrors} / ${s.consoleWarnings} |`);
  L.push(`| Uncaught page errors | ${s.pageErrors} |`);
  L.push(`| Failed / 4xx-5xx requests | ${s.failedRequests} |`);
  L.push(`| Broken images | ${s.brokenImages} |`);
  L.push(`| Broken links | ${s.brokenLinks ?? 'skipped'} |`);
  L.push(`| Horizontal overflow | ${s.horizontalOverflow.length ? s.horizontalOverflow.join(', ') : 'none'} |`);
  L.push(`| Accessibility (crit/serious/mod/minor) | ${s.a11yViolations ? Object.values(s.a11yViolations).join(' / ') : 'skipped'} |`);
  for (const [vp, p] of Object.entries(s.perf)) L.push(`| Perf ${vp} | LCP ${p.lcpMs ?? '-'} ms (${p.lcp}), CLS ${p.cls} (${p.clsRating}) |`);
  for (const [vp, v] of Object.entries(s.visual)) L.push(`| Visual diff ${vp} | ${typeof v === 'number' ? v + '% pixels changed' : v} |`);
  L.push('');
  for (const v of rep.viewports) {
    L.push(`## ${v.viewport} (${v.size}) — HTTP ${v.status}, ${v.loadMs} ms`, '', `Screenshot: ${v.screenshot}`, '');
    const errs = [...(v.pageErrors || []).map((e) => `pageerror: ${e.message}`), ...(v.console || []).map((c) => `${c.type}: ${c.text}`)];
    if (errs.length) L.push('**Console**', ...errs.slice(0, 20).map((e) => `- ${e.replace(/\n/g, ' ')}`), '');
    const net = [...(v.httpErrors || []).map((r) => `${r.status} ${r.type} ${r.url}`), ...(v.failedRequests || []).map((r) => `FAILED(${r.error}) ${r.type} ${r.url}`)];
    if (net.length) L.push('**Network**', ...net.slice(0, 20).map((e) => `- ${e}`), '');
    if (v.brokenImages?.length) L.push('**Broken images**', ...v.brokenImages.map((i) => `- ${i.src}`), '');
    if (v.layout?.horizontalOverflow) L.push(`**Horizontal overflow**: page ${v.layout.scrollWidth}px wide vs viewport ${v.layout.viewportWidth}px`, ...v.layout.overflowingElements.map((o) => `- \`${o.selector}\` right=${o.right}px width=${o.width}px`), '');
    if (v.layout && (v.layout.tinyTextElements || v.layout.smallTapTargets)) L.push(`Text < 11px: ${v.layout.tinyTextElements} elements · tap targets < 24px: ${v.layout.smallTapTargets}`, '');
    if (v.perf) L.push(`**Perf**: TTFB ${v.perf.ttfbMs} ms · DCL ${v.perf.domContentLoadedMs} ms · load ${v.perf.loadMs} ms · ${v.perf.requests} requests · ${v.perf.transferKB} KB · LCP element ${v.perf.lcpElement || '-'}`, '');
    if (v.visual?.diff) L.push(`**Visual diff**: ${v.visual.mismatchPct}% → ${v.visual.diff}`, '');
  }
  if (rep.accessibility?.violations?.length) {
    L.push('## Accessibility violations', '');
    for (const a of rep.accessibility.violations) L.push(`- **${a.impact}** \`${a.id}\` (${a.count}) ${a.help} — ${a.targets.slice(0, 3).map((t) => '`' + t + '`').join(', ')}`);
    L.push('');
  }
  if (rep.links?.broken?.length) { L.push('## Broken links', '', ...rep.links.broken.map((b) => `- ${b.status || b.error} ${b.url}`), ''); }
  return L.join('\n');
}

async function cmdRun() {
  const script = opts.script || opts._[0];
  if (!script) throw new Error('run needs --script <file.mjs>');
  const runDir = newRunDir('run');
  const mod = await import(pathToFileURL(path.resolve(String(script))).href);
  const fn = mod.default || mod.run;
  if (typeof fn !== 'function') throw new Error('script must `export default async ({ page, ... }) => {...}`');
  const vp = viewports()[0];
  const { browser, context } = await openContext(vp);
  let result, error, startWarnings = [];
  const page = await context.newPage();
  const col = attachCollectors(page);
  if (opts.trace) await context.tracing.start({ screenshots: true, snapshots: true });
  let n = 0;
  const shot = async (name, o = {}) => screenshot(page, path.join(runDir, `${String(++n).padStart(2, '0')}_${safe(name)}.png`), { full: o.full ?? !!opts.full, selector: o.selector });
  try {
    if (opts.url) { await gotoAndSettle(page, String(opts.url)); startWarnings = await pageWarnings(page); }
    result = await fn({ page, context, browser, expect, shot, runDir, url: opts.url, args: opts, log, viewport: vp });
  } catch (e) {
    error = { message: e.message.split('\n').slice(0, 6).join('\n') };
    try { await screenshot(page, path.join(runDir, 'failure.png'), { full: true }); error.screenshot = path.join(runDir, 'failure.png'); } catch {}
  } finally {
    if (opts.trace) await context.tracing.stop({ path: path.join(runDir, 'trace.zip') });
    await persistSession(context, page);
    await browser.close();
  }
  const files = fs.readdirSync(runDir).map((f) => path.join(runDir, f));
  const extraVp = viewports().length > 1 ? [`run uses one viewport per call — ran ${vp.name} only; call again with --viewport for the others`] : [];
  const warnings = [...startWarnings, ...extraVp];
  return { runDir, ok: !error, error, result, ...(warnings.length && { warnings }), files, console: cap(col.console), pageErrors: cap(col.pageErrors), httpErrors: cap(col.httpErrors), failedRequests: cap(col.failedRequests), trace: opts.trace ? path.join(runDir, 'trace.zip') : undefined };
}

// Text-only page outline — the cheap way to find your way around an app before writing a
// `run` script or deciding what to screenshot (no image tokens).
const OUTLINE = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const txt = (e) => (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
  const q = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const labelOf = (e) => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || document.getElementById(e.getAttribute('aria-labelledby') || '')?.innerText || e.placeholder || e.name || e.id || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  return {
    title: document.title,
    headings: q('h1,h2,h3,[role=heading]').map((e) => `${e.tagName === 'DIV' ? 'h?' : e.tagName.toLowerCase()} ${txt(e)}`).filter((s) => s.length > 3).slice(0, 20),
    navigation: uniq(q('nav a, nav button, aside a, aside button, [role=navigation] a, [role=navigation] button, [role=menuitem]').map((e) => ({ text: txt(e), href: e.getAttribute('href') || undefined })).filter((x) => x.text), (x) => x.text + x.href).slice(0, 40),
    links: uniq(q('main a[href], [role=main] a[href]').map((e) => ({ text: txt(e), href: e.getAttribute('href') })).filter((x) => x.text), (x) => x.href).slice(0, 30),
    buttons: uniq(q('main button, [role=main] button, main [role=button], form button, [role=dialog] button').map((e) => ({ text: txt(e), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true' || undefined })).filter((x) => x.text), (x) => x.text).slice(0, 40),
    tabs: q('[role=tab]').map((e) => ({ text: txt(e), selected: e.getAttribute('aria-selected') === 'true' || undefined })).slice(0, 15),
    fields: q('input:not([type=hidden]), select, textarea, [role=combobox], [role=textbox]').map((e) => ({ label: labelOf(e), type: e.type || e.getAttribute('role') || e.tagName.toLowerCase(), required: e.required || e.getAttribute('aria-required') === 'true' || undefined, filled: !!(e.value || e.getAttribute('aria-valuetext')) || undefined })).filter((f) => f.label || f.type).slice(0, 30),
    tables: q('table, [role=grid]').map((t) => ({ columns: [...t.querySelectorAll('th, [role=columnheader]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15), rows: t.querySelectorAll('tbody tr, [role=row]').length })).slice(0, 5),
    dialogs: q('[role=dialog], [role=alertdialog], dialog[open]').map((e) => txt(e).slice(0, 120)),
    alerts: q('[role=alert], [role=status], .toast, .alert').map((e) => txt(e)).filter(Boolean).slice(0, 10),
    pagination: [...document.body.innerText.matchAll(/(顯示\s*\d+\s*[-–~]\s*\d+[^\n]{0,20}|第\s*\d+\s*\/\s*\d+\s*頁|\d+\s*[-–]\s*\d+\s+of\s+\d+|Page\s+\d+\s+of\s+\d+)/gi)].map((m) => m[0].trim()).slice(0, 3),
  };
};

async function clickByText(page, t) {
  const cands = [
    page.getByRole('link', { name: t, exact: true }), page.getByRole('button', { name: t, exact: true }),
    page.getByRole('menuitem', { name: t, exact: true }), page.getByRole('tab', { name: t, exact: true }),
    page.getByText(t, { exact: true }), page.getByRole('link', { name: t }), page.getByRole('button', { name: t }), page.getByText(t),
  ];
  for (const c of cands) {
    const loc = c.first();
    if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
      await loc.click();
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
      await page.waitForTimeout(num('settle', 600));
      return;
    }
  }
  throw new Error(`nothing visible to click matching "${t}" — run inspect without --click to see what's on the page`);
}

async function cmdInspect() {
  const url = list('url').concat(opts._)[0];
  if (!url) throw new Error('inspect needs --url');
  const clicks = [].concat(opts.click ?? []).map(String);   // repeatable, in order; not comma-split
  const vp = viewports()[0];
  const { browser, context } = await openContext(vp);
  try {
    const page = await context.newPage();
    const col = attachCollectors(page);
    const nav = await gotoAndSettle(page, url);
    const steps = [];
    for (const t of clicks) { await clickByText(page, t); steps.push({ clicked: t, url: page.url() }); }
    const outline = await page.evaluate(OUTLINE);
    const warnings = await pageWarnings(page);
    let screenshotFile;
    if (opts.shot) { const runDir = newRunDir('inspect'); screenshotFile = await screenshot(page, path.join(runDir, `${safe(page.url())}_${vp.name}.png`)); }
    await persistSession(context, page);
    const clean = Object.fromEntries(Object.entries(outline).filter(([, v]) => !(Array.isArray(v) && !v.length)));
    return { url: page.url(), status: nav.status, viewport: vp.name, ...(steps.length && { steps }), ...(warnings.length && { warnings }), ...clean,
      errors: { console: col.console.filter((c) => c.type === 'error').length, pageErrors: col.pageErrors.length, httpErrors: col.httpErrors.length, failedRequests: col.failedRequests.length },
      ...(screenshotFile && { screenshot: screenshotFile }) };
  } finally { await browser.close(); }
}

async function cmdLogin() {
  const name = String(opts.session || 'default');
  const url = list('url').concat(opts._)[0];
  if (!url) throw new Error('login needs --url');
  const file = sessionFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const browser = await (opts.browser === 'firefox' ? firefox : opts.browser === 'webkit' ? webkit : chromium).launch({ headless: false });
  const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: !!opts.insecure });
  const page = await context.newPage();
  await page.goto(url);
  const waitUrl = opts['until-url'] ? String(opts['until-url']) : null;
  log(waitUrl ? `log in manually; saving once URL matches ${waitUrl}` : 'log in manually, then CLOSE the browser window to save the session');
  const save = async () => { await context.storageState({ path: file }); fs.chmodSync(file, 0o600); };
  if (waitUrl) {
    // Match the path only (a login URL like /login?redirect=/dashboard must not count), and never
    // while a login form is still on screen.
    const reached = async () => new URL(page.url()).pathname.includes(waitUrl) && !(await pageWarnings(page)).some((x) => x.startsWith('login-wall'));
    const deadline = Date.now() + num('timeout', 300000);
    while (!(await reached().catch(() => false))) { if (Date.now() > deadline) throw new Error(`timed out waiting for a page whose path contains "${waitUrl}"`); await page.waitForTimeout(500); }
    await page.waitForLoadState('networkidle').catch(() => {});
    await save(); await browser.close();
  } else {
    // Save only when something changes (navigation, new tab, tab closing) — not on a timer:
    // polling storageState in a headed window makes it visibly flicker.
    // Finish when the last tab is closed: on macOS closing the window leaves the app
    // running, so waiting for the browser process to exit would hang forever.
    let pending;
    const saveSoon = () => { clearTimeout(pending); pending = setTimeout(() => save().catch(() => {}), 1500); };
    await new Promise((done) => {
      const watch = (p) => {
        p.on('framenavigated', (f) => { if (f === p.mainFrame()) saveSoon(); });
        p.on('close', async () => {
          if (context.pages().length > 0) return;
          clearTimeout(pending);
          await save().catch(() => {});
          await browser.close().catch(() => {});
          done();
        });
      };
      watch(page);
      context.on('page', watch);
      browser.on('disconnected', done);
    });
    clearTimeout(pending);
  }
  return { session: name, project: projectSlug(), file, saved: fs.existsSync(file) };
}

async function cmdDiff() {
  const [a, b] = opts._.length >= 2 ? opts._ : [opts.baseline, opts.current];
  if (!a || !b) throw new Error('diff needs two PNG paths');
  const runDir = newRunDir('diff');
  return compareImages(path.resolve(String(a)), path.resolve(String(b)), path.join(runDir, 'diff.png'));
}

function cmdSessions() {
  const base = path.join(ROOT, 'sessions');
  if (opts.delete) {
    const name = String(opts.delete);
    const f = opts.project ? sessionFile(name) : (() => { try { return resolveSession(name); } catch (e) { return sessionFile(name); } })();
    const existed = fs.existsSync(f); fs.rmSync(f, { force: true });
    return { deleted: existed ? f : null, note: existed ? undefined : `no session "${name}" found` };
  }
  const out = {};
  if (fs.existsSync(base)) for (const p of fs.readdirSync(base)) out[p] = fs.readdirSync(path.join(base, p)).map((f) => ({ name: f.replace(/\.json$/, ''), hosts: sessionHosts(path.join(base, p, f)), modified: fs.statSync(path.join(base, p, f)).mtime.toISOString() }));
  return { root: base, currentProject: projectSlug(), sessions: out };
}

// ---------------------------------------------------------------- main
const COMMANDS = { inspect: cmdInspect, shot: cmdShot, audit: cmdAudit, run: cmdRun, login: cmdLogin, diff: cmdDiff, sessions: cmdSessions, clean: () => ({ removed: cleanTemp(num('days', KEEP_DAYS)), tempRoot: TMP_ROOT }) };
if (!COMMANDS[cmd]) {
  console.error(`usage: node pw.mjs <${Object.keys(COMMANDS).join('|')}> [options]  (see SKILL.md)`);
  process.exit(2);
}
try {
  const out = await COMMANDS[cmd]();
  console.log(JSON.stringify(out));   // compact: this goes straight into the agent's context
} catch (e) {
  const hint = /Executable doesn't exist|browserType.launch/.test(e.message) ? `browser not installed — run: node "${path.join(SKILL_DIR, 'scripts', 'setup.mjs')}" ${opts.browser || 'chromium'}` : /Cannot find (package|module)/.test(e.message) ? `dependencies missing — run: node "${path.join(SKILL_DIR, 'scripts', 'setup.mjs')}"` : /ERR_CERT|SSL|certificate/i.test(e.message) ? 'untrusted/self-signed certificate — add --insecure if this is an intranet host you trust' : /ERR_CONNECTION_REFUSED/.test(e.message) ? 'nothing is listening there — is the dev server running?' : undefined;
  console.log(JSON.stringify({ error: e.message.split('\n').slice(0, hint ? 1 : 5).join('\n'), hint }));   // with a hint, the first line is enough
  process.exit(1);
}
