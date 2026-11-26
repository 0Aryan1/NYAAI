import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/api/client';
import { TopicsReviewPage } from './TopicsReviewPage';

const C = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

function setup() {
  vi.spyOn(api, 'topicCases').mockResolvedValue({
    unconfirmed: 1,
    topics: [{ conceptId: C, name: 'Appointment of arbitrators', subject: 'ADR', cases: [{ sourceId: S, title: 'S.B.P. & Co. v. Patel Engineering', court: 'Supreme Court of India', year: 2005, confirmedAt: null, confirmedBy: null }] }],
  });
  const remove = vi.spyOn(api, 'removeTopicCase').mockResolvedValue(undefined);
  const restore = vi.spyOn(api, 'restoreTopicCase').mockResolvedValue(undefined);
  const confirm = vi.spyOn(api, 'confirmTopicCase').mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TopicsReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { remove, restore, confirm };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('confirming leading cases: every decision is asked twice, and can be undone', () => {
  it('"Not this topic" asks first; Cancel changes nothing; a removal can be put back', async () => {
    const { remove, restore } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Not this topic' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove from Appointment of arbitrators\? Lectures on this topic will stop teaching it\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Not this topic' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Not this topic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(C, S));
    expect(await screen.findByText('Removed from this topic')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(C, S));
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('"Confirm" asks first, then confirms', async () => {
    const { confirm } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm as a leading case on Appointment of arbitrators?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, confirm' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(C, S));
    expect(await screen.findByText('Confirmed')).toBeTruthy();
  });
});
