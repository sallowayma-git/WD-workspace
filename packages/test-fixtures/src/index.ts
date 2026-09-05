/**
 * Shared fixture for the local single-workspace product. There is no
 * organization or tenant concept, so only machine-local settings appear here.
 */
export const localWorkspaceFixture = {
  timezone: "Asia/Shanghai",
  dayCloseTime: "22:00",
} as const;
