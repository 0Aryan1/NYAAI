import { describe, expect, it } from 'vitest';
import { cleanPages, repairSpacedWords } from './clean.ts';

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
    expect(out[0]?.text).toBe("A contract is “a promise ‘enforceable’ by law” and B's right holds");
  });
});

describe('repairSpacedWords (letter-spaced PDF lines)', () => {
  const doc = (broken: string) => [
    {
      pageNo: 1,
      text: '45. Suspension of trustee powers.—A trustee who has accepted the trust cannot renounce after acceptance',
    },
    {
      pageNo: 1,
      text: 'except with the permission of a principal Civil Court of original jurisdiction, or with his consent.',
    },
    { pageNo: 1, text: broken },
  ];
  it('rejoins pieces into words the document uses elsewhere', () => {
    const out = repairSpacedWords(
      doc('4 6. Tru stee ca n not r en ou nce af ter acc ep ta nce . — A tru stee wh o h as ac cep ted'),
    );
    expect(out[2]!.text).toBe('46. Trustee cannot renounce after acceptance.—A trustee who has accepted');
    const court = repairSpacedWords(doc('C ourt of ori gin al j uris dictio n, or ( b) with the p er mis sion'));
    expect(court[2]!.text).toBe('Court of original jurisdiction, or (b) with the permission');
  });
  it('leaves normal lines alone and never joins two real words', () => {
    const normal = 'the trustee may take a part of the trust property in to his own hands';
    expect(repairSpacedWords(doc(normal))[2]!.text).toBe(normal);
  });
});

describe('repairSpacedWords on a fully letter-spaced heading', () => {
  it('rejoins words of up to 12 pieces', () => {
    const out = repairSpacedWords([
      { pageNo: 1, text: 'of mortgages of immoveable property and charges' },
      { pageNo: 2, text: 'OF MO R T G A G E S O F IM M O V E AB LE PR O P E R T Y A N D CH AR G E S' },
    ]);
    expect(out[1]!.text).toBe('OF MORTGAGES OF IMMOVEABLE PROPERTY AND CHARGES');
  });
});
