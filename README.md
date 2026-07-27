# classroom-session-sync

Syncs Google Classroom due dates to a local `.ics` file, for schools whose
Google Workspace admin policy blocks the official Calendar API (and often
blocks your own Apps Script projects too, via `admin_policy_enforced`).

## How it works

There's no supported API path here — this reuses the same authenticated
browser session you already have when you're signed into your school
Google account, the same way your own browser is allowed to view your
calendars. A one-time interactive login saves that session; a second
command replays it headlessly, opens each class's Classroom calendar in
Google's month-grid view, and reads the event data straight out of the
page (title, date, all-day/timed) into a proper `.ics` file.

This is DOM scraping, not an API integration. It depends on Google's
current page structure and could break if that changes — there's no
SLA on any of this working forever, just on it working today.

## Install

```bash
npm install -g github:agokule/google-classroom-calendar-sync
```

This runs a build step on install (via npm's `prepare` lifecycle), so no
separate compile step is needed. Playwright also downloads a Chromium
build on install — if that gets skipped in your environment, run
`npx playwright install chromium` once manually.

Prefer running from a clone instead of installing globally? Clone the
repo, run `npm install`, then use `npm run login` / `npm run sync` in
place of the `classroom-sync` commands below — both read and write the
same `~/.classroom-sync/` config either way.

## Usage

```bash
classroom-sync login   # opens a real browser window — log in once
classroom-sync run     # scrapes your calendars, writes classroom.ics
```

Everything this tool reads or writes lives in `~/.classroom-sync/`
(session, calendar config, output, debug HTML) — never inside the repo
itself, so there's nothing personal to accidentally commit.

The first `run` writes a template to `~/.classroom-sync/calendars.json`
and stops so you can fill it in.

Find each class's calendar ID on its calendar's settings page ("Integrate
calendar" → the field right above "Public URL to this calendar").

Your saved session will eventually expire (how long depends on your
school's session-length policy) — when `run` starts warning about a
permission-denied page, just run `login` again.

## Optional: publish to a GitHub Gist

Set a `GIST_TOKEN` environment variable (a fine-grained personal access
token with the "Gists" account permission set to read/write) and `run`
will also push the `.ics` to a secret Gist, printing a stable URL you can
subscribe to from anywhere — useful for a calendar app that can't read a
local file directly. "Secret" means unlisted, not access-controlled:
treat the URL itself as the secret.

## License

MIT
