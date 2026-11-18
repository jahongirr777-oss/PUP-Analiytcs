# Dispatch interaction and allocation update — 2026-11-18

The owner requested mouse-selectable calendar controls, labelled simultaneous
count/amount charts, optional charts in detail sections, arbitrary A/B date ranges
and warehouse groups, top routes per warehouse, and ID-only geographic drilldown
with copying. Public access is preserved. Delivery operational data is unchanged.

## Periods and presentation

- Calendar popovers have month/year selectors and clickable dates. The date
  preset semantics from DISPATCH_ANALYTICS.md remain.
- Automatic daily comparisons skip a zero-count previous day and use the latest
  earlier populated day for the same warehouse scope. The actual baseline date
  is returned/displayed. No future date is used. Manual A/B comparisons continue
  to honor the explicitly selected ranges, including zero groups.
- Warehouse display names retain codes, remove export prefixes/suffixes, and
  end in Warehouse. The unfiltered choice is ALL. Raw source identifiers remain
  stable in storage and filters.
- The overview chart renders count and amount together with independent scales,
  distinct colors, numeric point labels and full-value tooltips. Detail sections
  have explicit graph toggles.
- With ALL warehouses, the route table selects one maximum-count province per
  warehouse (deterministic province-name tie-break). Selecting a warehouse shows
  every province for it. Route share uses that warehouse's total, not global total.

## A/B comparison and ID drilldown

The comparison section takes independent inclusive date ranges and independent
multi-warehouse sets. Empty warehouse sets mean ALL. Results show counts, fees,
absolute differences and percentage differences against B. Coverage and zero
baseline safeguards remain. A warehouse present in both sets counts in both.

Geographic counts open a public ID-only endpoint. It requires explicit date and
province scope and optionally warehouse/district. Responses contain at most 200
IDs plus a keyset cursor and source revision. Subsequent pages reject a changed
source revision, preventing mixed-version copying. No client names, contacts,
addresses or other operational record fields are returned. Reads are rate-limited,
uncached and no-store. Users can load all matching IDs and then copy with a fresh
button click, or select the readonly text for manual copying.

## Approved 106 allocation rule

The owner explicitly approved both specified Bekbaraka client aliases for 106 and
approved retaining the six existing 106 rows with other clients. The exact aliases
and their digest values are NOT in Git, browser assets or public responses.
The server's BEKBARAKA_CLIENT_KEYS secret holds the approved normalized SHA-256
digests. Browser import computes a transient client digest; the server applies
the rule only to dispatch and drops the digest before staging/storage. The rule
also applies to future dispatch uploads.

The existing dataset requires 767 records reassigned from other/blank PVZ values
to 106. Their IDs and original agents are kept only in a private local correction
file. The correction is a single guarded SQL UPDATE with aggregate-maintenance
triggers. It removes the records from their original warehouse aggregates and
adds them to 106 without duplicating IDs. Expected 106 total is 6,007; total
shipments, charges, customer/payment totals and delivery remain unchanged.

Migration 0004 maintains daily totals, dispatch cube, source revision and data
update timestamps atomically on warehouse reassignment. Revisioned public-report
caching therefore invalidates immediately. A private database export is retained
before correction. Neither exports nor correction ID lists are committed.

Validation covers zero-day fallback and scope isolation, display names/top-route
selection, secret-based dispatch-only assignment, atomic aggregate changes,
delivery preservation, group comparisons, scoped IDs and changed-revision denial.
Browser visual and clipboard interaction QA require an available browser-control
session; build/API tests alone are not claimed as visual verification.

## Verified production result

The approved single-statement correction completed: 106 = 6,007 records; total
dispatch = 42,904; remaining blank PVZ = 1,551. Total charges and the complete
delivery aggregate fingerprint were unchanged. Top-route selection returned one
row for each of 31 warehouse values (including unassigned). Independent A/B
warehouse groups reconciled to expected counts. A 917-ID geographic result was
paginated without duplicates or extra fields; missing scope and stale revisions
were rejected. An actual sparse warehouse daily comparison used November 10
instead of the zero-count November 15 baseline when comparing November 16.
All 16 automated tests and the production build passed. Visual and system-clipboard
interaction QA were not available in this session.
