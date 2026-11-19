# Design summary (UI/UX, design system, performance)

Full detail: [LLD §11–14](specs/LLD.md).

## Principles (LLD §12.1)
1. One primary action per screen, in the accent colour.
2. Trust is visible: a source chip, or a yellow, grey or coverage mark on every legal line.
3. The teacher decides: the app suggests and never selects. There is no "verify all".
4. Plain words: no AI terms anywhere (see the microcopy rules below).
5. Calm motion on working screens (Motion, under 200 ms). React Bits only on the landing page and the 3 welcome moments.

## Screens (LLD §12.3)
Home (topic box plus 4 empty chip rows; Prepare is disabled until all 4 are chosen) · Build (4 real steps over SSE) · Lecture Studio (3 columns: outline 240 px | slide | sources and coach 360 px; header counts for yellow, grey and coverage) · Download dialog · Course plan · Explore · Research · My Style · Setup (5 steps + consent) · Library queue · Admin.

## Flags (LLD §12.4)
| Mark | Look | Token |
|---|---|---|
| Source chip | neutral pill "S2 · s. 56 ICA" | — |
| Yellow "please verify" | amber underline + dot | `--flag-yellow` |
| Grey "Status not verified" | grey pill | `--flag-grey` |
| Coverage note | blue-grey note | `--flag-coverage` |
| Your example | purple label | `--example` |
| Checking | quiet pulsing dot | — |

Colour is never the only signal: every mark also has an icon and a text label.

## Tokens (LLD §13.1), in `packages/ui/src/tokens.css`
| Token | Light | Dark |
|---|---|---|
| --bg | #F7F7F5 | #111318 |
| --surface | #FFFFFF | #1A1D24 |
| --text | #1E2430 | #E8EAF0 |
| --text-muted | #5B6475 | #A3AABA |
| --border | #E3E5EA | #2C313C |
| --accent | #2E3A8C | #8C98F2 |
| --flag-yellow fg/bg/underline | #B45309 / #FEF3C7 / #F59E0B | #FBBF24 / #3A2A0A |
| --flag-grey fg/bg | #475569 / #EEF1F5 | #CBD5E1 / #262B35 |
| --flag-coverage fg/bg | #1E4E6E / #E6F0F7 | #9FCBEA / #13283A |
| --example fg/bg | #5B21B6 / #F1EBFE | #C4B5FD / #2A2140 |
| --success / --danger | #15803D / #B91C1C | #4ADE80 / #F87171 |

- **Fonts:** Inter (UI), Source Serif 4 (legal text), Noto Sans Devanagari (Hindi fallback), all via @fontsource.
- **Type scale (px):** 12 / 14 / 16 / 18 / 20 / 24 / 30.
- **Spacing:** 4 px grid.
- **Radius:** 6 for controls, 10 for cards, full for pills.
- **Shadows:** 2 only (popover, dialog).

## Microcopy (LLD §12.8)
| Say | Never say |
|---|---|
| "Please verify" / "Not found in the library" | "hallucination", "low confidence", "model" |
| "Checking statements" | "inference", "tokens" |
| "Writing in your style" | "prompting", "fine-tuned" |
| "Status not verified" | "Unknown", "N/A" |

## Accessibility (LLD §12.7)
- WCAG 2.2 AA.
- axe-core runs in every E2E test.
- Reduced-motion fallbacks for all animation.
- Laptop is for editing; phone is review-only.

## Performance budgets (LLD §14.1)
| Measure | Budget |
|---|---|
| Home JS | ≤ 170 KB gz |
| Studio chunk | ≤ 250 KB gz |
| Home LCP | ≤ 2.0 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |
| Suggestions | ≤ 500 ms |
| Outline | ~20 s |
| Full draft | < 5 min |
| Edit code checks | ≤ 300 ms |
| .pptx | < 10 s |

## Keyboard (LLD §12.5)
| Keys | Does |
|---|---|
| ⌘K | Palette |
| ⌘↵ | Prepare |
| N / ⇧N | Next / previous open point |
| V | Verify |
| S | Open source |
| [ / ] | Previous / next slide |
| ⌘⇧D | Download |
| ? | Shortcut sheet |
