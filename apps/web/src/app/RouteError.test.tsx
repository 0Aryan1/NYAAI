import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { ApiRequestError } from '@/shared/api/http';
import { RouteError, routeErrorText } from './RouteError';

function Boom(): never {
  throw new Error('render failed');
}

describe('route errors', () => {
  it('a page that crashes shows the error inside the frame: the menu stays', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <div>
              <nav aria-label="Main">Menu</nav>
              <Outlet />
            </div>
          ),
          children: [{ errorElement: <RouteError />, children: [{ path: 'broken', element: <Boom /> }] }],
        },
      ],
      { initialEntries: ['/broken'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(log).toHaveBeenCalledWith('NYAAI route error', expect.any(Error));
    log.mockRestore();
  });

  it('says what kind of failure it was', () => {
    expect(routeErrorText(new ApiRequestError(0, null)).title).toBe('No connection');
    expect(routeErrorText(new TypeError('Failed to fetch dynamically imported module: /src/x.tsx')).title).toBe(
      'NYAAI was updated',
    );
    expect(routeErrorText(new Error('x'))).toMatchObject({ title: 'Something went wrong', canRetry: true });
  });
});

describe('retries', () => {
  it('asks again only when it may help: no connection or a server fault', async () => {
    const { worthRetrying } = await import('./queryClient');
    expect(worthRetrying(new ApiRequestError(0, null))).toBe(true);
    expect(worthRetrying(new ApiRequestError(503, null))).toBe(true);
    expect(worthRetrying(new ApiRequestError(404, null))).toBe(false);
    expect(worthRetrying(new ApiRequestError(429, null))).toBe(false);
  });
});
