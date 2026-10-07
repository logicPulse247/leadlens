import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { Prisma } from "@prisma/client";
import { logger } from "./logger";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

function errorResponse(status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) {
  const body: ErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return NextResponse.json(body, { status, headers });
}

type Ctx = { params: Record<string, string> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response | NextResponse>;

/** Wraps a route handler with consistent error mapping and request logging. */
export function route(handler: Handler): Handler {
  return async (req, ctx) => {
    const started = Date.now();
    try {
      const res = await handler(req, ctx);
      logger.info({ method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started }, "request");
      return res;
    } catch (err) {
      if (err instanceof ZodError) {
        return errorResponse(400, "VALIDATION_ERROR", "Request validation failed", err.flatten());
      }
      if (err instanceof ApiError) {
        return errorResponse(err.status, err.code, err.message, err.details);
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") return errorResponse(404, "NOT_FOUND", "Resource not found");
        if (err.code === "P2002") return errorResponse(409, "CONFLICT", "A record with these values already exists");
      }
      logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err), path: req.nextUrl.pathname }, "unhandled route error");
      return errorResponse(500, "INTERNAL_ERROR", "Something went wrong");
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export function tooManyRequests(retryAfter: number) {
  return errorResponse(429, "RATE_LIMITED", "Too many requests, please slow down", { retryAfter }, { "Retry-After": String(retryAfter) });
}
