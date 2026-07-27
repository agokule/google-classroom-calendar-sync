// Shared paths for the tool's persistent state, stored under a
// dotfile directory in the user's home — the same pattern tools like
// `gh` or `aws` use — so it works the same whether you run this via
// `npm run sync` in a clone or `classroom-sync run` after a global
// install, regardless of which directory you happen to be in.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CONFIG_DIR = path.join(os.homedir(), '.classroom-sync');
export const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
export const CALENDARS_FILE = path.join(CONFIG_DIR, 'calendars.json');
export const GIST_ID_FILE = path.join(CONFIG_DIR, '.gist-id');
export const OUTPUT_FILE = path.join(CONFIG_DIR, 'classroom.ics');
export const DEBUG_DIR = path.join(CONFIG_DIR, 'debug');

const CALENDARS_TEMPLATE = `[
  { "id": "REPLACE_WITH_CALENDAR_ID_1@group.calendar.google.com", "name": "Class1" },
  { "id": "REPLACE_WITH_CALENDAR_ID_2@group.calendar.google.com", "name": "Class2" }
]
`;

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * Playwright's bundled Chromium + `playwright install-deps` only cover
 * officially supported distros (Debian/Ubuntu/Fedora family). On anything
 * else (Arch, NixOS, ...) `install-deps` has nothing to install and the
 * bundled binary just fails to launch with missing .so errors. The
 * workaround is to launch the distro's own Chromium/Chrome package
 * instead of Playwright's bundled build - Playwright supports this via
 * the `channel` launch option, and a distro-packaged browser pulls in its
 * own correct shared libraries through the normal package manager.
 * Setting this env var opts into that path, e.g.
 * CLASSROOM_SYNC_BROWSER_CHANNEL=chromium after `pacman -S chromium`.
 */
export function browserChannel(): string | undefined {
  return process.env.CLASSROOM_SYNC_BROWSER_CHANNEL;
}

/**
 * Returns true if calendars.json already existed. If it didn't,
 * writes the template and returns false — callers should treat false
 * as "stop and tell the user to edit it first."
 */
export function ensureCalendarsFile(): boolean {
  ensureConfigDir();
  if (fs.existsSync(CALENDARS_FILE)) return true;
  fs.writeFileSync(CALENDARS_FILE, CALENDARS_TEMPLATE);
  return false;
}
