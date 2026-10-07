import { route, ok } from "@/lib/api";
import { listMergeCandidates, refreshMergeCandidates } from "@/server/services/dedupe/dedupe.service";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await listMergeCandidates() }));

export const POST = route(async () => ok({ created: await refreshMergeCandidates() }));
