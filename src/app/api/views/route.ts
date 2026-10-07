import { route, parseBody, ok } from "@/lib/api";
import { savedViewBodySchema } from "@/lib/schemas";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await prisma.savedView.findMany({ orderBy: { createdAt: "asc" } }) }));

export const POST = route(async (req) => {
  const body = await parseBody(req, savedViewBodySchema);
  return ok(await prisma.savedView.create({ data: { name: body.name, filters: body.filters } }), 201);
});
