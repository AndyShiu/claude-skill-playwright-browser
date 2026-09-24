#!/usr/bin/env node
// One-time, idempotent install of this skill's runtime. Works on macOS, Linux and Windows.
//   node scripts/setup.mjs                    -> npm deps + Chromium
//   node scripts/setup.mjs chromium webkit    -> pick browsers (chromium | firefox | webkit)
// npm deps go into this skill directory; browsers go into Playwright's shared per-user cache
// (macOS ~/Library/Caches/ms-playwright, Linux ~/.cache/ms-playwright, Windows %LOCALAPPDATA%\ms-playwright),
// so every project and every copy of the skill reuses them.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error(`[setup] Node.js 18+ required, found ${process.version}`); process.exit(1); }
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium'];
const bad = browsers.filter((b) => !['chromium', 'firefox', 'webkit'].includes(b));
if (bad.length) { console.error(`[setup] unknown browser(s): ${bad.join(', ')}`); process.exit(1); }
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit', shell: true });

if (!fs.existsSync(path.join(dir, 'node_modules', '@playwright', 'test'))) {
  console.error('[setup] installing npm dependencies ...');
  run(fs.existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci --no-audit --no-fund --loglevel=error' : 'npm install --no-audit --no-fund --loglevel=error');
}
console.error(`[setup] installing browsers: ${browsers.join(' ')}`);
run(`npx --no-install playwright install ${browsers.join(' ')}`);
console.error('[setup] ok');
