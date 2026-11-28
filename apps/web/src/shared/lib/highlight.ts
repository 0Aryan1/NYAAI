/** Spaces, dashes and curly quotes made plain, so a quote matches its paragraph however each was typed. */
const squash = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Splits the paragraph around the supporting words so they can be highlighted (spaces and quote styles aside). */
export function highlight(text: string, span: string): [string, string, string] | null {
  const t = squash(text);
  const s = squash(span);
  const i = t.indexOf(s);
  return i < 0 ? null : [t.slice(0, i), t.slice(i, i + s.length), t.slice(i + s.length)];
}
