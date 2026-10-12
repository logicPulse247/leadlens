import { route, parseBody, ok } from "@/lib/api";
import { suppressionBodySchema } from "@/lib/schemas";
import { addSuppressions, listSuppressions } from "@/server/services/suppression.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await listSuppressions() }));

export const POST = route(async (req) => {
  const { entries, reason } = await parseBody(req, suppressionBodySchema);
  const result = await addSuppressions(entries, reason);
  return ok(result, result.added ? 201 : 200);
});
