export const defaultLiveProviderTimeoutMs = 15_000;

type ProviderFetchLike<Input> = (input: Input, init: RequestInit) => Promise<Response>;

export async function fetchWithProviderTimeout<Input extends string | URL | Request>(
  fetcher: ProviderFetchLike<Input>,
  input: Input,
  init: RequestInit = {},
  timeoutMs = defaultLiveProviderTimeoutMs,
) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    return await fetcher(input, { ...init, signal });
  } finally {
    clearTimeout(timeout);
  }
}
