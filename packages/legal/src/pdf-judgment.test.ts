import { describe, expect, it } from 'vitest';
import { benchOf, pdfToJudgment, reporterNoteOf, type PdfLine, type PdfLines } from './pdf-judgment.ts';
import { splitJudgment } from './judgment.ts';

const L = (text: string, o: Partial<PdfLine> = {}): PdfLine => ({ text, size: 11, x: 100, y: 0, marks: [], ...o });
const doc = (pages: PdfLine[][], scanned = false): PdfLines => ({ pages: pages.map((lines, i) => ({ pageNo: i + 1, lines })), scanned, bodySize: 11 });
const LONG = 'x'.repeat(70);

describe('pdfToJudgment (official PDFs)', () => {
  const pages = [
    [
      L('[2021] 4 S.C.R. 532 : 2021 INSC 264'),
      L('PASL WIND SOLUTIONS PRIVATE LIMITED'),
      L('v.'),
      L('GE POWER CONVERSION INDIA PRIVATE LIMITED'),
      L('[R. F. NARIMAN, B. R. GAVAI AND HRISHIKESH ROY, JJ.]'),
      L('Arbitration – Foreign seat – Two Indian parties may choose a foreign seat of arbitration.'),
      L('Case Law Cited'),
      L('Atlas Export Industries v. Kotak & Co., (1999) 7 SCC 61 – relied on.'),
      L('The Judgment of the Court was delivered by'),
      L('R. F. NARIMAN, J.'),
      L('1. Leave granted.'),
      L('2. The present appeal raises an interesting question of law, an interest-'),
      L('ing one, as to whether two companies incorporated in India can choose a forum', { marks: ['1'] }),
      L('outside India for their arbitration, and whether the award is a foreign one.'),
      L('1 (2016) 10 SCC 813', { size: 9 }),
      L('A'),
      L('B'),
      L('532'),
    ],
    [
      L('A'),
      L('PASL WIND SOLUTIONS PVT. LTD. v. GE POWER'),
      L('CONVERSION INDIA PVT. LTD. [R. F. NARIMAN, J.]'),
      L('533'),
      L('3. Section 44 of the Arbitration Act, which defines a foreign award, reads:'),
      L('“44. Definition.—In this Chapter, unless the context otherwise requires,', { x: 130 }),
      L('foreign award means an arbitral award on differences between persons.”', { x: 130 }),
      L('4. The appellant says that the doctrine binding non-signatory parties is not'),
      L('of help to the respondent, since the agreement binds only its own non-'),
      L('signatory affiliates when the parties so intended at the time of contracting.'),
    ],
  ];
  const input = pdfToJudgment(doc(pages), { caseName: 'PASL WIND SOLUTIONS PRIVATE LIMITED v. GE POWER CONVERSION INDIA PRIVATE LIMITED', decidedOn: '2021-04-20', court: 'Supreme Court of India' });
  const texts = input.blocks.map((b) => b.text);

  it('keeps the reporter summary as the headnote and cuts case details and lists from it', () => {
    expect(input.headnote).toContain('Two Indian parties may choose a foreign seat');
    expect(input.headnote).not.toContain('Atlas Export');
    expect(input.bench).toEqual(['R. F. NARIMAN', 'B. R. GAVAI', 'HRISHIKESH ROY']);
  });

  it('drops running heads, page numbers, margin letters and footnotes', () => {
    const all = texts.join('\n');
    expect(all).not.toMatch(/S\.C\.R\./);
    expect(all).not.toMatch(/PVT\. LTD\./);
    expect(all).not.toMatch(/\b532\b|\b533\b/);
    expect(all).not.toContain('(2016) 10 SCC 813');
    expect(texts.some((t) => /^[A-H]$/.test(t))).toBe(false);
  });

  it('keeps the "delivered by" sentence and the judge line for the splitter, then the court’s paragraphs', () => {
    expect(texts[0]).toMatch(/delivered by/);
    expect(texts.some((t) => t.startsWith('1. Leave granted.'))).toBe(true);
    expect(texts.find((t) => t.startsWith('2.'))).toContain('choose a forum outside India for their arbitration');
  });

  it('joins a hyphenated line end only into a word the document uses, and keeps real hyphens', () => {
    const p2 = texts.find((t) => t.startsWith('2.'))!;
    expect(p2).toContain('an interesting one'); // "interest-" + "ing": "interesting" is used elsewhere
    const p4 = texts.find((t) => t.startsWith('4.'))!;
    expect(p4).toContain('its own non-signatory affiliates'); // "non-signatory" is used elsewhere with its hyphen
  });

  it('marks an indented quotation as quoted and gives each block its printed page', () => {
    const quote = input.blocks.find((b) => b.text.startsWith('“44.'))!;
    expect(quote.quoted).toBe(true);
    expect(input.blocks.find((b) => b.text.startsWith('3.'))!.page).toBe(533);
  });

  it('splits into the court’s numbered paragraphs, one majority opinion', () => {
    const split = splitJudgment(input);
    expect(split.paraNoSource).toBe('court');
    expect(split.opinions).toEqual([{ index: 0, type: 'majority', judge: 'R. F. NARIMAN' }]);
    expect(split.chunks.filter((c) => c.kind === 'paragraph').map((c) => c.paraNo)).toEqual(['1', '2', '3', '4']);
  });

  it('drops a table of contents and the author’s name repeated in page footers', () => {
    const toc = pdfToJudgment(
      doc([
        [
          L('JUDGMENT / ORDER OF THE SUPREME COURT'),
          L('JUDGMENT'),
          L('DR. DHANANJAYA Y CHANDRACHUD, CJI'),
          L('Table of Contents*'),
          L('A. The reference'),
          L('B. Submissions'),
          L(`1. More than a century ago ${LONG}`),
          L('ended.'),
          L('[DR. DHANANJAYA Y CHANDRACHUD, CJI]'),
        ],
      ]),
      { caseName: 'COX AND KINGS LTD. v. SAP INDIA PVT. LTD.', decidedOn: null, court: 'Supreme Court of India' },
    );
    expect(toc.blocks.map((b) => b.text)).toEqual(['DR. DHANANJAYA Y CHANDRACHUD, CJI', `1. More than a century ago ${LONG} ended.`]);
  });

  it('finds the court’s text after a "delivered" sentence broken over lines, and cuts the next case printed after it', () => {
    const old = pdfToJudgment(
      doc(
        [
          [
            L('ASSOCIATED HOTELS OF INDIA LTD.'),
            L('v.'),
            L('R. N. KAPOOR'),
            L('(S. K. DAS, A. K. SARKAR and K. SUBBA RAO, JJ.)'),
            L('Rent Control - Room in a hotel - Meaning of.'),
            L('Judgments'),
            L('were'),
            L('delivered'),
            L('S. K. Das J.'),
            L('This appeal raises a question on the meaning of a room in a hotel under the Act of 1947.'),
            L('The appeal fails and is dismissed.'),
            L('DHRANGADHRA CHEMICAL WORKS LTD.'),
            L('v.'),
            L('THE DHRANGADHRA MUNICIPALITY'),
            L('(B. P. SINHA, JAFER IMAM and K. C. WANCHOO, JJ.)'),
            L('The respondent Municipality issued a notice under the Bombay District Municipal Act.'),
          ],
        ],
        true,
      ),
      { caseName: 'ASSOCIATED HOTELS OF INDIA LTD. v. R. N. KAPOOR', decidedOn: '1959-09-18', court: 'Supreme Court of India' },
    );
    const all = old.blocks.map((b) => b.text).join('\n');
    expect(old.headnote).toContain('Room in a hotel');
    expect(all).toContain('This appeal raises a question');
    expect(all).toContain('The appeal fails and is dismissed.');
    expect(all).not.toContain('DHRANGADHRA');
  });

  it('takes scanned reports’ margin letters out of the text column', () => {
    const scan = pdfToJudgment(
      doc([[L('The Judgment of the Court was delivered by'), L(`1. It is only when the award is in conflict with the public policy of India F`), L('A that the merits are looked into.')]], true),
      { caseName: 'X v. Y', decidedOn: null, court: null },
    );
    expect(scan.blocks.map((b) => b.text)).toContain('1. It is only when the award is in conflict with the public policy of India that the merits are looked into.');
  });
});

describe('reporter notes and the Bench', () => {
  it('reads the e-SCR editor’s note on who formed the majority, and the separate opinions', () => {
    const note = reporterNoteOf([
      "Ed. Note: Hon’ble Dr. Dhananjaya Y. Chandrachud, CJI pronounced judgment on behalf of his Lordship, Hon’ble Mr. Justice Hrishikesh Roy, Hon’ble Mr. Justice J.B. Pardiwala and Hon’ble Mr. Justice Manoj Misra. Hon’ble Mr. Justice Pamidighantam Sri Narasimha pronounced a separate concurring judgment.",
    ]);
    expect(note.majority).toEqual(['Dhananjaya Y. Chandrachud', 'Hrishikesh Roy', 'J.B. Pardiwala', 'Manoj Misra']);
  });

  it('reads "(per X, J.) (Dissenting)" and "Per X, J. (Concurring):"', () => {
    const note = reporterNoteOf(['Held: (per K.V. Viswanathan, J.) (Dissenting) Courts exercising …', 'Per N. V. RAMANA, J. (Concurring): The reference …']);
    expect(note.dissenting).toEqual(['K.V. Viswanathan']);
    expect(note.concurring).toEqual(['N. V. RAMANA']);
  });

  it('types the opinions from the notes when the text does not say', () => {
    const split = splitJudgment({
      caseName: 'Gayatri Balasamy v. ISG Novasoft',
      decidedOn: '2025-04-30',
      court: 'Supreme Court of India',
      citations: [],
      author: null,
      bench: ['Sanjiv Khanna', 'B.R. Gavai', 'Sanjay Kumar', 'K.V. Viswanathan', 'A.G. Masih'],
      headnote: null,
      reporterNote: { majority: [], concurring: [], dissenting: ['K.V. Viswanathan'] },
      blocks: [
        { text: 'SANJIV KHANNA, CJI', page: 1, quoted: false },
        { text: '1. The question referred is whether courts may modify an award.', page: 1, quoted: false },
        { text: '2. We answer it as follows.', page: 1, quoted: false },
        { text: 'K.V. VISWANATHAN, J.', page: 2, quoted: false },
        { text: '1. I have read the opinion of the learned Chief Justice.', page: 2, quoted: false },
      ],
    });
    expect(split.opinions.map((o) => o.type)).toEqual(['majority', 'dissent']);
  });

  it('reads the Bench line, also over two lines', () => {
    expect(benchOf(['[DR DHANANJAYA Y CHANDRACHUD, CJI,', 'HRISHIKESH ROY AND MANOJ MISRA, JJ.]'])).toEqual(['DHANANJAYA Y CHANDRACHUD', 'HRISHIKESH ROY', 'MANOJ MISRA']);
  });
});
