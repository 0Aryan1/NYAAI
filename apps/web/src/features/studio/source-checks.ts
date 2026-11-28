/**
 * The checks a line passed, as the source drawer lists them (LLD §12.8): plain names, no skipped checks, and the
 * case-status check (C8) read live. An expert's later finding on the case replaces what the line was built with,
 * so a line built on "status not verified" shows "passed" once the case is confirmed good law, and "failed" once
 * it is found overruled.
 */
import type { CitationSource } from '@nyaai/shared';
import { caseStatusLabel, isAdverseStatus } from '@/shared/lib/labels';

/** Plain names for the ten checks (no AI terms, LLD §12.8). */
export const CHECK_NAMES: Record<string, string> = {
  C1: 'Source supplied',
  C2: 'Words found in the source',
  C3: 'Names, years and sections match',
  C4: 'Quotations exact',
  C5: 'Old and new law link confirmed',
  C6: 'Right kind of source',
  C7: "Court's majority reasoning",
  C8: 'Case status',
  C9: 'Source supports the line',
  C10: 'Second check',
};

type Check = CitationSource['checks'][number];

export function shownChecks(checks: readonly Check[], liveStatus: string | null): Check[] {
  return checks
    .filter((c) => c.result !== 'skipped')
    .map((c) =>
      c.name === 'C8' && liveStatus && liveStatus !== 'not_verified'
        ? { ...c, result: isAdverseStatus(liveStatus) ? 'fail' : 'pass', detail: caseStatusLabel(liveStatus) }
        : c,
    );
}
