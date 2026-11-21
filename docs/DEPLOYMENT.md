# Public dashboard and CSV test release

This is the current rollout plan, superseding the authentication and metadata-only
proposal in NEXT_PHASE.md. The owner requested public reading and public additive
imports. Only replacement is password-protected. This deliberately permits any
visitor to add valid records: Origin checks prevent cross-site browser requests,
but are not user authentication and can be imitated by non-browser callers.

## Implemented behavior

- Public aggregate dashboard, date/PVZ filters, dispatch and delivery cards, COD
  separately. Client names and original CSV files never leave the browser through
  this uploader; only allowlisted operational fields are stored. No public raw
  record or CSV-download endpoint exists.
- Dedicated Files view with source selection, Add/Replace, progress, upload history
  with pagination, and timestamps displayed in Asia/Tashkent. The dashboard's last
  upload time changes only on successful publication, not on upload initiation.
- Add ignores IDs already stored for the selected source, preserving the previous
  record. Duplicate IDs within a new file are rejected. Replacement affects only
  the selected source; the other source and history are retained.
- Replacement requires an explicit warning checkbox and password verified by the
  server on both initiation and publication. Set the requested value through
  Cloudflare's secret settings; no password value is embedded in JS or Git.
- Blank agents remain null for both sources. Client names are never used to infer
  PVZ and no default PVZ is applied.
- Streaming UTF-8 CSV reader; batches of at most 100 records; per-job capability
  tokens, hashed at rest. Replayed identical batches are idempotent; changed
  replays fail. Entire-file validation precedes upload. Incomplete or invalid
  imports never change the live report. Publication uses a D1 transaction batch.
- Add versus replacement races are rejected through per-source revision checks.
  A concurrent publication requires restarting the stale upload. Interrupted
  uploads are cancelled where possible; history retains their state.

## Connect the existing Cloudflare Worker

1. In the existing Cloudflare account, Storage & databases → D1 → Create database.
   Use `pup-analytics-db`. Do not activate any paid plan without an owner decision.
2. Copy its Database ID (an identifier, not an API secret). Add this top-level
   entry to wrangler.jsonc before deploying:

   ```json
   "d1_databases": [{
     "binding": "DB",
     "database_name": "pup-analytics-db",
     "database_id": "THE_CREATED_DATABASE_ID",
     "migrations_dir": "migrations"
   }]
   ```

   This binding connects `env.DB` to the database without any browser database
   credentials. Keep the Worker name and its existing workers.dev address.
3. Use Node 22.12+ and the committed lockfile: `npm ci`, `npm test`,
   `npm run build`. Wrangler is pinned in devDependencies.
4. Apply migrations: `npx wrangler d1 migrations apply pup-analytics-db --remote`.
   Make an export/restore plan before applying migrations to a nonempty database.
5. Add the secret with `npx wrangler secret put REPLACE_PASSWORD`, entering the
   owner's requested value privately at its prompt, or use the Cloudflare secret
   UI. Never use VITE_* for passwords, and never put them in command arguments.
6. Deploy `npx wrangler deploy`. The main config declares the rate limiter binding.
   Verify its namespace ID is unused by unrelated apps in the account; rate
   limits are approximate per Cloudflare location, not an account-wide budget cap.
   Existing Workers Builds should build with `npm run build` and deploy with
   `npx wrangler deploy`, using this config rather than assets-only deployment.
7. Verify /api/health and empty dashboard/history JSON; use synthetic CSV to test
   Add, duplicate re-upload, wrong replacement password, successful replacement
   with the other source unchanged, and failure without data loss.
8. Upload the original provided dispatch and updated delivery files in Add mode.
   Expected initial results: dispatch 19,347 IDs (676 blank PVZ), delivery 15,515
   IDs (18 blank PVZ), two completed history entries, and a last-upload timestamp.
   The full original files must not be committed to Git or stored in dist.

## Capacity and retention boundaries

Verification completed: all 9 automated tests pass and the Vite production build
succeeds. A local SQLite/D1-adapter trial imported the actual provided files with
19,347 and 15,515 applied rows, preserved 676 and 18 blank PVZ values, produced two
history entries and a last-upload timestamp. These are local tests, not a claim of
successful Cloudflare provisioning or online upload. Browser QA is pending.

This initial uploader intentionally caps one file at 50,000 records and 50 MiB.
The supplied files fit. It is NOT a completed 600k–1m importer. Streaming parsing
alone does not solve large transactional publication: the final JSON expansion,
distinct-ID validation, full aggregate rebuild, D1 write/read quotas and query
duration still require measured production validation. Do not remove this cap
without implementing and benchmarking a staged-version/queue publication model.

Successful chunks are deleted on publication. Cancelled chunks are deleted on
cancel. Expired interrupted jobs are cleaned daily by the Worker scheduled handler;
their history remains cancelled. Upload attempts are limited per IP/location;
shared networks share a quota and can encounter a temporary delay.

D1 Free currently includes 100k row writes/day, 5m reads/day, 500 MB per database.
Indexing, deletes, staging, aggregate rebuilds and repeated test imports also
consume quotas. The local test does not establish production billing or speed.
If a quota fails mid-publication, the previous report remains intact; a retry
after quota reset or an explicitly approved paid plan is needed. Public uploads
can consume the allowance. No recurring cost guarantee is made.

Sources checked 2026-11-17:
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/d1/platform/limits/
https://developers.cloudflare.com/d1/worker-api/d1-database/
https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Production rollout, 2026-11-17

D1 was provisioned and both migrations applied. The existing Worker was deployed
with DB, assets, rate limiting and daily cleanup bindings; the replacement secret
was set privately. The actual supplied CSVs completed online in Add mode:
dispatch 19,347 records (676 blank PVZ), delivery 15,515 records (18 blank PVZ).
Both history entries completed. Dashboard counts, last-upload time, date filtering
and absence of a public raw-client route were checked through the deployed API.
No login or paid-plan activation was added. Visual browser QA is still pending.

URL: https://pup-analiytcs.jahongirr777.workers.dev/
