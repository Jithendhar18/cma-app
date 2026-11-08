import { describe, expect, it } from 'vitest';
import { fetchAllPages, PagingError } from './paging';

const source = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
const pager = (rows: Array<{ i: number }>, calls: Array<[number, number]> = []) => (from: number, to: number) => {
  calls.push([from, to]);
  return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
};

describe('fetchAllPages', () => {
  it('returns everything across several pages, with explicit ranges (it never relies on the default row cap)', async () => {
    const calls: Array<[number, number]> = [];
    const all = await fetchAllPages(pager(source(2500), calls));
    expect(all).toHaveLength(2500);
    expect(all.map((r) => r.i)).toEqual(source(2500).map((r) => r.i));
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('stops after a short page', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllPages(pager(source(10), calls))).toHaveLength(10);
    expect(calls).toEqual([[0, 999]]);
  });
  it('handles an exact multiple of the page size by asking once more', async () => {
    const calls: Array<[number, number]> = [];
    expect(await fetchAllPages(pager(source(2000), calls))).toHaveLength(2000);
    expect(calls.length).toBe(3);
  });
  it('returns an empty list for an empty table', async () => expect(await fetchAllPages(pager([]))).toEqual([]));
  it('fails the whole read if any page fails, rather than returning a truncated list', async () => {
    let n = 0;
    await expect(fetchAllPages(() => Promise.resolve(++n === 2 ? { data: null, error: { message: 'boom' } } : { data: source(1000), error: null }))).rejects.toBeInstanceOf(PagingError);
  });
  it('gives up on a runaway source', async () => {
    await expect(fetchAllPages(() => Promise.resolve({ data: source(1000), error: null }), 1000, 5)).rejects.toBeInstanceOf(PagingError);
  });
});
