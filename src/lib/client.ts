"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiClientError("Network error. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiClientError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code, body?.error?.details);
  }
  return (await res.json()) as T;
}

export const json = (data: unknown) => JSON.stringify(data);

export interface FetchState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Minimal fetch hook with optional polling. Keeps previous data visible while reloading. */
export function useFetch<T>(url: string | null, opts: { pollMs?: number | (() => number | false) } = {}): FetchState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const pollRef = useRef(opts.pollMs);
  pollRef.current = opts.pollMs;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const result = await apiFetch<T>(url);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      const p = pollRef.current;
      const ms = typeof p === "function" ? p() : p;
      if (ms) timer = setTimeout(() => run(false), ms);
    };
    run(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, tick]);

  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
