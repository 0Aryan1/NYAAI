import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryGap } from '@nyaai/shared';
import { api } from '@/shared/api/client';
import { GapsPage } from './GapsPage';

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
    expect(await screen.findByText(/Looking again in India Code/)).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });
});
