import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { queryKeys } from '@/shared/api/client';
import { TopicBox } from './TopicBox';

afterEach(cleanup);

function Harness() {
  const [v, setV] = useState('');
  return (
    <>
      <TopicBox value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('TopicBox (HOME-2)', () => {
  it('shows library suggestions and picks one with the keyboard', async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    client.setQueryData(queryKeys.suggest('frustr'), {
      suggestions: [
        { kind: 'concept', label: 'Frustration of contract', detail: 'Contract', value: 'Frustration of contract' },
        { kind: 'section', label: 's. 56 Agreement to do impossible act', detail: 'Indian Contract Act', value: 's. 56 Agreement to do impossible act' },
      ],
    });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    const box = screen.getByRole('combobox', { name: 'What do you want to teach?' });
    fireEvent.change(box, { target: { value: 'frustr' } });
    await act(async () => vi.advanceTimersByTime(200));
    vi.useRealTimers();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toMatch(/opt-1$/);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('value').textContent).toBe('s. 56 Agreement to do impossible act');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
