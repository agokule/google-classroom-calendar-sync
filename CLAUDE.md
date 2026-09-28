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
npm run config      # tsx src/cli.ts config  (interactive TUI, needs a real terminal)
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

To try the TUI or CLI without touching the real `~/.classroom-sync/`,
run it with `HOME` pointed at a scratch directory (plus
`PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` so the downloaded
browsers are still found).

The published CLI entry point is `dist/cli.js` (built via the `prepare`
lifecycle script on `npm install -g`); when developing in a clone, use the
`tsx`-based `login`/`sync` scripts instead of building.

## Architecture

- `src/cli.ts` — argv dispatch only (`config` | `login` | `run` | `sync-gist`),
  delegates immediately. Commands throw `UserError` (`src/errors.ts`) for
  expected failures; the CLI prints just its message and exits 1, and the
  TUI shows it and keeps running — so nothing below `cli.ts` should call
  `process.exit`.
- `src/tui.ts` — `config`: a `@clack/prompts` menu loop for editing
  `calendars.json` / `settings.json` (classrooms, Gist token, browser,
  timezone, months to walk) and running login/sync/publish. Each action
  reads fresh state from disk and saves immediately. `parseCalendarId`
  accepts a bare ID or a Calendar link (`?src=`, base64 `?cid=`,
  `/ical/<id>/`).
- `src/session.ts` — `login`: opens a non-headless browser at
  calendar.google.com, waits for the user to sign in manually, then saves
  Playwright's `storageState` (cookies/localStorage) to disk. This saved
  session is what lets `run` operate headlessly later — it's a copy of
  live session cookies, not an OAuth token. `login(confirmSignedIn)`
  takes the "are you signed in yet?" wait as a callback so the CLI
  (press Enter) and TUI (confirm prompt) can each supply their own.
- `src/browser.ts` — `launchBrowser(headless)`: the one place Chromium is
  launched (by both login and sync), using `browserLaunchOptions()`, and
  turns Playwright's missing-OS-libraries error into install guidance.
- `src/sync.ts` — `run`: the scraper. For each calendar in `calendars.json`,
  loads `https://calendar.google.com/calendar/embed?src=<id>&ctz=<timezone>`
  using the saved session (a redirect to accounts.google.com means the
  session expired — reported as a `UserError`), walks backward/forward
  through `monthsToWalk` months (default `-1`, i.e. this month + last
  month; both it and the timezone come from settings), and on each visible month
  reads every `[data-eventchip]` node's title (`.WBi6vc`) and tooltip
  (`.XuJrye`) text. Tooltip text is parsed by `DATE_RE`/`parseEventTooltip`
  into start/end dates, all-day flag, and optional time label — this regex
  is the fragile core of the scraper and encodes several observed date
  formats (single date, same-month range, cross-month range, cross-year
  range with year shown once vs. on both endpoints). Deduping across months
  uses each chip's `data-eventid` (falls back to a per-position synthetic
  id). After scraping, writes a hand-built `.ics` (`eventsToICS`) and dumps
  each calendar's final page HTML to `~/.classroom-sync/debug/<name>.html`
  for troubleshooting when selectors stop matching (only after a
  calendar's month walk succeeds). `sync(reporter)` does the work and
  reports progress through a `SyncReporter`; `runSync()` is the CLI
  wrapper that prints to the console.
- `src/github-gist.ts` — optional, driven by the separate `sync-gist`
  command (not run automatically by `run`): using the token from
  `gistToken()` (`GIST_TOKEN` env var, else `settings.json`), pushes the
  on-disk `.ics` (`OUTPUT_FILE`, i.e. whatever `run` last wrote) to a
  secret (unlisted, not access-controlled) GitHub Gist and returns a
  commit-hash-free raw URL that always resolves to the latest revision.
  `syncGist()` throws a `UserError` if no token is configured or
  `OUTPUT_FILE` doesn't exist yet. `checkGistToken()` (used by the TUI)
  only proves a token is live via `GET /user`, not that it has the Gists
  permission. Gist id is cached in `~/.classroom-sync/.gist-id` so
  subsequent runs PATCH the same gist instead of creating new ones.
- `src/config.ts` — defines all persistent-state paths, all rooted at
  `~/.classroom-sync/` (`session.json`, `calendars.json`, `settings.json`,
  `classroom.ics`, `.gist-id`, `debug/`). Nothing the tool reads or writes
  lives inside the repo itself. `loadCalendars()` returns `[]` when
  `calendars.json` doesn't exist (`sync` then tells the user to add
  classrooms); `saveCalendars()` / `loadSettings()` / `updateSettings()`
  back the TUI. `settings.json` is written `0600` because it can hold the
  Gist token. Resolvers apply defaults and env overrides:
  `gistToken()`, `timezone()` (default `America/Toronto`),
  `monthsToWalk()` (default `-1`), and `browserLaunchOptions()` —
  either a Playwright `channel` or an `executablePath`. A distro-packaged
  Chromium (needed on distros `playwright install-deps` doesn't support,
  e.g. Arch, NixOS) must be an `executablePath` like `/usr/bin/chromium`:
  Playwright's `channel: 'chromium'` means its own downloaded full
  Chromium build, not the system one. The legacy
  `CLASSROOM_SYNC_BROWSER_CHANNEL` env var overrides the saved browser.
- `src/types.ts` — shared `CalendarConfig` / `Settings` / `ParsedDate` /
  `ScrapedEvent` shapes used across the above.

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
