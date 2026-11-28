import { describe, expect, it } from 'vitest';
import { pageFrom, pageOf, pageSql } from '../src/lib/page.ts';

describe('paged lists', () => {
  it('reads the defaults, a limit, and a cursor from the next page', () => {
    expect(pageFrom({}, { default: 200, max: 500 })).toEqual({ limit: 200, offset: 0 });
    expect(pageFrom({ limit: '2' }, { default: 200, max: 500 })).toEqual({ limit: 2, offset: 0 });
    const first = pageOf(['a', 'b', 'c'], { limit: 2, offset: 0 }); // 3 rows fetched for a page of 2: there is more
    expect(first.rows).toEqual(['a', 'b']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(pageFrom({ cursor: first.nextCursor, limit: '2' }, { default: 200, max: 500 })).toEqual({
      limit: 2,
      offset: 2,
    });
    expect(pageOf(['c'], { limit: 2, offset: 2 }).nextCursor).toBeNull(); // the last page
  });

  it('asks the database for one row more than the page, after the free parameter numbers', () => {
    expect(pageSql({ limit: 50, offset: 100 }, 3)).toEqual({ sql: ' limit $3 offset $4', params: [51, 100] });
  });

  it('a limit over the maximum falls back to the default; a cursor that is not ours is refused', () => {
    expect(pageFrom({ limit: '9999' }, { default: 200, max: 500 })).toEqual({ limit: 200, offset: 0 });
    expect(() => pageFrom({ cursor: 'not-a-cursor' }, { default: 200, max: 500 })).toThrow(/page link is not valid/);
  });
});
