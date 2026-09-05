/** Returns the work date in the local machine's calendar and timezone. */
export function useBusinessDate(): string {
  return new Date().toLocaleDateString("en-CA");
}
