import { describe, expect, it } from 'vitest';
import { linkCase, numbersIn, type ConceptForLinking } from './case-links.ts';

const k = (
  id: string,
  name: string,
  subject: string,
  sections: string[],
  aliases: string[] = [],
  act = 'Some Act',
): ConceptForLinking => ({
  id,
  name,
  subject,
  aliases,
  sections: sections.map((n) =>
    /A$/.test(n) && n.length > 3
      ? { kind: 'article' as const, act: null, number: n }
      : { kind: 'section' as const, act, number: n },
  ),
});
const concepts = [
  k('setaside', 'Setting aside an arbitral award', 'ADR', ['34'], ['section 34', 'public policy of India']),
  k('seat', 'Seat of arbitration', 'ADR', ['20', '2'], ['juridical seat', 'venue of arbitration']),
  k('agreement', 'Arbitration agreement', 'ADR', ['7', '8'], ['arbitrability']),
  k('lispendens', 'Lis pendens', 'Property', ['52'], ['transfer pending suit'], 'Transfer of Property Act'),
  k('licence', 'Lease and licence', 'Property', ['52'], [], 'Indian Easements Act'),
  k('lokadalat', 'Lok Adalat', 'ADR', ['21'], [], 'Legal Services Authorities Act'),
  k('redemption', 'Equity of redemption', 'Property', ['60', '62'], ['clog on redemption']),
  k('rtp', 'Right to property', 'Property', ['300A'], ['article 300A']),
  k('contract34', 'Something in contract', 'Contract', ['34']),
];

describe('leading cases to topics', () => {
  it('reads section and Article numbers from a note', () => {
    expect(numbersIn('Remitting an award under section 34(4); see also s. 37 and Article 300A')).toEqual([
      '34',
      '37',
      '300A',
    ]);
    expect(numbersIn('Part performance (section 53A) as a shield')).toEqual(['53A']);
  });

  it('a section links to the topic of the same subject that holds it, not another subject', () => {
    expect(
      linkCase({ name: 'Associate Builders v. DDA', topic: 'Public policy grounds under section 34' }, concepts, 'ADR'),
    ).toEqual([{ conceptId: 'setaside', reason: 'section' }]);
  });

  it("a topic's name or alias in the note links it, as whole words, plural allowed", () => {
    expect(linkCase({ name: 'x', topic: 'Unstamped arbitration agreements (seven judges)' }, concepts, 'ADR')).toEqual([
      { conceptId: 'agreement', reason: 'name' },
    ]);
    expect(linkCase({ name: 'x', topic: 'Clog on redemption; long-term mortgages' }, concepts, 'Property')).toEqual([
      { conceptId: 'redemption', reason: 'name' },
    ]);
    expect(
      linkCase(
        { name: 'x', topic: 'Doctrine of lis pendens (section 52)', acts: ['Transfer of Property Act'] },
        concepts,
        'Property',
      ),
    ).toEqual([{ conceptId: 'lispendens', reason: 'section' }]);
    expect(linkCase({ name: 'x', topic: 'Seat versus venue' }, concepts, 'ADR')).toEqual([]); // neither: a person names it
  });

  it('topics a person named in the pack win', () => {
    expect(
      linkCase(
        { name: 'BGS SGS Soma', topic: 'Seat versus venue', concepts: ['Seat of arbitration'] },
        concepts,
        'ADR',
      ),
    ).toEqual([{ conceptId: 'seat', reason: 'named_by_pack' }]);
    expect(linkCase({ name: 'x', topic: 'y', concepts: ['No such topic'] }, concepts, 'ADR')).toEqual([]);
  });

  it('an Article never matches a section of the same number', () => {
    expect(linkCase({ name: 'M.H. Hoskot', topic: 'Free legal aid as part of Article 21' }, concepts, 'ADR')).toEqual(
      [],
    );
    expect(linkCase({ name: 'x', topic: 'Article 300A after the 44th Amendment' }, concepts, 'Property')).toEqual([
      { conceptId: 'rtp', reason: 'section' },
    ]);
  });

  it("a section matches only the Acts taught in the case's unit", () => {
    // Unit acts known: s. 52 is the Transfer of Property Act's, not the Easements Act's.
    expect(
      linkCase(
        { name: 'x', topic: 'Section 52 again', acts: ['Transfer of Property Act', 'Registration Act'] },
        concepts,
        'Property',
      ),
    ).toEqual([{ conceptId: 'lispendens', reason: 'section' }]);
  });
});
