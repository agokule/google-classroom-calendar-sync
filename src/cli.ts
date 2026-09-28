#!/usr/bin/env node
import { UserError } from './errors.js';
import { runSyncGist } from './github-gist.js';
import { runLogin } from './session.js';
import { runSync } from './sync.js';
import { runTui } from './tui.js';

const USAGE = `classroom-sync — sync Google Classroom due dates to a local .ics file

Usage:
  classroom-sync config      Interactive setup: classrooms, GitHub token, browser, timezone, ...
  classroom-sync login       Log into your school Google account and save the session
  classroom-sync run         Scrape your Classroom calendars and write classroom.ics
  classroom-sync sync-gist   Publish the current classroom.ics to a GitHub Gist

Config lives in ~/.classroom-sync/ (session, calendars.json, settings.json, output).
`;

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'config') {
    await runTui();
    process.exit(0);
  } else if (command === 'login') {
    await runLogin();
    process.exit(0);
  } else if (command === 'run') {
    await runSync();
    process.exit(0);
  } else if (command === 'sync-gist') {
    await runSyncGist();
    process.exit(0);
  } else {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err instanceof UserError ? err.message : err);
  process.exit(1);
});
