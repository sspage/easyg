# Current State Report: easyG Billing Automation

**Date:** 2026-04-13  
**Assessed by:** spage + Claude  
**GCP Project:** white-dispatch-481617-f8

---

## Executive Summary

The v1 billing automation delivered by Ivan @ intelligents.agency in Dec 2025 is **non-functional**. Both Cloud Run jobs have been deleted, the 5 scheduled BigQuery queries are all in FAILED state, and no billing has been processed since December 2025. The system successfully processed exactly one month (Dec 2025, 72 line items, 64 customers) before failing.

A new billing export table (`billing_new`) has been configured against the Google reseller account and is receiving live data (April 2026, 19,160 rows, 68 customers), but has no scheduled processing pipeline attached to it.

---

## System Components — Status

### Cloud Run Jobs: DELETED

| Job | Purpose | Status |
|-----|---------|--------|
| `gcs-billing-automation` | Main billing + Xero invoice creation | **Deleted** — no longer exists |
| `voice-tax-processor` | Voice tax proportional distribution | **Deleted** — no longer exists |

No source code is available in this repo. These were containerized apps built via Cloud Build, but the container image is stale (last build: 2026-01-02).

### Cloud Scheduler: ACTIVE but broken

Both schedulers fire monthly but target deleted Cloud Run jobs. Last attempts returned error code 5 (NOT_FOUND).

| Job | Schedule | Target | Last Attempt | Result |
|-----|----------|--------|-------------|--------|
| `billing-monthly-trigger` | 1st of month, 6 PM UTC | `gcs-billing-automation` (deleted) | 2026-04-01 | NOT_FOUND |
| `voice-tax-monthly-trigger` | 1st of month, 11 PM ET | `voice-tax-processor` (deleted) | 2026-04-02 | NOT_FOUND |

### BigQuery Scheduled Queries: ALL FAILED

Ivan built a 5-stage daily SQL pipeline that ran as BigQuery scheduled queries. All 5 are in FAILED state.

| # | Name | Schedule | Purpose | Input | Output |
|---|------|----------|---------|-------|--------|
| 1 | Extract Workspace Usage | Daily 2:00 AM | Extract + transform raw export into working table | `reseller_billing_detailed_export_v1` | `workspace_usage_raw` |
| 2 | Classify Subscriptions | Daily 2:30 AM | Classify each customer as NEW/RENEWAL/TRANSFER | `workspace_usage_raw` + `subscription_overrides` + `customer_history` | `workspace_usage_classified` |
| 3 | Apply Markup Rules | Daily 3:00 AM | Apply correct markup factor per subscription type + SKU | `workspace_usage_classified` + `markup_rules` | `workspace_usage_with_markup` |
| 4 | Aggregate Invoice Items | Daily 3:30 AM | Group by customer + SKU + period | `workspace_usage_with_markup` | `aggregated_invoice_items` |
| 5 | Insert to Staging | Daily 4:00 AM | MERGE into outbox with Xero account mappings | `aggregated_invoice_items` + mappings | `invoice_outbox` |

These queries ran against `billing.reseller_billing_detailed_export_v1` (the **old** export table). They are all configured to run daily but all show FAILED state.

**Key insight:** The handoff doc's "daily processing" claim was real — it was these scheduled queries, not the Cloud Run jobs. The Cloud Run jobs only handled the final step: reading from `invoice_outbox` and pushing to Xero API.

### BigQuery Data: PARTIALLY INTACT

**`billing` dataset (old — 14 tables):**

| Table | Has Data | Notes |
|-------|----------|-------|
| `reseller_billing_detailed_export_v1` | Yes | Old export — unclear if still receiving data |
| `workspace_usage_raw` | Yes | Last populated by failed scheduled query |
| `workspace_usage_classified` | Yes | Last populated by failed scheduled query |
| `workspace_usage_with_markup` | Yes | Last populated by failed scheduled query |
| `aggregated_invoice_items` | Yes | Last populated by failed scheduled query |
| `invoice_outbox` | Yes | 72 rows, Dec 2025 only, all SENT_XERO |
| `markup_rules` | Yes | 4 rules: NEW (25%), RENEWAL (13.63%), TRANSFER (5.26%), Voice (0%) |
| `sku_to_xero_account` | Yes | 22 active SKU mappings |
| `customer_to_xero_contact` | Yes | Customer-to-Xero contact cache |
| `customer_to_xero_contact_backup` | Yes | Backup |
| `subscription_overrides` | Yes | Per-customer rate overrides |
| `tracking_categories` | Yes | 5 Xero tracking dimensions |
| `processed_periods` | Exists | Unknown if populated |
| `customer_history` | Exists | Used for NEW vs RENEWAL classification |

**`billing_new` dataset (new — 1 table):**

| Table | Has Data | Notes |
|-------|----------|-------|
| `reseller_billing_detailed_export_v1` | Yes | **Live data** — 19,160 rows, April 2026, 68 customers |

- Created: 2026-04-07 (based on earliest export_time)
- Configured by spage against the Google reseller account
- Has write access for `cloud-channel-billing-reporting-rebilling@system.gserviceaccount.com` (Google's export SA) and `devgc@easygcloud.com`
- Contains April 2026 data: $6,562.04 in costs, $7,402.23 at list price ($840.19 total margin)
- 68 customers, mix of Workspace (Starter/Standard/Plus/Enterprise) + Voice (Standard/Starter) + Vault + outbound calls
- **Not scheduled** — appears to be receiving Google's automatic daily export, but has no processing pipeline

### Secret Manager: PRESENT but likely stale

| Secret | Versions | Last Updated | Status |
|--------|----------|-------------|--------|
| `xero-client-id` | 1 | 2025-12-19 | Likely valid (static) |
| `xero-client-secret` | 1 | 2025-12-19 | Likely valid (static) |
| `xero-refresh-token` | 133 | 2026-02-01 | **Likely expired** — 2+ months since last rotation |
| `xero-tenant-id` | 1 | 2025-12-19 | Likely valid (static) |

The 133 versions of `xero-refresh-token` show the system was actively rotating tokens through Feb 1, 2026. Xero refresh tokens expire after 60 days of non-use, so re-authentication will be required.

### Service Accounts: INTACT

| Name | Email | Roles |
|------|-------|-------|
| billing-service | `billing-service@white-dispatch-481617-f8.iam.gserviceaccount.com` | BigQuery Admin, BigQuery Data Owner |
| Default compute | `909964402298-compute@developer.gserviceaccount.com` | Used by schedulers |

### Enabled APIs: 46 ACTIVE

All necessary APIs are enabled including Cloud Functions, Cloud Run, Cloud Build, BigQuery, Secret Manager, Cloud Scheduler, Pub/Sub, and Firebase-relevant services.

---

## What Actually Worked (Dec 2025)

Based on the `invoice_outbox` data:
- 72 line items processed for Dec 2025 billing period
- 64 unique customers
- All 72 items successfully sent to Xero (status: SENT_XERO for both invoices and bills)
- This was the only month ever processed

---

## Months Missed

| Month | Status |
|-------|--------|
| Dec 2025 | Processed (the only one) |
| Jan 2026 | **Not processed** |
| Feb 2026 | **Not processed** |
| Mar 2026 | **Not processed** |
| Apr 2026 | **Not processed** (data available in `billing_new`) |

---

## Configuration Change: billing_new

The `billing_new` dataset was created by spage as a fresh export target configured directly against the Google reseller account. This was done because the reliability of the old `billing` dataset's export pipeline could not be verified.

**Recommendation:** Use `billing_new.reseller_billing_detailed_export_v1` as the source of truth going forward. The old `billing.reseller_billing_detailed_export_v1` table should be retained temporarily for historical reference (Dec 2025 processing) but the new system should read from `billing_new`.

The configuration/reference tables in `billing` (markup_rules, sku_to_xero_account, customer_to_xero_contact, etc.) contain useful seed data. This data should be migrated to whatever storage the new system uses, but the tables themselves were designed for a SQL-query-driven workflow that is being replaced.

---

## Why It Failed

1. **No UX** — the system required the end user (Doug) to run manual SQL queries in BigQuery Console for any configuration changes, overrides, or troubleshooting. This is an unreasonable expectation for an operator who should be working at the application level, not writing SQL against infrastructure.
2. **Cloud Run jobs deleted** — the containerized apps that pushed data to Xero no longer exist, and no source code is available in this repo.
3. **Scheduled queries failing** — the 5-stage BigQuery pipeline is in FAILED state. Even if the Cloud Run jobs existed, the pipeline feeding them is broken.
4. **No monitoring or alerting** — when the system broke, nobody was notified. It silently stopped processing.
5. **Token expiration** — the Xero refresh token has likely expired after 2+ months of non-use.
6. **No backfill capability** — there is no mechanism to process missed months.

---

## Assets Worth Preserving

| Asset | Why |
|-------|-----|
| `billing_new` export table | Live data feed from Google — this is the new source of truth |
| Markup rate logic (NEW/RENEWAL/TRANSFER) | Business rules are correct, just need better UX |
| SKU-to-Xero account mappings (22 SKUs) | Took effort to map; seed data for new system |
| Customer-to-Xero contact mappings | Avoids re-mapping 68 customers |
| Subscription override concept | Good pattern, needs UI instead of SQL |
| Scheduled query SQL logic | Documents the transformation pipeline; useful as reference for reimplementation |
| Xero app credentials (client ID/secret) | Can be reused after re-auth |
| `billing-service` SA | Already has correct IAM roles |

## Assets to Retire

| Asset | Why |
|-------|-----|
| Cloud Run jobs | Already deleted; replacing with Cloud Functions |
| Cloud Scheduler jobs | Point to deleted targets; will be reconfigured |
| 5 BQ scheduled queries | All FAILED; replacing with serverless functions |
| `billing` dataset intermediate tables | Designed for SQL pipeline; new system will handle in code |
| `billing.reseller_billing_detailed_export_v1` (old) | Replaced by `billing_new` export |
