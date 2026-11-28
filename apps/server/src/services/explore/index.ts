/**
 * Explore (BRD EXP-1, EXP-2; HLD F4). Library only: no web search in the pilot.
 *
 *  - Concept list and topic map: the expert-curated concepts (legal_concepts), their key sections and leading cases
 *    (concept_links; a case the expert has not confirmed shows grey), the questions her lectures on the topic could
 *    not answer, and where the topic sits in her courses.
 *  - A follow-up question: library search (5 sources), `explore.answer` writes closed-book from them, and every
 *    claim goes through the same ten checks as a lecture line (C1–C8 in code, C9 support, C10 for high risk). A
 *    statement of law with no source is flagged; what the library cannot answer is said plainly, and the question
 *    goes to the library team as a gap.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { decide, looksLegal, type CheckResult, type CheckSource, type ClaimInput } from '@nyaai/checker-rules';
import { PROMPTS } from '@nyaai/prompts';
import { ExploreReply, type ConceptList, type ExploreAnswer, type TopicMap } from '@nyaai/shared';
import { checkClaims, sourcesBlock } from '../build/checking.ts';
import { checkSourcesFor } from '../build/part.ts';
import type { Gateway } from '../llm-gateway/index.ts';
import { searchWithLookup, type TenantRunner } from '../lookup/index.ts';
import type { SearchDeps } from '../search/index.ts';
import type { UsageSink } from '../usage.ts';

export async function listConcepts(c: pg.PoolClient, q: string | null): Promise<ConceptList['concepts']> {
  const r = await c.query<{
    id: string;
    name: string;
    subject: string;
    aliases: string[];
    key_sections: number;
    leading_cases: number;
  }>(
    `select lc.id, lc.name, lc.subject, lc.aliases,
            (select count(*)::int from concept_links l where l.concept_id = lc.id and l.kind = 'key_section') key_sections,
            (select count(*)::int from concept_links l where l.concept_id = lc.id and l.kind = 'leading_case') leading_cases
       from legal_concepts lc
      where $1::text is null or lc.name ilike '%' || $1 || '%' or exists (select 1 from unnest(lc.aliases) a where a ilike '%' || $1 || '%')
      order by lc.subject, lc.name`,
    [q],
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    subject: x.subject,
    aliases: x.aliases,
    keySections: x.key_sections,
    leadingCases: x.leading_cases,
  }));
}

export async function topicMap(c: pg.PoolClient, conceptId: string): Promise<TopicMap | null> {
  const concept = (
    await c.query<{ id: string; name: string; subject: string; aliases: string[] }>(
      'select id, name, subject, aliases from legal_concepts where id = $1',
      [conceptId],
    )
  ).rows[0];
  if (!concept) return null;
  const sections = (
    await c.query<{
      chunk_id: string;
      source_id: string;
      act: string | null;
      number: string | null;
      header: string | null;
      text: string;
    }>(
      `select k.id as chunk_id, k.source_id, k.act_name as act, coalesce(k.section, k.article) as number, k.header, k.text
         from concept_links l join chunks k on k.id = l.chunk_id
        where l.concept_id = $1 and l.kind = 'key_section' and k.status in ('live', 'provisional')
        order by k.act_name, k.seq`,
      [conceptId],
    )
  ).rows;
  const cases = (
    await c.query<{
      source_id: string;
      title: string;
      court: string | null;
      decided_on: Date | null;
      confirmed: boolean;
      case_status: TopicMap['leadingCases'][number]['caseStatus'] | null;
    }>(
      `select s.id as source_id, s.title, s.court, s.decided_on, l.confirmed_at is not null as confirmed, cs.status as case_status
         from concept_links l join sources s on s.id = l.source_id left join case_status_v cs on cs.source_id = s.id
        where l.concept_id = $1 and l.kind = 'leading_case' and s.status in ('live', 'provisional')
        order by l.confirmed_at is null, s.decided_on nulls last`,
      [conceptId],
    )
  ).rows;
  // Open questions: what her own lectures on this concept could not answer from the library.
  const open = (
    await c.query<{ q: string }>(
      `select distinct nf->>'question' as q
         from lectures l join lecture_inputs i on i.lecture_id = l.id, jsonb_array_elements(coalesce(l.plan->'notFound', '[]')) nf
        where i.ambiguity_choice = $1 and l.owner_id = app_user()
        limit 8`,
      [conceptId],
    )
  ).rows
    .map((r) => r.q)
    .filter(Boolean);
  const names = [concept.name, ...concept.aliases];
  const inCourses = (
    await c.query<{
      course_id: string;
      course_name: string;
      unit_id: string;
      position: number;
      title: string;
      lecture_id: string | null;
    }>(
      `select co.id as course_id, co.name as course_name, u.id as unit_id, u.position, u.title, u.lecture_id
         from course_units u join courses co on co.id = u.course_id
        where co.archived_at is null and u.status <> 'skipped'
          and ($1 = any(u.concept_ids) or exists (select 1 from unnest($2::text[]) n where u.title ilike '%' || n || '%'))
        order by co.name, u.position limit 12`,
      [conceptId, names],
    )
  ).rows;
  return {
    concept: { id: concept.id, name: concept.name, subject: concept.subject, aliases: concept.aliases },
    keySections: sections.map((x) => ({
      chunkId: x.chunk_id,
      sourceId: x.source_id,
      act: x.act,
      number: x.number,
      heading: x.header ?? '',
      excerpt: x.text.length > 320 ? `${x.text.slice(0, 317)}…` : x.text,
    })),
    leadingCases: cases.map((x) => ({
      sourceId: x.source_id,
      title: x.title,
      court: x.court,
      year: x.decided_on ? x.decided_on.getFullYear() : null,
      confirmed: x.confirmed,
      caseStatus: x.case_status ?? 'not_verified',
    })),
    openQuestions: open,
    inCourses: inCourses.map((x) => ({
      courseId: x.course_id,
      courseName: x.course_name,
      unitId: x.unit_id,
      position: x.position,
      title: x.title,
      lectureId: x.lecture_id,
    })),
  };
}

export interface ExploreDeps {
  tenant: TenantRunner;
  searchDeps: (c: pg.PoolClient) => SearchDeps;
  gateway: Gateway;
  usage: UsageSink;
}

const UNSOURCED = 'No source for this statement';

export interface AnswerLineIn {
  text: string;
  kind: 'claim' | 'teaching' | 'question';
  claims: ClaimInput[] | { text: string; type: string; tag: string; span: string }[];
}

/**
 * Lines written from sources (an Explore answer, a Research brief), through the same ten checks as a lecture line:
 * every claim checked; a line is as good as its weakest claim; a statement of law with no claim is flagged by the
 * code rule. Also returns the spans quoted from each source tag.
 */
export async function checkLines<K extends AnswerLineIn['kind']>(
  input: { text: string; kind: K; claims: AnswerLineIn['claims'] }[],
  sources: Map<string, CheckSource>,
  labels: Map<string, string>,
  deps: { gateway: Gateway; usage: UsageSink },
): Promise<{
  lines: {
    text: string;
    kind: K;
    status: 'supported' | 'open';
    flag: 'yellow' | 'grey' | null;
    reason: string | null;
    sources: { tag: string; label: string }[];
  }[];
  spans: Map<string, string[]>;
}> {
  const items = input.flatMap((l, li) =>
    l.claims.map((claim, ci) => ({ id: `${li}#${ci}`, claim: claim as ClaimInput })),
  );
  const checked = await checkClaims(items, sources, [], { gateway: deps.gateway, usage: deps.usage });
  const byLine = new Map<number, CheckResult[][]>();
  for (const c of checked) {
    const li = Number(c.id.split('#')[0]);
    byLine.set(li, [...(byLine.get(li) ?? []), c.results]);
  }
  const spans = new Map<string, string[]>();
  for (const c of checked) spans.set(c.claim.tag, [...(spans.get(c.claim.tag) ?? []), c.claim.span]);
  const lines = input.map((l, li) => {
    const results = byLine.get(li) ?? [];
    if (!results.length) {
      const unsourced = l.kind === 'claim' || looksLegal(l.text);
      return {
        text: l.text,
        kind: l.kind,
        status: unsourced ? ('open' as const) : ('supported' as const),
        flag: unsourced ? ('yellow' as const) : null,
        reason: unsourced ? UNSOURCED : null,
        sources: [],
      };
    }
    const decisions = results.map(decide);
    const worst =
      decisions.find((d) => d.status === 'open') ?? decisions.find((d) => d.flag === 'grey') ?? decisions[0]!;
    const tags = [...new Set(l.claims.map((c) => c.tag))];
    return {
      text: l.text,
      kind: l.kind,
      status: worst.status,
      flag: worst.flag,
      reason: worst.reason,
      sources: tags.map((t) => ({ tag: t, label: labels.get(t) ?? t })),
    };
  });
  return { lines, spans };
}

/** A follow-up question, answered from the library and checked like a lecture line (EXP-2). */
export async function answerQuestion(
  question: string,
  conceptName: string | null,
  deps: ExploreDeps,
): Promise<ExploreAnswer> {
  const query =
    conceptName && !question.toLowerCase().includes(conceptName.toLowerCase())
      ? `${conceptName}: ${question}`
      : question;
  // Library only (lookup = null): a thin result is recorded as a library gap for the library team.
  const found = await searchWithLookup(
    deps.tenant,
    { query: query.slice(0, 500), purpose: 'explore', maxSources: 5 },
    deps.searchDeps,
    null,
  );
  const libraryTold = !!found.gap;
  if (!found.sources.length) return { outcome: 'not_found', lines: [], sources: [], notFound: [question], libraryTold };

  const { sources, labels } = await checkSourcesFor(deps.tenant, found.sources);
  const boundary = randomBytes(6).toString('hex');
  const task = [
    `QUESTION: ${question}`,
    conceptName ? `TOPIC: ${conceptName}` : '',
    `Tags available: ${[...sources.keys()].join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const reply = (
    await deps.gateway.run(
      { prompt: PROMPTS['explore.answer'], schema: ExploreReply, context: [sourcesBlock(sources, boundary)], task },
      deps.usage,
    )
  ).data;

  // The ten checks, on every claim; a legal statement without one is flagged.
  const { lines, spans } = await checkLines(reply.lines, sources, labels, { gateway: deps.gateway, usage: deps.usage });
  const used = new Set<string>(lines.flatMap((l) => l.sources.map((s) => s.tag)));
  return {
    outcome: found.outcome,
    lines,
    sources: found.sources
      .filter((s) => used.has(s.tag))
      .map((s) => ({
        tag: s.tag,
        label: labels.get(s.tag) ?? s.tag,
        header: s.header,
        text: s.text,
        spans: spans.get(s.tag) ?? [],
        provisional: s.provisional,
        caseStatus: (s.status.case as ExploreAnswer['sources'][number]['caseStatus']) ?? null,
      })),
    notFound: reply.notFound,
    libraryTold,
  };
}
