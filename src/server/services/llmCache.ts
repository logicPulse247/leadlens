import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { cacheGet, cacheSet } from "@/server/cache/cache";
import { prisma } from "@/server/db/prisma";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable SHA-256 over key-order-independent JSON. Same content, same hash, regardless of property order. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

const TTL_SECONDS = 30 * 24 * 3600;

/** Two-tier cache for LLM results: Redis for speed, Postgres so it survives a Redis flush. */
export async function llmCacheGet<T>(hash: string): Promise<T | null> {
  const hot = await cacheGet<T>(`llm:${hash}`);
  if (hot) return hot;
  const row = await prisma.llmCache.findUnique({ where: { contentHash: hash } });
  if (!row) return null;
  await cacheSet(`llm:${hash}`, row.result, TTL_SECONDS);
  return row.result as T;
}

export async function llmCacheSet(hash: string, kind: string, value: unknown): Promise<void> {
  await prisma.llmCache.upsert({
    where: { contentHash: hash },
    create: { contentHash: hash, kind, result: value as Prisma.InputJsonValue },
    update: { result: value as Prisma.InputJsonValue },
  });
  await cacheSet(`llm:${hash}`, value, TTL_SECONDS);
}
