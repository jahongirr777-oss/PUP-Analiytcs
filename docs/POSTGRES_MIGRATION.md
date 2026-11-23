# PostgreSQL migration — prepared, not activated

## Status and user constraints

The user requires no payment card and no subscription charges. Oracle signup failed. R2 is disabled (Cloudflare error10042); the user cannot add a payment method. Do not enable R2, paid Workers, overages or a trial that silently becomes paid. Keep the current D1 deployment intact until a new destination is explicitly approved and remotely verified. The earlier rejected private KV snapshot transfer remains unapproved.

Candidate checked 2026-11-23: **YugabyteDB Aeon Serverless Postgres**, not the old Sandbox and not paid Distributed Postgres. Official docs state no card required, a shared account allowance of 2vCPU,16GiB memory,100GiB storage. Verify the same offer in the actual account before proceeding. This is not an unlimited throughput, permanent pricing or free-tier SLA promise. Check idle/suspend, backup retention, network and other terms in the account; old Sandbox terms must not be assumed to apply to Serverless.

Sources:
- https://docs.yugabyte.com/stable/yugabyte-cloud/serverless/
- https://docs.yugabyte.com/stable/yugabyte-cloud/cloud-quickstart/
- https://docs.yugabyte.com/stable/yugabyte-cloud/serverless/create-connect/
- https://developers.cloudflare.com/workers/databases/connecting-to-databases/
- https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/
- https://developers.cloudflare.com/hyperdrive/platform/pricing/

## Architecture

GitHub stores source only. Cloudflare continues to serve the same website and a small API. `postgres/worker.mjs` connects directly to PostgreSQL with verified TLS; no new VPS or R2 required. Direct connections need an agreed restricted egress strategy; an optional Free Hyperdrive binding can provide documented Cloudflare egress ranges. Database passwords remain Worker secrets. Cloudflare Workers Free still has 100,000 invocations/day and CPU/memory limits. Moving the database removes D1 row quotas, not every Cloudflare limit. The optional Node HTTP service works on an existing VPS, but no VPS has been provisioned.

`postgres/schema.sql` stores operational rows in generations and exposes views matching existing report queries. Additive publication inserts only previously absent IDs and updates summaries from the actual inserted delta. It never rebuilds all10m records for a monthly50k add. Replacement builds a separate generation, then atomically switches only the selected source. Failed publication leaves the active generation unchanged. Retired generations are retained at least24h, then cleaned in batches. Import staging and disk usage must be monitored; logical deletes require autovacuum and do not guarantee an immediately smaller physical file.

Imports are normalized and stripped of client names before storage. The approved secret hash rule for106 remains server-side. Blank agents stay blank. Public browsing and additive imports remain intentionally open; replacement requires the server-side password and explicit confirmation. Chunk replay is idempotent; duplicate IDs within a file fail; status requires the capability token. Concurrent stale imports fail instead of silently overwriting another import.

Reports use daily summaries and indexed, scoped ID pages. The Node service persists bounded last-good aggregates on its own disk. The Worker keeps best-effort cached aggregates with a visible fallback timestamp; cache eviction/cold locations mean fallback is not a durable availability guarantee. IDs are never cached or fabricated on outage. Fresh report cache can lag successful publication by up to15s. Neither cache is a backup.

## Limits that are actually implemented

- Optional Node server:2m records/file,512MiB CSV,500 rows/chunk; capacity is unverified on a real VPS.
- Worker candidate:50k records/file,50MiB CSV,100 rows/chunk,20s publication budget. This conservative bound fits the stated50k/month growth but is **not** the eventual600k–1m single-file importer. Larger imports require a staged/resumable publisher and real capacity tests before increasing this limit.
- Browser reads CSV as a stream, but holds an ID Set to reject duplicates; memory still grows with file size.
- Background publication uses database locks, durable queued state, restart retries and status polling. Database statement timeouts fail safely; network interruption leaves a retryable job. No automatic import from external email/storage is enabled.

## Activation checklist

1. User signs up at https://cloud.yugabyte.com/ and confirms **Serverless Postgres / Start free**,2vCPU and the advertised free storage, with no billing profile. If only paid options appear, stop; do not choose them.
2. Obtain specific approval to transfer shipment IDs, dates, statuses, PVZ, fees/COD, client/payment categories, recipient district/province and completed upload history. No client names, phone numbers, CSV originals or existing Cloudflare credentials are transferred.
3. Create a restricted application database role. Keep admin credentials local. Require TLS certificate verification; use supplied CA if necessary. Determine a secure trusted-IP strategy for Cloudflare's variable egress before live data. Provider docs explicitly advise against0.0.0.0/0 for production; do not silently open access worldwide. One documented no-card candidate is Hyperdrive Free with Cloudflare IP ranges allowlisted and origin TLS verify-full. It adds a separate100,000 SQL-statements/day quota (including cache hits). Create it only after owner approval for the database credentials/destination, verify the origin CA/hostname, then set HYPERDRIVE_TLS_VERIFIED=true and add the returned HYPERDRIVE binding. Do not enable this flag before verification. A direct connection is also supported if a secure allowlist is possible. If the required network configuration needs payment, report the blocker instead of weakening security.
4. Test schema, JSONB, transactions, temporary tables, read snapshots, locks, indexes and timeout/rollback on the actual Serverless engine using synthetic data. PGlite tests establish PostgreSQL semantics but do not establish cloud compatibility, routing or throughput.
5. Freeze existing uploads briefly and export a fresh D1 backup. Keep it private. Build a local SQLite input from the trusted provider SQL export, never arbitrary uploaded SQL.
6. `node postgres/migrate.mjs /private/path/current.sqlite --approved-transfer` uses POSTGRES_DATABASE_URL/POSTGRES_CA_CERT secrets in the environment, requires an empty target, copies only allowlisted operational fields and completed history, invalidates old capabilities, builds summaries and verifies sorted row fingerprints before committing. Never include connection strings in shell arguments or Git.
7. Reconcile live counts, sums, per-PVZ/date totals, blank agents,106 attribution, history and scoped ID hashes. Last known checkpoint is42,904 dispatch,15,515 delivery,dispatch fee_minor185209060000,106 count6,007,blank dispatch1,551; a fresh source takes precedence.
8. Put POSTGRES_DATABASE_URL and optional POSTGRES_CA_CERT in Cloudflare secrets using hidden stdin. Preserve REPLACE_PASSWORD and BEKBARAKA_CLIENT_KEYS. Set a unique DB_GENERATION. Deploy `wrangler.postgres.jsonc` only after consent and remote tests. The default wrangler.jsonc remains D1.
9. Smoke-test dashboard, date/PVZ filters, comparisons, scoped ID pages/copy, upload history, wrong password, add/replay, replacement isolation, interruption and quota/connection outage. Check actual Worker CPU and PostgreSQL size/latency at representative capacity. Resume writes after verification.
10. Keep D1 and source backups for rollback. After new PostgreSQL writes, first export/reconcile them before reverting to D1; a simple provider switch would lose them. Establish and test independent encrypted backups; free cloud storage is not itself a backup plan.

## Local checks

Automated tests cover real PostgreSQL SQL via PGlite, Worker routing/background jobs, delta reconciliation, atomic replacement, rollback after a late summary failure, duplicate/replay handling, stale revisions, public history privacy, verified TLS, bounded rate limiting and aggregate fallback. Cloud signup, remote compatibility,10m-row capacity, secure Cloudflare egress, browser end-to-end and container startup are still unverified. No live data has been transferred or current deployment changed.
