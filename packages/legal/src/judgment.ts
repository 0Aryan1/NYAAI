/**
 * Judgment splitter, opinion boundaries and paragraph roles (LLD §6.4). Pure: blocks in, labelled chunks out.
 *
 * 1. Paragraphs: the court's numbering is used when numbers at the start of blocks rise one by one through at
 *    least 80% of the text (`paraNoSource = 'court'`); otherwise blocks are numbered by us (`'nyaai'`) and
 *    citations show the report page.
 * 2. Reporter headnotes become `kind = 'headnote'`, role `headnote`; they can never support "held".
 * 3. Opinions start at a judge-signature line ("SUBBA RAO, J.—"), at the "delivered by" sentence, or at an opener
 *    ("I have had the advantage of reading…", "I respectfully disagree"). Types: majority (the only opinion, the
 *    one delivered for the Bench or for a majority of the bench), dissent, concurring, separate_no_majority, unknown.
 * 4. Roles, rules first: arguments, lower_court_summary, holding, facts. A paragraph the rules can't place gets
 *    `role: null`, for the labeller (Haiku, fixed answers) to try; anything still unclear stays 'unknown'.
 */

export type OpinionType = 'majority' | 'concurring' | 'dissent' | 'separate_no_majority' | 'unknown';
export type ParaRole = 'facts' | 'arguments' | 'lower_court_summary' | 'discussion' | 'holding' | 'headnote' | 'unknown';

export interface JudgmentBlock {
  text: string;
  /** Page of the printed report the block starts on, when the source gives one. */
  page: number | null;
  /** Indented or quoted in the source (a quotation, or an old report's indentation). */
  quoted: boolean;
}

export interface JudgmentInput {
  caseName: string;
  decidedOn: string | null;
  court: string | null;
  citations: string[];
  author: string | null;
  bench: string[];
  headnote: string | null;
  blocks: JudgmentBlock[];
  /**
   * The official reporter's notes on the opinions (e-SCR headnotes): who formed the majority, who concurred or
   * dissented separately. Used when the judgment text itself does not say.
   */
  reporterNote?: { majority: string[]; concurring: string[]; dissenting: string[] };
  /**
   * Quotations are reliably marked (`quoted`): true for PDFs, where they are set off by indentation. Indian Kanoon's
   * blockquote flag also marks some of the court's own paragraphs, so it is not relied on.
   */
  quotesMarked?: boolean;
}

export interface Opinion {
  index: number;
  type: OpinionType;
  /** Judge who wrote it, as printed ("Ayyangar", "Subba Rao"). */
  judge: string | null;
}

export interface JudgmentChunk {
  seq: number;
  kind: 'paragraph' | 'paragraph_block' | 'headnote';
  paraNo: string | null;
  paraNoSource: 'court' | 'nyaai' | null;
  pageNo: number | null;
  opinion: OpinionType | null;
  opinionIndex: number | null;
  judge: string | null;
  /** Rule result; null = the rules could not decide (send to the labeller). */
  role: ParaRole | null;
  header: string;
  text: string;
}

export interface SplitJudgment {
  opinions: Opinion[];
  chunks: JudgmentChunk[];
  paraNoSource: 'court' | 'nyaai';
  benchSize: number;
}

const COURT_NO = /^\s*\[?(\d{1,4})\]?[.)]\s+/;
/**
 * A quoted statute section ("4. Effect of foreign awards.—", "46. When foreign award binding.—") carries a number
 * that is not the court's: judgments quote provisions in their own numbering (PASL Wind, 2021, quotes ss. 4–6 of the
 * 1961 Act inside para 3, and the court's paras 4–6 were swallowed).
 */
const QUOTED_PROVISION = /^\s*\d{1,4}[A-Z]?\.\s*[A-Z][^.\n—–]{2,100}\.\s*[—–]/;
/** The court's own paragraph number, or null for a quotation that only looks numbered. */
/**
 * A court's numbering sometimes skips (BALCO goes 187 → 189), or restarts at 1 for the next opinion. A number up to 3 ahead counts when the number after it
 * follows within the next 12 blocks; quoted lists ("33", "37", "42") never confirm themselves that way.
 */
function confirmedJump(blocks: { text: string }[], i: number, no: number, expected: number): boolean {
  const ahead = blocks.slice(i + 1, i + 16).map(courtNo);
  // While the court's own next number still turns up shortly, this number belongs to a quotation.
  if (ahead.includes(String(expected))) return false;
  const followed = () => ahead.slice(0, 12).some((a) => a === String(no + 1) || a === String(no + 2));
  // A second opinion that numbers its paragraphs from 1 again (S.B.P. & Co., 2005: the dissent after para 46).
  if (no === 1 && expected > 5) return followed();
  if (no <= expected || no - expected > 10) return false;
  return followed();
}
// (Kanoon's blockquote flag is not used: it also marks some of the court's own numbered paragraphs.)
/** A paragraph that grew past this by merging unnumbered blocks is cut at the next block that starts cleanly. */
const MAX_MERGED_CHARS = 8000;
const courtNo = (b: { text: string }) => (QUOTED_PROVISION.test(b.text) ? null : (COURT_NO.exec(b.text)?.[1] ?? null));
/** Sub-paragraph numbers ("3.1.", "4.2"): the court numbers the parts of paragraph 3 instead of paragraph 3 itself. */
const SUB_NO = /^\s*(\d{1,4})\.(\d{1,2})\.?\s+(?=\S)/;

/**
 * The court's running numbering. A whole number counts when it is the next one (or a confirmed jump or restart).
 * A sub-number counts only as the first part of the next paragraph ("3.1" after 2) or the next part of the current
 * one ("3.2" after 3.1); a quoted clause numbered "6.1" in the middle of paragraph 3 does not.
 */
class Numbering {
  expected = 1;
  private major = 0;
  private minor = 0;

  accept(blocks: { text: string }[], i: number): string | null {
    const b = blocks[i]!;
    const sub = QUOTED_PROVISION.test(b.text) ? null : SUB_NO.exec(b.text);
    if (sub) {
      const major = Number(sub[1]);
      const minor = Number(sub[2]);
      const opens = major === this.expected && minor === 1;
      const continues = major === this.major && this.minor > 0 && minor === this.minor + 1;
      if (!opens && !continues) return null;
      if (opens) this.expected = major + 1;
      this.major = major;
      this.minor = minor;
      return `${major}.${minor}`;
    }
    const no = courtNo(b);
    if (no && (Number(no) === this.expected || confirmedJump(blocks, i, Number(no), this.expected))) {
      this.restartAt(Number(no));
      return no;
    }
    return null;
  }

  restartAt(no: number) {
    this.expected = no + 1;
    this.major = no;
    this.minor = 0;
  }
}
const APPEARANCE = /\bfor the (appellants?|respondents?|petitioners?|interveners?|State|Union)\b[^.]*\.?\s*$/i;
const JUDGE_SIGNATURE = /^\s*([A-Z][A-Za-z.'\s]{1,60}?),?\s*(C\.\s?J\.(?:I\.)?|CJI\b\.?|JJ?\.)\s*[-—–:.]+\s*/;
const INLINE_SIGNATURE = /(?:^|[.;]\s+)([A-Z][A-Z.'\s]{2,40}),?\s*(C\.\s?J\.|J\.)\s*[-—–:]*\s*(?=[A-Z])/;
/** "R.F. NARIMAN, J." alone in a block: the next block starts that judge's opinion. */
const SIGNATURE_ALONE = /^\s*([A-Z][A-Za-z.'\s]{1,60}?),?\s*(C\.\s?J\.(?:I\.)?|CJI\.?|JJ?\.)\s*$/;
/** Judges' signature lines at the end ("……J. (PINAKI CHANDRA GHOSE)", "New Delhi; April 11, 2017"). */
const SIGNATURE_LINE = /^[\s.…]*(?:J\.|CJI\.?)\s*\(|(?:\.|…){5,}\s*J\.|^\s*New\s+Delhi[;,]?\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}\.?\s*$|^\s*\(\s*[A-Z][A-Z.\s]{2,40}\)\s*(?:New\s+Delhi.*)?$|^\s*(?:New\s+Delhi[;,]?\s*)?[A-Z][a-z]+\s+\d{1,2},\s*\d{4}\.?\s*$/;
const OPENERS = /^\s*(?:I|We)\s+(?:have\s+had\s+the\s+(?:advantage|benefit|privilege)\s+of\s+(?:reading|perusing|going through)|respectfully\s+(?:disagree|differ)|agree\s+with\s+the\s+conclusion|regret\s+(?:that\s+)?(?:I|we)\s+(?:am|are)\s+unable\s+to\s+agree)/i;
const DELIVERED_BY = /judg(?:e)?ment\s+of\s+(.+?),?\s+(?:was|were)\s+delivered\s+by\s+([A-Z][A-Za-z.'\s]+?),?\s*(?:C\.\s?J\.|J\.|j\.)/i;
const FOR_THE_BENCH = /\b(?:for|on behalf of)\s+(?:the\s+)?(?:Bench|Court|myself and)\b|\bdelivered the judgment of the Court\b/i;
const COURT_ORDER = /^\s*(?:By\s+(?:the\s+)?Court\s*[:.—-]|ORDER\s*$|O\s*R\s*D\s*E\s*R\s*$)/i;

const DISSENT_SIGNAL = /\bdissent|\brespectfully\s+(?:disagree|differ)|\bunable\s+to\s+(?:agree|concur)|\bgo\s+further\s+and\s+hold|\bwould\s+(?:issue|allow|dismiss|set\s+aside|quash)\b/i;
const CONCUR_SIGNAL = /\b(?:I|we)\s+(?:agree|concur)\s+(?:with|in)\s+(?:the\s+)?(?:conclusion|order|result|judgment)\b|\bconcur(?:ring)?\s+in\s+the\s+result\b/i;

const ARGUMENTS = /\blearned\s+(?:senior\s+)?(?:counsel|advocate|Attorney[-\s]General|Solicitor[-\s]General)\b.{0,160}\b(?:submit|contend|argu|urg|plead|point)|\bit\s+(?:was|is|has\s+been)\s+(?:urged|contended|argued|submitted)\b|\bon\s+behalf\s+of\s+the\s+(?:appellant|respondent|petitioner)s?\b.{0,80}\b(?:submit|contend|argu|urg)|\b(?:Mr|Mrs|Ms|Shri|Dr)\.?\s+[A-Z][\w.]*(?:\s+[A-Z][\w.]*)?,?.{0,80}\b(?:appeared|argued|contended|submitted|urged|put\s+forward|pressed)\b|\b(?:argument|contention|submission)s?\b.{0,40}\b(?:advanced|put\s+forward|raised|pressed)\b/i;
const LOWER_COURT = /\b(?:the\s+)?(?:High\s+Court|trial\s+(?:court|judge)|Tribunal|Appellate\s+Tribunal|learned\s+(?:trial\s+)?Judge|first\s+appellate\s+court|District\s+Judge|Division\s+Bench)\b.{0,80}\b(?:held|observed|found|came\s+to\s+the\s+conclusion|took\s+the\s+view|decided|dismissed|decreed)\b/i;
const HOLDING = /\bwe\s+hold\b|\bin\s+view\s+of\s+the\s+(?:above|foregoing)\b|\b(?:appeals?|petitions?|writ\s+petitions?)\s+(?:is|are|stands?)\s+(?:accordingly\s+)?(?:allowed|dismissed|partly\s+allowed|disposed\s+of)\b|\bin\s+the\s+result\b|\bfor\s+these\s+reasons\b|\b(?:appeals?|petitions?|suit|decree|order)\b.{0,40}\baccordingly\b|\baccordingly\b.{0,60}\b(?:allowed|dismissed|set\s+aside|quashed|disposed\s+of|affirmed)\b/i;
/** The court speaking in its own voice about its conclusion: decides the role even when counsel is mentioned too. */
const COURT_CONCLUSION = /\bwe\s+hold\b|\bwe\s+are\s+(?:clearly\s+)?of\s+(?:the\s+)?(?:view|opinion)\b|\bin\s+our\s+(?:view|opinion|judgment)\b|\b(?:the\s+)?(?:appeals?|petitions?|writ\s+petitions?)\s+(?:is|are|stands?)\s+(?:accordingly\s+)?(?:allowed|dismissed|partly\s+allowed)\b|\bthe\s+result\s+is\s+that\b/i;
const ISSUE = /\b(?:question|point|issue)s?\s+(?:that|which)?\s*(?:arises?|falls?|requires?|calls?)\s+for\s+(?:our\s+)?(?:consideration|determination|decision)|\bthe\s+(?:only|sole|main|short|real)\s+(?:question|point|issue)\b/i;

const lastName = (s: string) => s.replace(/\b(?:CJI|C\.?\s?J\.?|JJ?\.?|Hon'?ble|Mr\.?|Justice)\b/gi, '').replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).pop()?.toLowerCase() ?? '';

/** How far the court's own numbering runs through the blocks (see `courtNumbering`). */
export function courtNumberingStats(blocks: JudgmentBlock[]): { accepted: number; own: number; coverage: number } {
  const numbering = new Numbering();
  let covered = 0;
  const total = blocks.reduce((n, b) => n + b.text.length, 0) || 1;
  let accepted = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (numbering.accept(blocks, i)) accepted++;
    if (numbering.expected > 1) covered += blocks[i]!.text.length;
  }
  return { accepted, own: blocks.filter((b) => !b.quoted).length, coverage: covered / total };
}

/**
 * The court's numbering counts when it runs through ≥ 80% of the text and numbers at least 1 in 5 blocks. A few
 * numbered blocks in a long judgment (A. Ayyasamy: 10 of 107) are quotations, not the court's numbering. When
 * quotations are reliably marked (PDFs give each its own block), only the court's own blocks are counted, and a long
 * run (25+) counts however many quoted extracts sit between (Ssangyong, 2019, quotes whole numbered paragraphs).
 */
export function courtNumbering(blocks: JudgmentBlock[], quotesMarked = false): boolean {
  const { accepted, own, coverage } = courtNumberingStats(blocks);
  if (!quotesMarked) return accepted > 3 && accepted >= blocks.length * 0.2 && coverage >= 0.8;
  return accepted > 3 && (accepted >= own * 0.2 || accepted >= 25) && coverage >= 0.8;
}

export function ruleRole(text: string): ParaRole | null {
  if (COURT_CONCLUSION.test(text)) return 'holding';
  if (ARGUMENTS.test(text)) return 'arguments';
  if (LOWER_COURT.test(text)) return 'lower_court_summary';
  if (HOLDING.test(text)) return 'holding';
  return null;
}

interface WorkingBlock extends JudgmentBlock {
  opinionStart?: { judge: string | null };
  courtOrder?: boolean;
  /** Case caption, appearances and the "delivered by" sentence: not judgment text. */
  caption?: boolean;
}

/** Split a block at an inline signature after the "delivered by" sentence ("… separate judgment. AYYANGAR, J. —"). */
function splitInlineSignatures(blocks: JudgmentBlock[]): WorkingBlock[] {
  const out: WorkingBlock[] = [];
  let pendingJudge: string | null | undefined;
  for (const raw of blocks) {
    // "The Judgment of the Court was delivered by DIPAK MISRA, J." also ends like a signature: read it as the sentence.
    const alone = DELIVERED_BY.test(raw.text) ? null : SIGNATURE_ALONE.exec(raw.text);
    if (alone) {
      pendingJudge = alone[1]!.trim();
      continue;
    }
    const b: WorkingBlock = pendingJudge !== undefined ? { ...raw, opinionStart: { judge: pendingJudge } } : raw;
    pendingJudge = undefined;
    if (b.opinionStart) {
      out.push(b);
      continue;
    }
    const del = DELIVERED_BY.exec(b.text);
    const sig = del ? INLINE_SIGNATURE.exec(b.text.slice(del.index)) : null;
    if (del && !sig) {
      const after = b.text.slice(del.index + del[0].length).replace(/^[\s.,;:—–-]+/, '');
      const head = b.text.slice(0, del.index + del[0].length).trim();
      if (head) out.push({ ...b, text: head, caption: true });
      if (after) out.push({ ...b, text: after, opinionStart: { judge: del[2]!.trim() } });
      // The sentence stands alone (a PDF line): the judge's opinion starts with the next block.
      else pendingJudge = del[2]!.trim();
      continue;
    }
    if (sig) {
      const at = b.text.search(DELIVERED_BY) + sig.index + (sig[0].length - sig[0].trimStart().length);
      const head = b.text.slice(0, at).trim();
      const rest = b.text.slice(at).replace(INLINE_SIGNATURE, '').trim();
      if (head) out.push({ ...b, text: head, caption: true });
      out.push({ ...b, text: rest || b.text.slice(at), opinionStart: { judge: sig[1]!.trim() } });
      continue;
    }
    const signature = JUDGE_SIGNATURE.exec(b.text);
    if (signature && signature[1]!.split(/\s+/).length <= 5) {
      out.push({ ...b, text: b.text.slice(signature[0].length).trim() || b.text, opinionStart: { judge: signature[1]!.trim() } });
      continue;
    }
    if (OPENERS.test(b.text)) {
      out.push({ ...b, opinionStart: { judge: null } });
      continue;
    }
    if (COURT_ORDER.test(b.text)) {
      out.push({ ...b, courtOrder: true });
      continue;
    }
    out.push(b);
  }
  return out;
}

interface Unit extends WorkingBlock {
  courtNo: string | null;
  /** A long paragraph's later part, cut for size: the court number it continues. */
  continuesNo?: string | null;
}

/**
 * One chunk per paragraph. With court numbering, a block that does not carry the next number (a quoted passage,
 * a sub-numbered extract) belongs to the paragraph before it. Without it, a quoted block joins the paragraph
 * before it. A block that starts an opinion or the Court's order always starts a new paragraph.
 */
function mergeContinuations(blocks: WorkingBlock[], courtNumbers: boolean): Unit[] {
  const units: Unit[] = [];
  const numbering = new Numbering();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const prev = units[units.length - 1];
    const no = courtNo(b);
    if (courtNumbers) {
      const accepted = numbering.accept(blocks, i);
      if (accepted) {
        units.push({ ...b, courtNo: accepted, continuesNo: null });
        continue;
      }
      if (b.opinionStart && no) {
        units.push({ ...b, courtNo: no });
        numbering.restartAt(Number(no));
        continue;
      }
    }
    const expected = numbering.expected;
    // Old reports break a paragraph at the page end: the next block starts mid-sentence (lower case, or the block
    // before did not finish its sentence). That is the same paragraph.
    const brokenAtPage = prev ? /^[a-z(,;]/.test(b.text) || !/[.:;?!"”)\]]\s*$/.test(prev.text) : false;
    // With court numbering, unnumbered blocks join the paragraph before them, unless it has already grown long and
    // this block starts cleanly (Kanoon lost its number): then it is a continuation of its own, never given a number.
    const tooLong = courtNumbers && prev !== undefined && prev.text.length > MAX_MERGED_CHARS && !b.quoted && !brokenAtPage;
    const continues = prev && !b.opinionStart && !b.courtOrder && !tooLong && (courtNumbers ? expected > 1 : b.quoted || brokenAtPage);
    if (continues) prev.text = `${prev.text}\n${b.text}`;
    else units.push({ ...b, courtNo: null, continuesNo: tooLong ? (prev.courtNo ?? prev.continuesNo ?? null) : null });
  }
  return units;
}

export function splitJudgment(input: JudgmentInput): SplitJudgment {
  const benchSize = input.bench.length;
  // Appearances ("X, for the appellant.") are not judgment text.
  const kept = input.blocks.filter(
    (b) => !(b.text.length < 400 && APPEARANCE.test(b.text) && !/\bheld\b/i.test(b.text)) && !SIGNATURE_LINE.test(b.text),
  );
  const split = splitInlineSignatures(kept);
  // Blocks before the first opinion start (when it comes early) are the case caption: jurisdiction line, parties.
  const firstStart = split.findIndex((b) => b.opinionStart);
  const body = split.filter((b, i) => !b.caption && !(firstStart > 0 && firstStart <= 5 && i < firstStart));
  const useCourtNumbers = courtNumbering(body, input.quotesMarked);
  const blocks = mergeContinuations(body, useCourtNumbers);

  // Who formed the majority, when the judgment says so (the sentence sits in the caption, so look before dropping it).
  const delivered = split.map((b) => DELIVERED_BY.exec(b.text)).find(Boolean);
  const majorityJudges = delivered ? delivered[1]!.split(/,|\band\b/).map(lastName).filter(Boolean) : [];
  if (delivered) majorityJudges.push(lastName(delivered[2]!));
  else if (input.reporterNote?.majority.length) majorityJudges.push(...input.reporterNote.majority.map(lastName).filter(Boolean));
  const noted = (list: string[] | undefined) => new Set((list ?? []).map(lastName).filter(Boolean));
  const dissenters = noted(input.reporterNote?.dissenting);
  const concurrers = noted(input.reporterNote?.concurring);
  const majorityIsBench = majorityJudges.length > 0 && benchSize > 0 && majorityJudges.length > benchSize / 2;

  // Group blocks into opinions.
  const groups: { judge: string | null; blocks: Unit[]; courtOrder: boolean }[] = [];
  for (const b of blocks) {
    if (b.opinionStart || groups.length === 0) groups.push({ judge: b.opinionStart?.judge ?? input.author ?? null, blocks: [], courtOrder: false });
    if (b.courtOrder) groups.push({ judge: null, blocks: [], courtOrder: true });
    groups[groups.length - 1]!.blocks.push(b);
  }
  const opinionGroups = groups.filter((g) => !g.courtOrder && g.blocks.length > 0);

  const opinions: Opinion[] = [];
  const typeOf = (g: (typeof groups)[number]): OpinionType => {
    if (g.courtOrder) return 'majority'; // the order of the Court
    if (opinionGroups.length === 1) return 'majority';
    const text = g.blocks.map((b) => b.text).join(' ');
    const judge = g.judge ? lastName(g.judge) : '';
    // The official reporter names the separate opinions.
    if (judge && dissenters.has(judge)) return 'dissent';
    if (judge && concurrers.has(judge)) return 'concurring';
    if (dissenters.size || concurrers.size) {
      // Every other opinion is accounted for, and the dissenters are fewer than half the Bench: the one opinion
      // left is the Court's (Gayatri Balasamy, 2025: one dissent of five; Vidya Drolia, 2020: one concurrence).
      const unnamed = opinionGroups.filter((x) => !x.judge || (!dissenters.has(lastName(x.judge)) && !concurrers.has(lastName(x.judge))));
      if (unnamed.length === 1 && unnamed[0] === g && benchSize > 0 && dissenters.size < benchSize / 2) return 'majority';
    }
    if (majorityJudges.length) {
      if (judge && majorityJudges.includes(judge)) return majorityIsBench ? 'majority' : 'unknown';
      if (DISSENT_SIGNAL.test(text)) return 'dissent';
      if (CONCUR_SIGNAL.test(text)) return 'concurring';
      return 'unknown';
    }
    if (FOR_THE_BENCH.test(text.slice(0, 400))) return 'majority';
    if (DISSENT_SIGNAL.test(text)) return 'dissent';
    if (CONCUR_SIGNAL.test(text)) return 'concurring';
    return benchSize >= 3 ? 'separate_no_majority' : 'unknown';
  };
  groups.forEach((g, index) => opinions.push({ index, type: typeOf(g), judge: g.judge }));

  const chunks: JudgmentChunk[] = [];
  const year = input.decidedOn?.slice(0, 4);
  const base = year ? `${input.caseName} (${year})` : input.caseName;
  if (input.headnote) {
    chunks.push({
      seq: 1, kind: 'headnote', paraNo: null, paraNoSource: null, pageNo: null, opinion: null, opinionIndex: null,
      judge: null, role: 'headnote', header: `${base} › Headnote (reporter's summary)`, text: input.headnote,
    });
  }

  // Facts: the opening narrative of the first opinion, before the paragraph that states the issue. Without such a
  // paragraph, the rules don't guess and leave those paragraphs to the labeller.
  const firstIssue = groups[0]?.blocks.findIndex((b) => ISSUE.test(b.text)) ?? -1;

  let n = 0;
  groups.forEach((g, gi) => {
    const op = opinions[gi]!;
    g.blocks.forEach((b, bi) => {
      n++;
      const court = useCourtNumbers ? (b.courtNo ?? undefined) : undefined;
      const paraNo = court ?? (useCourtNumbers && b.continuesNo ? `${b.continuesNo} (cont.)` : String(n));
      let role = ruleRole(b.text);
      if (g.courtOrder) role = 'holding';
      if (!role && gi === 0 && firstIssue > 0 && bi < firstIssue) role = 'facts';
      const opinionLabel = op.type === 'majority' ? '' : ` › ${op.type === 'separate_no_majority' ? 'separate opinion' : op.type}${op.judge ? ` (${op.judge})` : ''}`;
      chunks.push({
        seq: chunks.length + 1,
        kind: useCourtNumbers ? 'paragraph' : 'paragraph_block',
        paraNo,
        paraNoSource: useCourtNumbers && court ? 'court' : 'nyaai',
        pageNo: b.page,
        opinion: op.type,
        opinionIndex: op.index,
        judge: op.judge,
        role,
        header: `${base}${opinionLabel} › ${useCourtNumbers && court ? `para ${paraNo}` : `para ${paraNo}${b.page ? ` (p. ${b.page})` : ''}`}`,
        text: b.text,
      });
    });
  });

  return { opinions, chunks, paraNoSource: useCourtNumbers ? 'court' : 'nyaai', benchSize };
}
