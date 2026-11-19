import { describe, expect, it } from 'vitest';
import { cleanPages } from './clean.ts';

const page = (pageNo: number, ...lines: string[]) => ({ pageNo, text: lines.join('\n') });

describe('cleanPages (LLD §6.1 stage 3)', () => {
  it('drops running headers, footers and page numbers but keeps repeated body wording', () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page(
        n,
        'THE INDIAN CONTRACT ACT, 1872',
        `${n}. Title ${n}.—Body ${n}.`,
        'Provided that the rule applies.',
        'Some more law text here.',
        `Illustration ${n}`,
        'Gazette of India',
        String(n + 10),
      ),
    );
    const out = cleanPages(pages).map((l) => l.text);
    expect(out).not.toContain('THE INDIAN CONTRACT ACT, 1872');
    expect(out).not.toContain('Gazette of India');
    expect(out).not.toContain('11');
    expect(out.filter((t) => t === 'Provided that the rule applies.')).toHaveLength(4);
  });

  it('keeps page numbers on lines', () => {
    const out = cleanPages([page(7, 'alpha'), page(8, 'beta')]);
    expect(out).toEqual([
      { pageNo: 7, text: 'alpha' },
      { pageNo: 8, text: 'beta' },
    ]);
  });

  it('joins a word hyphenated across a line break', () => {
    const out = cleanPages([page(1, 'such promisor must make compen-', 'sation to such promisee for any loss')]);
    expect(out.map((l) => l.text)).toEqual(['such promisor must make compensation', 'to such promisee for any loss']);
  });

  it('keeps the hyphen of a real compound broken at a line end', () => {
    const out = cleanPages([page(1, 'loss through non-', 'performance of the promise')]);
    expect(out.map((l) => l.text)).toEqual(['loss through non-performance', 'of the promise']);
  });

  it('does not join a real hyphen before a capital letter', () => {
    const out = cleanPages([page(1, 'the Ninety-', 'Seventh Amendment')]);
    expect(out.map((l) => l.text)).toEqual(['the Ninety-', 'Seventh Amendment']);
  });

  it('normalises spaces everywhere and quotes only outside quotation marks', () => {
    const out = cleanPages([page(1, 'A contract  is “a promise ‘enforceable’ by law” and B’s right​ holds')]);
    expect(out[0]?.text).toBe('A contract is “a promise ‘enforceable’ by law” and B\'s right holds');
  });
});
