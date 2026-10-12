import { z } from "zod";
import { route, parseQuery, ok } from "@/lib/api";
import { getDashboard } from "@/server/services/dashboard.service";

export const dynamic = "force-dynamic";

const querySchema = z.object({ icpId: z.string().min(1).optional() });

export const GET = route(async (req) => {
  const { icpId } = parseQuery(req, querySchema);
  return ok(await getDashboard(icpId));
});
