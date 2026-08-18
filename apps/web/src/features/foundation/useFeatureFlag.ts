import { useQuery } from "@tanstack/react-query";
import { getContext } from "./contextApi";

/**
 * Reads a single feature flag from the /context payload.
 *
 * The /context endpoint returns `featureFlags` as a `Record<string, boolean>`
 * (see contextApi.ts). Every flag defaults to `false` when the context has not
 * loaded yet, when the flag is absent, or when the context query fails — so any
 * flag-gated feature stays OFF by default (PRD requirement: feature flags ship
 * disabled until explicitly enabled server-side).
 *
 * Shares the `["context"]` query key with {@link useBusinessDate} so the payload
 * is fetched only once and cached.
 */
export function useFeatureFlag(key: string): boolean {
  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    retry: false,
    staleTime: 60_000,
  });
  return contextQuery.data?.featureFlags[key] ?? false;
}
