import { z } from 'zod';

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(25),
  sort: z
    .string()
    .regex(/^-?[A-Za-z_.]+$/)
    .optional(),
  search: z.string().trim().max(200).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function sortSpec(sort: string | undefined, allowed: string[], fallback = '-createdAt'): Record<string, 1 | -1> {
  const s = sort && allowed.includes(sort.replace(/^-/, '')) ? sort : fallback;
  return s.startsWith('-') ? { [s.slice(1)]: -1 } : { [s]: 1 };
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export async function paginate<T = any>(
  model: any,
  filter: Record<string, unknown>,
  q: PageQuery,
  allowedSort: string[],
  populate?: string | { path: string; select?: string }[] | { path: string; select?: string },
  fallbackSort = '-createdAt',
): Promise<Page<T>> {
  let cursor = model
    .find(filter)
    .sort(sortSpec(q.sort, allowedSort, fallbackSort))
    .skip((q.page - 1) * q.limit)
    .limit(q.limit);
  if (populate) cursor = cursor.populate(populate);
  const [items, total] = await Promise.all([cursor.lean(), model.countDocuments(filter)]);
  return { items: items as T[], total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) };
}
