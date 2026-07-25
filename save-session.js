// save-session.js
//
// Run this once (and again whenever the session eventually expires)
// to log into your SCHOOL account interactively and save the
// resulting authenticated session to disk. Nothing here talks to
// Google's OAuth/API layer, so it isn't subject to the
// admin_policy_enforced block — it's the same access your browser
// already has when you're signed in.
//
// Usage: node save-session.js

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://calendar.google.com');

  console.log('Log into your SCHOOL account in the opened window.');
  console.log('Once you can see your calendar, come back here and press Enter.');
  await new Promise((resolve) => process.stdin.once('data', resolve));

  await context.storageState({ path: 'school-session.json' });
  console.log('Session saved to school-session.json');
  await browser.close();
  process.exit(0);
})();
