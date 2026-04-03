export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryOn?: (status: number) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  timeoutMs: 120000,
  retryOn: (status) => status >= 500 || status === 408,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt: number, base: number, max: number): number {
  const delay = base * Math.pow(2, attempt);
  return Math.min(delay, max);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (attempt < opts.maxRetries && opts.retryOn(res.status)) {
        const delay = exponentialBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await sleep(delay);
        continue;
      }

      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < opts.maxRetries) {
        const delay = exponentialBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await sleep(delay);
      } else {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<T> {
  const res = await fetchWithRetry(input, init, options);
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json?.error) message = String(json.error);
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}
