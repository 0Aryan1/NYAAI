/**
 * The stored shape of a slide's body and notes (LLD §11.4): a Tiptap-style document with one `claimLine` node per
 * line. Each line carries a stable key, so citations, checks and reports stay attached to it across edits.
 */
import type { SlideLine } from '@nyaai/shared';

export interface LineNode {
  attrs?: { lineKey?: string; kind?: SlideLine['kind']; yourExample?: boolean; edited?: boolean };
  content?: { text?: string }[];
}

export interface DocLine {
  lineKey: string;
  kind: string;
  yourExample: boolean;
  /** Changed by the teacher (absent on lines as the build wrote them). */
  edited?: boolean;
  text: string;
}

/** A line node's plain text. */
export const lineText = (n: LineNode): string => (n.content ?? []).map((t) => t.text ?? '').join('');

/** The document stored for a slide's body or notes. */
export function slideDoc(lines: DocLine[]) {
  return {
    type: 'doc',
    content: lines.map((l) => ({
      type: 'claimLine',
      attrs: {
        lineKey: l.lineKey,
        kind: l.kind,
        yourExample: l.yourExample,
        ...(l.edited === undefined ? {} : { edited: l.edited }),
      },
      content: [{ type: 'text', text: l.text }],
    })),
  };
}
