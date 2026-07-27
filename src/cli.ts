#!/usr/bin/env node
import { runLogin } from './session';
import { runSync } from './sync';
import { runSyncGist } from './github-gist';

const USAGE = `classroom-sync — sync Google Classroom due dates to a local .ics file

Usage:
  classroom-sync login       Log into your school Google account and save the session
  classroom-sync run         Scrape your Classroom calendars and write classroom.ics
  classroom-sync sync-gist   Publish the current classroom.ics to a GitHub Gist (needs GIST_TOKEN)

Config lives in ~/.classroom-sync/ (session, calendars.json, output).
`;

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'login') {
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
  console.error(err);
  process.exit(1);
});

