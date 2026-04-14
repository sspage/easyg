# GCP Architecture Plan: v1 -> v2 Transition

**Date:** 2026-04-13

---

## Current Services Inventory

### Services to KEEP (as-is or with minor changes)

| # | Service | Resource | Current State | v2 Action | Details |
|---|---------|----------|---------------|-----------|---------|
| 1 | **BigQuery** | Dataset: `billing_new` | Active, receiving daily Google export (19K rows, 17 MB, Apr 2026) | **Keep as-is** | This is the live billing data feed from Google Channel Services. Read-only source of truth for v2. No changes needed — Google populates it automatically. |
| 2 | **Secret Manager** | `xero-client-id` | Active (1 version) | **Keep** | Static Xero OAuth app credential. |
| 3 | **Secret Manager** | `xero-client-secret` | Active (1 version) | **Keep** | Static Xero OAuth app credential. |
| 4 | **Secret Manager** | `xero-refresh-token` | Stale (133 versions, last: Feb 2026) | **Keep, re-auth required** | Token likely expired. Will need fresh Xero OAuth flow, then Cloud Functions will manage rotation going forward. |
| 5 | **Secret Manager** | `xero-tenant-id` | Active (1 version) | **Keep** | Static Xero tenant identifier. |
| 6 | **IAM** | SA: `billing-service@...iam.gserviceaccount.com` | Active, BigQuery Admin + Data Owner + `roles/datastore.user` + `roles/secretmanager.secretAccessor` | **Keep** | Already expanded with Firestore and Secret Manager access during v2 setup. |
| 7 | **Cloud Logging** | Default sinks | Active (audit + default) | **Keep as-is** | Standard GCP logging. Functions will log here automatically. |

### Services to REPLACE

| # | Service | Resource | Current State | v2 Replacement | Details |
|---|---------|----------|---------------|----------------|---------|
| 8 | **Cloud Scheduler** | `billing-monthly-trigger` | Active, targeting deleted Cloud Run job (NOT_FOUND errors) | **Delete and replace** | Delete old job. Create new scheduler targeting `processBilling` Cloud Function. Disabled by default — user enables via Settings toggle. |
| 9 | **Cloud Scheduler** | `voice-tax-monthly-trigger` | Active, targeting deleted Cloud Run job (NOT_FOUND errors) | **Delete** | Voice tax processing is merged into the main billing function. No separate scheduler needed. |
| 10 | **BQ Scheduled Queries** | 5 queries (Extract, Classify, Markup, Aggregate, Stage) | All FAILED | **Delete** -> logic moves into Cloud Functions | The 5-stage SQL pipeline becomes application code in Cloud Functions. More testable, debuggable, and the UI can show progress/errors per stage. |
| 11 | **BigQuery** | Dataset: `billing` (14 tables, 317 MB) | Stale data (last processed Dec 2025) | **Migrate seed data, then retire** | Extract useful config (markup_rules, sku_to_xero_account, customer_to_xero_contact, tracking_categories) into Firestore. Keep dataset temporarily for reference, then delete. |

### Services to DELETE

| # | Service | Resource | Current State | Reason to Delete |
|---|---------|----------|---------------|-----------------|
| 12 | **Artifact Registry** | `gcr.io` repo (33 container images, 5.5 GB) | Stale (last push Jan 2026) | No longer building containers. Cloud Functions deploy from source. 5.5 GB of dead images costing storage. |
| 13 | **Cloud Build** | Build history + source bucket `gs://..._cloudbuild/` | Stale (last build Jan 2026) | Cloud Functions deploy via `gcloud functions deploy` or Firebase CLI, not Cloud Build. |
| 14 | **Cloud Run** | Jobs: `gcs-billing-automation`, `voice-tax-processor` | Already deleted | Already gone. Just noting for completeness. |

### Services UNUSED (enabled but never used)

These APIs are enabled but have no active resources. They were likely enabled by default or speculatively.

| # | API | Action |
|---|-----|--------|
| 15 | Vertex AI | **Disable** — not used |
| 16 | Cloud SQL Admin | **Disable** — no SQL instances |
| 17 | Dataform / Dataplex / Dataproc / Datastream | **Disable** — not used |
| 18 | Cloud Pub/Sub | **Evaluate** — may need for function triggers, otherwise disable |
| 19 | Compute Engine | **Evaluate** — may be needed as dependency for other services |

**Note:** All items in the Replace, Delete, and Unused sections are in scope for this release. Cleanup happens after v2 is validated, not deferred.

---

## Net New Services for v2

| # | Service | Resource | Purpose | Cost |
|---|---------|----------|---------|------|
| 1 | **Firebase Hosting** | Static SPA site | Web UI for Doug — dashboard, customer management, markup profiles, billing runs, settings | Free tier (10 GB/month transfer, 1 GB storage) |
| 2 | **Firebase Auth** | Authentication | Secure admin access to the web UI (email/password or Google sign-in) | Free tier (50K MAU) |
| 3 | **Cloud Firestore** | Database | All configuration and state: markup profiles, customer mappings, SKU mappings, billing run history, line items, Xero connection state | Free tier (1 GiB storage, 50K reads/day, 20K writes/day) |
| 4 | **Cloud Functions (2nd gen)** | `processBilling` | Main billing function (Phase 1): reads BQ, applies markups from Firestore, stores draft invoices. Auto-refreshes Xero token before API calls. Triggered by user from UI (future: opt-in Cloud Scheduler). | Free tier (2M invocations/month, 400K GB-seconds) |
| 5 | **Cloud Functions (2nd gen)** | `sendToXero` | Phase 3 function: pushes approved drafts to Xero as DRAFT invoices + bills. Auto-refreshes Xero token before API calls. Triggered by user from UI. | Free tier |
| 6 | **Cloud Functions (2nd gen)** | `xeroCallback` | Xero OAuth callback handler for re-auth flow from UI | Free tier |
| 7 | **Cloud Functions (2nd gen)** | `api` | API layer for web UI — CRUD for profiles, customers, overrides, SKU mappings, billing run state, settings | Free tier |
| 8 | **Firestore API** | (enable) | Required for Firestore access | No cost |
| 9 | **Firebase** | Project link | Link existing GCP project to Firebase | No cost |

**Scheduling:** Cloud Scheduler is deployed and configured but **disabled by default**. The user enables it via a toggle in Settings. When enabled, it auto-runs Phase 1 (Process) only — Phases 2 (Review) and 3 (Send to Xero) always require user action.

**Xero tokens:** The Xero OAuth refresh token is automatically refreshed at the start of any billing action (Process or Send to Xero). The user never has to think about tokens unless they've gone >60 days without using the system, in which case the UI shows a one-click re-auth prompt.

---

## Architecture Diagram

```
                        ┌─────────────────────────┐
                        │    Firebase Hosting      │
                        │    (Static SPA)          │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   Cloud Functions        │
                        │   api (HTTP)             │
                        │   ┌───────────────────┐  │
                        │   │ Markup Profiles    │  │
                        │   │ Customer Mgmt     │  │
                        │   │ SKU Mappings      │  │
                        │   │ Billing Runs      │  │
                        │   │ Settings/Auth     │  │
                        │   └───────────────────┘  │
                        └──┬──────────┬──────────┬─┘
                           │          │          │
              ┌────────────┘          │          └────────────┐
              ▼                       ▼                       ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│     Firestore        │ │      BigQuery         │ │     Xero API         │
│                      │ │                       │ │                      │
│ - Markup Profiles    │ │ billing_new.          │ │ - Draft Invoices     │
│ - Customers          │ │ reseller_billing_     │ │ - Draft Bills        │
│ - SKU Mappings       │ │ detailed_export_v1    │ │ - Contacts           │
│ - Overrides          │ │ (read-only)           │ │ - Account Codes      │
│ - Billing Runs       │ │                       │ │                      │
│ - Line Items         │ │ ◄── Google exports    │ │                      │
│ - Settings           │ │     daily (automatic) │ │                      │
└──────────────────────┘ └──────────────────────┘ └──────────┬───────────┘
                                                              │
                                                              ▼
                                                  ┌──────────────────────┐
                                                  │   Secret Manager     │
                                                  │                      │
                                                  │ - xero-client-id     │
                                                  │ - xero-client-secret │
                                                  │ - xero-refresh-token │
                                                  │ - xero-tenant-id     │
                                                  └──────────────────────┘

        ┌──────────────────┐         ┌─────────────────────────┐
        │  Cloud Scheduler │ ·····▶  │  Cloud Functions         │
        │  (future opt-in) │         │  processBilling (HTTP)   │
        └──────────────────┘         └─────────────────────────┘

Note: Default mode is user-initiated from the UI.
Cloud Scheduler is deployed but disabled by default (opt-in via Settings).
When enabled, only auto-runs Phase 1. Phases 2+3 always require user action.
```

---

## Cost Estimate

| Service | Free Tier Allowance | Our Expected Usage | Monthly Cost |
|---------|--------------------|--------------------|-------------|
| Firebase Hosting | 10 GB transfer, 1 GB storage | ~50 MB SPA, minimal traffic | $0 |
| Cloud Functions | 2M invocations, 400K GB-sec | ~100 invocations/month (1 billing run + API calls) | $0 |
| Firestore | 1 GiB, 50K reads/day | ~5 MB config/state, ~200 reads on billing day | $0 |
| BigQuery | 1 TB query/month, 10 GB free storage | ~1 query/month on 17 MB table | $0 |
| Secret Manager | 6 active secret versions | 4 secrets, ~10 access ops/month | $0 |
| Cloud Scheduler | 3 free jobs | 1 job (deployed, disabled by default) | $0 |
| Cloud Logging | 50 GiB/month | Minimal function logs | $0 |
| **Total** | | | **$0/month** |

**Storage cleanup savings:** Deleting the 5.5 GB Artifact Registry images and the 317 MB of stale BigQuery tables in `billing` removes unnecessary storage.

---

## Transition Steps (GCP-focused)

### Phase A: Setup & Deploy

| Step | Action | Dependency |
|------|--------|------------|
| 1 | Link GCP project to Firebase (`firebase projects:addfirebase`) | None |
| 2 | Enable Firestore API, create database (us-east1) | Step 1 |
| 3 | Enable Firebase Hosting | Step 1 |
| 4 | Enable Firebase Auth, configure provider | Step 1 |
| 5 | Migrate seed data from BQ `billing` tables into Firestore | Step 2 |
| 6 | Deploy Cloud Functions (api, processBilling, sendToXero, xeroCallback) | Step 2 |
| 7 | Deploy new Cloud Scheduler targeting processBilling (paused/disabled) | Step 6 |
| 8 | Deploy web UI to Firebase Hosting | Steps 3, 4, 6 |
| 9 | Re-authenticate Xero via UI OAuth flow | Step 8 |

### Phase B: Validate

| Step | Action | Dependency |
|------|--------|------------|
| 10 | Process April 2026 billing from UI (Phase 1) | Steps 5-9 |
| 11 | Review draft invoices in UI (Phase 2) | Step 10 |
| 12 | Send to Xero (Phase 3), verify drafts appear correctly | Step 11 |
| 13 | Test batch send to customers | Step 12 |
| 14 | Test auto-schedule toggle (enable, verify trigger, disable) | Step 7 |

### Phase C: Cleanup v1 infrastructure

| Step | Action | Dependency |
|------|--------|------------|
| 15 | Delete both old Cloud Scheduler jobs (`billing-monthly-trigger`, `voice-tax-monthly-trigger`) | After step 12 validated |
| 16 | Delete 5 FAILED BQ scheduled queries | After step 12 validated |
| 17 | Delete Artifact Registry images (5.5 GB) | After step 12 validated |
| 18 | Delete Cloud Build source bucket contents | After step 12 validated |
| 19 | Retire `billing` dataset (archive then delete after migration confirmed) | After step 12 validated |
| 20 | Disable unused APIs (Vertex AI, Cloud SQL, Dataform, Dataplex, Dataproc, Datastream) | After step 12 validated |
