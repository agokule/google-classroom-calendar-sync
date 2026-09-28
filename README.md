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

Requires Node.js 22 or newer.

```bash
npm install -g github:agokule/google-classroom-calendar-sync
```

This runs a build step on install (via npm's `prepare` lifecycle), so no
separate compile step is needed. Playwright also downloads a Chromium
build on install — if that gets skipped in your environment, run
`npx playwright install chromium` once manually.

Prefer running from a clone instead of installing globally? Clone the
repo, run `npm install`, then use `npm run config` / `npm run login` /
`npm run sync` / `npm run sync-gist` in place of the `classroom-sync`
commands below — both read and write the same `~/.classroom-sync/`
config either way.

## Usage

```bash
classroom-sync config      # interactive setup — classrooms, GitHub token, browser, ...
classroom-sync login       # opens a real browser window — log in once
classroom-sync run         # scrapes your calendars, writes classroom.ics
classroom-sync sync-gist   # publishes the current classroom.ics to a GitHub Gist
```

`classroom-sync config` is the easiest place to start: it's a menu for
adding, renaming, and removing classrooms, saving a GitHub token,
choosing the browser, timezone, and how many months to scrape, and it can
run the login, sync, and publish steps for you. Changes are saved as soon
as you make them.

Everything this tool reads or writes lives in `~/.classroom-sync/`
(session, `calendars.json`, `settings.json`, output, debug HTML) — never
inside the repo itself, so there's nothing personal to accidentally
commit. You can also edit `calendars.json` by hand; see
`calendars.example.json` for its format.

Find each class's calendar ID on its calendar's settings page ("Integrate
calendar" → the field right above "Public URL to this calendar"). The
`config` menu also accepts a pasted calendar link and pulls the ID out of
it.

Your saved session will eventually expire (how long depends on your
school's session-length policy) — when `run` says the session has
expired, just run `login` again.

### Unsupported Linux distros (Arch, NixOS, ...)

`playwright install-deps` only knows how to install shared libraries on
Playwright's officially supported distros (Debian/Ubuntu/Fedora family).
On anything else it has nothing to do, and Playwright's bundled Chromium
will fail to launch with missing-library errors. If you hit that, install
your distro's own Chromium and point this tool at it instead of the
bundled build:

```bash
sudo pacman -S chromium   # or your distro's equivalent package
classroom-sync config     # Browser → pick /usr/bin/chromium
```

The `config` menu lists any Chromium/Chrome it finds on your `PATH`,
checks that the one you pick actually launches, and saves the choice for
`login` and `run`. (The older `CLASSROOM_SYNC_BROWSER_CHANNEL` env var
still works and overrides that setting, but note that
`CLASSROOM_SYNC_BROWSER_CHANNEL=chromium` means Playwright's own
downloaded Chromium, not your distro's.)

## Optional: publish to a GitHub Gist

Create a fine-grained personal access token with the "Gists" account
permission set to read/write, and save it with `classroom-sync config`
(it walks you through creating one and checks it with GitHub). It's
stored in `~/.classroom-sync/settings.json`, readable only by you. A
`GIST_TOKEN` environment variable also works and takes priority.

Then run `classroom-sync sync-gist` after `run` to push the current
`classroom.ics` to a secret Gist, printing a stable URL you can subscribe
to from anywhere — useful for a calendar app that can't read a local file
directly. "Secret" means unlisted, not access-controlled: treat the URL
itself as the secret.

## License

MIT
