# GCP Project: white-dispatch-481617-f8 — Validated State

**Validated:** 2026-04-13  
**Source of truth:** Live GCP project inspection + handoff doc from Ivan @ intelligents.agency

---

## Project Identity

| Field            | Value                        |
|------------------|------------------------------|
| GCP Project Name | Google2XeroTest               |
| Project ID       | white-dispatch-481617-f8      |
| Project Number   | 909964402298                  |
| Organization ID  | 312660871352                  |
| Created          | 2025-12-18                    |
| Region           | us-central1                   |

## Handoff Doc Validation

Reference: `docs/easyG Billing Automation — Complete Handover.md` (by Ivan @ intelligents.agency, delivered 2025-12-29)

### Confirmed Accurate

- Xero secrets in Secret Manager: `xero-client-id`, `xero-client-secret`, `xero-refresh-token`, `xero-tenant-id` — all present
- `xero-refresh-token` has 133 versions (latest: 2026-02-01), confirming active token rotation through Feb 2026
- BigQuery `billing` dataset with all documented tables present and schemas match described functionality
- Markup rules match doc: NEW (25%), RENEWAL (13.63%), TRANSFER (5.26%), plus Google Voice pass-through at 0%
- SKU-to-Xero account mappings: 22 active SKUs mapped (Workspace, Voice, Vault, Education, etc.)
- Xero tracking categories configured for pricing model (Commit/Flex) and subscription status (New/Renewal/Transfer)
- `billing-service` SA exists with BigQuery Admin + Data Owner roles

### Discrepancies Found

| Handoff Doc Says | Actual State | Severity |
|------------------|-------------|----------|
| Cloud Run Job `gcs-billing-automation` exists | **No Cloud Run jobs exist** — job has been deleted | Critical |
| Cloud Scheduler runs on 2nd of month, 8am ET | Two separate schedulers: `billing-monthly-trigger` (1st @ 6PM UTC) and `voice-tax-monthly-trigger` (1st @ 11PM ET) | Medium |
| Single Cloud Run Job handles everything | Voice tax is a **separate** job (`voice-tax-processor`) — also deleted | Medium |
| "Daily processing" in architecture diagram | No evidence of daily runs; only monthly scheduler triggers found | Low |
| Doc implies system is running | **Both Cloud Run jobs are deleted.** Schedulers fire but target nothing (last attempts returned error code 5 = NOT_FOUND) | Critical |

### Current State Summary

- **The system is non-functional.** Both Cloud Run jobs have been deleted.
- Schedulers are still active and attempting to fire monthly, but hitting NOT_FOUND errors.
- Last successful data: Dec 2025 billing period only (72 line items, 64 customers, all marked SENT_XERO).
- No data for Jan, Feb, Mar, or Apr 2026 — billing has not run since the initial delivery.
- `billing_new` dataset exists with only the raw export table, suggesting an incomplete migration attempt.
- The `xero-refresh-token` was last rotated on 2026-02-01, so it may have expired by now.

## Infrastructure That Still Exists

### BigQuery (billing dataset — 14 tables)

| Table | Purpose | Has Data |
|-------|---------|----------|
| `reseller_billing_detailed_export_v1` | Raw Google Channel export (daily) | Yes (partitioned) |
| `aggregated_invoice_items` | Grouped line items per customer/SKU/period | Yes |
| `invoice_outbox` | Staging + Xero sync status | Yes (72 rows, Dec 2025 only) |
| `markup_rules` | NEW/RENEWAL/TRANSFER rates | Yes (4 rules) |
| `sku_to_xero_account` | Product-to-Xero account code mapping | Yes (22 SKUs) |
| `customer_to_xero_contact` | Google customer to Xero contact cache | Yes |
| `customer_to_xero_contact_backup` | Backup of above | Yes |
| `subscription_overrides` | Per-customer rate overrides (e.g., transfers) | Yes |
| `tracking_categories` | Xero tracking dimensions | Yes (5 entries) |
| `processed_periods` | Which months have been billed | Exists |
| `customer_history` | Historical customer data | Exists |
| `workspace_usage_raw` | Raw usage data | Exists |
| `workspace_usage_classified` | Classified usage data | Exists |
| `workspace_usage_with_markup` | Usage with markup applied | Exists |

### Cloud Scheduler (still active, targeting deleted jobs)

| Job | Schedule | Target (DELETED) |
|-----|----------|-------------------|
| `billing-monthly-trigger` | 1st of month, 6 PM UTC | Cloud Run Job: `gcs-billing-automation` |
| `voice-tax-monthly-trigger` | 1st of month, 11 PM ET | Cloud Run Job: `voice-tax-processor` |

### Secret Manager

| Secret | Versions | Last Updated |
|--------|----------|-------------|
| `xero-client-id` | 1 | 2025-12-19 |
| `xero-client-secret` | 1 | 2025-12-19 |
| `xero-refresh-token` | 133 | 2026-02-01 |
| `xero-tenant-id` | 1 | 2025-12-19 |

### Service Accounts

| Name | Email | Roles |
|------|-------|-------|
| billing-service | `billing-service@white-dispatch-481617-f8.iam.gserviceaccount.com` | BigQuery Admin, BigQuery Data Owner |
| Default compute | `909964402298-compute@developer.gserviceaccount.com` | (used by schedulers for OAuth) |

### Storage

| Bucket | Purpose |
|--------|---------|
| `gs://white-dispatch-481617-f8_cloudbuild/` | Cloud Build source archives |

### Enabled APIs (key ones)

Cloud Run, Cloud Functions, Cloud Build, Cloud Scheduler, Secret Manager, BigQuery, Pub/Sub, Compute Engine, IAM, Cloud SQL Admin, Vertex AI, Cloud Storage, Artifact Registry, Cloud Logging, Cloud Monitoring
