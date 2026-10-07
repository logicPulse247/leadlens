import { route, ok } from "@/lib/api";
import { leadFacets } from "@/server/services/lead.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await leadFacets()));
