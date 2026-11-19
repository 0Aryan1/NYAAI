/** Token values mirrored from tokens.css so contrast can be tested in CI (LLD §13.1). */
export const TOKENS = {
  light: {
    bg: '#F7F7F5', surface: '#FFFFFF', text: '#1E2430', textMuted: '#5B6475', border: '#E3E5EA',
    accent: '#2E3A8C', accentContrast: '#FFFFFF',
    flagYellow: '#B45309', flagYellowBg: '#FEF3C7', flagGrey: '#475569', flagGreyBg: '#EEF1F5',
    flagCoverage: '#1E4E6E', flagCoverageBg: '#E6F0F7', example: '#5B21B6', exampleBg: '#F1EBFE',
    success: '#15803D', danger: '#B91C1C',
  },
  dark: {
    bg: '#111318', surface: '#1A1D24', text: '#E8EAF0', textMuted: '#A3AABA', border: '#2C313C',
    accent: '#8C98F2', accentContrast: '#111318',
    flagYellow: '#FBBF24', flagYellowBg: '#3A2A0A', flagGrey: '#CBD5E1', flagGreyBg: '#262B35',
    flagCoverage: '#9FCBEA', flagCoverageBg: '#13283A', example: '#C4B5FD', exampleBg: '#2A2140',
    success: '#4ADE80', danger: '#F87171',
  },
} as const;

export type Theme = keyof typeof TOKENS;
type Key = keyof (typeof TOKENS)['light'];

/** Text/background pairs that must reach WCAG AA 4.5:1 in both themes. */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [fg: Key, bg: Key]> = [
  ['text', 'bg'], ['text', 'surface'], ['textMuted', 'bg'], ['textMuted', 'surface'],
  ['accent', 'surface'], ['accentContrast', 'accent'],
  ['flagYellow', 'flagYellowBg'], ['flagGrey', 'flagGreyBg'], ['flagCoverage', 'flagCoverageBg'], ['example', 'exampleBg'],
  ['success', 'surface'], ['danger', 'surface'],
];

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
