import { z } from "zod";
import { getDataAdapter } from "../../data/runtime";

const searchItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  status: z.string().nullable(),
  payload: z.string().nullable(),
});

const searchGroupSchema = z.object({
  type: z.string(),
  items: z.array(searchItemSchema),
});

const searchResponseSchema = z.object({
  query: z.string(),
  groups: z.array(searchGroupSchema),
  parsedDateHint: z.string().nullable(),
});

export type SearchResultItem = z.infer<typeof searchItemSchema>;
export type SearchResultGroup = z.infer<typeof searchGroupSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export function searchGlobal(
  query: string,
  limit = 20,
): Promise<SearchResponse> {
  return getDataAdapter()
    .searchGlobal(query, limit)
    .then((value) => searchResponseSchema.parse(value));
}
