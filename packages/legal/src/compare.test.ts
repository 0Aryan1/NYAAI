import { describe, expect, it } from 'vitest';
import { matchChunks, textAgreement } from './compare.ts';
import { escrCaseName, escrDate, escrPages, pickEscrByDate, pickEscrRecord, type EscrRecord } from './escr.ts';

describe('textAgreement', () => {
  it('ignores case, quote styles and line breaks', () => {
    const a = 'An award can be set aside only on the grounds mentioned in Section 34(2) and (3), and not otherwise.';
    const b = 'an award can be set aside only on the grounds mentioned in section 34 (2) and (3),\nand not otherwise';
    expect(textAgreement(a, b).aInB).toBeGreaterThan(0.9);
  });

  it('reads a copy that holds more (a missing majority opinion) as containing the shorter one', () => {
    const concurrence = 'I agree with the conclusion that the group of companies doctrine has an independent existence in Indian law.';
    const full = `The majority opinion discusses consent and party autonomy at length. ${concurrence}`;
    const r = textAgreement(concurrence, full);
    expect(r.aInB).toBe(1);
    expect(r.bInA).toBeLessThan(0.7);
  });
});

describe('matchChunks', () => {
  const old = [
    { id: 'a', text: '1. Leave granted.' },
    { id: 'b', text: '2. The present appeal raises an interesting question as to whether two companies incorporated in India can choose a foreign seat.' },
    { id: 'c', text: '3. A paragraph that the new copy no longer has at all, about something quite different entirely.' },
  ];

  it('gives a paragraph its old id, and its label only when the text is the same', () => {
    const fresh = [
      '1. Leave granted.',
      '2. The present appeal raises an interesting question – as to whether two companies incorporated in India can choose a foreign seat.',
      '3. Section 44 of the Act defines a foreign award for the purposes of Part II.',
    ];
    const m = matchChunks(old, fresh);
    expect(m[0]).toEqual({ id: 'a', same: true });
    expect(m[1]).toEqual({ id: 'b', same: true });
    expect(m[2]).toEqual({ id: null, same: false });
  });

  it('never hands one old id to two new paragraphs', () => {
    const m = matchChunks(old, [old[1]!.text, old[1]!.text]);
    expect(m.filter((x) => x.id === 'b')).toHaveLength(1);
  });
});

describe('e-SCR records', () => {
  const rec = (title: string, decidedOn: string, path: string): EscrRecord => ({ title, citation: null, neutralCitation: null, decidedOn, path, year: decidedOn.slice(0, 4), judges: null, english: true });

  it('reads e-SCR dates, page spans and titles', () => {
    expect(escrDate('25-11-2014')).toBe('2014-11-25');
    expect(escrPages('2014_13_895_956')).toBe(62);
    expect(escrCaseName('COX AND KINGS LTD. versus SAP INDIA PVT. LTD. & ANR.')).toBe('COX AND KINGS LTD. v. SAP INDIA PVT. LTD. & ANR.');
  });

  it('picks the named case by party words and year, then the longer report', () => {
    const records = [
      rec('SUNRISE ASSOCIATES versus GOVT. OF NCT OF DELHI', '2006-05-04', '2006_1_421_470'),
      rec('ASSOCIATE BUILDERS versus DELHI DEVELOPMENT AUTHORITY', '2014-11-25', '2014_13_895_956'),
      rec('ASSOCIATE BUILDERS versus DELHI DEVELOPMENT AUTHORITY', '2015-02-10', '2015_1_10_12'),
    ];
    expect(pickEscrRecord('Associate Builders v. Delhi Development Authority', records, { year: 2014 })?.path).toBe('2014_13_895_956');
    expect(pickEscrRecord('Kinnari Mullick v. Ghanshyam Das Damani', records, { year: 2017 })).toBeNull();
  });

  it('finds a case spelt differently by its date and one party word, and only when that is unique', () => {
    const records = [rec('VIDYA DEVI versus THE STATE OF HIMACHAL PRADESH & ORS.', '2020-01-08', '2020_1_749_756'), rec('RAM LAL versus STATE OF PUNJAB', '2020-01-08', '2020_1_757_760')];
    expect(pickEscrRecord('Vidaya Devi v. The State Of Himachal Pradesh', records, { year: 2020 })).toBeNull();
    expect(pickEscrByDate('Vidaya Devi v. The State Of Himachal Pradesh', records, '2020-01-08')?.path).toBe('2020_1_749_756');
    expect(pickEscrByDate('Vidaya Devi v. The State Of Himachal Pradesh', records, '2020-01-09')).toBeNull();
  });
});
