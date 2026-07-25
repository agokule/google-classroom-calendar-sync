// fetch-ics.js
//
// Loads each class's Classroom calendar in the month-grid embed view
// (authenticated via the session saved by save-session.js) and reads
// real event chips out of the DOM. The selectors below are copied
// directly from the HTML you sent over (data-eventchip, data-eventid,
// .WBi6vc for title, .XuJrye for the full tooltip text) — not guessed.
//
// Usage: node fetch-ics.js

const { chromium } = require('playwright');
const fs = require('fs');
const { publishToGist } = require('./github-gist');

const CALENDARS_FILE = './calendars.json';
let CALENDARS;
try {
  CALENDARS = JSON.parse(fs.readFileSync(CALENDARS_FILE, 'utf8'));
} catch (err) {
  console.error(`Couldn't read ${CALENDARS_FILE}${err.code === 'ENOENT' ? ' (not found)' : ': ' + err.message}.`);
  console.error('Copy calendars.example.json to calendars.json and fill in your real calendar IDs.');
  process.exit(1);
}

const TIMEZONE = 'America/Toronto';
const OUTPUT_FILE = './classroom.ics';
const DEBUG_DIR = './debug';

// Months to page through from whichever month loads by default
// (today's). Negative = click back, positive = click forward. Every
// month visited along the way gets scraped and merged in, so -1
// scrapes today's month AND the one before it.
//
// Set to -1 for now to reach June 2026, since that's the last month
// with real data before summer break. Once school's back in session,
// change this to something like +2 for a real look-ahead window.
const MONTHS_TO_WALK = -6;

// Both confirmed by inspecting your real page (right-click > Inspect
// on each arrow) — span[2] is back, span[3] is forward.
const BACK_BUTTON_XPATH =
  'xpath=/html/body/c-wiz/div/header/div/div[1]/nav/div[1]/span[2]/button';
const FORWARD_BUTTON_XPATH =
  'xpath=/html/body/c-wiz/div/header/div/div[1]/nav/div[1]/span[3]/button';

const MONTH_INDEX = {};
['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  .forEach((abbr, i) => { MONTH_INDEX[abbr] = i; });

// Matches "June 3, 2026" as well as multi-day ranges like
// "June 22 – 24, 2026" or "June 30 – July 2, 2026" — Google renders a
// multi-day event as one chip per day it spans, and every one of those
// chips carries this same full-range text, not a per-day date.
const MONTHS_PATTERN = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December';
const DATE_RANGE_RE = new RegExp(
  `(${MONTHS_PATTERN})[a-z]*\\.?\\s+(\\d{1,2})` +
  `(?:\\s*[\\u2013-]\\s*(?:(${MONTHS_PATTERN})[a-z]*\\.?\\s+)?(\\d{1,2}))?` +
  `,\\s*(\\d{4})`,
  'i'
);

function baseUrl(calendarId) {
  const params = new URLSearchParams({ src: calendarId, ctz: TIMEZONE });
  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

async function clickBack(page) {
  await page.locator(BACK_BUTTON_XPATH).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

async function clickForward(page) {
  await page.locator(FORWARD_BUTTON_XPATH).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

function parseEventTooltip(tooltipText) {
  const isAllDay = /^\s*All day\b/i.test(tooltipText);
  const m = tooltipText.match(DATE_RANGE_RE);
  if (!m) return null;

  const [, startMonthTxt, startDayTxt, endMonthTxt, endDayTxt, yearTxt] = m;
  const startKey = startMonthTxt.slice(0, 3).toLowerCase();
  if (!(startKey in MONTH_INDEX)) return null;
  const year = parseInt(yearTxt, 10);

  const date = new Date(year, MONTH_INDEX[startKey], parseInt(startDayTxt, 10));
  let endDate = date;

  if (endDayTxt) {
    const endKey = (endMonthTxt || startMonthTxt).slice(0, 3).toLowerCase();
    if (!(endKey in MONTH_INDEX)) return null;
    endDate = new Date(year, MONTH_INDEX[endKey], parseInt(endDayTxt, 10));
    // "Dec 30 – Jan 2, 2027": the trailing year belongs to the END date;
    // walk the start back a year if the end month is earlier than the start.
    if (MONTH_INDEX[endKey] < MONTH_INDEX[startKey]) date.setFullYear(year - 1);
  }

  let timeLabel = null;
  if (!isAllDay && !endDayTxt) {
    const timeMatch = tooltipText.match(/^\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s+to\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
    if (timeMatch) timeLabel = `${timeMatch[1]}-${timeMatch[2]}`;
  }

  return { date, endDate, isAllDay, timeLabel };
}

async function scrapeVisibleMonth(page, cal, seenUids) {
  const chips = page.locator('[data-eventchip]');
  // Give a busy day's chips a moment to finish rendering before reading
  // them — a likely culprit for the one event that went missing on a
  // 2-event day was a timing race, not a structural difference.
  await page.waitForTimeout(400);
  const count = await chips.count();
  const events = [];
  const missed = [];

  for (let i = 0; i < count; i++) {
    const chip = chips.nth(i);
    const eventId = await chip.getAttribute('data-eventid').catch(() => null);
    const uid = (eventId || `${cal.name}-${i}-${Date.now()}`) + '@classroom-sync';
    if (seenUids.has(uid)) continue; // already picked up in a previously-scraped month

    const title = await chip.locator('.WBi6vc').first().innerText({ timeout: 4000 }).catch(() => null);
    const tooltip = await chip.locator('.XuJrye').first().innerText({ timeout: 4000 }).catch(() => null);
    if (!title || !tooltip) {
      missed.push(uid);
      continue;
    }

    const parsed = parseEventTooltip(tooltip);
    if (!parsed) continue;

    seenUids.add(uid);
    events.push({ uid, title: title.trim(), calName: cal.name, ...parsed });
  }

  if (missed.length) {
    console.warn(`${cal.name}: ${missed.length} chip(s) found but couldn't be read (title/tooltip lookup failed) \u2014 check debug/*.html if events still look missing`);
  }

  return events;
}

function pad(n) { return String(n).padStart(2, '0'); }
function toICSDate(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function escapeICS(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function eventsToICS(allEvents) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//classroom-scrape-sync//EN', 'X-WR-CALNAME:Classroom'];
  allEvents.forEach((e) => {
    const summary = e.title + ' (' + e.calName + ')' + (e.timeLabel ? ' [' + e.timeLabel + ']' : '');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + e.uid);
    lines.push('DTSTART;VALUE=DATE:' + toICSDate(e.date));
    lines.push('DTEND;VALUE=DATE:' + toICSDate(addDays(e.endDate, 1)));
    lines.push('SUMMARY:' + escapeICS(summary));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function walkAndScrape(page, cal) {
  const seenUids = new Set();
  const all = [];
  const steps = Math.abs(MONTHS_TO_WALK);
  const step = MONTHS_TO_WALK < 0 ? clickBack : clickForward;

  await page.goto(baseUrl(cal.id), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  all.push(...(await scrapeVisibleMonth(page, cal, seenUids)));

  for (let i = 0; i < steps; i++) {
    await step(page);
    all.push(...(await scrapeVisibleMonth(page, cal, seenUids)));
  }

  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const safeName = cal.name.replace(/\W+/g, '_');
  fs.writeFileSync(`${DEBUG_DIR}/${safeName}.html`, await page.content());

  return all;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: 'school-session.json' });
  const page = await context.newPage();

  const all = [];
  for (const cal of CALENDARS) {
    const events = await walkAndScrape(page, cal);
    console.log(`${cal.name}: ${events.length} event(s) across ${Math.abs(MONTHS_TO_WALK) + 1} month(s)`);
    all.push(...events);
  }

  await browser.close();

  if (all.length === 0) {
    console.error('');
    console.error('No events scraped. Check debug/*.html \u2014 likely either the session');
    console.error('expired (re-run save-session.js) or a selector needs adjusting.');
    process.exit(1);
  }

  const ics = eventsToICS(all);
  fs.writeFileSync(OUTPUT_FILE, ics);
  console.log('');
  console.log('Wrote', all.length, 'events to', OUTPUT_FILE);

  // Optional: only runs if GIST_TOKEN is set in the environment. See
  // github-gist.js for what this needs and why.
  const url = await publishToGist(ics).catch((err) => {
    console.error('Gist publish failed:', err.message);
    return null;
  });
  if (url) console.log('Published to:', url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
