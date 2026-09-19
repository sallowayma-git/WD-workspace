type ColorWithHexString = {
  toHexString: () => string;
};

function hasHexString(value: unknown): value is ColorWithHexString {
  if (typeof value !== "object" || value === null) return false;
  const method = (value as { toHexString?: unknown }).toHexString;
  return typeof method === "function";
}

/** Convert Ant Design ColorPicker values to the API's nullable hex string. */
export function serializeStatusLabelColor(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (!hasHexString(value)) return null;
  try {
    return value.toHexString();
  } catch {
    return null;
  }
}
