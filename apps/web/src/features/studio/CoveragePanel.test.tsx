import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoverageResponse } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { RateLimitBanner } from '@/shared/ui/rate-limit-banner';
import { CoveragePanel } from './CoveragePanel';

const LECTURE = '11111111-1111-4111-8111-111111111111';
const item = (over: Partial<CoverageResponse['groups'][number]['items'][number]>) => ({
  id: '22222222-2222-4222-8222-222222222222',
  sectionKey: 'Arbitration and Conciliation Act, 1996:s9',
  kind: 'proviso' as const,
  label: 'Proviso to s. 9',
  state: 'missing' as const,
  reason: null,
  text: 'Provided that the arbitral tribunal shall have the powers…',
  canAdd: true,
  ...over,
});
const coverage: CoverageResponse = {
  score: 0.5,
  covered: 1,
  counted: 3,
  groups: [
    {
      sectionKey: 'Arbitration and Conciliation Act, 1996:s9',
      title: 's. 9 Arbitration and Conciliation Act, 1996',
      missing: 2,
      total: 3,
      items: [
        item({}),
        item({
          id: '33333333-3333-4333-8333-333333333333',
          kind: 'leading_case',
          label: 'Leading case: X v. Y',
          text: null,
          canAdd: false,
        }),
      ],
    },
  ],
  leftOut: [],
  notFound: [],
};

function setup() {
  vi.spyOn(api, 'coverage').mockResolvedValue(coverage);
  const add = vi
    .spyOn(api, 'addCoverage')
    .mockResolvedValue({ slideId: '44444444-4444-4444-8444-444444444444', lineKey: 'e-1' });
  const onAdded = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CoveragePanel lectureId={LECTURE} onAdded={onAdded} />
    </QueryClientProvider>,
  );
  return { add, onAdded };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the coverage panel', () => {
  it('says "X of Y covered", not a bare percentage', async () => {
    setup();
    expect(
      await screen.findByText(/^1 of 3 provisos, exceptions, explanations, clauses and leading cases/),
    ).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('"Add this for me" is offered for a statute part with its own words, not for a leading case, and shows the new line', async () => {
    const { add, onAdded } = setup();
    const buttons = await screen.findAllByRole('button', { name: 'Add this for me' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 'e-1'));
    expect(add.mock.calls[0]![0]).toBe('22222222-2222-4222-8222-222222222222');
  });
});

describe('too many requests', () => {
  it('a refused request shows one plain message on every screen for a minute', () => {
    vi.useFakeTimers();
    render(<RateLimitBanner />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => void new ApiRequestError(429, null));
    expect(screen.getByRole('status').textContent).toMatch(/Too many requests in a short time\. Please wait a minute/);
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
