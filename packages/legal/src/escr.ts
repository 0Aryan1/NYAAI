/**
 * Supreme Court Reports (e-SCR) records (pure). The Supreme Court's e-SCR is the official law report; its search page
 * needs a captcha, so the loader reads the same PDFs and their catalogue from a public mirror of e-SCR (see
 * services/escr). Here: choosing the record that is the named case, and naming it.
 */
import { casePartyWords, pickCaseHit, type CaseHit } from './gaps.ts';

export interface EscrRecord {
  /** "ASSOCIATE BUILDERS versus DELHI DEVELOPMENT AUTHORITY" */
  title: string;
  /** "[2014] 13 S.C.R. 895" */
  citation: string | null;
  /** Neutral citation, "2014 INSC 809". */
  neutralCitation: string | null;
  /** ISO date, from e-SCR's "25-11-2014". */
  decidedOn: string | null;
  /** e-SCR file key, "2014_13_895_956" (year, volume, first page, last page). */
  path: string;
  /** The mirror's year folder for the file. */
  year: string;
  judges: string | null;
  /** English text available ("ENG" listed, or nothing listed). */
  english: boolean;
}

/** "25-11-2014" → "2014-11-25". */
export function escrDate(d: string | null | undefined): string | null {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d?.trim() ?? '');
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

/** Pages in the report, from the file key's first and last page: the judgment is longer than a later order. */
export function escrPages(path: string): number {
  const m = /_(\d+)_(\d+)$/.exec(path);
  return m ? Math.max(1, Number(m[2]) - Number(m[1]) + 1) : 1;
}

/** "COX AND KINGS LTD. versus SAP INDIA PVT. LTD. & ANR." → "COX AND KINGS LTD. v. SAP INDIA PVT. LTD. & ANR." */
export function escrCaseName(title: string): string {
  return title.replace(/\s+versus\s+/i, ' v. ').replace(/\s+/g, ' ').trim();
}

/**
 * The e-SCR record that is the named case: party words must match (or every one of `titleWords`), the decision year
 * breaks ties, then the longer report (a later order in the same matter is short).
 */
export function pickEscrRecord(caseName: string, records: EscrRecord[], opts: { year?: number | null; titleWords?: string[] } = {}): EscrRecord | null {
  const hits = records
    .filter((r) => r.english)
    .map((r) => ({ title: escrCaseName(r.title), publishdate: r.decidedOn, docsource: 'Supreme Court of India', docsize: escrPages(r.path), r }) satisfies CaseHit & { r: EscrRecord });
  return pickCaseHit(caseName, hits, { year: opts.year, court: 'SC', titleWords: opts.titleWords })?.r ?? null;
}

/**
 * Second chance when the names are spelt differently (Indian Kanoon's "Vidaya Devi", "Hyaliram Jagannath"): the one
 * record decided on the same day whose title has a distinctive word of either party. Two or more such records → none.
 */
export function pickEscrByDate(caseName: string, records: EscrRecord[], decidedOn: string): EscrRecord | null {
  const words = casePartyWords(caseName).filter((w): w is string => !!w);
  if (!words.length) return null;
  const hits = records.filter(
    (r) => r.english && r.decidedOn === decidedOn && words.some((w) => new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`).test(r.title.toLowerCase())),
  );
  return hits.length === 1 ? hits[0]! : null;
}
