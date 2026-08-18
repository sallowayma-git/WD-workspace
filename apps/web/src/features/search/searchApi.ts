import { z } from "zod";
import { getJson } from "../../lib/api/http";

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
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return getJson(`/search?${params.toString()}`, searchResponseSchema);
}
