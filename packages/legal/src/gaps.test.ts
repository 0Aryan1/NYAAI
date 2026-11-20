import { describe, expect, it } from 'vitest';
import { actKey, actMentions, caseMatches, classifyGap, libraryActName, onAllowlist, pickAct, questionKey, sameAct } from './gaps.ts';

describe('actKey and sameAct', () => {
  it('compares Act names from India Code, the library and teachers', () => {
    expect(actKey('The Sale of Goods Act, 1930')).toBe('sale of goods act');
    expect(sameAct('The Indian Contract Act, 1872', 'Indian Contract Act')).toBe(true);
    expect(sameAct('The Specific Relief Act, 1963', 'Indian Contract Act')).toBe(false);
  });
});

describe('actMentions', () => {
  it('finds known Acts by alias, with their year', () => {
    expect(actMentions('transfer of property under the SGA')).toEqual([{ name: 'Sale of Goods Act', year: 1930 }]);
    expect(actMentions('specific performance under the Specific Relief Act')).toEqual([{ name: 'Specific Relief Act', year: 1963 }]);
  });

  it('finds any capitalised Act name, dropping the words that start the sentence', () => {
    expect(actMentions('Explain the Limitation Act, 1963 and acknowledgment of debt')).toEqual([{ name: 'Limitation Act', year: 1963 }]);
    expect(actMentions('What does the Information Technology Act say about electronic contracts')).toEqual([
      { name: 'Information Technology Act', year: null },
    ]);
  });

  it('takes the year from the question over the known year', () => {
    expect(actMentions('Consumer Protection Act, 1986 and deficiency of service')).toEqual([{ name: 'Consumer Protection Act', year: 1986 }]);
  });

  it('ignores the Constitution and sentences that only say "the Act"', () => {
    expect(actMentions('Article 21 of the Constitution')).toEqual([]);
    expect(actMentions('Is the Act valid after amendment?')).toEqual([]);
    expect(actMentions('doctrine of frustration')).toEqual([]);
  });
});

describe('classifyGap', () => {
  const loaded = ['Indian Contract Act', 'Constitution of India'];

  it('is an Act gap when the question names an Act the library does not hold', () => {
    expect(classifyGap('passing of property under the Sale of Goods Act', loaded)).toEqual({
      kind: 'act',
      act: { name: 'Sale of Goods Act', year: 1930 },
      caseName: null,
    });
  });

  it('is not an Act gap when the Act is already loaded', () => {
    expect(classifyGap('frustration under s. 56 of the Indian Contract Act', loaded).kind).toBe('topic');
  });

  it('is a case gap when the question names a case', () => {
    expect(classifyGap('What did Taylor v. Caldwell hold?', loaded)).toEqual({ kind: 'case', act: null, caseName: 'Taylor v. Caldwell' });
  });

  it('is a topic gap otherwise', () => {
    expect(classifyGap('will theory and reliance theory of contract', loaded).kind).toBe('topic');
  });
});

describe('questionKey', () => {
  it('counts the same question typed differently as one gap', () => {
    expect(questionKey('Doctrine of Frustration?')).toBe(questionKey('  doctrine of   frustration '));
  });
});

describe('pickAct (load only an exact, unrepealed, single match)', () => {
  const sga = { title: 'The Sale of Goods Act, 1930', year: 1930, repealed: false };
  const old = { title: 'The Sale of Goods Act, 1930', year: 1930, repealed: true };
  const other = { title: 'The Sale of Goods (Amendment) Act, 1963', year: 1963, repealed: false };

  it('picks the one exact match', () => {
    expect(pickAct({ name: 'Sale of Goods Act', year: 1930 }, [other, sga])).toEqual({ kind: 'one', act: sga });
    expect(pickAct({ name: 'Sale of Goods Act', year: null }, [other, sga])).toEqual({ kind: 'one', act: sga });
  });

  it('never takes a near match or a different year', () => {
    expect(pickAct({ name: 'Sale of Goods Act', year: 1940 }, [sga])).toEqual({ kind: 'none' });
    expect(pickAct({ name: 'Goods Act', year: null }, [sga])).toEqual({ kind: 'none' });
  });

  it('leaves repealed Acts and several matches to the editor', () => {
    expect(pickAct({ name: 'Sale of Goods Act', year: 1930 }, [old])).toEqual({ kind: 'repealed', act: old });
    const twin = { ...sga, title: 'Sale of Goods Act' };
    expect(pickAct({ name: 'Sale of Goods Act', year: null }, [sga, twin]).kind).toBe('ambiguous');
  });
});

describe('libraryActName and caseMatches', () => {
  it('turns an India Code title into the library name', () => {
    expect(libraryActName('The Sale of Goods Act, 1930')).toBe('Sale of Goods Act');
    expect(libraryActName('The Indian Contract Act, 1872')).toBe('Indian Contract Act');
  });
  it('accepts a hit only when both parties are in its title', () => {
    expect(caseMatches('Satyabrata Ghose v. Mugneeram Bangur', 'Satyabrata Ghose vs Mugneeram Bangur And Co. And Anr on 16 November, 1953')).toBe(true);
    expect(caseMatches('Satyabrata Ghose v. Mugneeram Bangur', 'Satyabrata Ghose vs State Of West Bengal')).toBe(false);
    expect(caseMatches('Kharak Singh v. State of U.P.', 'Kharak Singh vs The State Of U. P. & Others')).toBe(true);
    expect(caseMatches('Maneka Gandhi v. Union of India', 'Maneka Gandhi vs Union Of India on 25 January, 1978')).toBe(true);
    expect(caseMatches('Maneka Gandhi v. Union of India', 'Union Of India vs Maneka Gandhi')).toBe(false);
    expect(caseMatches('State v. Union of India', 'State Of Bihar vs Union Of India')).toBe(false);
  });
});

describe('onAllowlist', () => {
  const allow = ['gov.in', 'nic.in'];
  it('accepts the domain and its sub-domains over https only', () => {
    expect(onAllowlist('https://indiacode.gov.in/handle/1', allow)).toBe(true);
    expect(onAllowlist('https://gov.in/x', allow)).toBe(true);
    expect(onAllowlist('http://indiacode.gov.in/x', allow)).toBe(false);
  });
  it('rejects look-alike hosts', () => {
    expect(onAllowlist('https://notgov.in/x', allow)).toBe(false);
    expect(onAllowlist('https://gov.in.evil.com/x', allow)).toBe(false);
    expect(onAllowlist('not a url', allow)).toBe(false);
  });
});
