import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/shared/api/client';
import { MemoryRouter } from 'react-router';
import { HomePage } from './HomePage';

function renderHome() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.home, {
    courses: [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        name: 'Law of Contract II',
        nextUnit: { id: '00000000-0000-4000-8000-0000000000u1', position: 9, title: 'Frustration' },
      },
    ],
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <HomePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Home (HOME-4, HOME-5, HOME-6)', () => {
  it('starts with every chip empty, including the course', () => {
    renderHome();
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('radio', { name: /Law of Contract II/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'No course, one-off' })).toBeTruthy();
  });

  it('keeps Prepare disabled until a topic and all four chips are chosen, naming what is missing', () => {
    renderHome();
    const prepare = screen.getByRole('button', { name: 'Prepare' }) as HTMLButtonElement;
    expect(prepare.disabled).toBe(true);
    expect(
      screen.getByText(/Still needed: a topic, a course \(or one-off\), a class length, a level, a style/),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('What do you want to teach?'), {
      target: { value: 'Frustration of contract' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'No course, one-off' }));
    fireEvent.click(screen.getByRole('radio', { name: '50 min' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(prepare.disabled).toBe(true);
    expect(screen.getByText(/Still needed: a style\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'My usual style' }));
    expect(prepare.disabled).toBe(false);
  });
});
