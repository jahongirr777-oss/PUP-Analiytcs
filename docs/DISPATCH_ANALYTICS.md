# Dispatch analytics update — 2026-11-18

Scope: replace dispatch data only and extend only the dispatch analytics page.
Delivery records and its source revision remain unchanged. The shared theme and
dataset coverage banner apply to the overall site as requested. No change to main
is attempted without the owner's separate authorization.

## Source contract

New dispatch headers: Трек ID, Услуги, Дата создания, Стоимость доставки,
Статус оплаты, Первый принявший агент, Имя клиента, Тип клиента,
Регион получателя. Legacy dispatch CSVs remain accepted; unavailable dimensions
are explicitly unknown. Delivery mapping remains compatible.

The owner confirmed Мерчант = legal entity and Клиент = individual. Unknown
client types remain unknown. Payment categories are corporate, recipient cash,
sender cash, unpaid and unknown. Unpaid records remain separate and are not
silently counted as paid. Amounts are delivery charges, not COD. All source rows
are counted, and the customer type detail reconciles to total shipments.

Client names and original CSVs are never uploaded or committed. Blank agents
remain null. Only allowlisted operational fields, the approved client category,
payment category, recipient district and derived province enter storage. Original
district labels are retained; province grouping normalizes apostrophe/spacing and
explicit spelling/historical aliases against public administrative references.
Unknown new district names remain unknown rather than guessed.

## Periods and comparisons

Preset periods are calendar day, Monday-start week, decade (1–10, 11–20,
21–month end), month, quarter, half-year and year. The default anchor is the last
date in the dispatch data, not today's potentially uncovered date. The user can
change the anchor, use custom inclusive dates, or clear the date filter with X.

Incomplete calendar periods compare matching elapsed portions of the previous
period. Example: November 1–17 versus October 1–17. A custom interval compares
the immediately preceding interval of equal inclusive length. Leap dates clamp
to the previous month's/year's valid last day. Decades respect their actual
calendar lengths. Exact current and previous dates are shown in the UI.

Comparisons are suppressed unless both intervals lie within the imported source
coverage. A zero baseline shows the absolute change with no invented percentage.
The full imported source date span and its successful publication time remain
visible independently of report filters. The last update is displayed in
Asia/Tashkent; source business dates are not shifted across timezones.

## Report behavior

Two large KPI cards expand count-only customer composition or payment detail.
The default dynamic table contains count, count growth and amount; count detail
removes monetary columns. The amount detail includes payment counts/amounts and
an amount trend. Tables sort by date/count/amount/growth and can group by the
calendar periods above. The chart has individual point tooltips.

Source PVZ and dates filter every dispatch detail. Province bars show counts and
share of selected shipments. The paginated PVZ → province table supports
province filtering; its district breakdown retains actual source names. The
global light/dark theme persists locally, using muted ivory/sage and slate/navy
surfaces rather than pure white/black.

## Rollout and verification

Migration 0003 adds dimension columns and a daily aggregated dispatch cube, with
unknown-dimension backfill to preserve the existing report during rollout.
Replacement validates/stages all rows, then atomically replaces only dispatch,
rebuilds dispatch aggregates and updates its history. A private database export
is retained locally before the operation; no backup or CSV enters Git.

Tests cover calendar edges, partial coverage, zero baselines, source mapping,
PVZ isolation, aggregate reconciliation, delivery preservation and import rollback.
Before/after production checks compare delivery count/amount/COD and the
dispatch count, amount, category totals, range, blank PVZ count and history.

Geographic sources:
- https://gov.uz/oz/adliya/sections/view/2828
- https://gov.uz/oz/yaypan/news/view/120156
- https://gov.uz/oz/navoiy/news/view/159179

The existing 50k-per-file limit remains. This update does not assert that the
current publication transaction is suitable for million-row files.
