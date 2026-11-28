import { caseStatusLabel, caseStatusTone } from '@/shared/lib/labels';
import { Pill } from './pill';

/** A case's status in plain words, coloured the same way on every screen (see `caseStatusTone`). */
export function CaseStatusPill({ status }: { status: string | null | undefined }) {
  return <Pill tone={caseStatusTone(status)}>{caseStatusLabel(status)}</Pill>;
}
