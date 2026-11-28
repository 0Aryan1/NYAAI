import { describe, expect, it } from 'vitest';
import { looksLikeHeading, NOTE_CHUNK_WORDS, pdfBlocks, splitNotes, textBlocks } from './notes.ts';

describe("a teacher's notes, split by heading", () => {
  it('one chunk per heading block, labelled as her notes, with the heading path', () => {
    const chunks = splitNotes('ADR Notes', [
      { text: 'Seat of arbitration', heading: 1 },
      { text: 'The seat decides which court supervises.', heading: null },
      { text: 'Example', heading: 2 },
      { text: 'A Delhi company and a Mumbai company choose London.', heading: null },
      { text: 'Interim measures', heading: 1 },
      { text: 'Section 9 and section 17 compared in class.', heading: null },
    ]);
    expect(chunks.map((c) => c.header)).toEqual([
      'Your notes: ADR Notes › Seat of arbitration',
      'Your notes: ADR Notes › Seat of arbitration › Example',
      'Your notes: ADR Notes › Interim measures',
    ]);
    expect(chunks[1]!.text).toBe('A Delhi company and a Mumbai company choose London.');
    expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  it('text before the first heading is kept; a long block splits between paragraphs, never inside one', () => {
    const para = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    const chunks = splitNotes('N', [
      { text: 'Intro words.', heading: null },
      { text: 'Long', heading: 1 },
      { text: para(200), heading: null },
      { text: para(200), heading: null },
      { text: para(500), heading: null },
    ]);
    expect(chunks[0]).toMatchObject({ heading: null, header: 'Your notes: N', text: 'Intro words.' });
    expect(chunks.slice(1).map((c) => c.text.split(' ').length)).toEqual([200, 200, 500]);
    expect(NOTE_CHUNK_WORDS).toBe(350);
  });

  it('reads Markdown and plain text', () => {
    expect(
      textBlocks('# Seat\nThe seat matters.\n\nSecond paragraph\ncontinues here.\n\nINTERIM MEASURES\n\nBody.'),
    ).toEqual([
      { text: 'Seat', heading: 1 },
      { text: 'The seat matters.', heading: null },
      { text: 'Second paragraph continues here.', heading: null },
      { text: 'INTERIM MEASURES', heading: 1 },
      { text: 'Body.', heading: null },
    ]);
  });

  it('knows a heading line from a sentence', () => {
    expect(looksLikeHeading('2.1 Seat and Venue')).toBe(true);
    expect(looksLikeHeading('PUBLIC POLICY')).toBe(true);
    expect(looksLikeHeading('Grounds For Setting Aside')).toBe(true);
    expect(looksLikeHeading('The court may set aside an award.')).toBe(false);
    expect(looksLikeHeading('the seat decides the supervising court')).toBe(false);
  });

  it('reads a PDF: larger lines are headings, a wide gap starts a paragraph, page numbers dropped', () => {
    const line = (text: string, y: number, size = 11) => ({ text, y, size, x: 72, marks: [] });
    const blocks = pdfBlocks({
      bodySize: 11,
      scanned: false,
      pages: [
        {
          pageNo: 1,
          lines: [
            line('Seat of Arbitration', 700, 16),
            line('The seat decides', 680),
            line('the supervising court.', 667),
            line('A new paragraph starts here.', 630),
            line('3', 40),
          ],
        },
      ],
    });
    expect(blocks).toEqual([
      { text: 'Seat of Arbitration', heading: 1 },
      { text: 'The seat decides the supervising court.', heading: null },
      { text: 'A new paragraph starts here.', heading: null },
    ]);
  });
});
