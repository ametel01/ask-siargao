export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function compareCanonicalStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
