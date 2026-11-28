/**
 * The library editor's review (LIB-2), without the screen: which judgments still need her, how the list is filtered
 * and counted, the order of a judgment's citations, and the checks that move it to "Done".
 */
import type { ParaRole, ReviewJudgment, ReviewJudgmentList } from '@nyaai/shared';

/** Where a judgment's text came from, in the editor's words. */
export function originLabel(origin: string, scanned: boolean): string {
  const base =
    origin === 'court_site'
      ? 'Official copy'
      : origin === 'upload'
        ? 'Uploaded copy'
        : origin === 'indian_kanoon'
          ? 'Indian Kanoon copy'
          : 'Other copy';
  return scanned ? `${base} (scanned)` : base;
}

/** Paragraph roles in the words a law teacher uses (HLD 5.2 b), with what each one means (the glossary she reads). */
export const ROLES: Record<ParaRole, { label: string; means: string }> = {
  facts: { label: 'Facts', means: 'what happened between the parties' },
  arguments: { label: "Counsel's arguments", means: 'what the lawyers argued' },
  lower_court_summary: { label: "Lower court's view", means: 'what an earlier court decided' },
  discussion: { label: "Court's reasoning", means: 'this court’s own reasons' },
  holding: { label: "Court's decision", means: 'what this court decided' },
  unknown: { label: 'Not sure', means: 'a quotation, a list of cases, or unclear' },
};
export const ROLE_LABELS = Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])) as Record<
  ParaRole,
  string
>;
export const OPINION_LABELS: Record<string, string> = {
  majority: 'Majority',
  concurring: 'Concurring',
  dissent: 'Dissent',
  separate_no_majority: 'Separate opinions, no single majority',
  unknown: 'Opinion not identified',
};

/** The report citations, official ones first ("[2014] 13 S.C.R. 895", "2014 INSC 809", then SCC, AIR …). */
export function citationsOf(citation: string | null): string[] {
  if (!citation) return [];
  const all = [
    ...new Set(
      citation
        .split(/\s*;\s*/)
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
  const rank = (c: string) =>
    /S\.C\.R\./.test(c) ? 0 : /INSC/.test(c) ? 1 : /SCC/.test(c) ? 2 : /AIR/.test(c) ? 3 : 4;
  return all.sort((a, b) => rank(a) - rank(b));
}

type Item = ReviewJudgmentList['judgments'][number];
export type Filter = 'todo' | 'done' | 'all';
/** Still needs the expert: labels, case status, approval of a live lookup, or whether it is a second copy. */
export const todo = (x: Item) =>
  !x.rolesChecked || x.caseStatus === 'not_verified' || x.status === 'provisional' || x.maybeSame;
export const stillToDo = (x: Item) =>
  [
    x.maybeSame && 'same case?',
    x.caseStatus === 'not_verified' && 'status',
    !x.rolesChecked && 'labels',
    x.status === 'provisional' && 'approval',
  ].filter((t): t is string => !!t);

/** The list as she filtered it: still to do, done, or all; and by words in the title. */
export function filterJudgments(all: Item[], filter: Filter, q: string): Item[] {
  const words = q.trim().toLowerCase();
  return all
    .filter((x) => (filter === 'all' ? true : filter === 'todo' ? todo(x) : !todo(x)))
    .filter((x) => !words || x.title.toLowerCase().includes(words));
}

export const reviewCounts = (all: Item[]) => ({
  todo: all.filter(todo).length,
  done: all.filter((x) => !todo(x)).length,
  all: all.length,
});

export interface ChecklistStep {
  done: boolean;
  title: string;
  hint: string;
  /** The id of the section where the step is done (the "Do it" button scrolls there); null once nothing is left. */
  target: string | null;
}

/** The checks that move a judgment to "Done": a possible second copy first, then status, labels and approval. */
export function checklistSteps(j: ReviewJudgment): ChecklistStep[] {
  return [
    ...(j.maybeSameAs
      ? [
          {
            done: false,
            title: 'Is this a second copy of a case we hold?',
            hint: 'Answer the yellow question above.',
            target: 'step-same',
          },
        ]
      : []),
    {
      done: j.caseStatus !== 'not_verified',
      title: 'Is it still good law?',
      hint: 'Say whether a later judgment overruled it.',
      target: 'step-status',
    },
    {
      done: j.rolesChecked,
      title: 'Are the paragraph labels right?',
      hint: 'Check which paragraphs are the court’s own reasoning and decision.',
      target: 'step-labels',
    },
    j.status === 'provisional'
      ? {
          done: false,
          title: 'Is this the right judgment, with its full text?',
          hint: 'Needed for copies not from the official report.',
          target: 'step-approve',
        }
      : {
          done: true,
          title: 'Right judgment, full text',
          hint: j.origin === 'court_site' ? 'Not needed: official copy.' : 'Approved.',
          target: null,
        },
  ];
}
