// Logs into your SCHOOL account interactively and saves the
// resulting authenticated session to disk. Nothing here talks to
// Google's OAuth/API layer, so it isn't subject to an
// admin_policy_enforced block — it's the same access your browser
// already has when you're signed in.

import * as readline from 'node:readline/promises';
import { launchBrowser } from './browser.js';
import { ensureConfigDir, SESSION_FILE } from './config.js';

/**
 * Opens a visible browser at Google Calendar and waits for
 * `confirmSignedIn` — resolving true saves the session, false abandons
 * the login without touching the previously saved one. Returns whether
 * the session was saved.
 */
export async function login(confirmSignedIn: () => Promise<boolean>): Promise<boolean> {
  ensureConfigDir();

  const browser = await launchBrowser(false);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://calendar.google.com');

    if (!(await confirmSignedIn())) return false;
    await context.storageState({ path: SESSION_FILE });
    return true;
  } finally {
    await browser.close();
  }
}

export async function runLogin(): Promise<void> {
  await login(async () => {
    console.log('Log into your SCHOOL account in the opened window.');
    console.log('Once you can see your calendar, come back here and press Enter.');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('');
    rl.close();
    return true;
  });
  console.log('Session saved to', SESSION_FILE);
}
