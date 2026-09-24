# Interpreting audit results

Use this when turning `report.json` / `report.md` into advice. Prioritize: things that break functionality > things that hurt many users (mobile layout, performance) > accessibility > cosmetics.

## Console & page errors
- `pageErrors` are uncaught exceptions — usually real bugs. Use the stack's file/line to find the source; in a dev server the URLs map to source files, in production look for source maps.
- `console` errors that just echo a failed request ("Failed to load resource: 404") duplicate the network section — report the request, not both.
- Warnings are mostly framework noise (React keys, deprecated APIs). Mention them only if relevant to the user's question or clearly actionable.

## Network
- `httpErrors`: 4xx/5xx. 401/403 on API calls often means the session is missing or expired (see SKILL.md §7), not a bug.
- `failedRequests`: DNS/connection/CORS/aborted. `net::ERR_ABORTED` on navigation or media is usually harmless; `net::ERR_BLOCKED_BY_CLIENT` is an ad blocker (won't happen headless); mixed content and CORS failures are real bugs.
- Third-party failures (analytics, fonts, ads) are lower priority than same-origin ones.

## Broken images / links
- Broken images: check the `src` path, case sensitivity (Linux servers), and the build's asset base URL.
- Links are checked with HEAD, falling back to GET for 403/405/501. Some sites block bots and return 403/429 — treat external 403/429 as "unverified", not broken. Same-origin 404s are real.

## Layout (per viewport)
- `horizontalOverflow` + `overflowingElements`: the page is wider than the screen, causing sideways scroll on phones. Typical causes: fixed `width` in px, `100vw` plus padding/scrollbar, long unbroken strings/URLs, wide tables or `<pre>` without `overflow-x:auto`, images without `max-width:100%`, negative margins. Suggest the fix on the listed selector.
- `tinyTextElements`: text under 11px — hard to read on mobile.
- `smallTapTargets`: interactive elements smaller than 24×24 px (WCAG 2.2 AA minimum; 44–48 px is the comfortable guideline).
- Always look at the mobile/tablet screenshots yourself; the heuristics miss overlap, clipping and z-index problems that are obvious visually.

## Performance (lab numbers, one load, local machine)
| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP | ≤ 2500 ms | ≤ 4000 ms | > 4000 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

- These are single lab measurements on the user's machine and network — use them to spot problems and compare before/after, not as field data. Localhost numbers are optimistic.
- `lcpElement` tells you what to optimize (hero image → size/format/preload; text → web font loading).
- CLS usually comes from images/iframes/ads without dimensions, late-injected banners, or font swaps.
- `largestResources` points at oversized bundles/images.
- INP (interaction latency) is not measured by a page load; for a slow interaction, script it with `run` and time it.

## Accessibility (axe-core)
- Impact order: critical > serious > moderate > minor. Report critical/serious with the selector and the rule's `helpUrl`.
- Common ones: `image-alt`, `label` (form inputs without labels), `color-contrast`, `button-name`, `link-name`, `html-has-lang`, `document-title`, `landmark-*` / `region` (moderate, structural).
- axe checks the rendered DOM at that moment; content behind tabs/modals needs a `run` script that opens it first.
- Automated checks catch roughly a third of accessibility issues; say so if the user asks whether the page "is accessible".

## Visual diff
- `mismatchPct` is the share of pixels that changed. Rough reading: < 0.1% anti-aliasing/noise; 0.1–2% small change (text, icon, spacing); > 2% layout shift or a different state (banner, loading, data). Open the `*_diff.png` (changed pixels in red) and both screenshots before judging.
- Dynamic content (dates, carousels, ads, random data) causes false positives: wait for a stable state with `--wait-for`, and pass `--mask "<css>"` (repeatable) for regions that always change — on both the baseline run and later runs.
- `heightChanged` means the page got taller/shorter (content added/removed); the percentage covers only the overlapping top part, so also compare the two screenshots side by side. `sizeChanged` (width differs) means the shots aren't comparable — different viewport or device scale.
- Full-page screenshots can paint sticky/fixed elements (table headers, top bars) at the wrong position. Confirm any overlap involving them with a viewport screenshot at a natural scroll position and by measuring `getBoundingClientRect()` before calling it a bug.

## Tracing a finding to code
When working inside the project: search the codebase for the selector's class/id, the failing URL path, or the error message text; check the component that renders the offending element; propose a concrete diff. Re-run the same audit (or `shot`) after a fix to confirm it's resolved.
