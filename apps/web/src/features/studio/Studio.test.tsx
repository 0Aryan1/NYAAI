import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SlideLine, StudioSlide } from '@nyaai/shared';
import { ClaimLine } from './ClaimLine';
import { highlight } from './SourceDrawer';
import { openPoints } from './StudioPage';
import { footnoteNumbers } from './SlideCanvas';

afterEach(cleanup);

const C = '00000000-0000-4000-8000-0000000000c1';
const line = (over: Partial<SlideLine>): SlideLine => ({
  lineKey: 'p0-s1-l1',
  text: 'An agreement to do an impossible act is void.',
  kind: 'claim',
  status: 'supported',
  flag: null,
  flagReason: null,
  sources: [{ tag: 'S1', citationId: C, label: 's. 56 ICA', provisional: false, caseStatus: null }],
  risk: 'normal',
  edited: false,
  ...over,
});

describe('ClaimLine marks (LLD §12.4): colour is never the only signal', () => {
  it('shows a source chip that opens the source', () => {
    const open = vi.fn();
    render(<ul><ClaimLine line={line({})} active={false} numbers={new Map([[C, 1]])} showChecks onOpenSource={open} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'S1 · s. 56 ICA' }));
    expect(open).toHaveBeenCalledWith(C);
  });

  it('labels a yellow line "Please verify" and shows the reason on demand', () => {
    render(<ul><ClaimLine line={line({ status: 'open', flag: 'yellow', flagReason: 'These words are not in the source' })} active={false} numbers={new Map([[C, 1]])} showChecks onOpenSource={() => {}} /></ul>);
    expect(screen.queryByText('These words are not in the source')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Please verify/ }));
    expect(screen.getByText('These words are not in the source')).toBeTruthy();
  });

  it('labels a grey case "Status not verified" and her example "Your example"', () => {
    render(
      <ul>
        <ClaimLine line={line({ flag: 'grey', flagReason: 'Status not verified' })} active={false} numbers={new Map([[C, 1]])} showChecks onOpenSource={() => {}} />
        <ClaimLine line={line({ lineKey: 'p0-s1-l2', kind: 'example', status: 'your_example', sources: [] })} active={false} numbers={new Map([[C, 1]])} showChecks onOpenSource={() => {}} />
      </ul>,
    );
    expect(screen.getByText('Status not verified')).toBeTruthy();
    expect(screen.getByText('Your example')).toBeTruthy();
  });
});

describe('Source drawer highlight', () => {
  it('finds the supporting words despite line breaks and curly quotes', () => {
    const parts = highlight('A contract to do an act\nwhich, after the contract is made, becomes “impossible”.', 'which, after the contract is made, becomes "impossible"');
    expect(parts?.[1]).toBe('which, after the contract is made, becomes "impossible"');
    expect(highlight('abc', 'xyz')).toBeNull();
  });
});

describe('next point to verify (N)', () => {
  it('lists yellow lines and notes in slide order', () => {
    const slide = (lines: SlideLine[], notes: SlideLine[] = []): StudioSlide => ({ id: C, position: 0, partIndex: 0, layout: 'bullets', title: 't', version: 1, lines, notes });
    const pts = openPoints([
      slide([line({ lineKey: 'a' }), line({ lineKey: 'b', flag: 'yellow', status: 'open' })]),
      slide([line({ lineKey: 'c', flag: 'grey' })], [line({ lineKey: 'n', flag: 'yellow', status: 'open' })]),
    ]);
    expect(pts).toEqual([{ slide: 0, lineKey: 'b' }, { slide: 1, lineKey: 'n' }]);
  });
});

describe('slide view (footnotes) vs check view', () => {
  it('shows a footnote number in slide view, and keeps a yellow line marked there too', () => {
    const open = vi.fn();
    render(
      <ul>
        <ClaimLine line={line({ status: 'open', flag: 'yellow', flagReason: 'Not found in the library' })} active={false} numbers={new Map([[C, 2]])} showChecks={false} onOpenSource={open} />
      </ul>,
    );
    expect(screen.queryByText('S1 · s. 56 ICA')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Source 2: s. 56 ICA' }));
    expect(open).toHaveBeenCalledWith(C);
    expect(screen.getByRole('button', { name: /Please verify/ })).toBeTruthy();
  });

  it('numbers each source once per slide, in reading order', () => {
    const s = (cid: string, label: string) => ({ tag: 'S1', citationId: cid, label, provisional: false, caseStatus: null });
    const slide: StudioSlide = {
      id: C, position: 0, partIndex: 0, layout: 'bullets', title: 't', version: 1,
      lines: [line({ sources: [s('a', 's. 56 ICA')] }), line({ lineKey: 'k2', sources: [s('b', 'Satyabrata Ghose ¶9'), s('c', 's. 56 ICA')] })],
      notes: [],
    };
    const { byCitation, notes } = footnoteNumbers(slide);
    expect(notes.map((n) => `${n.n} ${n.label}`)).toEqual(['1 s. 56 ICA', '2 Satyabrata Ghose ¶9']);
    expect(byCitation.get('c')).toBe(1);
  });
});

describe('editing a line (STUDIO-2, -4)', () => {
  it('saves new words on Enter, and puts the old ones back on Escape', () => {
    const edit = vi.fn();
    render(<ul><ClaimLine line={line({})} active={false} numbers={new Map([[C, 1]])} showChecks={false} onOpenSource={() => {}} onEdit={edit} /></ul>);
    fireEvent.click(screen.getByText('An agreement to do an impossible act is void.'));
    const box = screen.getByRole('textbox', { name: 'Edit this line' });
    fireEvent.change(box, { target: { value: 'An agreement to do an impossible act is void (s. 56).' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(edit).toHaveBeenCalledWith('An agreement to do an impossible act is void (s. 56).');
    fireEvent.click(screen.getByText('An agreement to do an impossible act is void.'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit this line' }), { target: { value: 'something else' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit this line' }), { key: 'Escape' });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('lets her mark a yellow line verified from its note, and shows a changed line as being checked', () => {
    const verify = vi.fn();
    render(
      <ul>
        <ClaimLine line={line({ status: 'open', flag: 'yellow', flagReason: 'These words are not in the source' })} active={false} numbers={new Map([[C, 1]])} showChecks={false} onOpenSource={() => {}} onEdit={() => {}} onVerify={verify} />
        <ClaimLine line={line({ lineKey: 'k2', status: 'open', flag: 'yellow', flagReason: 'Changed by you: being checked against the source', edited: true })} active={false} numbers={new Map([[C, 1]])} showChecks={false} onOpenSource={() => {}} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Please verify/ }));
    fireEvent.click(screen.getByRole('button', { name: 'I have checked it: mark verified' }));
    expect(verify).toHaveBeenCalled();
    expect(screen.getByText('Checking…')).toBeTruthy();
  });
});
