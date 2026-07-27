// Logs into your SCHOOL account interactively and saves the
// resulting authenticated session to disk. Nothing here talks to
// Google's OAuth/API layer, so it isn't subject to an
// admin_policy_enforced block — it's the same access your browser
// already has when you're signed in.

import { chromium } from 'playwright';
import { browserChannel, ensureConfigDir, SESSION_FILE } from './config';

export async function runLogin(): Promise<void> {
  ensureConfigDir();

  const channel = browserChannel();
  const browser = await chromium.launch({ headless: false, channel }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Playwright's own error text for this case names the missing .so files
    // and says as much, but buries the fix at the bottom of a long dump.
    if (/missing dependencies|host system is missing|missing libraries/i.test(message)) {
      console.error('Playwright is installed but missing required OS libraries.');
      console.error('Run `npx playwright install-deps` (may need sudo) and try again.');
      console.error('');
      console.error("If that fails or you're on a Linux distro Playwright doesn't officially");
      console.error("support (Arch, NixOS, etc.), `install-deps` has nothing to install there.");
      console.error('Install your distro\'s own Chromium instead and point this tool at it:');
      console.error('  sudo pacman -S chromium   # or your distro\'s equivalent package');
      console.error('  export CLASSROOM_SYNC_BROWSER_CHANNEL=chromium');
      console.error('then run `classroom-sync login` again.');
      process.exit(1);
    }
    throw err;
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://calendar.google.com');

  console.log('Log into your SCHOOL account in the opened window.');
  console.log('Once you can see your calendar, come back here and press Enter.');
  await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));

  await context.storageState({ path: SESSION_FILE });
  console.log('Session saved to', SESSION_FILE);
  await browser.close();
}
