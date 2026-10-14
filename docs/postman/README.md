# LeadLens Postman collection

## Import

1. Open Postman → **Import** → choose `LeadLens-API-Demo.postman_collection.json`.
2. Collection variable `baseUrl` defaults to `http://localhost:3000`.

## Run the demo

```bash
docker compose up -d
npm run dev          # terminal 1
npm run worker       # terminal 2 — required for enrich + score
```

Suggested order (also numbered in the collection):

1. **GET Health**
2. **GET List ICPs** — auto-saves `icpId`
3. **POST Import (paste)** or **POST Discover**
4. **GET List leads** — auto-saves `leadId`
5. **POST Enrich** → **GET Jobs** (wait until done)
6. **POST Score** → list leads again (scores appear)
7. **POST Generate outreach**
8. **POST Export CSV** — check headers `X-Exported-Count`, `X-Suppressed-Leads`
9. **POST Add suppression** → export again to show the opt-out

Default `LLM_PROVIDER=mock` — no OpenAI/Anthropic keys needed.
