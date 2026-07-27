// Logs into your SCHOOL account interactively and saves the
// resulting authenticated session to disk. Nothing here talks to
// Google's OAuth/API layer, so it isn't subject to an
// admin_policy_enforced block — it's the same access your browser
// already has when you're signed in.

import { chromium } from 'playwright';
import { ensureConfigDir, SESSION_FILE } from './config';

export async function runLogin(): Promise<void> {
  ensureConfigDir();

  const browser = await chromium.launch({ headless: false });
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
