/**
 * Her syllabus file read into units and topics (COURSE-2). Read in memory and not kept: she checks and edits the
 * list, then creates the course. Word paragraphs, PDF lines with a text layer, or plain text.
 */
import {
  defaultPer,
  readSyllabus,
  syllabusLectures,
  syllabusLines,
  syllabusPdfLines,
  type NoteBlock,
} from '@nyaai/legal';
import type { SyllabusPreview } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { docxBlocks, NoteReadError } from '../ingest/note.ts';
import { NoTextLayerError, pdfLines } from '../ingest/extract.ts';

/** Her syllabus file, line by line (Word paragraphs, PDF lines, text lines). */
async function syllabusBlocks(bytes: Uint8Array, kind: string): Promise<NoteBlock[]> {
  if (kind === 'docx') return docxBlocks(bytes);
  if (kind === 'pdf') {
    try {
      return syllabusPdfLines(await pdfLines(bytes));
    } catch (err) {
      if (err instanceof NoTextLayerError)
        throw new NoteReadError(
          'This PDF is a scan with no text in it. Upload a Word copy or a typed PDF, or paste the topics.',
        );
      throw err;
    }
  }
  return syllabusLines(new TextDecoder().decode(bytes));
}

/** The two ways to plan it (one lecture per unit, or per topic) and the likelier one for her class count. */
export async function previewSyllabus(
  bytes: Uint8Array,
  kind: string,
  classCount: number | null,
): Promise<SyllabusPreview> {
  let outline;
  try {
    outline = readSyllabus(await syllabusBlocks(bytes, kind));
  } catch (err) {
    if (err instanceof NoteReadError) throw new AppError('UNSUPPORTED_FILE', err.message);
    throw err;
  }
  const perUnit = syllabusLectures(outline, 'unit');
  const perTopic = syllabusLectures(outline, 'topic');
  if (!perUnit.length)
    throw new AppError(
      'VALIDATION_FAILED',
      'We found no lecture topics in this file. Paste the topics instead, one per line.',
    );
  return {
    courseName: outline.courseName,
    units: outline.units,
    perUnit,
    perTopic,
    suggested: defaultPer(outline, classCount),
  };
}
