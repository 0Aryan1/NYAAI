import { describe, expect, it } from 'vitest';
import { STATUTE_PATTERNS as P } from './patterns.ts';

describe('statute patterns (LLD §6.3)', () => {
  it('recognises a section heading with an em dash', () => {
    const m = P.section.exec('56. Agreement to do impossible act.—An agreement to do an act impossible in itself is void.');
    expect(m?.[1]).toBe('56');
    expect(m?.[2]).toBe('Agreement to do impossible act');
  });
  it('recognises lettered sections', () => {
    expect(P.section.exec('124A. Sedition.—Whoever ...')?.[1]).toBe('124A');
  });
  it('recognises provisos, explanations, exceptions and illustrations', () => {
    expect(P.proviso.test('Provided that nothing in this section ...')).toBe(true);
    expect(P.proviso.test('Provided further that ...')).toBe(true);
    expect(P.explanation.test('Explanation 1.— For the purposes ...')).toBe(true);
    expect(P.exception.test('Exception 1.— ...')).toBe(true);
    expect(P.illustration.test('Illustrations')).toBe(true);
  });
  it('recognises sub-sections and clauses', () => {
    expect(P.subSection.exec('(2) Where ...')?.[1]).toBe('2');
    expect(P.clause.exec('(a) any person ...')?.[1]).toBe('a');
    expect(P.clause.exec('(iv) ...')?.[1]).toBe('iv');
  });
  it('does not treat ordinary prose as a section', () => {
    expect(P.section.test('In 1954 the Court considered the matter')).toBe(false);
    expect(P.section.test('2. The words "or any other" were omitted by Act 3 of 1951')).toBe(false);
  });
  it('keeps hyphenated words and "etc." inside a section title', () => {
    const m = P.section.exec('19. Protection of certain rights regarding freedom of speech, etc.—(1) All citizens shall have the right—');
    expect(m?.[2]).toBe('Protection of certain rights regarding freedom of speech, etc');
    expect(m?.[3]).toBe('(1) All citizens shall have the right—');
    expect(P.section.exec('7. Co-operative societies.—Every society ...')?.[2]).toBe('Co-operative societies');
  });
  it('recognises chapters and Constitution parts', () => {
    expect(P.chapter.exec('CHAPTER III')?.[2]).toBe('III');
    expect(P.chapter.exec('PART IVA')?.[2]).toBe('IVA');
  });
  it('recognises amendment footnotes', () => {
    expect(P.amendment.exec('1. Ins. by the Constitution (Ninety-seventh Amendment) Act, 2011, s. 2 (w.e.f. 15-2-2012).')?.[1]).toBe('1');
    expect(P.amendment.test('3. Sub-clause (f) omitted by s. 2, ibid. (w.e.f. 20-6-1979).')).toBe(true);
    expect(P.amendment.test('56. Agreement to do impossible act.—An agreement ...')).toBe(false);
  });
});

describe('chapter and footnote markers found in India Code PDFs', () => {
  it('reads a chapter number with a footnote marker glued on, and keeps arabic numbers whole', () => {
    expect(P.chapter.exec('CHAPTER II1')?.[2]).toBe('II');
    expect(P.chapter.exec('CHAPTER 12')?.[2]).toBe('12');
    expect(P.chapter.exec('PART IVA')?.[2]).toBe('IVA');
  });
  it('treats a commencement note as a footnote', () => {
    expect(P.amendment.test('1. 9th day of October, 2023, vide notification No. S.O. 4384(E), for Ss.1, 3')).toBe(true);
    expect(P.amendment.test('1. Short title and commencement.—(1) This Act may be called')).toBe(false);
  });
});
