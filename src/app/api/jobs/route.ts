import { route, ok } from "@/lib/api";
import { listRecentJobs } from "@/server/queue/jobs";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok(await listRecentJobs()));
