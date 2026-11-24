/**
 * The .pptx file (PPT-1, PPT-2; LLD §10.2). Until CNLU's templates arrive (open question, BRD §11) every deck is
 * built on the NYAAI base design with `pptxgenjs`, the LLD's fallback path: 16:9, calm type, one idea per slide, the
 * sources as footnotes, and the explanation, full citations and open points in the speaker notes.
 */
import PptxGenJS from 'pptxgenjs';
import type { Deck, DeckSlide } from './deck.ts';

const C = { accent: '2E3A8C', text: '1E2430', muted: '5B6475', rule: 'E3E5EA', tintCase: 'EEF0FA', tintExample: 'F1EBFE', example: '5B21B6', yellow: 'A34A07' };
const FONT = 'Calibri';
const KIND: Record<string, string> = { case_box: 'CASE', example: 'EXAMPLE', recap: 'RECAP', bridge: 'NEXT CLASS', question: 'QUESTION' };

/** Body text boxes: bullets for ordinary slides, larger plain lines for a question. */
function bodyRuns(d: DeckSlide) {
  const question = d.layout === 'question';
  return d.lines.flatMap((l, i) => {
    const base = { italic: l.kind === 'question', color: l.yourExample ? C.example : C.text, fontSize: question ? 26 : 20 };
    const last = i === d.lines.length - 1;
    const text = { text: l.text, options: { ...base, bullet: question || l.kind === 'question' ? false : { indent: 18 }, paraSpaceAfter: 10, breakLine: !last && !l.marks.length } };
    // The line's source numbers, small and raised, matching the footnotes under the slide.
    const marks = l.marks.length ? [{ text: ` ${l.marks.join(',')}`, options: { ...base, color: C.accent, superscript: true, breakLine: !last } }] : [];
    return [text, ...marks];
  });
}

export async function renderPptx(deck: Deck, meta: { topic: string; subtitle: string }): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pptx.title = meta.topic;
  pptx.company = 'NYAAI';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  // Title slide.
  const t = pptx.addSlide();
  t.background = { color: 'FFFFFF' };
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: C.accent }, line: { color: C.accent } });
  t.addText(meta.topic, { x: 0.9, y: 2.4, w: 11.5, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, color: C.text, valign: 'bottom' });
  t.addText(meta.subtitle, { x: 0.9, y: 4.1, w: 11.5, h: 0.6, fontFace: FONT, fontSize: 18, color: C.muted });

  deck.slides.forEach((d, idx) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    let y = 0.55;
    if (KIND[d.layout]) {
      s.addText(KIND[d.layout]!, { x: 0.7, y, w: 6, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.accent, charSpacing: 2 });
      y += 0.35;
    }
    s.addText(d.title, { x: 0.7, y, w: 11.9, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: C.text, valign: 'top', fit: 'shrink' });
    y += 1.05;
    const bodyH = 7.5 - y - (d.footnotes.length ? 1.0 : 0.6);

    // Tinted panels for a case, an example, a recap or a bridge.
    const tint = d.layout === 'case_box' || d.layout === 'recap' || d.layout === 'bridge' ? C.tintCase : d.layout === 'example' ? C.tintExample : null;
    if (tint) {
      s.addShape(pptx.ShapeType.rect, { x: 0.7, y, w: 11.9, h: bodyH, fill: { color: tint }, line: { color: tint } });
      if (d.layout === 'case_box') s.addShape(pptx.ShapeType.rect, { x: 0.7, y, w: 0.08, h: bodyH, fill: { color: C.accent }, line: { color: C.accent } });
    }
    const pad = tint ? 0.35 : 0;
    if (d.layout === 'two_column' && d.lines.length > 2) {
      const half = Math.ceil(d.lines.length / 2);
      const w = (11.9 - 0.4) / 2;
      s.addText(bodyRuns({ ...d, lines: d.lines.slice(0, half) }), { x: 0.7, y, w, h: bodyH, fontFace: FONT, valign: 'top', fit: 'shrink' });
      s.addText(bodyRuns({ ...d, lines: d.lines.slice(half) }), { x: 0.7 + w + 0.4, y, w, h: bodyH, fontFace: FONT, valign: 'top', fit: 'shrink' });
    } else if (d.lines.length) {
      s.addText(bodyRuns(d), { x: 0.7 + pad, y: y + pad / 2, w: 11.9 - 2 * pad, h: bodyH - pad, fontFace: FONT, valign: 'top', fit: 'shrink' });
    }
    if (d.footnotes.length) {
      s.addShape(pptx.ShapeType.line, { x: 0.7, y: 6.55, w: 11.9, h: 0, line: { color: C.rule, width: 0.75 } });
      s.addText(d.footnotes.join('    '), { x: 0.7, y: 6.6, w: 11.0, h: 0.5, fontFace: FONT, fontSize: 10, color: C.muted, valign: 'top', fit: 'shrink' });
    }
    s.addText(String(idx + 2), { x: 12.2, y: 6.95, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, align: 'right' });
    if (d.notes) s.addNotes(d.notes);
  });

  // Hidden last slide: every open point, for her, never shown in class (LLD §10.3).
  if (deck.verify.length || deck.notVerified.length || deck.notCovered.length) {
    const h = pptx.addSlide();
    h.hidden = true;
    h.addText('Points to verify (hidden slide)', { x: 0.7, y: 0.5, w: 11.9, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: C.yellow });
    const rows: { text: string; options: Record<string, unknown> }[] = [];
    const head = (text: string) => rows.push({ text, options: { bold: true, fontSize: 14, color: C.text, paraSpaceBefore: 8, breakLine: true } });
    const item = (text: string) => rows.push({ text, options: { fontSize: 12, color: C.text, bullet: { indent: 14 }, breakLine: true } });
    if (deck.verify.length) {
      head('[!] Please verify: not confirmed by NYAAI');
      deck.verify.forEach((v) => item(`Slide ${v.slide}: ${v.text}`));
    }
    if (deck.notVerified.length) {
      head('[?] Status not verified: no law expert has yet confirmed these cases are still good law');
      deck.notVerified.forEach(item);
    }
    if (deck.notCovered.length) {
      head('[~] Not covered');
      deck.notCovered.forEach(item);
    }
    h.addText(rows, { x: 0.7, y: 1.4, w: 11.9, h: 5.7, fontFace: FONT, valign: 'top', fit: 'shrink' });
    h.addNotes(rows.map((r) => r.text).join('\n'));
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
