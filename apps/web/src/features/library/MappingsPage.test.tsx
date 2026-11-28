import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LawMapping } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { MappingsPage, sectionsFrom } from './MappingsPage';

const row: LawMapping = {
  id: '55555555-5555-4555-8555-555555555555',
  pair: 'IPC → BNS',
  oldAct: 'Indian Penal Code, 1860',
  newAct: 'Bharatiya Nyaya Sanhita, 2023',
  relation: 'renumbered',
  oldSections: ['420'],
  newSections: ['318'],
  note: 'Cheating: new number.',
  sourceUrl: 'https://www.mha.gov.in/x',
  signedBy: null,
  signedAt: null,
  createdAt: '2026-11-27T10:00:00.000Z',
};

function setup() {
  vi.spyOn(api, 'lawMappings').mockResolvedValue({ mappings: [row], unsigned: 1 });
  const add = vi.spyOn(api, 'addLawMapping').mockResolvedValue(row);
  const sign = vi
    .spyOn(api, 'signLawMapping')
    .mockResolvedValue({ ...row, signedBy: 'Prof. X', signedAt: '2026-11-27T11:00:00.000Z' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MappingsPage />
    </QueryClientProvider>,
  );
  return { add, sign };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('old and new criminal law rows', () => {
  it('reads several sections from one box', () => {
    expect(sectionsFrom('420, 415; s. 53A\n')).toEqual(['420', '415', 's. 53A']);
  });

  it('shows each row as old → new with its relation, and an unsigned row as not used', async () => {
    setup();
    expect(await screen.findByText('IPC s. 420')).toBeTruthy();
    expect(screen.getByText('BNS s. 318')).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toContain('Renumbered');
    expect(screen.getByText('Not signed: not used')).toBeTruthy();
  });

  it('signing asks once more', async () => {
    const { sign } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    expect(sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, sign' }));
    await waitFor(() => expect(sign).toHaveBeenCalledWith(row.id));
  });

  it('taking back a signature asks once more, and says lectures will be told', async () => {
    vi.spyOn(api, 'lawMappings').mockResolvedValue({
      mappings: [{ ...row, signedBy: 'Prof. X', signedAt: '2026-11-27T11:00:00.000Z' }],
      unsigned: 0,
    });
    const unsign = vi.spyOn(api, 'unsignLawMapping').mockResolvedValue(row);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MappingsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Undo signature' }));
    expect(unsign).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Lecture lines that relied on this row will be marked for their teachers to check again/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, take it back' }));
    await waitFor(() => expect(unsign).toHaveBeenCalledWith(row.id));
  });

  it('"No direct equivalent" has no new section box; the server\'s reasons are shown in plain words', async () => {
    const { add } = setup();
    add.mockRejectedValueOnce(
      new ApiRequestError(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: { issues: [{ path: 'newSections', message: '"Split" needs two or more new sections.' }] },
          traceId: 't',
        },
      }),
    );
    fireEvent.change(screen.getByLabelText(/^How they relate/), { target: { value: 'no_direct_equivalent' } });
    expect((screen.getByLabelText('New sections') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^How they relate/), { target: { value: 'split' } });
    fireEvent.change(screen.getByLabelText(/Old sections/), { target: { value: '377' } });
    fireEvent.change(screen.getByLabelText('New sections'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Split in two.' } });
    fireEvent.change(screen.getByLabelText('Official source'), { target: { value: 'https://www.mha.gov.in/y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the row' }));
    expect(await screen.findByText('"Split" needs two or more new sections.')).toBeTruthy();
    expect(add.mock.calls[0]![0]).toMatchObject({
      pair: 'IPC → BNS',
      relation: 'split',
      oldSections: ['377'],
      newSections: ['100'],
    });
  });
});
