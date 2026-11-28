import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, ListSkeleton, LoadError, SlowNote } from './states';

describe('loading, error and empty states', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a failed load says what failed, reassures, and offers to try again', () => {
    const retry = vi.fn();
    render(<LoadError what="Your notes" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('Your notes could not be loaded.');
    expect(screen.getByRole('alert').textContent).toContain('Nothing you made is lost');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offline, it says so instead', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<LoadError what="Your notes" />);
    expect(screen.getByRole('alert').textContent).toContain('You seem to be offline.');
    spy.mockRestore();
  });

  it('a list skeleton is announced for screen readers; after 8 seconds it says it is slow', () => {
    vi.useFakeTimers();
    render(<ListSkeleton label="Loading your courses" />);
    expect(screen.getByRole('status', { name: 'Loading your courses' })).toBeTruthy();
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByText(/taking longer than usual/)).toBeTruthy();
  });

  it('a slow note stays hidden while nothing is loading', () => {
    vi.useFakeTimers();
    render(<SlowNote active={false} />);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
  });

  it('an empty state names the place and gives the first step', () => {
    render(
      <EmptyState title="No documents yet" action={<button type="button">Upload a document</button>}>
        Upload your own notes.
      </EmptyState>,
    );
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a document' })).toBeTruthy();
  });
});
