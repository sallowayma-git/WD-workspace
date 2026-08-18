import { z } from "zod";
import { getJson } from "../../lib/api/http";

const contextSchema = z.object({
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
  }),
  organization: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
  }),
  businessDate: z.string(),
  timezone: z.string(),
  dayCloseTime: z.string(),
  permissions: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  clientMinCompatibleVersion: z.string(),
});

export type ContextView = z.infer<typeof contextSchema>;

export function getContext(): Promise<ContextView> {
  return getJson("/context", contextSchema);
}
