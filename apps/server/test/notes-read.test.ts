import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { splitNotes } from '@nyaai/legal';
import { docxBlocks, NoteReadError, readNote } from '../src/services/ingest/note.ts';

const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function docx(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('reading her Word notes', () => {
  it('takes headings from the paragraph styles and keeps the text, entities decoded', async () => {
    const bytes = await docx(
      [
        para('ADR Notes', 'Title'),
        para('Seat &amp; venue', 'Heading1'),
        para('The seat decides the court.'),
        para('Example', 'Heading2'),
        `<w:p><w:r><w:t>Delhi</w:t><w:tab/><w:t>v. Mumbai</w:t></w:r></w:p>`,
      ].join(''),
    );
    const blocks = await docxBlocks(bytes);
    expect(blocks).toEqual([
      { text: 'ADR Notes', heading: 1 },
      { text: 'Seat & venue', heading: 1 },
      { text: 'The seat decides the court.', heading: null },
      { text: 'Example', heading: 2 },
      { text: 'Delhi v. Mumbai', heading: null },
    ]);
    expect(splitNotes('ADR', blocks).map((c) => c.header)).toEqual([
      'Your notes: ADR › Seat & venue',
      'Your notes: ADR › Seat & venue › Example',
    ]);
  });

  it('a file that is not a Word document gets a reason she can act on', async () => {
    await expect(readNote(new TextEncoder().encode('not a zip'), 'docx')).rejects.toBeInstanceOf(NoteReadError);
  });

  it('reads Markdown as it is', async () => {
    expect(await readNote(new TextEncoder().encode('# Seat\nThe seat matters.'), 'md')).toEqual([
      { text: 'Seat', heading: 1 },
      { text: 'The seat matters.', heading: null },
    ]);
  });
});
