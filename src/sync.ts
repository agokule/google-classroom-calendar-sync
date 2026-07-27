// Loads each class's Classroom calendar in the month-grid embed view
// (authenticated via the session saved by `classroom-sync login`) and
// reads real event chips out of the DOM. The selectors below are
// copied directly from the real page HTML (data-eventchip,
// data-eventid, .WBi6vc for title, .XuJrye for the full tooltip
// text) — not guessed.

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import { publishToGist } from './github-gist';
import {
  CALENDARS_FILE,
  DEBUG_DIR,
  OUTPUT_FILE,
  SESSION_FILE,
  ensureCalendarsFile,
  ensureConfigDir,
} from './config';
import type { CalendarConfig, ParsedDate, ScrapedEvent } from './types';

const TIMEZONE = 'America/Toronto';

// Months to page through from whichever month loads by default
// (today's). Negative = click back, positive = click forward. Every
// month visited along the way gets scraped and merged in, so -1
// scrapes today's month AND the one before it.
const MONTHS_TO_WALK = -1;

// Both confirmed by inspecting the real page (right-click > Inspect
// on each arrow) — span[2] is back, span[3] is forward.
const BACK_BUTTON_XPATH =
  'xpath=/html/body/c-wiz/div/header/div/div[1]/nav/div[1]/span[2]/button';
const FORWARD_BUTTON_XPATH =
  'xpath=/html/body/c-wiz/div/header/div/div[1]/nav/div[1]/span[3]/button';

const MONTH_INDEX: Record<string, number> = {};
(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const)
  .forEach((abbr, i) => { MONTH_INDEX[abbr] = i; });

// Handles every date shape seen in the real page so far:
//  - "June 3, 2026"                        (single date)
//  - "June 22 – 24, 2026"                  (same-month range, year once)
//  - "June 30 – July 2, 2026"              (cross-month range, year once) [defensive, unconfirmed]
//  - "December 21, 2025 – January 4, 2026" (cross-year range, full date both sides) [confirmed real]
const MONTHS_PATTERN = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(
  `(${MONTHS_PATTERN})[a-z]*\\.?\\s+(\\d{1,2})` +  // 1 start month, 2 start day
  `(?:,\\s*(\\d{4}))?` +                            // 3 start year (only when shown explicitly)
  `(?:\\s*[\\u2013-]\\s*` +                         // range separator
  `(?:(${MONTHS_PATTERN})[a-z]*\\.?\\s+)?` +        // 4 end month (only when different from start)
  `(\\d{1,2}))?` +                                  // 5 end day
  `,\\s*(\\d{4})`,                                  // 6 trailing year — always present, belongs to the LAST endpoint mentioned
  'i'
);

function baseUrl(calendarId: string): string {
  const params = new URLSearchParams({ src: calendarId, ctz: TIMEZONE });
  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

async function clickBack(page: Page): Promise<void> {
  await page.locator(BACK_BUTTON_XPATH).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

async function clickForward(page: Page): Promise<void> {
  await page.locator(FORWARD_BUTTON_XPATH).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

function parseEventTooltip(tooltipText: string): ParsedDate | null {
  const isAllDay = /^\s*All day\b/i.test(tooltipText);
  const m = tooltipText.match(DATE_RE);
  if (!m) return null;

  const [, startMonthTxt, startDayTxt, startYearTxt, endMonthTxt, endDayTxt, trailingYearTxt] = m;
  const startKey = startMonthTxt.slice(0, 3).toLowerCase();
  if (!(startKey in MONTH_INDEX)) return null;

  const trailingYear = parseInt(trailingYearTxt, 10);
  const hasRange = endDayTxt !== undefined;
  const endKey = endMonthTxt ? endMonthTxt.slice(0, 3).toLowerCase() : startKey;
  if (!(endKey in MONTH_INDEX)) return null;

  let startYear = startYearTxt ? parseInt(startYearTxt, 10) : trailingYear;
  // Defensive: an unconfirmed format where a year-boundary range shows
  // only the trailing (end) year, e.g. "Dec 30 – Jan 2, 2027" with no
  // year after "30". If the end month rolls back before the start
  // month with no explicit start year, the start must be the prior year.
  if (!startYearTxt && hasRange && MONTH_INDEX[endKey] < MONTH_INDEX[startKey]) {
    startYear -= 1;
  }

  const date = new Date(startYear, MONTH_INDEX[startKey], parseInt(startDayTxt, 10));
  const endDate = hasRange
    ? new Date(trailingYear, MONTH_INDEX[endKey], parseInt(endDayTxt, 10))
    : date;

  let timeLabel: string | null = null;
  if (!isAllDay && !hasRange) {
    const timeMatch = tooltipText.match(/^\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s+to\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
    if (timeMatch) timeLabel = `${timeMatch[1]}-${timeMatch[2]}`;
  }

  return { date, endDate, isAllDay, timeLabel };
}

async function scrapeVisibleMonth(
  page: Page,
  cal: CalendarConfig,
  seenUids: Set<string>
): Promise<ScrapedEvent[]> {
  const chips = page.locator('[data-eventchip]');
  await page.waitForTimeout(400);
  const count = await chips.count();
  const events: ScrapedEvent[] = [];
  const missed: string[] = [];

  for (let i = 0; i < count; i++) {
    const chip = chips.nth(i);
    const eventId = await chip.getAttribute('data-eventid').catch(() => null);
    const uid = (eventId || `${cal.name}-${i}-${Date.now()}`) + '@classroom-sync';
    if (seenUids.has(uid)) continue; // already picked up in a previously-scraped month/page

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

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toICSDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function eventsToICS(allEvents: ScrapedEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//classroom-scrape-sync//EN',
    'X-WR-CALNAME:Classroom',
  ];
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

async function walkAndScrape(page: Page, cal: CalendarConfig): Promise<ScrapedEvent[]> {
  const seenUids = new Set<string>();
  const all: ScrapedEvent[] = [];
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

export async function runSync(): Promise<void> {
  ensureConfigDir();

  if (!fs.existsSync(SESSION_FILE)) {
    console.error(`No saved session found at ${SESSION_FILE}.`);
    console.error('Run `classroom-sync login` first.');
    process.exit(1);
  }

  if (!ensureCalendarsFile()) {
    console.error(`Wrote a template to ${CALENDARS_FILE}.`);
    console.error('Edit it with your real calendar IDs and run this again.');
    process.exit(1);
  }
  const CALENDARS = JSON.parse(fs.readFileSync(CALENDARS_FILE, 'utf8')) as CalendarConfig[];

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  const all: ScrapedEvent[] = [];
  for (const cal of CALENDARS) {
    const events = await walkAndScrape(page, cal);
    console.log(`${cal.name}: ${events.length} event(s) across ${Math.abs(MONTHS_TO_WALK) + 1} month(s)`);
    all.push(...events);
  }

  await browser.close();

  if (all.length === 0) {
    console.error('');
    console.error(`No events scraped. Check ${DEBUG_DIR} \u2014 likely either the session`);
    console.error('expired (run `classroom-sync login` again) or a selector needs adjusting.');
    process.exit(1);
  }

  const ics = eventsToICS(all);
  fs.writeFileSync(OUTPUT_FILE, ics);
  console.log('');
  console.log('Wrote', all.length, 'events to', OUTPUT_FILE);

  const url = await publishToGist(ics).catch((err: unknown) => {
    console.error('Gist publish failed:', err instanceof Error ? err.message : err);
    return null;
  });
  if (url) console.log('Published to:', url);
}
