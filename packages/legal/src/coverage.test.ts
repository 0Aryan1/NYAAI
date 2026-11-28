import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mustCoverParts } from './coverage.ts';

const S56 = [
  '56. Agreement to do impossible act.—An agreement to do an act impossible in itself is void.',
  'Contract to do an act afterwards becoming impossible or unlawful.—A contract to do an act',
  'which, after the contract is made, becomes impossible, or, by reason of some event which the promisor',
  'could not prevent, unlawful, becomes void when the act becomes impossible or unlawful.',
  'Compensation for loss through non-performance of act known to be impossible or unlawful.—',
  'Where one person has promised to do something which he knew, or, with reasonable diligence, might',
  'have known, and which the promisee did not know, to be impossible or unlawful, such promisor must',
  'make compensation to such promisee for any loss which such promisee sustains through the non-performance',
  'of the promise.',
  'Illustrations',
  '(a) A agrees with B to discover treasure by magic. The agreement is void.',
].join('\n');

describe('mustCoverParts', () => {
  it('lists the headed paragraphs of s. 56, not its illustrations', () => {
    const parts = mustCoverParts(S56, 'act', '56');
    expect(parts.map((p) => p.label)).toEqual([
      's. 56: Contract to do an act afterwards becoming impossible or unlawful',
      's. 56: Compensation for loss through non-performance of act known to be impossible or unlawful',
    ]);
    expect(parts[0]!.text).toContain('becomes void when the act becomes impossible or unlawful.');
    expect(parts[1]!.text).not.toContain('treasure');
  });

  it('lists the Explanations of s. 25', () => {
    const fixture = readFileSync(new URL('../test/fixtures/ica-1872-ss25-32-56.txt', import.meta.url), 'utf8');
    const s25 = fixture.slice(fixture.indexOf('25. Agreement without consideration'), fixture.indexOf('\n32. '));
    expect(mustCoverParts(s25, 'act', '25').map((p) => p.label)).toEqual(
      expect.arrayContaining(['Explanation 1 to s. 25', 'Explanation 2 to s. 25']),
    );
  });

  it('lists the clauses and sub-clauses of Article 19, skipping the omitted (f)', () => {
    const fixture = readFileSync(new URL('../test/fixtures/constitution-arts18-20.txt', import.meta.url), 'utf8');
    const a19 = fixture
      .slice(fixture.indexOf('19. Protection of certain rights'), fixture.indexOf('\n20. '))
      .replace(/\d\[/g, '[');
    const labels = mustCoverParts(a19, 'constitution', '19').map((p) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining(['Article 19(1)(a)', 'Article 19(1)(g)', 'Article 19(2)', 'Article 19(6)']),
    );
    expect(labels).not.toContain('Article 19(1)(f)');
    expect(labels).not.toContain('Article 19(1)');
  });

  it('lists provisos with their number and the sub-section they belong to', () => {
    const t = [
      '10. Thing.—(1) A rule.',
      'Provided that first.',
      'Provided further that second.',
      '(2) Another rule.',
      'Provided that third.',
    ].join('\n');
    expect(mustCoverParts(t, 'act', '10').map((p) => p.label)).toEqual([
      'Proviso to s. 10(1)',
      'Proviso 2 to s. 10(1)',
      'Proviso 3 to s. 10(2)',
    ]);
    expect(mustCoverParts('11. Plain.—A rule.\nProvided that x.', 'act', '11').map((p) => p.label)).toEqual([
      'Proviso to s. 11',
    ]);
  });
});
