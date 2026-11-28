/**
 * Court list for metadata validation (LLD §6.5): a court name must be on this list, or the value stays empty and
 * the chunk goes to needs_review. Covers the Supreme Court, every High Court and the main national tribunals.
 */
export type CourtLevel = 'supreme_court' | 'high_court' | 'tribunal' | 'district' | 'foreign';

const HIGH_COURTS = [
  'Allahabad',
  'Andhra Pradesh',
  'Bombay',
  'Calcutta',
  'Chhattisgarh',
  'Delhi',
  'Gauhati',
  'Gujarat',
  'Himachal Pradesh',
  'Jammu and Kashmir and Ladakh',
  'Jammu & Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Madras',
  'Manipur',
  'Meghalaya',
  'Orissa',
  'Patna',
  'Punjab-Haryana',
  'Punjab and Haryana',
  'Rajasthan',
  'Sikkim',
  'Telangana',
  'Tripura',
  'Uttarakhand',
];
const TRIBUNALS = [
  'National Company Law Appellate Tribunal',
  'National Company Law Tribunal',
  'Appellate Tribunal For Electricity',
  'National Green Tribunal',
  'Income Tax Appellate Tribunal',
  'Customs, Excise and Gold Tribunal',
  'Competition Appellate Tribunal',
  'Central Administrative Tribunal',
  'National Consumer Disputes Redressal Commission',
];

export interface CourtInfo {
  court: string;
  level: CourtLevel;
}

/** Normalises a source's court label ("Supreme Court of India", "Patna High Court") or returns null if unknown. */
export function identifyCourt(label: string | null | undefined): CourtInfo | null {
  if (!label) return null;
  const l = label.replace(/\s+/g, ' ').trim();
  if (/^Supreme Court(?: of India)?$/i.test(l)) return { court: 'Supreme Court of India', level: 'supreme_court' };
  for (const hc of HIGH_COURTS) {
    const re = new RegExp(
      `^(?:High Court of ${hc.replace(/[-&]/g, '.')}|${hc.replace(/[-&]/g, '.')} High Court)(?:\\s*-.*)?$`,
      'i',
    );
    if (re.test(l)) return { court: `${hc} High Court`, level: 'high_court' };
  }
  for (const t of TRIBUNALS) if (l.toLowerCase().startsWith(t.toLowerCase())) return { court: t, level: 'tribunal' };
  return null;
}
