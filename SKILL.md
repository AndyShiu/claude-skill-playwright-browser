---
name: playwright-browser
description: Headless, reproducible browser automation with Playwright for any project — screenshots of web pages or local dev servers (desktop/tablet/mobile, full page or one element, single page or every page/menu of an app in one batch), frontend audits (console errors, failed requests, broken images/links, responsive overflow, axe accessibility, LCP/CLS performance), before/after visual comparison, scripted E2E flows (log in, click, fill, page through, assert), and logged-in pages via saved sessions. Use this whenever the user wants to screenshot or visually check a site, find frontend bugs, see how a page looks on mobile, compare the UI before and after a CSS/code change, reproduce a bug from an issue or ticket and capture evidence images for it, verify a UI flow works, or run/write a browser test — even if they never say "Playwright" or "browser". If Claude in Chrome could also do the job, briefly ask which to use (with a recommendation) instead of silently picking.
---

# Playwright Browser

Background browser automation that runs locally and produces files (PNG, JSON, Markdown) the user can keep or reuse. The runtime lives in this skill directory and is shared by every project; per-project scripts, sessions and baselines are kept separate.

Respond in the user's language.

**Paths.** `<skill-dir>` means the directory that contains this SKILL.md — Claude Code reports it as the skill's base directory when the skill loads. It may be `~/.claude/skills/playwright-browser`, a project's `.claude/skills/…`, or a plugin folder, so never assume a fixed location. Call the CLI as `node "<skill-dir>/scripts/pw.mjs" <command> …` with the real absolute path substituted; that form works in zsh, bash, PowerShell and cmd (forward slashes are fine on Windows). Below, `pw` is shorthand for exactly that.

## 0. Choose the tool first

This skill does not replace Claude in Chrome. They overlap, so decide deliberately:

| Prefer **Claude in Chrome** | Prefer **Playwright (this skill)** |
|---|---|
| Needs the user's real, already-logged-in browser (SSO, 2FA, extensions) | Runs in the background without touching the user's browser |
| User wants to watch or step in while it operates | Must be reproducible (same script, same result) |
| One quick look at a page | Several viewports / pages in one batch |
| Interacting with something open in a tab right now | Tests, audits, reports, before/after visual diff |

If the request clearly fits one column, just proceed. If both fit (e.g. "take a screenshot of our site"), ask one short question naming both options and recommending one with a reason — e.g. "Use Playwright (background, can do desktop+mobile in one go) or Chrome (your logged-in tab)? I'd suggest Playwright." Don't ask again for follow-up tasks in the same thread unless the situation changes.

## Match the output to the request

Do what was asked, at the size it was asked. "Screenshot the pricing page" → take the shot, check it looks right, hand it over; no audit, no improvement list. "Why does the save button do nothing?" → reproduce and diagnose that button, fix it if you're in the project; don't append unrelated findings from a full audit. Only run `audit` and give a prioritized list of recommendations when the user asks for a review, a health check, or "find problems". If you happen to notice something serious outside the request (a crash, a security issue), mention it in one line — nothing more.

## 1. Make sure the runtime exists

```bash
node "<skill-dir>/scripts/pw.mjs" clean     # cheap check; prints JSON
```
If it returns an `error` with a `hint` about setup, the runtime isn't installed on this machine yet (normal right after someone shares or clones the skill). Tell the user it's a one-time download (~150 MB for Chromium, needs Node.js 18+), then run `node "<skill-dir>/scripts/setup.mjs"`. For other engines: `node "<skill-dir>/scripts/setup.mjs" firefox webkit`. Setup installs npm packages into the skill directory and browsers into Playwright's shared per-user cache, so it never touches the user's projects.

## 2. Commands

Every command prints one compact JSON object on stdout (progress goes to stderr, so use `2>/dev/null` when parsing); long lists are trimmed to 20 items plus a `truncated` count, and `audit` keeps the full data in `report.json`. Output files go to a fresh temp run dir (`$TMPDIR/claude-playwright/<timestamp>_<cmd>/`) unless `--out <dir>` is given — `--out` dirs are yours and are never auto-deleted.

```bash
# pw = node "<skill-dir>/scripts/pw.mjs"
pw inspect --url <url> [--click "<visible text>" ...] [--shot]
pw shot  --url <url> [--viewport desktop,mobile|all|1366x768] [--full] [--selector "<css>"] [--name <label>]
pw audit --url <url> [--viewport ...] [--skip links,axe,perf,visual,layout,images,console,network]
          [--external-links] [--max-links 100] [--update-baseline] [--name <label>]
pw run   --script <file.mjs> [--url <start-url>] [--viewport mobile] [--full] [--trace]   # one viewport per call
pw login --session <name> --url <login-url> [--until-url <path-substring>]
pw diff  <baseline.png> <current.png>
pw sessions [--delete <name>]
pw clean [--days 7]
```

Options shared by page commands: `--mask "<css>"` (blank out dynamic regions such as clocks or carousels in screenshots — use it for visual diffs), `--session <name>` (reuse a login), `--browser chromium|firefox|webkit`, `--headed` (show the window, useful for debugging), `--wait-for "<css>"`, `--wait <ms>`, `--timeout <ms>`, `--insecure` (self-signed HTTPS on intranet hosts), `--header "Name: value"`, `--locale zh-TW`, `--project <slug>` (defaults to the git repo name of the cwd).

Viewport presets: `desktop` 1440×900, `laptop` 1280×800, `tablet` 768×1024 (touch), `mobile` 390×844 (touch, 3x). `audit` defaults to desktop + tablet + mobile; `shot` and `run` default to desktop.

## 3. Finding your way around: `inspect`

Before writing a `run` script or guessing selectors, run `inspect`. It returns a text outline of the page — headings, navigation (including menu items that are buttons, not links), buttons with their disabled state, form fields with labels and required flags, tables with their columns and row counts, tabs, dialogs, alerts and pagination text — plus error counts and login/loading warnings. `--click` (repeatable, in order) clicks elements by their visible text first, so `--click Settings --click "User management"` walks a menu. It costs a few hundred tokens where a screenshot costs ~1.5k and a trial-and-error discovery script costs several round trips; use screenshots when you need to judge how something *looks*, `inspect` when you need to know what's *there*.

## 4. Screenshots

Decide the spec from the request — full page vs viewport vs one element, which sizes — and ask only if it genuinely matters and isn't inferable. Each image you open costs roughly 1.5–2k tokens, so capture only the sizes that were asked for and prefer an element or viewport shot when that answers the question.

Before handing screenshots over, make sure they show the real page. For a few shots, **look at each image** (Read the PNG) so you can describe what's there and catch a blank page, cookie banner, login wall or spinner. For a batch (roughly more than 5), rely on the `warnings` in the JSON, open every shot that has one plus a couple of samples, and tell the user which ones you actually looked at. If the page wasn't ready, retry with `--wait-for "<selector>"` or `--wait 1500` rather than handing over a bad shot.

Then tell the user where the files are — and be accurate about retention: only the default run dir (`$TMPDIR/claude-playwright/…`) is auto-deleted after 7 days; anything written with `--out` or copied elsewhere stays until someone deletes it — and ask where they want them saved (or whether the temp copy is enough for the next step, e.g. attaching to an issue). Copy with `cp`; never move files into the project without being asked.

## 5. Audits (finding frontend problems)

`audit` checks, per viewport: console errors/warnings and uncaught exceptions, failed and 4xx/5xx requests, broken images, horizontal overflow (with the offending elements), tiny text / small tap targets, LCP and CLS with Web Vitals ratings, and visual diff against a stored baseline; plus once per page: axe accessibility violations and broken links (same-origin by default).

Use it when the user asks to review or find problems — not as a default wrapper around every page visit. It writes `report.json` and `report.md` in the run dir. Read `report.md`, open the screenshots of any viewport that shows problems, and then give the user a prioritized summary — what's broken, where, likely cause, and a suggested fix pointing at their source code when you're inside the project. Read `references/analysis.md` when you need thresholds, how to interpret a finding, or how to trace it to code.

Screenshots of pages with sticky/fixed headers can be misleading in full-page mode (the header may be painted at the wrong offset). Before reporting an overlap or clipping bug involving a sticky element, confirm it with a normal viewport screenshot at a natural scroll position (a `run` script that scrolls, then `shot()`), and measure the two elements' `getBoundingClientRect()` if in doubt.

Visual baselines are stored per project in `~/.claude/playwright/baselines/<project>/` (override with `--baseline-dir`). The first run with `--update-baseline` records them; later audits report the % of changed pixels and write a `*_diff.png`. If the page height changed (content added/removed), the overlapping top part is compared and `heightChanged` is reported alongside. Only update a baseline when the user confirms the new look is intended.

## 6. Custom flows (`run`)

For anything interactive — log in, navigate, fill a form, assert text, capture steps — write a small ES module and run it. The runner injects everything, so the script doesn't import Playwright (that also means it works in non-Node projects):

```js
// flow.mjs
export default async ({ page, expect, shot, context, args, log }) => {
  await page.getByRole('link', { name: 'Pricing' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing');
  await shot('pricing');                         // numbered PNG in the run dir
  await page.getByLabel('Email').fill('qa@example.com');
  await shot('form', { selector: 'form' });      // element-only shot
  return { title: await page.title() };          // returned as `result`
};
```

On failure the runner captures `failure.png`, and returns `ok:false` with the error plus collected console/network errors, so you can diagnose in one step. Add `--trace` to get a `trace.zip` (open with `npx playwright show-trace`, from the skill dir).

Prefer role/label/text locators (`getByRole`, `getByLabel`, `getByText`) over CSS; they survive markup changes and read like the UI.

Things that trip scripts up:
- Browser dialogs (`alert`/`confirm`/`prompt`) are **auto-dismissed**, so `confirm()` returns false and the action looks like it did nothing. Register a handler first: `page.once('dialog', (d) => d.accept())`.
- iframes: `page.frameLocator('iframe[title=…]').getByRole(...)`. Uploads: `page.setInputFiles(sel, { name, mimeType, buffer })`. Downloads: `const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)])`.
- Very tall pages (> ~5000 px) screenshot fine, but opening a full-page image shrinks it until it's unreadable — capture the relevant section (`selector` or scroll + viewport shot) when you need to read it.

**Where scripts live.** Default: write them in the run dir or scratchpad and discard — don't touch the project. If the user wants to keep a flow (re-run it later, share with the team, or turn it into CI), save it in the project; suggest `.claude/playwright/<name>.mjs` unless the project already has an e2e folder. For projects that want real Playwright Test specs in CI, read `references/project-tests.md`.

## 7. Logged-in pages

Never put credentials in scripts or in this skill. Instead:

1. `pw login --session <name> --url <login-page>` opens a visible browser; the user logs in themselves, then closes the window (or pass `--until-url dashboard` to save automatically once the page path contains that text and no login form is showing — write it without a leading `/`, because Git Bash on Windows rewrites arguments that start with `/` into Windows paths).
2. Reuse it with `--session <name>` on `shot` / `audit` / `run`.

Sessions are saved outside any project at `~/.claude/playwright/sessions/<project>/<name>.json` (mode 600) so they can't be committed. Before concluding a site needs a fresh login, run `sessions` — it lists every saved session with the hosts it covers. If you're working from a different directory than where the session was created, `--session <name>` still finds it when exactly one project has that name for the target host (otherwise add `--project <slug>`).

After each command that used `--session`, the refreshed cookies/tokens are written back to the session file (only if the page is still logged in; `--no-save-session` to disable), so apps with short-lived tokens stay logged in as long as the session keeps being used. A session left unused past the app's refresh-token lifetime will still expire.

Outputs carry `warnings` when the page shows a login form (`login-wall`) or visible loading indicators (`still-loading`). Treat a login wall as "session missing or expired" — tell the user and offer to run `login` again; never present a login screen as the requested page. For still-loading, re-run with `--wait-for` pointing at real content.

## 8. Targets and side effects

URLs can be localhost dev servers, intranet hosts (use `--insecure` for self-signed certs), or public sites. If a local dev server isn't running, say so and offer to start it rather than reporting the site as broken.

Actions with real-world effects — submitting forms, purchases, deleting data, sending messages — depend on the situation: on a dev/test environment the user asked you to exercise, go ahead; on anything that looks like production or when the intent is unclear, confirm before the first such action. Read-only screenshots and audits never need confirmation.

## 9. Temp files and cleanup

Run dirs older than 7 days are deleted automatically at the start of every command (`--keep-days` to change), and macOS also purges `$TMPDIR` periodically — so anything the user wants to keep must be copied out. `clean --days 0` removes all of them now. Sessions and baselines are not temp and are never auto-deleted.
