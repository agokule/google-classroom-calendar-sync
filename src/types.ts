// Shared shapes used across the sync scripts.

export interface CalendarConfig {
  id: string;
  name: string;
}

// Contents of ~/.classroom-sync/settings.json. Every field is optional;
// config.ts supplies the defaults and any env var overrides.
export interface Settings {
  gistToken?: string;
  browserChannel?: string; // Playwright `channel`, e.g. "chrome" or "msedge"
  browserExecutablePath?: string; // a Chromium-based browser binary, e.g. /usr/bin/chromium
  timezone?: string; // IANA zone the calendar embed renders in
  monthsToWalk?: number;
}

export interface ParsedDate {
  date: Date;
  endDate: Date;
  isAllDay: boolean;
  timeLabel: string | null;
}

export interface ScrapedEvent extends ParsedDate {
  uid: string;
  title: string;
  calName: string;
}
