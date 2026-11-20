# Statute fixtures

Real statute text used by the splitter tests (LLD §16.1: ICA ss. 25, 32, 56 and Constitution Art. 19).

| File | Text | Source |
|---|---|---|
| `ica-1872-indiacode-lines.tsv` | The whole Indian Contract Act, 1872, as ingestion extracts and cleans it (`page<TAB>line`) | Official PDF from indiacode.gov.in (bitstream `a1872-9.pdf`, 53 pages), fetched 2026-11-20 |
| `ica-1872-ss25-32-56.txt` | ss. 25, 32, 56 with chapter headings, laid out as pages (form feed `\f`) with a running header and page numbers, to test the cleaner | Wording checked word for word against the official text above (identical apart from line breaks) |
| `constitution-2026-09-10-lines.tsv` | The whole Constitution of India as ingestion extracts and cleans it | Legislative Department PDF, "As on 10th September, 2026" (402 pages) |
| `constitution-arts18-20.txt` | Arts. 18, 19, 20, the "Right to Freedom" heading, and amendment footnotes, as pages | Wording checked word for word against the edition above (identical apart from line breaks); footnote layout reconstructed |

Indian Kanoon is not used for statute text: its Contract Act copy has OCR errors and no s. 6, and its Article 19 page
mixes editorial comment into the Article.

## Judgments (`judgments/`)

The court's text only (paragraph blocks, page markers, metadata) as produced by `kanoonToJudgment` from Indian Kanoon
documents fetched 2026-11-20; Kanoon's markup is not stored. Satyabrata Ghose v. Mugneeram Bangur (1953, tid 1214064),
Kharak Singh v. State of U.P. (1962, tid 619152, majority + dissent), Energy Watchdog v. CERC (2017, tid 29719380, court
numbering). Replace with official Supreme Court copies when they can be fetched.
