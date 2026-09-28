// Launches Chromium with whichever browser the user picked (Playwright's
// bundled build by default — see browserLaunchOptions in config.ts).

import { chromium, type Browser } from 'playwright';
import { browserLaunchOptions } from './config.js';
import { UserError } from './errors.js';

export async function launchBrowser(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless, ...browserLaunchOptions() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Playwright's own error text for this case names the missing .so files
    // and says as much, but buries the fix at the bottom of a long dump.
    if (/missing dependencies|host system is missing|missing libraries/i.test(message)) {
      throw new UserError([
        'Playwright is installed but missing required OS libraries.',
        'Run `npx playwright install-deps` (may need sudo) and try again.',
        '',
        "If that fails or you're on a Linux distro Playwright doesn't officially",
        'support (Arch, NixOS, etc.), `install-deps` has nothing to install there.',
        "Install your distro's own Chromium instead and point this tool at it:",
        "  sudo pacman -S chromium   # or your distro's equivalent package",
        '  classroom-sync config     # then Browser → /usr/bin/chromium',
      ].join('\n'));
    }
    throw err;
  }
}
