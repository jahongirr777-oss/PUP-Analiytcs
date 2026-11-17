# PUP Analytics: reliable data foundation

Reviewed 2026-11-17 against main commit 34bd6954d27c8ae51f2da82f295047627478cd49.

## Observed state

The deployed workers.dev app loads. Its footer reports that the API is unavailable.
Opening /api/health renders the React loading screen rather than a JSON health
response. Repository code contains a Pages Function, but no Worker entry point
or Wrangler configuration. This is consistent with SPA fallback swallowing API
requests on the Workers deployment. Cloudflare account configuration was not
accessible, so that exact deployment setting is not independently confirmed.

App.jsx contains four hard-coded locations and calculated demo KPIs. PVZ selection
filters those rows; the period selector only changes local state. Dispatch and
delivery pages reuse sample cards. Clients/status/files are placeholders. There is
no upload, authentication, database binding, data version synchronization, or CSV
parser. The loading percentage is initialization progress, not imported-row progress.

## This change

Adds an explicit Workers entry point and asset routing. /api/health returns demo
liveness JSON; all other /api routes return 503 JSON until protected data routes
exist. This avoids accidentally returning index.html for missing API routes.
The frontend remains demo-only. Public health deliberately does not query D1 or
expose schema, record counts, filenames, user identities, or database errors.

Adds a D1-compatible metadata migration for staging datasets, idempotent import
jobs, checkpoints and an active-version pointer. It does not invent dispatch or
delivery column mappings. No database is provisioned/bound and no real data is
uploaded by this change. The SQL is a foundation, not a working importer.

## Free-tier feasibility

Official limits checked on the review date:

| Resource | Free allowance / constraint | Consequence |
| --- | --- | --- |
| D1 | 500 MB per database; 5 GB account total | Row count alone cannot establish capacity; include indexes and retained staging versions. |
| D1 | 100,000 rows written/day; 5 million rows read/day | A 600k–1m initial load needs at least 6–10 daily quotas without index/metadata overhead; actual import can take longer. |
| Workers | 100,000 requests/day; 10 ms CPU per invocation; 128 MB memory | Do not parse an entire large CSV in an HTTP request or load it into browser memory. |

Index maintenance adds billable writes. Two source files, corrections, retries,
aggregation and keeping old/new datasets increase work further. Queries fail when
D1 free daily quotas are exhausted. Full scans of one million rows would use a
substantial part of the read budget on each refresh.

For production volume, recommend benchmarking D1 on Workers Paid rather than
promising zero cost. Workers Paid starts at $5/month; D1 paid has a 10 GB per-DB
limit, with usage charges beyond included allowances. This is not an all-inclusive
quote: include storage, queues, uploads, backups and traffic, then set monitoring
and budget controls. Do not enable a paid plan without the owner's decision.

If zero recurring cost is mandatory: stream/process locally on an authorized
computer and upload only approved aggregates to a protected dashboard; keep raw
records private locally. This sacrifices always-online raw-record queries and
requires an explicit refresh procedure. Do not split databases merely to evade
free quotas: writes are an account-wide daily allowance.

Capacity gate: generate synthetic records with realistic identifier lengths and
field widths, load 100k then 1m into a disposable staging database, and measure
database bytes including indexes, rows read/written, import throughput and query
p95 under representative concurrency. Allow room for two dataset versions,
temporary staging and growth. SQLite local measurements are preliminary, not a
substitute for Cloudflare metrics. If projected D1 growth approaches its paid
per-database ceiling or concurrent analytical workloads cannot meet latency,
evaluate managed PostgreSQL with a measured budget before finalizing storage.

## Next implementation sequence

1. **Repair runtime in a preview.** Use Workers deployment, not Pages instructions:
   build `npm run build`; deploy `npx wrangler deploy` with this config. Pin a tested
   Wrangler 4 version and commit a dependency lockfile on a machine with Node
   22.12+ before production use. Verify /api/health has JSON content type and
   /api/unknown is 503 JSON; confirm assets and PVZ filter still work. The existing
   Pages function may remain for a separate Pages deployment, but is not the
   Workers entry point. Avoid silently switching hosting products.
2. **Protect the data plane before connecting real records.** Configure Cloudflare
   Access for the intended staff and verify signed Access JWTs in the Worker
   (trusted issuer/JWKS, signature algorithm, audience, expiry and not-before).
   Check authorized user/role and permitted PVZ on every request. A header containing
   an email address alone is not authentication. Cover workers.dev, custom domains
   and preview aliases, or disable bypass routes. Public health can remain liveness
   only. Reject missing/invalid identity before any database or object access.
   Use same-origin secure sessions; protect mutations against CSRF, apply rate and
   upload limits, and return private no-store responses. Test anonymous, expired,
   forged, wrong-audience and cross-PVZ access. No wildcard credentialed CORS.
3. **Provision a separate staging D1.** Bind it as DB in the selected environment:
   add `d1_databases` with `binding`, `database_name`, `database_id` and
   `migrations_dir: "migrations"` to its Wrangler config. Database IDs are identifiers,
   not passwords. Apply migrations locally, then staging; make an export/restore
   plan before production migrations. Keep staging and production resources
   separate. Secrets belong in Cloudflare secrets or protected CI secrets, never
   VITE_* variables or repository files. D1 uses the server binding; no browser DB
   token is necessary. Enable only prepared, bound SQL and allowlisted sort fields.
4. **Agree the data contract.** Obtain only the column headers and 5–10 invented or
   thoroughly anonymized rows from each CSV, with delimiter/encoding/date timezone,
   currency units, whether rows are events or snapshots, and how duplicate IDs and
   corrections behave. Preserve identifiers as TEXT (including leading zeros),
   amounts as integer minor units, and explicit event timestamps/business dates.
   Confirm whether shipment ID is unique globally or within a source/PVZ and
   whether one shipment can have multiple deliveries. Do not join on phone/name.
5. **Build bounded resumable import.** Authenticated upload initiation -> private R2
   object with short-lived scoped multipart upload -> server validation -> bounded
   jobs -> staging data -> reconciliation -> atomic active-dataset publication.
   Queues carry object/job references, not CSV or personal data. Select chunk size
   from CPU/write measurements; free Queues have limited retention and quotas, so
   persist recovery state in D1. Queue delivery may repeat: commit each batch's
   data and checkpoint atomically and enforce uniqueness for idempotent replay.
   Never use naive split-on-newline: support quoted commas, multiline values, BOM,
   encoding, oversized records, invalid dates/amounts and formula-safe exports.
   Use file SHA-256 + source kind + mapping version for duplicate detection within
   a dataset; define cross-dataset replacement separately. Put errors in protected
   storage by row number/error code; never log raw client rows.
6. **Publish reconciled reports.** Preserve unmatched dispatch/delivery IDs, report
   duplicates and rejected rows, reconcile source counts/totals, then build daily
   PVZ aggregates for the candidate version. Validate both required sources before
   marking ready; the metadata trigger alone cannot validate their contents. Switch
   active_dataset only after validation in one transaction. Keep the previous
   version for rollback. Dashboard endpoints return aggregates and data_version;
   record drilldowns use bounded keyset pagination and server-side authorization.
   Failed imports leave the active version unchanged; never fall back to demo
   figures inside live mode. UI must show loading, empty, stale and error states.

R2 must remain private (no public bucket URL). Confirm current free storage and
operation allowances and account/billing requirements before enabling it. Define
raw file/error retention and deletion, backup retention, least-privilege staff
access and account-region requirements before importing client data. Keep real
CSVs, exports, SQLite files, .dev.vars and .env files outside Git and build assets.

## Acceptance gates

- Preview runtime smoke check passes, including /api JSON behavior.
- Authentication/authorization denial tests pass before real data binding.
- Local SQL constraints reject duplicate imports and activation of staging data.
- Synthetic 1m-row run fits storage/headroom and agreed cost/latency bounds.
- Resume after interruption produces no duplicates or double-counted aggregates.
- A deliberately invalid import never changes the active report version.
- Two independent source counts/totals reconcile; leading-zero IDs survive.
- Restore/rollback is demonstrated with synthetic data, not client records.

## Sources

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/queues/platform/limits/
- https://developers.cloudflare.com/r2/pricing/

Local verification: Worker tests can run with `node --test tests/worker.test.mjs`.
Cloudflare runtime preview and the full frontend build remain required before merge.
