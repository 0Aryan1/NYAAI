import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryGap } from '@nyaai/shared';
import { api } from '@/shared/api/client';
import { GapsPage, lookupOutcome } from './GapsPage';

const gap: LibraryGap = {
  id: '33333333-3333-4333-8333-333333333333',
  question: "What did Mohori Bibee v. Dharmodas Ghose hold about a minor's agreement?",
  kind: 'case',
  actName: null,
  actYear: null,
  caseName: 'Mohori Bibee v. Dharmodas Ghose',
  asks: 3,
  teachers: 2,
  state: 'open',
  attempts: [{ at: '2026-11-25T10:00:00.000Z', provider: 'indian_kanoon', outcome: 'nothing', detail: 'No judgment titled like "Mohori Bibee v. Dharmodas Ghose"' }],
  leads: [{ provider: 'web', title: 'Indian Contract Act, 1872 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2187', lastUpdated: '2026-10-01', checked: true }],
  loadedSourceIds: [],
  note: null,
  firstSeenAt: '2026-11-20T10:00:00.000Z',
  lastSeenAt: '2026-11-25T10:00:00.000Z',
  lastLookupAt: '2026-11-25T10:00:00.000Z',
};

function setup() {
  vi.spyOn(api, 'libraryGaps').mockResolvedValue({ gaps: [gap] });
  const update = vi.spyOn(api, 'updateGap').mockImplementation(async (_id, body) => ({ ...gap, state: body.state, note: body.note ?? null }));
  const lookup = vi.spyOn(api, 'lookupGap').mockResolvedValue({ jobId: 'job-1' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GapsPage />
    </QueryClientProvider>,
  );
  return { update, lookup };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('library gaps for the editor', () => {
  it('shows the question, who asked, what the lookup tried, and the official links to check', async () => {
    setup();
    expect(await screen.findByText(gap.question)).toBeTruthy();
    expect(screen.getByText(/2 teachers, asked 3 times/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Indian Contract Act, 1872 \(India Code\)/ });
    expect(link.getAttribute('href')).toBe(gap.leads[0]!.url);
    expect(screen.getByText(/Official websites · updated 2026-10-01 · opens/)).toBeTruthy();
    expect(screen.getByText(/No judgment titled like/)).toBeTruthy();
  });

  it('closing asks first, then closes with her note; "Look again" starts a lookup', async () => {
    const { update, lookup } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Close: I loaded the source' }));
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Loaded the Act from India Code.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, close it' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(gap.id, { state: 'resolved', note: 'Loaded the Act from India Code.' }));
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    const again = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Look again' }));
    await waitFor(() => expect(again.lookup).toHaveBeenCalledWith(gap.id));
    expect(lookup).not.toHaveBeenCalled();
  });

  it('"Look again" shows "Looking now…" until the lookup has really finished, then says what it found', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const gaps = vi.spyOn(api, 'libraryGaps').mockResolvedValue({ gaps: [gap] });
      vi.spyOn(api, 'lookupGap').mockResolvedValue({ jobId: 'job-1' });
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <GapsPage />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Look again' }));
      // At once: the badge and the line say it is looking, and the button waits.
      expect(await screen.findByText('Looking now…')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toMatch(/Looking in India Code, Indian Kanoon and official websites/);
      expect((screen.getByRole('button', { name: 'Look again' }) as HTMLButtonElement).disabled).toBe(true);

      // The worker has picked it up: still looking.
      gaps.mockResolvedValue({ gaps: [{ ...gap, state: 'looking', lastLookupAt: '2026-11-28T10:00:00.000Z' }] });
      await act(async () => void (await vi.advanceTimersByTimeAsync(3100)));
      expect(screen.getByText('Looking now…')).toBeTruthy();

      // Finished: nothing downloaded, one new link.
      const done: LibraryGap = {
        ...gap,
        state: 'open',
        lastLookupAt: '2026-11-28T10:00:00.000Z',
        attempts: [
          ...gap.attempts,
          { at: '2026-11-28T10:00:02.000Z', provider: 'indian_kanoon', outcome: 'nothing', detail: 'No judgment titled like "Mohori Bibee v. Dharmodas Ghose"' },
          { at: '2026-11-28T10:00:05.000Z', provider: 'web', outcome: 'loaded', detail: '1 official link(s) for the editor (not added to the library)' },
        ],
        leads: [...gap.leads, { provider: 'web', title: 'New page', url: 'https://www.sci.gov.in/new', lastUpdated: null, checked: true }],
      };
      gaps.mockResolvedValue({ gaps: [done] });
      await act(async () => void (await vi.advanceTimersByTimeAsync(3100)));
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Done: nothing to download, but 1 new link to check below\./));
      expect(screen.queryByText('Looking now…')).toBeNull();
      expect(within(screen.getByText(gap.question).closest('li')!).getByText('Waiting')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Look again' }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what a finished lookup brought', () => {
  const start = { lastLookupAt: '2026-11-25T10:00:00.000Z', leadUrls: gap.leads.map((l) => l.url), startedAt: 0 };
  const after = (over: Partial<LibraryGap>): LibraryGap => ({ ...gap, state: 'open', lastLookupAt: '2026-11-28T10:00:00.000Z', ...over });

  it('is not done while the gap is looking, or before a newer lookup ran', () => {
    expect(lookupOutcome(start, after({ state: 'looking' }))).toEqual({ done: false });
    expect(lookupOutcome(start, { ...gap, lastLookupAt: start.lastLookupAt })).toEqual({ done: false });
  });

  it('counts only that run: downloads, new links, and services that did not answer', () => {
    const r = lookupOutcome(
      start,
      after({
        state: 'loaded',
        attempts: [
          { at: '2026-11-20T10:00:00.000Z', provider: 'indian_kanoon', outcome: 'loaded', detail: 'old', sourceIds: ['44444444-4444-4444-8444-444444444444'] },
          { at: '2026-11-28T10:00:03.000Z', provider: 'indian_kanoon', outcome: 'loaded', detail: 'x', sourceIds: ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'] },
          { at: '2026-11-28T10:00:04.000Z', provider: 'web', outcome: 'failed', detail: 'timeout' },
        ],
      }),
    );
    expect(r).toEqual({ done: true, tone: 'success', message: 'Done: 2 sources downloaded. Check them in Library, under “To check”. Official websites did not answer; try again later.' });
    expect(lookupOutcome(start, after({}))).toEqual({ done: true, tone: 'muted', message: 'Done: nothing new found.' });
  });
});
