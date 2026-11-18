# D1 read-limit incident and recovery preparation — 2026-11-18

Diagnosis: the Worker log explicitly reports the account's D1 Free daily row-read
limit exceeded. The assets and liveness endpoint return 200 while all database
reports return 503. Operator SQL confirmed 58,419 operational rows, three upload
history entries and the warehouse correction audit are intact. No data deletion
or corruption was observed. The daily reset is 00:00 UTC, 05:00 Asia/Tashkent.

The analytics queries amplified reads through repeated cube scans. An edge cache
alone was insufficient because each lookup first read D1's source revision; even
that read fails after quota exhaustion. Report availability must not depend on a
database read merely to locate its cache.

## Prepared recovery

- Private current D1 export; no source facts, export or payload committed.
- Operator helper scripts/build-read-snapshot.mjs builds compact immutable read
  models and private geographic ID blocks. Current payload: 99 keys, about 2.3 MB
  total, largest value under 100 KB, well below KV's per-value limit. KV Free has
  separate daily operation quotas; this is not an unlimited-capacity promise.
- Namespace REPORT_CACHE is created but payload upload requires the owner's
  specific approval. Automatic approval review rejected uploading shipment IDs
  and operational aggregates to this additional remote storage destination.
  Do not bypass the rejection with Worker-side writes or a different upload path.
- server/read-snapshot.mjs serves existing report contracts without any D1 access.
  Scope/date validation, keyset pagination, revision checks and ID-only responses
  are preserved. There are no customer names/contacts in the snapshots and no
  public object-download endpoint. Source update time and snapshot build time are
  separate; the UI identifies saved reports.
- Successful publication invalidates the old snapshot before changing live data;
  failed publication restores its pointer. Future uploads must never silently
  retain an old report as the new version. After any data change, an authorized
  operator must regenerate the snapshot; an automatic refresh pipeline is not
  claimed by this incident fix. Direct source corrections also require refresh.
- The current, time-bounded D1 read restriction is exposed clearly to users and
  gates new uploads until the quota resets. No paid plan was activated.

## Operator activation after explicit data/destination approval

1. Confirm the private export is current, then run the helper with private input
   and output paths. Do not include either payload in Git or dist.
2. Upload the private bulk JSON using the REPORT_CACHE binding. Account for KV's
   daily write allowance. KV is eventually consistent; verify all required keys
   from the deployed location before reporting recovery complete.
3. Deploy, then check dashboard, history, warehouse/date filtering, comparisons,
   geographic ID pagination and original totals. Test with all D1 reads denied.
4. Retain the original source update timestamp and delivery fingerprint; no new
   data import or source mutation is required for this read-only recovery.

All 19 automated tests pass, including database-independent reads, scope/revision
denials and snapshot invalidation. Production activation is pending payload
approval, so the site must not be reported restored until verified online.

Sources:
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/kv/platform/pricing/
