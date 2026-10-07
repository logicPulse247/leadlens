import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getRedis } from "@/server/cache/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function check(name: string, fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - started };
  } catch (err) {
    logger.warn({ name, err: String(err) }, "health check failed");
    return { name, ok: false, ms: Date.now() - started };
  }
}

export async function GET() {
  const checks = await Promise.all([
    check("postgres", () => prisma.$queryRaw`SELECT 1`),
    check("redis", () => getRedis().ping()),
  ]);
  const healthy = checks.every((c) => c.ok);
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", uptime: Math.round(process.uptime()), checks },
    { status: healthy ? 200 : 503 },
  );
}
