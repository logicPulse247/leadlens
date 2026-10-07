import { route, ok } from "@/lib/api";
import { idParamSchema } from "@/lib/schemas";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req, { params }) => {
  const { id } = idParamSchema.parse(params);
  await prisma.savedView.delete({ where: { id } });
  return ok({ deleted: true });
});
