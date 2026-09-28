// Shared paths for the tool's persistent state, stored under a
// dotfile directory in the user's home — the same pattern tools like
// `gh` or `aws` use — so it works the same whether you run this via
// `npm run sync` in a clone or `classroom-sync run` after a global
// install, regardless of which directory you happen to be in.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UserError } from './errors.js';
import type { CalendarConfig, Settings } from './types.js';

export const CONFIG_DIR = path.join(os.homedir(), '.classroom-sync');
export const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
export const CALENDARS_FILE = path.join(CONFIG_DIR, 'calendars.json');
export const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
export const GIST_ID_FILE = path.join(CONFIG_DIR, '.gist-id');
export const OUTPUT_FILE = path.join(CONFIG_DIR, 'classroom.ics');
export const DEBUG_DIR = path.join(CONFIG_DIR, 'debug');

export const DEFAULT_TIMEZONE = 'America/Toronto';

// Months to page through from whichever month the calendar loads on
// (today's). Negative = click back, positive = click forward. Every
// month visited along the way gets scraped and merged in, so -1
// scrapes today's month AND the one before it.
export const DEFAULT_MONTHS_TO_WALK = -1;

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UserError(`${file} isn't valid JSON (${message}). Fix or delete it and try again.`);
  }
}

/** The configured classrooms, or [] if calendars.json doesn't exist yet. */
export function loadCalendars(): CalendarConfig[] {
  const data = readJson(CALENDARS_FILE);
  if (data === undefined) return [];
  const valid = Array.isArray(data) && data.every(
    (c) => typeof c?.id === 'string' && typeof c?.name === 'string'
  );
  if (!valid) {
    throw new UserError(`${CALENDARS_FILE} should be a list of { "id": "...", "name": "..." } entries.`);
  }
  return (data as CalendarConfig[]).map(({ id, name }) => ({ id, name }));
}

export function saveCalendars(calendars: CalendarConfig[]): void {
  ensureConfigDir();
  fs.writeFileSync(CALENDARS_FILE, JSON.stringify(calendars, null, 2) + '\n');
}

export function loadSettings(): Settings {
  const data = readJson(SETTINGS_FILE);
  if (data === undefined) return {};
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new UserError(`${SETTINGS_FILE} should contain a JSON object.`);
  }
  return data as Settings;
}

export function saveSettings(settings: Settings): void {
  ensureConfigDir();
  // May hold the GitHub token, so keep it owner-only. `mode` only applies
  // when the file is created, hence the explicit chmod for existing files.
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(SETTINGS_FILE, 0o600);
}

export function updateSettings(changes: Partial<Settings>): void {
  saveSettings({ ...loadSettings(), ...changes });
}

/** GIST_TOKEN in the environment wins over the token saved in settings. */
export function gistToken(): { token: string; source: 'env' | 'settings' } | null {
  if (process.env.GIST_TOKEN) return { token: process.env.GIST_TOKEN, source: 'env' };
  const { gistToken } = loadSettings();
  return gistToken ? { token: gistToken, source: 'settings' } : null;
}

/**
 * Playwright's bundled Chromium + `playwright install-deps` only cover
 * officially supported distros (Debian/Ubuntu/Fedora family). On anything
 * else (Arch, NixOS, ...) `install-deps` has nothing to install and the
 * bundled binary just fails to launch with missing .so errors. The
 * workaround is to launch a distro-packaged browser instead, which pulls
 * in its own correct shared libraries through the normal package manager.
 *
 * That has to be an `executablePath` (e.g. /usr/bin/chromium): Playwright's
 * `channel` option only knows its own downloaded builds ("chromium" is
 * Playwright's full Chromium build, not the system one) and branded
 * installs at their standard locations ("chrome", "msedge"). The
 * CLASSROOM_SYNC_BROWSER_CHANNEL env var predates the settings file and
 * still overrides it.
 */
export function browserLaunchOptions(): { channel?: string; executablePath?: string } {
  const envChannel = process.env.CLASSROOM_SYNC_BROWSER_CHANNEL;
  if (envChannel) return { channel: envChannel };
  const { browserChannel, browserExecutablePath } = loadSettings();
  return { channel: browserChannel, executablePath: browserExecutablePath };
}

export function timezone(): string {
  return loadSettings().timezone ?? DEFAULT_TIMEZONE;
}

export function monthsToWalk(): number {
  return loadSettings().monthsToWalk ?? DEFAULT_MONTHS_TO_WALK;
}
