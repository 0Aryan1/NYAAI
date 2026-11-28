/** Plain words for stored codes (LLD §12.8: never show a code or "N/A"). */
const CASE_STATUS_LABEL: Record<string, string> = {
  not_verified: 'Status not verified',
  good_law: 'Still good law',
  followed: 'Followed',
  distinguished: 'Distinguished',
  doubted: 'Doubted',
  overruled: 'Overruled',
  reversed: 'Reversed',
};
export const caseStatusLabel = (s: string | null | undefined) =>
  s ? (CASE_STATUS_LABEL[s] ?? s) : CASE_STATUS_LABEL.not_verified!;

/** A later bench overruled or reversed it: a line resting on it is wrong law. */
export const isAdverseStatus = (s: string | null | undefined) => s === 'overruled' || s === 'reversed';

/**
 * How a case's status looks, everywhere it shows: grey until a law expert has checked it, yellow when it is no longer
 * good law, blue (coverage) when a later bench doubted it, green otherwise. Read from the status code, never the label.
 */
export const caseStatusTone = (s: string | null | undefined): 'grey' | 'yellow' | 'coverage' | 'success' =>
  !s || s === 'not_verified' ? 'grey' : isAdverseStatus(s) ? 'yellow' : s === 'doubted' ? 'coverage' : 'success';

/** Lecture number as the course plan shows it: L01, L12 (one definition, in @nyaai/shared). */
export { lectureNo } from '@nyaai/shared';
