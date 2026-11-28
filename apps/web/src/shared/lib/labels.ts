/** Plain words for stored codes (LLD §12.8: never show a code or "N/A"). */
export const CASE_STATUS_LABEL: Record<string, string> = {
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

/** Lecture number as the course plan shows it: L01, L12. */
export const lectureNo = (position: number) => `L${String(position).padStart(2, '0')}`;
