import { route, ok } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  return ok(await prisma.job.findUniqueOrThrow({ where: { id } }));
});
