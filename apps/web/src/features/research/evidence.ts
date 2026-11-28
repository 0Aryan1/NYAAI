/**
 * A research brief's evidence table and its export (RES-3 to RES-5), without the screen: how a row's status is
 * coloured, the orders she can sort it in, and saving the brief as Word or PDF (made by the server from the brief as
 * checked; lines to verify are marked in the file).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { EvidenceRow } from '@nyaai/shared';
import { api } from '@/shared/api/client';
import { errorText } from '@/shared/lib/errors';
import { caseStatusTone } from '@/shared/lib/labels';
import { saveFile } from '@/shared/lib/save-file';

/** A case is coloured by its status code like everywhere else; an Act by its law status (repealed = yellow). */
export const evidenceTone = (e: EvidenceRow) =>
  e.caseStatus
    ? caseStatusTone(e.caseStatus)
    : e.statusLabel === 'Repealed'
      ? 'yellow'
      : e.statusLabel === 'Status not verified'
        ? 'grey'
        : 'success';

export type EvidenceSort = 'order' | 'relation' | 'court' | 'date';

/** The rows in her chosen order: as the questions found them, by how they relate, by court, or newest first. */
export function sortEvidence(rows: readonly EvidenceRow[], sort: EvidenceSort): EvidenceRow[] {
  const out = [...rows];
  if (sort === 'relation') out.sort((a, b) => a.relation.localeCompare(b.relation));
  if (sort === 'court') out.sort((a, b) => (a.court ?? '').localeCompare(b.court ?? ''));
  if (sort === 'date') out.sort((a, b) => (b.decidedOn ?? '').localeCompare(a.decidedOn ?? ''));
  return out;
}

/** Save the brief as Word or PDF. `exporting` is the format being made; `note` says what was saved or what failed. */
export function useBriefExport(runId: string) {
  const [note, setNote] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (format: 'docx' | 'pdf') => api.exportBrief(runId, format),
    onMutate: () => setNote(null),
    onSuccess: (r) => {
      saveFile(r.blob, r.fileName);
      setNote(
        r.toVerify
          ? `Saved ${r.fileName}. ${r.toVerify} ${r.toVerify === 1 ? 'line is' : 'lines are'} marked “Please verify” in it.`
          : `Saved ${r.fileName}.`,
      );
    },
    onError: (err) => setNote(errorText(err, 'The file could not be made. Try again.')),
  });
  return { exportAs: m.mutate, exporting: m.isPending ? m.variables : null, note };
}
