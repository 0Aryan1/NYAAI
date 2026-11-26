/**
 * The two reference journeys (BRD §5), click by click as a teacher would, with axe-core (WCAG 2.2 AA) on every
 * screen. J3 first (a new teacher sets up), then J1 with the same teacher (a lecture end to end, then the next one
 * opens with a recap). The AI is the scripted fake (E2E_FAKE_AI); search runs on the real library.
 *
 * Not covered here, because they are not built yet: the coach's class activity (J1 step 8, week 2), her own
 * template (J1 step 9 uses the base design), old slides, template and courses in setup (J3 steps 3, 5, 6 are "skip
 * for now"; the course is made from a syllabus on the Courses screen instead).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const email = () => {
  const e = process.env.E2E_EMAIL;
  if (!e) throw new Error('E2E_EMAIL is set by global-setup');
  return e;
};

/** axe-core on the page as it is now: no WCAG 2.0/2.1/2.2 A or AA violation. */
async function axe(page: Page, where: string) {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
  expect(violations, `accessibility on ${where}`).toEqual([]);
}

const pick = (page: Page, text: string | RegExp) => page.locator('label').filter({ hasText: text }).first().click();

const SYLLABUS = `# Law of Contract

Unit I: Discharge of contracts
1. Frustration of contract
2. Impossibility of performance

Suggested Readings
1. Pollock and Mulla, Indian Contract Act`;

/** Lecture 1 of J1, for the report journey after it. */
let firstLecture = '';

test.describe.serial('teacher journeys', () => {
  test('J3: first sign-in, consent, profile, style, finish, Home', async ({ page }) => {
    await page.goto('/login');
    await axe(page, 'sign-in');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');

    // 1. Consent: every outside service is listed; nothing goes on until she agrees.
    await expect(page).toHaveURL(/\/setup\/consent/);
    await axe(page, 'setup: consent');
    const agree = page.getByRole('button', { name: 'I agree, continue' });
    await expect(agree).toBeDisabled();
    await page.getByRole('checkbox').check();
    await agree.click();

    // 2. Profile: name, subjects taught, teaching language.
    await expect(page).toHaveURL(/\/setup\/profile/);
    await axe(page, 'setup: profile');
    await page.getByLabel('Name').fill('E2E Teacher');
    await pick(page, 'Law of Contract I');
    await pick(page, /^English$/);
    await page.getByRole('button', { name: 'Next' }).click();

    // 3. Old slides: optional.
    await expect(page).toHaveURL(/\/setup\/old_slides/);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // 4. Five style questions, one tap each.
    await expect(page).toHaveURL(/\/setup\/style/);
    await axe(page, 'setup: style');
    for (const group of await page.locator('fieldset').all()) await group.locator('label').first().click();
    await page.getByRole('button', { name: 'Next' }).click();

    // 5. Template: skipped for now.
    await expect(page).toHaveURL(/\/setup\/template/);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // 6. Courses: the same form as the Courses screen; she adds one, it is listed, then she finishes → Home.
    await expect(page).toHaveURL(/\/setup\/courses/);
    await expect(page.getByRole('button', { name: 'Finish without a course' })).toBeVisible();
    await axe(page, 'setup: courses');
    await page.getByLabel('Name', { exact: true }).fill('Law of Contract I');
    await page.getByRole('textbox', { name: /Lectures, one per line/ }).fill('Offer and acceptance\nConsideration');
    await page.getByRole('button', { name: 'Create course' }).click();
    await expect(page.getByRole('list', { name: 'Your courses' }).getByText('Law of Contract I')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Your courses' }).getByText('2 lectures planned')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(''); // ready for another
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await axe(page, 'Home');
  });

  test('J1: a lecture end to end, then the next one opens with a recap', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();

    // A course from her syllabus (COURSE-2): the reading list is left out.
    await page.goto('/courses');
    await axe(page, 'Courses');
    await page.locator('input[aria-label="Upload your syllabus"]').setInputFiles({ name: 'syllabus.md', mimeType: 'text/markdown', buffer: Buffer.from(SYLLABUS) });
    await expect(page.getByRole('textbox', { name: /Lectures, one per line/ })).toHaveValue('Frustration of contract\nImpossibility of performance');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Law of Contract');
    await page.getByRole('checkbox', { name: /Find the sources for every lecture now/ }).uncheck();
    await page.getByRole('button', { name: 'Create course' }).click();
    await expect(page).toHaveURL(/\/courses\/[0-9a-f-]{36}$/);
    await axe(page, 'course plan');
    const courseUrl = page.url();

    // 2–5. Prepare L01 from the plan: course and topic come with it; she taps length, level and style.
    await page.getByRole('button', { name: /^Prepare L01/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prepare', exact: true })).toBeDisabled(); // none pre-selected
    await pick(page, '50 min');
    await pick(page, 'Standard');
    await pick(page, 'My usual style');
    await page.getByText('Add your own example or a special request (optional)').click();
    await page.getByLabel('Must include').fill('A wedding hall booking cancelled in the lockdown.');
    await page.getByRole('button', { name: 'Prepare', exact: true }).click();

    // 5. The build: real steps, then the Studio opens by itself.
    await expect(page.getByRole('heading', { name: 'Preparing your lecture' })).toBeVisible();
    await axe(page, 'Build');
    await page.waitForURL(/\/lectures\/[0-9a-f-]{36}$/, { timeout: 180_000 });
    const lectureUrl = page.url();
    firstLecture = lectureUrl;

    // 6–7. Studio: the plan, a source with its exact words, the yellow point verified, a line edited.
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
    await axe(page, 'Studio');
    const source = page.locator('button[aria-label^="Source 1"]').first();
    await source.click();
    const drawer = page.getByRole('complementary', { name: 'Source' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('mark')).not.toHaveText(''); // the supporting words, highlighted
    await axe(page, 'Studio: source');

    await page.getByRole('button', { name: /A point to check/ }).first().click();
    await page.getByRole('button', { name: 'Please verify' }).first().click();
    await page.getByRole('button', { name: 'I have checked it: mark verified' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();

    await page.getByRole('button', { name: /What .* means/ }).first().click();
    // The line's own buttons show when the pointer is over it (or on keyboard focus).
    const firstLine = page.locator('.group').filter({ has: page.getByRole('button', { name: 'Edit this line', includeHidden: true }) }).first();
    await firstLine.hover();
    await firstLine.getByRole('button', { name: 'Edit this line' }).click();
    const box = page.getByRole('textbox', { name: 'Edit this line' });
    await box.fill('A shorter line in my own words: an agreement to do an impossible act is void.');
    await box.press('Enter');
    await expect(page.getByText('All changes saved')).toBeVisible();
    await expect(page.getByText('A shorter line in my own words', { exact: false }).first()).toBeVisible();

    // The connection drops while she edits: her words stay, wait, and save by themselves when it is back.
    await page.route('**/api/v1/slides/**', (r) => r.abort('internetdisconnected'));
    await firstLine.hover();
    await firstLine.getByRole('button', { name: 'Edit this line' }).click();
    await box.fill('Written while the connection was down.');
    await box.press('Enter');
    await expect(page.getByText(/1 slide not saved yet/)).toBeVisible();
    await expect(page.getByText('Written while the connection was down.').first()).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByRole('status').filter({ hasText: 'You’re offline' })).toBeVisible();
    await axe(page, 'Studio: offline');
    await page.unroute('**/api/v1/slides/**');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByText('All changes saved')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'You’re offline' })).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: /What .* means/ }).first().click();
    await expect(page.getByText('Written while the connection was down.').first()).toBeVisible(); // it reached the server

    // 9. Download the .pptx.
    await page.getByRole('button', { name: 'Download' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await axe(page, 'Download dialog');
    const seen = dialog.getByRole('checkbox', { name: /I have seen the points to verify/ });
    if (await seen.count()) await seen.check();
    const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download' }).click()]);
    expect(file.suggestedFilename()).toMatch(/\.pptx$/);
    await dialog.getByRole('button', { name: 'Close' }).last().click();

    // 10. Mark taught; the class memory is written; the next lecture opens with a recap.
    await page.getByRole('button', { name: 'Mark taught' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Mark taught' })).toBeHidden();
    const courseId = courseUrl.split('/').pop()!;
    await expect
      .poll(async () => ((await (await page.request.get(`/api/v1/courses/${courseId}`)).json()) as { units: { memory: unknown }[] }).units[0]?.memory, { timeout: 60_000 })
      .not.toBeNull();

    await page.goto(courseUrl);
    await page.getByRole('button', { name: /^Prepare L02/ }).first().click();
    await pick(page, '50 min');
    await pick(page, 'Standard');
    await pick(page, 'My usual style');
    await page.getByRole('button', { name: 'Prepare', exact: true }).click();
    await page.waitForURL((u) => /\/lectures\/[0-9a-f-]{36}$/.test(u.pathname) && !lectureUrl.endsWith(u.pathname), { timeout: 180_000 });
    await expect(page.getByRole('button', { name: /Recap of last class/ }).first()).toBeVisible();
    const secondLecture = page.url();

    // 11. F8.6: she changes the taught L01; L02 read its course memory, so it "may need update" until she says it is fine.
    await page.goto(lectureUrl);
    await page.getByRole('button', { name: /What .* means/ }).first().click();
    const l1Line = page.locator('.group').filter({ has: page.getByRole('button', { name: 'Edit this line', includeHidden: true }) }).first();
    await l1Line.hover();
    await l1Line.getByRole('button', { name: 'Edit this line' }).click();
    await page.getByRole('textbox', { name: 'Edit this line' }).fill('Changed after class: frustration needs a supervening event.');
    await page.getByRole('textbox', { name: 'Edit this line' }).press('Enter');
    await expect(page.getByText('All changes saved')).toBeVisible();
    await page.goto(courseUrl);
    await expect(page.getByText('May need update')).toBeVisible();
    await page.goto(secondLecture);
    const banner = page.getByRole('status').filter({ hasText: 'May need update' });
    await expect(banner).toContainText('L01');
    await axe(page, 'Studio: may need update');
    await banner.getByRole('button', { name: 'It’s still right' }).click();
    await expect(banner).toBeHidden();
  });

  test('ADM-2 / LIB-1: she reports a wrong fact; the library editor answers; she sees the answer on the line', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await page.goto(firstLecture);
    await page.getByRole('button', { name: /What .* means/ }).first().click();
    const claim = page.locator('.group').filter({ has: page.locator('button[aria-label^="Source 1"]') }).first();
    const lineText = (await claim.locator('span.leading-relaxed').first().innerText()).trim();
    await claim.hover();
    await claim.getByRole('button', { name: 'Report a wrong fact' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report a wrong fact' });
    await expect(dialog).toBeVisible();
    await axe(page, 'Studio: report dialog');
    await dialog.getByLabel('What is wrong? (optional)').fill('I think the Act says may, not must.');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('status')).toContainText('within a day');
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByText('Reported: the library team will check it within a day').first()).toBeVisible();

    // The library editor: the report is in her queue, as a copy, and she answers it.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Library editor' }).click();
    await expect(page).toHaveURL(/\/library/);
    await page.goto('/library/reports');
    await axe(page, 'Library: reports');
    const card = page.getByRole('listitem').filter({ hasText: 'I think the Act says may, not must.' });
    await expect(card).toContainText(lineText.slice(0, 40));
    await card.getByText('The source is right').click();
    await card.getByLabel('Note for the teacher (optional)').fill('Checked against the official text.');
    await card.getByRole('button', { name: 'Send answer' }).click();
    await expect(card.getByRole('status')).toContainText('Answered');

    // LIB-1: she adds an old → new criminal law row; it is not used until she signs it (asked once more); then removed.
    await page.getByRole('link', { name: 'Old → new law' }).click();
    await expect(page.getByRole('heading', { name: 'Old and new criminal law' })).toBeVisible();
    await axe(page, 'Library: old and new law');
    const sec = String(9000 + Math.floor(Math.random() * 999));
    await page.getByLabel(/^Old sections/).fill(`${sec}ZQ`);
    await page.getByLabel('New sections').fill(`${sec}ZR`);
    await page.getByLabel('Note').fill('E2E test row: renumbered.');
    await page.getByLabel('Official source').fill('https://www.mha.gov.in/en/commoncontent/new-criminal-laws');
    await page.getByRole('button', { name: 'Add the row' }).click();
    const mrow = page.getByRole('listitem').filter({ hasText: 'E2E test row' });
    await expect(mrow).toContainText('Not signed: not used');
    await mrow.getByRole('button', { name: 'Sign' }).click();
    await mrow.getByRole('button', { name: 'Yes, sign' }).click();
    await page.getByRole('tab', { name: /All/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'E2E test row' })).toContainText('Signed by');
    await page.getByRole('listitem').filter({ hasText: 'E2E test row' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'E2E test row' })).toHaveCount(0);

    // Back as the teacher: the answer is on her line.
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await page.goto(firstLecture);
    await page.getByRole('button', { name: /What .* means/ }).first().click();
    await expect(page.getByText('The library checked it: the source is right').first()).toBeVisible();
  });

  test('J4 / EXP-1, EXP-2, EXP-6: explore a topic, ask a follow-up from the library, turn it into a lecture', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();

    await page.getByRole('link', { name: 'Explore' }).click();
    await expect(page.getByRole('heading', { name: 'Explore' })).toBeVisible();
    await axe(page, 'Explore');
    await page.getByPlaceholder(/Find a topic/).fill('lis pendens');
    await page.getByRole('link', { name: /Lis pendens/ }).first().click();

    // The topic map: key sections and leading cases from the expert's list.
    await expect(page.getByRole('heading', { name: 'Lis pendens', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Key sections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Leading cases' })).toBeVisible();
    await axe(page, 'Explore: topic map');

    // A follow-up, answered from the library: a line with its source, and the source's exact words.
    await page.getByLabel('Your question').fill('Does lis pendens apply to a transfer made while the suit is pending?');
    await page.getByRole('button', { name: 'Ask' }).click();
    const answer = page.getByRole('article').first();
    await expect(answer).toContainText('Does lis pendens apply');
    const chip = answer.getByRole('button').first();
    await chip.click();
    await expect(answer.locator('mark')).not.toHaveText('');
    await axe(page, 'Explore: answer and source');

    // Turn into a lecture: Prepare opens with the topic chosen.
    await page.getByRole('button', { name: 'Turn into a lecture' }).click();
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveValue('Lis pendens');
  });

  test('RES-1, RES-3, RES-4: a quick research run gives an evidence table and a checked brief, kept under My research', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email());
    await page.getByLabel('Email').press('Enter');
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();

    await page.getByRole('link', { name: 'Research' }).click();
    await expect(page.getByRole('heading', { name: 'Research', level: 1 })).toBeVisible();
    await axe(page, 'Research');
    await page.getByLabel('Your question').fill('When can a court set aside an arbitral award as against the public policy of India?');
    await page.locator('label').filter({ hasText: 'India only' }).first().click();
    await page.getByRole('button', { name: 'Start research' }).click();

    // Live progress, then the brief and the evidence (the run page polls).
    await expect(page).toHaveURL(/\/research\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'The brief' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { name: /Evidence \(\d+\)/ })).toBeVisible();
    await expect(page.getByText('Short answer')).toBeVisible();
    await axe(page, 'Research: brief and evidence');
    await page.getByRole('button', { name: 'Show the whole passage' }).first().click();
    await expect(page.getByRole('button', { name: 'Show less' })).toBeVisible();

    // Kept under My research; and it turns into a lecture.
    await page.getByRole('link', { name: 'My research' }).click();
    await expect(page.getByRole('link', { name: /set aside an arbitral award/ })).toBeVisible();
    await page.getByRole('link', { name: /set aside an arbitral award/ }).click();

    // RES-5: the brief as Word and as PDF, named from the question.
    const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word' }).click()]);
    expect(word.suggestedFilename()).toMatch(/^Research_When_Can_A_Court_Set_Aside_An_Arbitral_\d{4}-\d{2}-\d{2}\.docx$/);
    await expect(page.getByRole('status').filter({ hasText: /^Saved Research_/ })).toBeVisible();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);

    await page.getByRole('button', { name: 'Turn into a lecture' }).click();
    await expect(page.getByRole('heading', { name: 'Prepare a lecture' })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveValue(/set aside an arbitral award/);
  });
});
