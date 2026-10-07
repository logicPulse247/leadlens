import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "leadlens" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ["req.headers.authorization", "*.apiKey", "*.password"],
});

export function childLogger(scope: string, bindings: Record<string, unknown> = {}) {
  return logger.child({ scope, ...bindings });
}
