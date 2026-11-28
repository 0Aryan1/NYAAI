import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideLine, StudioSlide } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { adoptKeys, isConnectionError, optimisticSlide, pendingSaves, toEdit } from './pending-saves';
import { useSlideEditor } from './useSlideEditor';

const line = (lineKey: string, text: string): SlideLine => ({
  lineKey,
  text,
  kind: 'claim',
  status: 'supported',
  flag: null,
  flagReason: null,
  sources: [],
  risk: 'normal',
  edited: false,
});
const slide = (over: Partial<StudioSlide> = {}): StudioSlide => ({
  id: '11111111-1111-4111-8111-111111111111',
  position: 1,
  partIndex: 0,
  layout: 'bullets',
  title: 'Seat',
  version: 3,
  lines: [line('p0-s1-l1', 'The seat decides the court.'), line('p0-s1-l2', 'The venue is where hearings sit.')],
  notes: [],
  ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pendingSaves.clear();
});

describe('changes kept while the connection is down', () => {
  it('a dropped connection is retried; a refusal is not', () => {
    expect(isConnectionError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isConnectionError(new ApiRequestError(503, null))).toBe(true);
    expect(isConnectionError(new ApiRequestError(409, null))).toBe(false);
    expect(isConnectionError(new ApiRequestError(400, null))).toBe(false);
  });

  it('shows her words at once; a line she added waits as new, and is sent as new', () => {
    const s = slide();
    const shown = optimisticSlide(s, {
      version: 3,
      title: 'Seat',
      lines: [
        { lineKey: 'p0-s1-l1', text: 'My words.', kind: 'claim' },
        { lineKey: null, text: 'A new line.', kind: 'teaching' },
      ],
      notes: [],
    });
    expect(shown.lines.map((l) => [l.text, l.edited])).toEqual([
      ['My words.', true],
      ['A new line.', true],
    ]);
    expect(shown.lines[1]!.lineKey.startsWith('unsaved-')).toBe(true);
    expect(toEdit(shown.lines[1]!).lineKey).toBeNull();
    expect(shown.version).toBe(3); // still the server's version: the save that waits carries it
  });

  it('a line added offline and already created by the save before is not added twice', () => {
    const saved = slide({ lines: [...slide().lines, line('p0-s1-l3', 'A new line.')] });
    const later = adoptKeys(
      {
        version: 3,
        title: 'Seat',
        lines: [
          { lineKey: 'p0-s1-l1', text: 'x', kind: 'claim' },
          { lineKey: null, text: 'A new line.', kind: 'teaching' },
        ],
        notes: [],
      },
      saved,
    );
    expect(later.lines.map((l) => l.lineKey)).toEqual(['p0-s1-l1', 'p0-s1-l3']);
  });
});

describe('the Studio editor without a connection', () => {
  const setup = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const lectureId = '22222222-2222-4222-8222-222222222222';
    qc.setQueryData(queryKeys.slides(lectureId), { slides: [slide()] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useSlideEditor(lectureId), { wrapper });
    const shown = () => (qc.getQueryData(queryKeys.slides(lectureId)) as { slides: StudioSlide[] }).slides[0]!;
    return { hook, shown };
  };

  it('keeps her edit when the save cannot get through, and saves it when the connection is back', async () => {
    const { hook, shown } = setup();
    const server = slide({
      version: 4,
      lines: [{ ...line('p0-s1-l1', 'My shorter words.'), edited: true }, slide().lines[1]!],
    });
    const save = vi
      .spyOn(api, 'saveSlide')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ slide: server } as never);

    await act(() => hook.result.current.editLine(slide(), 'p0-s1-l1', 'My shorter words.'));
    expect(hook.result.current.pending).toBe(1);
    expect(hook.result.current.state).not.toBe('error');
    expect(shown().lines[0]!.text).toBe('My shorter words.'); // her words stay on the slide

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(hook.result.current.pending).toBe(0));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toMatchObject({
      version: 3,
      lines: [{ lineKey: 'p0-s1-l1', text: 'My shorter words.' }, { lineKey: 'p0-s1-l2' }],
    });
    expect(shown().version).toBe(4); // the server's copy, checked
    expect(hook.result.current.state).toBe('saved');
  });

  it('two changes made offline go as one save, with both', async () => {
    const { hook, shown } = setup();
    const save = vi.spyOn(api, 'saveSlide').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(() => hook.result.current.editLine(slide(), 'p0-s1-l1', 'First change.'));
    save.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(() => hook.result.current.editLine(shown(), 'p0-s1-l2', 'Second change.'));
    expect(hook.result.current.pending).toBe(1);
    save.mockResolvedValueOnce({ slide: slide({ version: 4 }) } as never);
    await act(() => hook.result.current.retryNow());
    const last = save.mock.calls.at(-1)![1];
    expect(last).toMatchObject({ version: 3, lines: [{ text: 'First change.' }, { text: 'Second change.' }] });
    expect(hook.result.current.pending).toBe(0);
  });

  it('a change the server refuses is not kept: she sees why, and the slide is reloaded', async () => {
    const { hook } = setup();
    vi.spyOn(api, 'saveSlide').mockRejectedValueOnce(
      new ApiRequestError(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'This slide changed in another tab.',
          details: undefined,
          traceId: 't',
        },
      } as never),
    );
    await act(() => hook.result.current.editLine(slide(), 'p0-s1-l1', 'My words.'));
    expect(hook.result.current.pending).toBe(0);
    expect(hook.result.current.state).toBe('error');
    expect(hook.result.current.error).toBe('This slide changed in another tab.');
  });
});
