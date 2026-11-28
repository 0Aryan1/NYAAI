/**
 * Time in India. The college works in Indian time, so "today", a month's budget and a lecture's taught date are all
 * read in IST, whatever the server's own time zone is. Pass `TIMEZONE` to SQL as a parameter (`at time zone $n`).
 */
export const TIMEZONE = 'Asia/Kolkata';

/** Today's date in India, as YYYY-MM-DD (e.g. for a file name). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now);
}
