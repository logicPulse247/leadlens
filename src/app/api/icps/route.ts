import { route, parseBody, ok } from "@/lib/api";
import { icpInputSchema } from "@/lib/schemas";
import { createIcp, listIcps } from "@/server/services/icp.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await listIcps() }));

export const POST = route(async (req) => {
  const input = await parseBody(req, icpInputSchema);
  return ok(await createIcp(input), 201);
});
