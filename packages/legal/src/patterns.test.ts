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
  });
});
