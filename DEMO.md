# LeadLens: 2-minute demo script

**Goal of the video:** show that LeadLens takes a messy list of small businesses and turns it into a ranked, explained, export-ready shortlist, and that it does so responsibly.

## Before recording (2 minutes)

```bash
docker compose up -d
npm run db:seed
npm run dev          # terminal 1
npm run worker       # terminal 2
```

- Open <http://localhost:3000> in a clean browser window at about 1440×900, light mode (switch to dark at the end).
- Start from an empty leads table for the best story. If you have old data: `npx prisma migrate reset --force` then `npm run db:seed`.
- Have `data/sample_companies.csv` visible in a file picker, or use the built-in discovery to avoid file dialogs on camera.

## Script

| Time | On screen | Say |
| --- | --- | --- |
| **0:00** | **ICPs** page, open the seeded ICP | "Caprae looks for owner-run small businesses to acquire. In LeadLens you describe that once as an ICP: industries, places, headcount, keywords to include or avoid, and signals like owner-operated, long-established, no recent funding." |
| **0:15** | **Import & Discover**, pick the ICP, turn on *Enrich after import*, click **Discover companies** | "Bring in companies by CSV, pasted list, or discovery. Here I'm discovering from a sample dataset." |
| **0:25** | Import summary card | "Messy input is cleaned on the way in. These duplicates were removed by domain, and these near-matches are queued for a human to review, not auto-merged." |
| **0:35** | **Leads** page, jobs tray filling up | "Each company is enriched as its own queued job. It reads only the company's public site, obeys robots.txt, identifies itself, and waits between requests to the same domain. Progress is live." |
| **0:50** | Table sorted by Fit, scores appearing | "As soon as a lead is enriched it is scored 0 to 100: deterministic rules for industry, size and location, blended with an AI read of the company's own words." |
| **1:00** | Click the top lead, drawer opens, scroll to score explanation | "Every score comes with reasons and risks in plain English, plus acquisition signals. Nothing is a black box. Here's the contact info we found, validated for syntax and MX, with the source page." |
| **1:20** | Outreach tab, choose *Founder-to-founder*, **Generate draft** | "A short personalised email. It can only use facts from the enrichment record, and anything it invents is caught and replaced. Here are the facts this draft is based on. It's editable and one click to copy." |
| **1:35** | Back to table, filter Tier A, select a few, **Export selected CSV** | "Filter to the best fits, select, and export a HubSpot-style CSV. JSON is there too." |
| **1:45** | **Ethics & Compliance**, add one of those domains to the opt-out list, run the same export again, point at the toast | "Opt-outs are enforced, not just stored. I add this company to the suppression list, export again, and it's left out, and the app tells me so." |
| **1:55** | **Dashboard**, toggle dark mode | "The dashboard rolls it up: leads by tier, average fit by industry, enrichment success rate and duplicates removed. That's LeadLens: clean, ranked, explained, and responsible." |

## Tips

- If jobs are slow on camera, record the import, cut, and resume once the table has scores. The worker log in a split terminal is a good visual for "queued job per lead".
- Keep the mouse still while narrating; zoom the browser to 110% if the table text is small.
- To show the guard against invented facts, open the drafts' *Facts this draft is based on* list rather than reading the email aloud.
- Do not show real personal data. The sample dataset is fictional.

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| Leads stay *Enriching…* | The worker isn't running: `npm run worker`. |
| Scores don't appear | Choose an ICP at import, or click **Score leads** on the Leads page. |
| Empty dashboard | No leads yet, or the ICP filter at the top right excludes them. |
| Port clash on 5442 or 6380 | Set `POSTGRES_PORT` / `REDIS_PORT` and update `DATABASE_URL` / `REDIS_URL`. |
