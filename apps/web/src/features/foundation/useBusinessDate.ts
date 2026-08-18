import { useQuery } from "@tanstack/react-query";
import { getContext } from "./contextApi";

/**
 * Returns the server-computed business date for the current organization
 * (Asia/Shanghai based, see PRD AC-001). Falls back to the browser's local
 * date only when the /context payload is not yet available, so the UI still
 * has a sensible default during initial load or when the context query fails.
 *
 * Note: pages rendered under <ContextGate> are only mounted after /context
 * resolves successfully, so in practice the fallback rarely fires. It is
 * kept for resilience (e.g. context refetch failure, or use outside the gate).
 */
export function useBusinessDate(): string {
  const contextQuery = useQuery({
    queryKey: ["context"],
    queryFn: getContext,
    retry: false,
  });
  return (
    contextQuery.data?.businessDate ?? new Date().toISOString().slice(0, 10)
  );
}
