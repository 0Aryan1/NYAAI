/**
 * Text normalisation for the span check C2 (LLD §8.3): Unicode NFKC, curly quotes → straight,
 * en/em dashes → hyphen, soft hyphens removed, whitespace collapsed. Case is kept.
 */
export function normaliseForSpan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** C2 core: does the supporting span appear word for word in the source text? */
export function spanAppearsIn(span: string, sourceText: string): boolean {
  const s = normaliseForSpan(span);
  return s.length > 0 && normaliseForSpan(sourceText).includes(s);
}
