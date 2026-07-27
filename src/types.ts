// Shared shapes used across the sync scripts.

export interface CalendarConfig {
  id: string;
  name: string;
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
