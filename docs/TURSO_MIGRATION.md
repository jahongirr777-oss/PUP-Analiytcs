# Turso Free migration: prepared, not activated

The live deployment remains D1. The adapter and optional daily client/payment/route rollups are local preparation. No Turso account, database, token or data transfer has been created.

Free is quota-limited, not an uptime guarantee. Official pricing checked 2026-11-23: 5 GB storage, 500 million rows read/month, 10 million rows written/month. Exceeding quotas can block service. Do not enable paid billing or overages. Sources: https://turso.tech/pricing and https://docs.turso.tech/help/usage-and-billing .

## Before cutover

1. Obtain explicit consent to send tracking IDs, dates, statuses, PVZ, amounts, client/payment categories, recipient regions and upload history to Turso Free. Do not send names, phones, CSV originals or Cloudflare secrets. Existing permission for Cloudflare or the rejected KV snapshot upload is not permission for this transfer.
2. User creates their own Turso Free account and accepts its terms. Use mature libSQL engine and least-privilege credentials kept in Cloudflare secrets.
3. Freeze uploads briefly, create a fresh private D1 backup. Retain D1 for rollback. Old Nov18 export is not an automatic current cutover source.
4. Build a clean target with migrations 0001–0005; exclude provider internal tables, pending chunks/jobs and reusable historical upload tokens. Preserve completed history and revisions. Never commit backup files.
5. Verify real remote libSQL transactions, JSON functions, triggers, failed publication rollback and add/replace flows. Local tests do not establish remote compatibility or million-row capacity.
6. Reconcile dispatch/delivery counts, amounts, date range, by-PVZ totals and scoped ID hashes. Current checkpoint: 42,904 dispatch, 15,515 delivery; dispatch fee_minor 185209060000; 106 has 6,007 and blank PVZ 1,551. Recheck against fresh export.
7. Measure actual read/write usage for imports and reports, including indexes, staging and rollup rebuilds. Test representative large synthetic inputs without private data. Do not assume one imported record costs one written row.
8. Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN as secrets; set DATABASE_PROVIDER=turso and a unique DB_GENERATION only after verification. Migration0005 is mandatory for this mode. Old D1 KV snapshots are intentionally disabled in Turso mode.
9. Smoke-test public reports and scoped IDs, then resume uploads. Keep D1 backup intact. If rollback follows new Turso writes, first export/reconcile those writes; simply changing provider back would lose them.

## Remaining stability work

Monitor quotas before exhaustion. Cache aggregates, invalidate by source revision, and show an explicit stale timestamp for last-good report fallback. Automatic persistent fallback is not implemented for Turso yet. Existing KV payload transfer remains unapproved; do not upload it or treat this migration as a workaround. A sustained million-record workload needs measured capacity evidence before any promise of free continuous service.

## Local verification

22 automated tests passed; Vite production build passed. Adapter tests cover immutable bindings, batch mode, unsafe integers, destination validation and fail-closed provider selection. Optimized rollups and actual cloud cutover still require integration validation.
