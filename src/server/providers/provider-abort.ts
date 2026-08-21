export const providerRequestTimeoutMs = 45_000;

export function combineAbortSignals(
  signals: ReadonlyArray<AbortSignal | null | undefined>,
): AbortSignal {
  const available = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (available.length === 0) return new AbortController().signal;
  if (available.length === 1) return available[0] as AbortSignal;
  return AbortSignal.any(available);
}

export async function runProviderOperation<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  return operation();
}
