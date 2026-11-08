/**
 * Reads every page of a query. The API caps a response (1,000 rows by default), so a single `select()` silently returns a truncated
 * list for a big table. This asks for explicit ranges until a short page arrives, so the result never depends on that cap.
 */
export const PAGE_SIZE = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

export class PagingError extends Error {
  constructor(public readonly cause: unknown) {
    super('A page of results could not be read.');
    this.name = 'PagingError';
  }
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
  maxPages = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new PagingError(error);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new PagingError(new Error('too many pages'));
}
