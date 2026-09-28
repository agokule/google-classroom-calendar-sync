# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Syncs Google Classroom due dates to a local `.ics` file for schools whose
Workspace admin policy blocks the official Calendar API. There is no
supported API path: it drives a real Chromium browser (Playwright) with a
saved authenticated session, opens each class's Classroom calendar in
Google's month-grid embed view, and scrapes event chips straight out of the
DOM. This is DOM scraping, not an API integration — it depends on Google's
current page structure/CSS class names and can break silently if that
changes.

## Commands

```bash
npm install       # also downloads a Playwright Chromium build
npm run build      # tsc -> dist/
npm run login       # tsx src/cli.ts login  (interactive, opens a real browser window)
npm run sync         # tsx src/cli.ts run
```

There is no test suite and no lint script configured. `npm run build`
(`tsc`) is the only correctness check available — run it after changes to
`src/`.

The package is ESM (`"type": "module"`, `module: nodenext`), so relative
imports in `src/` must use the `.js` extension. TypeScript is v7 (the
native compiler), which has no `tsserver.js` — editor tooling that needs
one (e.g. `typescript-language-server`) won't use this project's copy.
Requires Node 22+.

The published CLI entry point is `dist/cli.js` (built via the `prepare`
lifecycle script on `npm install -g`); when developing in a clone, use the
`tsx`-based `login`/`sync` scripts instead of building.

## Architecture

- `src/cli.ts` — argv dispatch only (`login` | `run` | `sync-gist`), delegates immediately.
- `src/session.ts` — `login`: opens a non-headless browser at
  calendar.google.com, waits for the user to sign in manually, then saves
  Playwright's `storageState` (cookies/localStorage) to disk. This saved
  session is what lets `run` operate headlessly later — it's a copy of
  live session cookies, not an OAuth token.
- `src/sync.ts` — `run`: the scraper. For each calendar in `calendars.json`,
  loads `https://calendar.google.com/calendar/embed?src=<id>&ctz=...` using
  the saved session, walks backward/forward through `MONTHS_TO_WALK` months
  (currently `-1`, i.e. this month + last month), and on each visible month
  reads every `[data-eventchip]` node's title (`.WBi6vc`) and tooltip
  (`.XuJrye`) text. Tooltip text is parsed by `DATE_RE`/`parseEventTooltip`
  into start/end dates, all-day flag, and optional time label — this regex
  is the fragile core of the scraper and encodes several observed date
  formats (single date, same-month range, cross-month range, cross-year
  range with year shown once vs. on both endpoints). Deduping across months
  uses each chip's `data-eventid` (falls back to a per-position synthetic
  id). After scraping, writes a hand-built `.ics` (`eventsToICS`) and dumps
  each calendar's final page HTML to `~/.classroom-sync/debug/<name>.html`
  for troubleshooting when selectors stop matching.
- `src/github-gist.ts` — optional, driven by the separate `sync-gist`
  command (not run automatically by `run`): if `GIST_TOKEN` env var is
  set, pushes the on-disk `.ics` (`OUTPUT_FILE`, i.e. whatever `run` last
  wrote) to a secret (unlisted, not access-controlled) GitHub Gist and
  prints a commit-hash-free raw URL that always resolves to the latest
  revision. `runSyncGist()` exits with an error if `GIST_TOKEN` is unset
  or `OUTPUT_FILE` doesn't exist yet. Gist id is cached in
  `~/.classroom-sync/.gist-id` so subsequent runs PATCH the same gist
  instead of creating new ones.
- `src/config.ts` — defines all persistent-state paths, all rooted at
  `~/.classroom-sync/` (`session.json`, `calendars.json`, `classroom.ics`,
  `.gist-id`, `debug/`). Nothing the tool reads or writes lives inside the
  repo itself. `ensureCalendarsFile()` writes a template and returns
  `false` on first run so callers know to stop and ask the user to fill in
  real calendar IDs before scraping. `browserChannel()` reads
  `CLASSROOM_SYNC_BROWSER_CHANNEL`, used by both `session.ts` and
  `sync.ts` to launch a distro-packaged Chromium (via Playwright's
  `channel` option) instead of Playwright's bundled build — needed on
  Linux distros `playwright install-deps` doesn't support (Arch, NixOS).
- `src/types.ts` — shared `CalendarConfig` / `ParsedDate` / `ScrapedEvent`
  shapes used across the above.

## Key constraints when touching the scraper (`src/sync.ts`)

- Selectors (`data-eventchip`, `data-eventid`, `.WBi6vc`, `.XuJrye`) and the
  two nav-button XPaths (`BACK_BUTTON_XPATH`/`FORWARD_BUTTON_XPATH`) were
  copied from Google's actual rendered page, not guessed — if scraping
  starts failing, check `~/.classroom-sync/debug/*.html` before assuming
  the code is wrong; the page markup may have changed.
- `DATE_RE` intentionally handles several tooltip date formats; when
  editing it, keep the existing format list in the comment above it in
  sync, and be aware some branches (cross-month range, year-boundary range
  with implicit start year) are marked "defensive, unconfirmed" — they
  were written to be plausible but haven't been observed in real data.
- Everything under `~/.classroom-sync/` (session cookies, calendar IDs,
  debug HTML) is real user data / credentials-equivalent and must never be
  written into or read from the repo directory.
