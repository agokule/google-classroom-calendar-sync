// Interactive setup (`classroom-sync config`): manage the classroom list
// and settings under ~/.classroom-sync/ from menus instead of
// hand-editing JSON, and run login / sync / publish without remembering
// the individual commands. Every change is written to disk immediately.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import { launchBrowser } from './browser.js';
import {
  CONFIG_DIR,
  DEFAULT_TIMEZONE,
  OUTPUT_FILE,
  SESSION_FILE,
  SETTINGS_FILE,
  browserLaunchOptions,
  gistToken,
  loadCalendars,
  loadSettings,
  monthsToWalk,
  saveCalendars,
  timezone,
  updateSettings,
} from './config.js';
import { UserError } from './errors.js';
import { checkGistToken, syncGist } from './github-gist.js';
import { login } from './session.js';
import { sync, type SyncReporter } from './sync.js';
import type { CalendarConfig, Settings } from './types.js';

const BACK = 'back';

// Checked in this order; the first hit per name is offered as a choice.
const SYSTEM_BROWSER_NAMES = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

type MenuChoice =
  | 'classrooms' | 'token' | 'browser' | 'timezone' | 'months'
  | 'login' | 'sync' | 'publish' | 'quit';

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserError('`classroom-sync config` is interactive and needs to run in a terminal.');
  }

  const actions: Record<Exclude<MenuChoice, 'quit'>, () => Promise<void>> = {
    classrooms: manageClassrooms,
    token: manageToken,
    browser: chooseBrowser,
    timezone: chooseTimezone,
    months: chooseMonths,
    login: loginInteractively,
    sync: syncNow,
    publish: publishNow,
  };

  p.intro('classroom-sync');
  let last: MenuChoice = 'classrooms';
  for (;;) {
    const options = mainMenuOptions();
    const choice: MenuChoice | typeof p.CANCEL_SYMBOL = await p.select<MenuChoice>({
      message: 'What would you like to do?',
      options,
      initialValue: options.some((o) => o.value === last && !o.disabled) ? last : undefined,
    });
    if (p.isCancel(choice) || choice === 'quit') break;
    last = choice;

    try {
      await actions[choice]();
    } catch (err) {
      p.log.error(errorMessage(err));
    }
  }
  p.outro(`Settings are saved in ${CONFIG_DIR}`);
}

function mainMenuOptions(): p.Option<MenuChoice>[] {
  const calendars = loadCalendars();
  const token = gistToken();
  const hasSession = fs.existsSync(SESSION_FILE);
  const hasOutput = fs.existsSync(OUTPUT_FILE);

  // Hints only show on the focused option, so anything worth seeing at a
  // glance goes in the label itself.
  return [
    { value: 'classrooms', label: `Classrooms (${calendars.length})`, hint: 'add, rename or remove' },
    {
      value: 'token',
      label: `GitHub Gist token: ${!token ? 'not set' : token.source === 'env' ? 'from $GIST_TOKEN' : 'saved'}`,
      hint: 'optional, for publishing the calendar to a URL',
    },
    { value: 'browser', label: `Browser: ${describeBrowser()}` },
    { value: 'timezone', label: `Timezone: ${timezone()}` },
    { value: 'months', label: `Months to scrape: ${describeMonths(monthsToWalk())}` },
    {
      value: 'login',
      label: `Log in to Google (${hasSession ? `session saved ${ago(fs.statSync(SESSION_FILE).mtime)}` : 'not logged in yet'})`,
    },
    {
      value: 'sync',
      label: 'Sync now',
      disabled: calendars.length === 0 || !hasSession,
      hint: calendars.length === 0 ? 'add a classroom first' : !hasSession ? 'log in first' : `writes ${OUTPUT_FILE}`,
    },
    {
      value: 'publish',
      label: 'Publish to Gist',
      disabled: !token || !hasOutput,
      hint: !token ? 'set a GitHub token first' : !hasOutput ? 'sync first' : undefined,
    },
    { value: 'quit', label: 'Quit' },
  ];
}

// --- Classrooms -----------------------------------------------------------

async function manageClassrooms(): Promise<void> {
  for (;;) {
    const calendars = loadCalendars();
    const choice = await p.select<number | 'add' | 'remove-several' | typeof BACK>({
      message: calendars.length ? 'Pick a classroom to edit, or add one' : 'No classrooms yet',
      options: [
        ...calendars.map((cal, i) => ({ value: i, label: cal.name, hint: cal.id })),
        { value: 'add', label: '+ Add a classroom' },
        ...(calendars.length > 1 ? [{ value: 'remove-several' as const, label: '- Remove several' }] : []),
        { value: BACK, label: '← Back' },
      ],
      maxItems: 12,
    });
    if (p.isCancel(choice) || choice === BACK) return;

    if (choice === 'add') await addClassroom(calendars);
    else if (choice === 'remove-several') await removeClassrooms(calendars);
    else await editClassroom(calendars, choice);
  }
}

async function addClassroom(calendars: CalendarConfig[]): Promise<void> {
  p.log.info(
    'In Google Calendar, open the class calendar\'s ⋮ menu → Settings and sharing →\n' +
    '"Integrate calendar" and copy the Calendar ID. Pasting a calendar link works too.'
  );
  const id = await promptCalendarId(calendars);
  if (id === null) return;
  const name = await promptName(calendars);
  if (name === null) return;

  saveCalendars([...calendars, { id, name }]);
  p.log.success(`Added ${name}.`);
}

async function editClassroom(calendars: CalendarConfig[], index: number): Promise<void> {
  const cal = calendars[index];
  const others = calendars.filter((_, i) => i !== index);
  const action = await p.select({
    message: cal.name,
    options: [
      { value: 'rename', label: 'Rename' },
      { value: 'id', label: 'Change calendar ID', hint: cal.id },
      { value: 'remove', label: 'Remove' },
      { value: BACK, label: '← Back' },
    ],
  });
  if (p.isCancel(action) || action === BACK) return;

  if (action === 'rename') {
    const name = await promptName(others, cal.name);
    if (name === null) return;
    calendars[index] = { ...cal, name };
  } else if (action === 'id') {
    const id = await promptCalendarId(others, cal.id);
    if (id === null) return;
    calendars[index] = { ...cal, id };
  } else {
    const confirmed = await p.confirm({ message: `Remove ${cal.name}?`, initialValue: false });
    if (confirmed !== true) return;
    calendars.splice(index, 1);
  }
  saveCalendars(calendars);
  p.log.success('Saved.');
}

async function removeClassrooms(calendars: CalendarConfig[]): Promise<void> {
  const picked = await p.multiselect({
    message: 'Which classrooms should be removed?',
    options: calendars.map((cal, i) => ({ value: i, label: cal.name, hint: cal.id })),
    required: false,
  });
  if (p.isCancel(picked) || picked.length === 0) return;

  const count = plural(picked.length, 'classroom');
  const confirmed = await p.confirm({ message: `Remove ${count}?`, initialValue: false });
  if (confirmed !== true) return;
  saveCalendars(calendars.filter((_, i) => !picked.includes(i)));
  p.log.success(`Removed ${count}.`);
}

/** Resolves to the calendar ID, or null if the user backed out. */
async function promptCalendarId(others: CalendarConfig[], initialValue?: string): Promise<string | null> {
  const input = await p.text({
    message: 'Calendar ID',
    placeholder: 'something@group.calendar.google.com',
    initialValue,
    validate: (value) => {
      const id = parseCalendarId(value ?? '');
      if (!id) return "That doesn't look like a calendar ID (something@group.calendar.google.com) or a calendar link.";
      if (others.some((c) => c.id === id)) return 'That calendar is already in the list.';
      return undefined;
    },
  });
  if (p.isCancel(input)) return null;

  const id = parseCalendarId(input)!;
  if (id !== input.trim()) p.log.info(`Using calendar ID ${id}`);
  return id;
}

/** Resolves to the trimmed name, or null if the user backed out. */
async function promptName(others: CalendarConfig[], initialValue?: string): Promise<string | null> {
  const input = await p.text({
    message: 'Name (shown after each event title, e.g. "Essay due (English)")',
    placeholder: 'English',
    initialValue,
    validate: (value) => {
      const name = value?.trim() ?? '';
      if (!name) return 'Give it a name.';
      if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        return 'Another classroom already has that name.';
      }
      return undefined;
    },
  });
  return p.isCancel(input) ? null : input.trim();
}

/**
 * Accepts a bare calendar ID, or a Google Calendar link that carries one:
 * an embed/public URL (`?src=<id>`), an "add calendar" share link
 * (`?cid=<id, usually base64-encoded>`), or an iCal feed address
 * (`/calendar/ical/<id>/...`). Returns null if nothing ID-shaped is found.
 */
export function parseCalendarId(input: string): string | null {
  let id = input.trim();
  if (/^https?:\/\//i.test(id)) {
    let url: URL;
    try {
      url = new URL(id);
    } catch {
      return null;
    }
    const cid = url.searchParams.get('cid');
    const icalPath = url.pathname.match(/\/ical\/([^/]+)\//)?.[1];
    id =
      url.searchParams.get('src') ??
      (icalPath && decodeURIComponent(icalPath)) ??
      (cid && (cid.includes('@') ? cid : Buffer.from(cid, 'base64').toString('utf8'))) ??
      '';
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) ? id : null;
}

// --- GitHub token ---------------------------------------------------------

async function manageToken(): Promise<void> {
  if (process.env.GIST_TOKEN) {
    p.log.warn('GIST_TOKEN is set in your environment; it takes priority over a token saved here.');
  }

  for (;;) {
    const saved = loadSettings().gistToken;
    const choice = await p.select({
      message: saved ? `GitHub Gist token (saved, ends in ${saved.slice(-4)})` : 'GitHub Gist token (none saved)',
      options: [
        { value: 'set', label: saved ? 'Replace the token' : 'Save a token' },
        ...(saved ? [{ value: 'check', label: 'Check the token' }, { value: 'remove', label: 'Remove the token' }] : []),
        { value: 'help', label: 'How do I create one?' },
        { value: BACK, label: '← Back' },
      ],
    });
    if (p.isCancel(choice) || choice === BACK) return;

    if (choice === 'help') {
      showTokenHelp();
    } else if (choice === 'check') {
      await reportTokenOwner(saved!);
    } else if (choice === 'remove') {
      updateSettings({ gistToken: undefined });
      p.log.success('Token removed.');
      return;
    } else if (await saveToken()) {
      return;
    }
  }
}

async function saveToken(): Promise<boolean> {
  const input = await p.password({
    message: 'Paste your GitHub token',
    validate: (value) => {
      const token = value?.trim() ?? '';
      if (!token) return 'Paste the token, or press Esc to go back.';
      if (/\s/.test(token)) return "Tokens don't contain spaces.";
      return undefined;
    },
  });
  if (p.isCancel(input)) return false;
  const token = input.trim();

  const owner = await reportTokenOwner(token);
  if (owner === null) {
    const keep = await p.confirm({ message: 'Save it anyway?', initialValue: false });
    if (keep !== true) return false;
  }
  updateSettings({ gistToken: token });
  p.log.success(`Saved to ${SETTINGS_FILE} (readable only by you).`);
  return true;
}

/**
 * Asks GitHub who the token belongs to and says so. Resolves to the
 * login, null if GitHub rejected the token, or undefined if GitHub
 * couldn't be reached (which says nothing about the token).
 */
async function reportTokenOwner(token: string): Promise<string | null | undefined> {
  try {
    const owner = await withSpinner('Checking the token with GitHub', () => checkGistToken(token));
    if (owner) p.log.success(`Token works (GitHub user @${owner}).`);
    else p.log.warn('GitHub rejected that token. It may be mistyped, expired, or revoked.');
    return owner;
  } catch (err) {
    p.log.warn(`Couldn't check the token with GitHub: ${errorMessage(err)}`);
    return undefined;
  }
}

function showTokenHelp(): void {
  p.note(
    [
      '1. github.com → Settings → Developer settings → Personal access tokens',
      '   → Fine-grained tokens → Generate new token',
      "2. Resource owner: you. Repository access doesn't matter.",
      '3. Account permissions → Gists → Read and write',
      '4. Generate it, copy it, and choose "Save a token" here.',
      '',
      'A classic token with only the "gist" scope works too.',
      '',
      'The gist is secret (unlisted), not private: anyone who has',
      'its URL can read it, so treat the URL itself as the secret.',
    ].join('\n'),
    'Creating a GitHub token'
  );
}

// --- Browser --------------------------------------------------------------

async function chooseBrowser(): Promise<void> {
  if (process.env.CLASSROOM_SYNC_BROWSER_CHANNEL) {
    p.log.warn('CLASSROOM_SYNC_BROWSER_CHANNEL is set in your environment and overrides what you pick here.');
  }

  const { browserChannel, browserExecutablePath } = loadSettings();
  const current = browserExecutablePath
    ? `path:${browserExecutablePath}`
    : browserChannel ? `channel:${browserChannel}` : 'bundled';

  const options: p.Option<string>[] = [
    { value: 'bundled', label: "Playwright's bundled Chromium", hint: 'default' },
    ...findOnPath(SYSTEM_BROWSER_NAMES).map((file) => ({
      value: `path:${file}`,
      label: file,
      hint: 'installed on this system; use this on Arch, NixOS, etc.',
    })),
    { value: 'channel:chrome', label: 'Google Chrome', hint: 'installed in its standard location' },
    { value: 'channel:msedge', label: 'Microsoft Edge', hint: 'installed in its standard location' },
    { value: 'other', label: 'Another browser executable…' },
  ];
  // Keep a hand-picked path or channel selectable as the current value.
  if (!options.some((o) => o.value === current)) {
    options.splice(1, 0, { value: current, label: describeBrowser(), hint: 'current' });
  }

  const choice = await p.select({
    message: 'Which browser should classroom-sync drive?',
    options,
    initialValue: current,
  });
  if (p.isCancel(choice)) return;

  let changes: Partial<Settings> = { browserChannel: undefined, browserExecutablePath: undefined };
  if (choice.startsWith('channel:')) {
    changes.browserChannel = choice.slice('channel:'.length);
  } else if (choice.startsWith('path:')) {
    changes.browserExecutablePath = choice.slice('path:'.length);
  } else if (choice === 'other') {
    const file = await p.text({
      message: 'Path to a Chromium-based browser executable',
      placeholder: '/usr/bin/chromium',
      validate: (value) => (isExecutable(value?.trim() ?? '') ? undefined : 'No executable file at that path.'),
    });
    if (p.isCancel(file)) return;
    changes.browserExecutablePath = file.trim();
  }
  updateSettings(changes);

  // Better to find out now than halfway through the next sync.
  try {
    await withSpinner('Checking that it launches', async () => (await launchBrowser(true)).close());
    p.log.success(`Saved. Using ${describeBrowser()}.`);
  } catch (err) {
    p.log.warn(`Saved, but it failed to launch:\n${errorMessage(err)}`);
  }
}

function describeBrowser(): string {
  const { channel, executablePath } = browserLaunchOptions();
  if (process.env.CLASSROOM_SYNC_BROWSER_CHANNEL) return `channel "${channel}" (from env)`;
  if (executablePath) return executablePath;
  if (channel === 'chrome') return 'Google Chrome';
  if (channel === 'msedge') return 'Microsoft Edge';
  if (channel) return `channel "${channel}"`;
  return "Playwright's bundled Chromium";
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** First match on $PATH for each name, skipping aliases of one already found. */
function findOnPath(names: string[]): string[] {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const found = new Map<string, string>(); // real path -> path as found
  for (const name of names) {
    const file = dirs.map((dir) => path.join(dir, name)).find(isExecutable);
    if (!file) continue;
    const real = fs.realpathSync(file);
    if (!found.has(real)) found.set(real, file);
  }
  return [...found.values()];
}

// --- Timezone & months ----------------------------------------------------

async function chooseTimezone(): Promise<void> {
  const current = timezone();
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), current, system])].sort();

  const choice = await p.autocomplete({
    message: "Your school's timezone (type to search)",
    options: zones.map((tz) => ({
      value: tz,
      hint: tz === system ? 'this computer' : tz === DEFAULT_TIMEZONE ? 'default' : undefined,
    })),
    initialValue: current,
    placeholder: current,
    maxItems: 8,
  });
  if (p.isCancel(choice)) return;
  updateSettings({ timezone: choice });
  p.log.success(`Timezone set to ${choice}.`);
}

async function chooseMonths(): Promise<void> {
  const input = await p.text({
    message: 'Months to page through from the current one (negative = earlier, positive = later)',
    initialValue: String(monthsToWalk()),
    validate: (value) => {
      const n = Number(value?.trim());
      return Number.isInteger(n) && Math.abs(n) <= 12 ? undefined : 'Enter a whole number from -12 to 12.';
    },
  });
  if (p.isCancel(input)) return;
  const months = Number(input.trim());
  updateSettings({ monthsToWalk: months });
  p.log.success(`Each sync will scrape ${describeMonths(months)}.`);
}

function describeMonths(n: number): string {
  if (n === 0) return 'this month only';
  return `this month + ${Math.abs(n)} ${n < 0 ? 'before' : 'after'}`;
}

// --- Actions --------------------------------------------------------------

async function loginInteractively(): Promise<void> {
  p.log.step('Opening a browser window. Sign into your SCHOOL Google account there.');
  const saved = await login(async () => {
    const done = await p.confirm({
      message: 'Signed in and can see your calendar?',
      active: 'Yes, save the session',
      inactive: 'Cancel',
    });
    return done === true;
  });
  if (saved) p.log.success(`Session saved to ${SESSION_FILE}`);
  else p.log.warn('Login cancelled. Nothing was saved.');
}

async function syncNow(): Promise<void> {
  const s = p.spinner();
  let spinning: string | null = null; // message of the running spinner, if any
  const report: SyncReporter = {
    progress(message) {
      if (spinning) s.message(message);
      else s.start(message);
      spinning = message;
    },
    info(message) {
      if (spinning) s.stop(message);
      else p.log.info(message);
      spinning = null;
    },
    warn(message) {
      const resume = spinning;
      if (spinning) s.clear();
      spinning = null;
      p.log.warn(message);
      if (resume) report.progress(resume);
    },
  };

  try {
    const count = await sync(report);
    p.log.success(`Wrote ${plural(count, 'event')} to ${OUTPUT_FILE}`);
  } finally {
    if (spinning) s.clear();
  }
}

async function publishNow(): Promise<void> {
  const url = await withSpinner('Publishing classroom.ics to your GitHub Gist', syncGist);
  p.note(
    `${url}\n\nSubscribe to this URL in your calendar app. It always\n` +
    'serves the latest publish. Anyone who has it can read it.',
    'Published'
  );
}

// --- Helpers --------------------------------------------------------------

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const s = p.spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (err) {
    s.error(message);
    throw err;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ago(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
