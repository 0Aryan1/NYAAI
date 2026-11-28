import { describe, expect, it } from 'vitest';
import { matchHeldCase, type HeldCase } from './same-case.ts';

const gayatri: HeldCase = {
  sourceId: 'g',
  title: 'Gayatri Balasamy v. M/S Isg Novasoft Technologies Limited',
  decidedOn: '2025-04-30',
  courtLevel: 'supreme_court',
};
const rajesh2015: HeldCase = {
  sourceId: 'r',
  title: 'Union of India v. Rajesh Kumar (2015)',
  decidedOn: '2015-03-10',
  courtLevel: 'supreme_court',
};
const SC = 'Supreme Court of India';

describe('is a Kanoon judgment one the library already holds?', () => {
  it('same parties, same date, same court: the same case', () => {
    const m = matchHeldCase(
      { title: 'Gayatri Balasamy vs M/S Isg Novasoft Technologies Limited on 30 April, 2025', docsource: SC },
      [rajesh2015, gayatri],
    );
    expect(m).toEqual({ kind: 'same', held: gayatri });
  });

  it('a shortened Kanoon title still matches the full name', () => {
    expect(
      matchHeldCase({ title: 'Gayatri Balasamy vs M/S Isg Novasoft ... on 30 April, 2025', docsource: SC }, [gayatri])
        ?.kind,
    ).toBe('same');
  });

  it('same names in another year: only maybe, so it is downloaded and the editor asked', () => {
    const m = matchHeldCase({ title: 'Union Of India vs Rajesh Kumar on 2 August, 2019', docsource: SC }, [rajesh2015]);
    expect(m).toEqual({ kind: 'maybe', held: rajesh2015 });
  });

  it('same names and date but another court: only maybe', () => {
    expect(
      matchHeldCase({ title: 'Union Of India vs Rajesh Kumar on 10 March, 2015', docsource: 'Delhi High Court' }, [
        rajesh2015,
      ])?.kind,
    ).toBe('maybe');
  });

  it('no date on the Kanoon title: only maybe', () => {
    expect(
      matchHeldCase({ title: 'Gayatri Balasamy vs M/S Isg Novasoft Technologies Limited', docsource: SC }, [gayatri])
        ?.kind,
    ).toBe('maybe');
  });

  it('a different case on the same topic is not a match at all', () => {
    expect(
      matchHeldCase(
        { title: 'Ssangyong Engineering vs National Highways Authority Of India on 8 May, 2019', docsource: SC },
        [gayatri, rajesh2015],
      ),
    ).toBeNull();
  });

  it('a title with no "v." matches on its words', () => {
    const inRe: HeldCase = {
      sourceId: 'i',
      title:
        'In Re: Interplay between Arbitration Agreements under the Arbitration and Conciliation Act, 1996 and the Indian Stamp Act, 1899',
      decidedOn: '2023-12-13',
      courtLevel: 'supreme_court',
    };
    expect(
      matchHeldCase(
        { title: 'In Re: Interplay Between Arbitration Agreements Under The ... on 13 December, 2023', docsource: SC },
        [inRe],
      )?.kind,
    ).toBe('same');
    expect(
      matchHeldCase({ title: 'In Re: Section 6A Of The Citizenship Act 1955 on 17 October, 2024', docsource: SC }, [
        inRe,
      ]),
    ).toBeNull();
  });

  it('a same-case match wins over an earlier maybe', () => {
    const other = { ...gayatri, sourceId: 'g2', decidedOn: '2024-01-01' };
    expect(
      matchHeldCase(
        { title: 'Gayatri Balasamy vs M/S Isg Novasoft Technologies Limited on 30 April, 2025', docsource: SC },
        [other, gayatri],
      ),
    ).toEqual({ kind: 'same', held: gayatri });
  });
});
