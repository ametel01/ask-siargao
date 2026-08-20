export function combineAbortSignals(
  signals: ReadonlyArray<AbortSignal | null | undefined>,
): AbortSignal {
  const available = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (available.length === 0) return new AbortController().signal;
  if (available.length === 1) return available[0] as AbortSignal;
  return AbortSignal.any(available);
}

export async function raceWithAbortSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
