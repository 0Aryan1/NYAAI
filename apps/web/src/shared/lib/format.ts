/**
 * Dates and times as the teachers read them: Indian English, in India time, whatever the browser's own zone (a
 * teacher on a trip still sees the class's day). One place, so every screen writes "28 Nov 2026" the same way.
 */
const ZONE = 'Asia/Kolkata';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: ZONE, ...opts });
const DATE = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const SHORT_DATE = fmt({ day: 'numeric', month: 'short' });
const DATE_TIME = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TIME = fmt({ hour: 'numeric', minute: '2-digit' });

/** A stored date or timestamp as a Date, or null when it is missing or not a date (a provider's free text). */
function parse(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "28 Nov 2026". Text that is not a date is shown as it came; nothing gives "". */
export const formatDate = (value: string | null | undefined) => {
  const d = parse(value);
  return d ? DATE.format(d) : (value ?? '');
};

/** "28 Nov", for lists within the year. */
export const formatShortDate = (value: string | null | undefined) => {
  const d = parse(value);
  return d ? SHORT_DATE.format(d) : (value ?? '');
};

/** "28 Nov, 03:45 pm", for events within the last days. */
export const formatDateTime = (value: string | null | undefined) => {
  const d = parse(value);
  return d ? DATE_TIME.format(d) : (value ?? '');
};

/** "3:45 pm". */
export const formatTime = (value: string | number) => {
  const d = parse(value);
  return d ? TIME.format(d) : '';
};

/** Today in India, as YYYY-MM-DD (the value of a date field). */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now,
  );
}
