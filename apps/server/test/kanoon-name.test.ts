/** Full case names for judgments whose Indian Kanoon title is cut short. */
import { describe, expect, it } from 'vitest';
import { fullCaseName } from '../src/services/ingest/kanoon.ts';

const noUsage = async () => {};

describe('fullCaseName', () => {
  it('keeps a complete Kanoon title', async () => {
    expect(await fullCaseName('Satyabrata Ghose v. Mugneeram Bangur & Co.', '', null, noUsage)).toBe('Satyabrata Ghose v. Mugneeram Bangur & Co.');
  });
  it("uses a course pack's name when its parties check out against the title and the opening", async () => {
    const opening = 'Appeal by Zoroastrian Co-operative Housing Society against the District Registrar, Co-operative Societies';
    const known = 'Zoroastrian Co-operative Housing Society Ltd. v. District Registrar, Co-operative Societies (Urban)';
    expect(await fullCaseName('Zoroastrian Co-Operative Housing ...', opening, null, noUsage, known)).toBe(known);
  });
  it('refuses a name whose other party is nowhere, unless the caller matched it on the search title', async () => {
    const known = 'Shrimant Shamrao Suryavanshi v. Pralhad Bhairoba Suryavanshi';
    expect(await fullCaseName('Shrimant Shamrao Suryavanshi And', 'J U D G E M E N T', null, noUsage, known)).toBe('Shrimant Shamrao Suryavanshi And');
    expect(await fullCaseName('Shrimant Shamrao Suryavanshi And', 'J U D G E M E N T', null, noUsage, known, true)).toBe(known);
    expect(await fullCaseName('Someone Else ...', 'J U D G E M E N T', null, noUsage, known, true)).toBe('Someone Else');
  });
});
