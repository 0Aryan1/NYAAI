/** Old and new criminal law rows (the mappings screen), without the screen. */
/** "420, 415" or "s. 420; 415" → ["420", "415"] (the server checks each one). */
export const sectionsFrom = (text: string): string[] =>
  text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
