import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Prepare</Button>);
    expect(screen.getByRole('button', { name: 'Prepare' }).getAttribute('type')).toBe('button');
  });
  it('can be disabled (Prepare stays disabled until all chips are chosen)', () => {
    render(
      <Button variant="primary" disabled>
        Prepare
      </Button>,
    );
    expect((screen.getByRole('button', { name: 'Prepare' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
