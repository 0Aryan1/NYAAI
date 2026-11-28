/** The files a teacher can upload as a note or a syllabus: Word, PDF, plain text or Markdown (the server reads these). */
export const DOCUMENT_ACCEPT =
  '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

/** Word, PDF or text: the browser's type, or one guessed from the file name (some browsers leave .md blank). */
export function fileType(file: File): string {
  if (file.type) return file.type;
  if (/\.md$/i.test(file.name)) return 'text/markdown';
  if (/\.txt$/i.test(file.name)) return 'text/plain';
  return 'application/octet-stream';
}
