# Aclarian audit-finding targets

A prospect list built for Aclarian's sales team: local governments whose latest single audit reported a
material weakness in internal control over financial reporting, ranked, with the finance contact from the
filing and a draft email for each.

- `index.html`: the page. Reads `/targets.json`.
- `lib/fac.js`: Federal Audit Clearinghouse pull, merge and ranking.
- `api/refresh.js`: hourly cron. One FAC request per run (seeds the last three audit years one per run, then
  pulls new filings since the last cursor), writes `fac/raw.json` and `fac/targets.json` to Vercel Blob.
- `vercel.json`: cron schedule, plus the `/targets.json` rewrite to the Blob URL.
- `scripts/build-local.mjs`: builds `targets.json` from saved FAC pulls for local testing.

Env: `BLOB_READ_WRITE_TOKEN` (from the connected Blob store), `CRON_SECRET`, and optionally `FAC_API_KEY`
(a free api.data.gov key; without it the job uses the shared `DEMO_KEY`, capped at 10 requests an hour).
