export function optionalInstant(data: FormData, name: string): string | undefined {
  const value = data.get(name);
  if (typeof value !== "string") return undefined;
  return value ? new Date(value).toISOString() : undefined;
}
