import { route, parseQuery, ok } from "@/lib/api";
import { leadListQuerySchema } from "@/lib/schemas";
import { listLeads } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => ok(await listLeads(parseQuery(req, leadListQuerySchema))));
