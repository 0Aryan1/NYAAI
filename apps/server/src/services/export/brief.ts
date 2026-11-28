/**
 * A research brief as Word or PDF (RES-5; LLD §10, "Research brief → Word": a footnote on each flagged sentence, a
 * closing "Please verify" list, grey cases marked "(status not verified)" in the text). Built from the brief as saved
 * and checked, never from the browser, so the file says exactly what the page says, flags included.
 * `planBrief` decides the content (pure, tested); `renderDocx` and `renderPdf` only lay it out.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';
import type { BriefLine, ResearchRunView } from '@nyaai/shared';

export const NOT_VERIFIED = '(status not verified)';
const RELATION = { supports: 'Supports', limits: 'Limits', conflicts: 'Conflicts' } as const;

export interface PlannedLine {
  text: string;
  /** "S1 · s. 34 Arbitration and Conciliation Act, 1996" */
  sources: string[];
  /** Footnote number when the line is to verify. */
  note: number | null;
}
export interface PlannedBrief {
  title: string;
  subtitle: string;
  sections: { heading: string; lines?: PlannedLine[]; bullets?: string[] }[];
  /** Footnotes, in order: "Please verify: …", with the line they belong to (for the closing list). */
  notes: { n: number; text: string; line: string }[];
  evidence: { tag: string; label: string; meta: string; relation: string; status: string; words: string[] }[];
  footer: string;
}

/** The content of the file, in the order of the page. */
export function planBrief(
  run: Pick<ResearchRunView, 'question' | 'scope' | 'brief' | 'createdAt'>,
  today: string,
): PlannedBrief {
  const b = run.brief;
  if (!b) throw new Error('the brief is not ready');
  const notes: PlannedBrief['notes'] = [];
  const line = (l: BriefLine): PlannedLine => {
    const grey = l.flag === 'grey';
    let note: number | null = null;
    if (l.flag === 'yellow') {
      note = notes.length + 1;
      notes.push({ n: note, text: `Please verify: ${l.reason ?? 'this line'}`, line: l.text });
    }
    return {
      text: grey && !l.text.includes(NOT_VERIFIED) ? `${l.text} ${NOT_VERIFIED}` : l.text,
      sources: l.sources.map((s) => `${s.tag} · ${s.label}`),
      note,
    };
  };
  const sections: PlannedBrief['sections'] = [];
  const empty = b.shortAnswer.length === 0 && b.keyPoints.length === 0;
  if (empty)
    sections.push({
      heading: 'Short answer',
      bullets: [
        'The library does not hold enough to answer this yet. The library team has the question and will look for the sources.',
      ],
    });
  else {
    sections.push({ heading: 'Short answer', lines: b.shortAnswer.map(line) });
    if (b.keyPoints.length) sections.push({ heading: 'Key points', lines: b.keyPoints.map(line) });
    if (b.conflicts.length) sections.push({ heading: 'Where the authorities differ', lines: b.conflicts.map(line) });
  }
  if (b.openQuestions.length) sections.push({ heading: 'Open questions', bullets: b.openQuestions });
  if (b.notFound.length) sections.push({ heading: 'Not found in the sources', bullets: b.notFound });
  const years =
    run.scope.fromYear || run.scope.toYear
      ? ` · judgments ${run.scope.fromYear ?? 'any year'}–${run.scope.toYear ?? 'now'}`
      : '';
  return {
    title: run.question,
    subtitle: `Research brief · ${run.scope.comparative ? 'Comparative' : 'India only'}${years} · asked ${run.createdAt.slice(0, 10)} · exported ${today}`,
    sections,
    notes,
    evidence: b.evidence.map((e) => ({
      tag: e.tag,
      label: e.label,
      meta: [
        e.court,
        e.decidedOn,
        `found for question ${e.subQuestion}`,
        e.provisional ? 'not yet reviewed by the library team' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      relation: RELATION[e.relation],
      status: e.statusLabel,
      words: e.spans.length ? e.spans : [e.text.slice(0, 600)],
    })),
    footer:
      'Prepared with NYAAI from the library’s Acts and judgments only. Every line was checked against the words it cites; lines marked with a number are still to verify (see the notes).',
  };
}

export function briefFileName(question: string, today: string, ext: 'docx' | 'pdf'): string {
  const words = question
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => w[0]!.toUpperCase() + w.slice(1));
  return `Research_${words.join('_') || 'Brief'}_${today}.${ext}`;
}

/* -------------------------------------------------------------------------------------------------- Word */

const YELLOW = 'A34A07';
const MUTED = '5B6270';

export async function renderDocx(p: PlannedBrief): Promise<Buffer> {
  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: p.title })] }),
    new Paragraph({ children: [new TextRun({ text: p.subtitle, color: MUTED, size: 20 })], spacing: { after: 240 } }),
  ];
  for (const s of p.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s.heading)] }));
    for (const l of s.lines ?? []) {
      body.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: l.text, ...(l.note ? { underline: { color: YELLOW } } : {}) }),
            ...(l.note ? [new FootnoteReferenceRun(l.note)] : []),
            ...(l.sources.length
              ? [new TextRun({ text: l.sources.join('; '), color: MUTED, size: 18, break: 1 })]
              : []),
          ],
        }),
      );
    }
    for (const x of s.bullets ?? []) body.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(x)] }));
  }
  if (p.evidence.length) {
    body.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`Evidence (${p.evidence.length})`)] }),
    );
    const cell = (children: Paragraph[], width: number, head = false) =>
      new TableCell({
        children,
        width: { size: width, type: WidthType.PERCENTAGE },
        ...(head ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF0F3' } } : {}),
      });
    body.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              cell([new Paragraph({ children: [new TextRun({ text: 'Source', bold: true })] })], 30, true),
              cell(
                [new Paragraph({ children: [new TextRun({ text: 'How it relates · status', bold: true })] })],
                20,
                true,
              ),
              cell(
                [new Paragraph({ children: [new TextRun({ text: 'The exact words used', bold: true })] })],
                50,
                true,
              ),
            ],
          }),
          ...p.evidence.map(
            (e) =>
              new TableRow({
                children: [
                  cell(
                    [
                      new Paragraph({ children: [new TextRun({ text: `${e.tag} · ${e.label}`, bold: true })] }),
                      new Paragraph({ children: [new TextRun({ text: e.meta, color: MUTED, size: 18 })] }),
                    ],
                    30,
                  ),
                  cell(
                    [
                      new Paragraph(e.relation),
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: e.status,
                            color: e.status === 'Status not verified' ? MUTED : undefined,
                            size: 18,
                          }),
                        ],
                      }),
                    ],
                    20,
                  ),
                  cell(
                    e.words.map((w) => new Paragraph({ children: [new TextRun({ text: `“${w}”`, size: 18 })] })),
                    50,
                  ),
                ],
              }),
          ),
        ],
      }),
    );
  }
  if (p.notes.length) {
    body.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: `Please verify (${p.notes.length})`, color: YELLOW })],
      }),
    );
    for (const n of p.notes)
      body.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: `${n.n}. `, bold: true }),
            new TextRun(`“${n.line}”`),
            new TextRun({ text: ` — ${n.text.replace(/^Please verify: /, '')}`, color: YELLOW }),
          ],
        }),
      );
  }
  body.push(
    new Paragraph({
      spacing: { before: 360 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 6 } },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: p.footer, color: MUTED, size: 16 })],
    }),
  );
  const doc = new Document({
    creator: 'NYAAI',
    title: p.title.slice(0, 200),
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    footnotes: Object.fromEntries(p.notes.map((n) => [n.n, { children: [new Paragraph(n.text)] }])),
    sections: [{ children: body }],
  });
  return Packer.toBuffer(doc);
}

/* --------------------------------------------------------------------------------------------------- PDF */

// The built-in PDF fonts read Windows-1252 only. Briefs are English, but a stray character (₹, Devanagari) must not
// print as junk: ₹ becomes "Rs.", anything else outside the set "?". Noted in docs/memory.md.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function winAnsi(s: string): string {
  return [...s.replace(/₹\s?/g, 'Rs. ')]
    .map((ch) => (ch.codePointAt(0)! <= 0xff || CP1252_EXTRA.has(ch) ? ch : '?'))
    .join('');
}

export function renderPdf(p: PlannedBrief): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 60, right: 60 },
      info: { Title: winAnsi(p.title.slice(0, 200)), Creator: 'NYAAI' },
      bufferPages: true,
    });
    const parts: Buffer[] = [];
    doc.on('data', (d: Buffer) => parts.push(d));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
    const t = winAnsi;
    const heading = (s: string, color = '#111111') => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(color).text(t(s)).moveDown(0.3);
    };

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#111111').text(t(p.title));
    doc.moveDown(0.3).font('Helvetica').fontSize(9.5).fillColor('#5B6270').text(t(p.subtitle));
    for (const s of p.sections) {
      heading(s.heading);
      for (const l of s.lines ?? []) {
        doc
          .font('Helvetica')
          .fontSize(10.5)
          .fillColor('#111111')
          .text(t(l.text), { continued: !!l.note, underline: !!l.note });
        if (l.note)
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#A34A07').text(` [${l.note}]`, { underline: false });
        if (l.sources.length)
          doc
            .moveDown(0.1)
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor('#5B6270')
            .text(t(l.sources.join('; ')));
        doc.moveDown(0.5);
      }
      for (const x of s.bullets ?? [])
        doc
          .font('Helvetica')
          .fontSize(10.5)
          .fillColor('#111111')
          .list([t(x)], { bulletRadius: 1.5 })
          .moveDown(0.2);
    }
    if (p.evidence.length) {
      heading(`Evidence (${p.evidence.length})`);
      for (const e of p.evidence) {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('#111111')
          .text(t(`${e.tag} · ${e.label}`));
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#5B6270')
          .text(t(`${e.relation} · ${e.status}${e.meta ? ` · ${e.meta}` : ''}`));
        for (const w of e.words)
          doc
            .font('Times-Italic')
            .fontSize(10)
            .fillColor('#222222')
            .text(t(`“${w}”`), { indent: 10 });
        doc.moveDown(0.5);
      }
    }
    if (p.notes.length) {
      heading(`Please verify (${p.notes.length})`, '#A34A07');
      for (const n of p.notes) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#111111')
          .text(t(`${n.n}. “${n.line}”`), { continued: true });
        doc
          .fillColor('#A34A07')
          .text(t(` — ${n.text.replace(/^Please verify: /, '')}`))
          .moveDown(0.3);
      }
    }
    doc.moveDown(1).font('Helvetica').fontSize(8).fillColor('#5B6270').text(t(p.footer));
    // Page numbers.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Below the bottom margin: without this, pdfkit would start a new page for the number.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#5B6270')
        .text(`${i + 1} / ${range.count}`, 60, doc.page.height - 40, {
          width: doc.page.width - 120,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
