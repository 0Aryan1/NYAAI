import { describe, expect, it } from 'vitest';
import type { SlideLine, StudioSlide } from '@nyaai/shared';
import { deckFileName, paginate, planDeck, type CitationDetail } from '../src/services/export/deck.ts';

const line = (o: Partial<SlideLine>): SlideLine => ({ lineKey: 'k', text: 'A line.', kind: 'claim', status: 'supported', flag: null, flagReason: null, sources: [], risk: 'normal', edited: false, ...o });
const src = (citationId: string, label: string, caseStatus: string | null = null) => ({ tag: 'S1', citationId, label, provisional: false, caseStatus });
const slide = (o: Partial<StudioSlide>): StudioSlide => ({ id: 's', position: 0, partIndex: 0, layout: 'bullets', title: 'Grounds', version: 1, lines: [], notes: [], ...o });
const cites = new Map<string, CitationDetail>([
  ['c1', { citationId: 'c1', label: 's. 34 A&C Act', title: 'The Arbitration and Conciliation Act, 1996', span: 'only by an application for setting aside', caseStatus: null }],
  ['c2', { citationId: 'c2', label: 'Associate Builders ¶35', title: 'Associate Builders v. DDA', span: 'and not otherwise', caseStatus: 'not_verified' }],
]);

describe('the downloaded deck (LLD §10.2–10.3)', () => {
  it('splits a long slide into "(cont.)" slides instead of shrinking the text', () => {
    expect(paginate(Array.from({ length: 9 }, (_, i) => ({ text: `l${i}` }))).map((p) => p.length)).toEqual([7, 2]);
    expect(paginate([{ text: 'x'.repeat(500) }, { text: 'y'.repeat(300) }]).map((p) => p.length)).toEqual([1, 1]);
  });

  it('writes the notes, the sources with their exact words, and every open point', () => {
    const deck = planDeck(
      [
        slide({
          lines: [
            line({ lineKey: 'a', text: 'Recourse is only by an application to set aside.', sources: [src('c1', 's. 34 A&C Act')] }),
            line({ lineKey: 'b', text: 'The court held that review is narrow.', sources: [src('c2', 'Associate Builders ¶35', 'not_verified')], status: 'open', flag: 'yellow', flagReason: 'Labels not yet checked by an expert' }),
          ],
          notes: [line({ lineKey: 'n', text: 'Ask: is this an appeal?', kind: 'teaching' })],
        }),
      ],
      cites,
      { withFlags: true, notCovered: ['Explanation 1 to s. 34 (s. 34)'] },
    );
    const s = deck.slides[0]!;
    expect(s.footnotes).toEqual(['1 s. 34 A&C Act', '2 Associate Builders ¶35']);
    expect(s.lines.map((l) => l.marks)).toEqual([[1], [2]]);
    expect(s.notes).toContain('Ask: is this an appeal?');
    expect(s.notes).toContain('SOURCES\n[1] s. 34 A&C Act (The Arbitration and Conciliation Act, 1996) — "only by an application for setting aside"');
    expect(s.notes).toContain('[!] PLEASE VERIFY, not confirmed by NYAAI: "The court held that review is narrow." (Labels not yet checked by an expert)');
    expect(s.notes).toContain('[?] STATUS NOT VERIFIED: Associate Builders v. DDA');
    expect(deck.verify).toEqual([{ slide: 2, text: 'The court held that review is narrow. (Labels not yet checked by an expert)' }]);
    expect(deck.notVerified).toEqual(['Associate Builders v. DDA']);
    expect(deck.notCovered).toEqual(['Explanation 1 to s. 34 (s. 34)']);
  });

  it('names the file after the lecture (PPT-3)', () => {
    expect(deckFileName('Frustration of contract', 9, '2026-11-22')).toBe('L09_Frustration_Of_Contract.pptx');
    expect(deckFileName('Seat of arbitration?', null, '2026-11-22')).toBe('OneOff_Seat_Of_Arbitration_2026-11-22.pptx');
  });
});
