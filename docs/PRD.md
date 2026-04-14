# PRD: easyG Billing Automation v2

**Author:** spage  
**Date:** 2026-04-13  
**Status:** Draft  
**Prior art:** v1 by Ivan @ intelligents.agency (delivered 2025-12-29, now non-functional)

---

## 1. Problem Statement

easyG is a Google Cloud Partner reseller (Miami). They resell Google Workspace, Google Voice, Vault, and related products to ~68 customers. Google provides tiered partner discounts (5-20% depending on customer acquisition type), and easyG bills customers at a marked-up price, keeping the margin.

The v1 system automated the data pipeline but required the end user (Doug) to manage everything through BigQuery SQL queries and manual Xero review. It was never effectively adopted because it was too technical to use, and it broke silently in early 2026 with no way for Doug to diagnose or fix it.

**The core need remains the same:** automate the monthly billing from Google while applying markups for margin, and create invoices in Xero. But the solution must be operable entirely through a web interface — no GCP Console, SQL queries, or CLI tools required for day-to-day use.

## 2. Goals

1. **Automate billing**: Pull Google Workspace/Voice costs, apply markups, create draft invoices + bills in Xero — monthly, zero manual data entry
2. **Web-based management**: Full UI for configuration, overrides, monitoring, and review — no SQL, no CLI, no GCP Console
3. **Markup flexibility**: Default markup profiles, per-customer overrides, and custom one-off rates — all manageable through UI
4. **Xero integration**: Automated account creation/mapping, draft invoice generation, token management
5. **Minimize cost**: Serverless-only architecture (Cloud Functions + Firebase hosting), target $0/month operational cost on Blaze plan with minimal storage
6. **Clean up v1**: Remove all non-functional infrastructure from GCP

## 3. Users

| User | Role |
|------|------|
| Doug (easyG) | Primary operator. Reviews/approves invoices in Xero. Manages markup profiles, customer overrides, and SKU mappings via web UI. Business-focused user — comfortable with technology but operates at the application level, not infrastructure. All workflows must be accessible through the UI without requiring GCP Console, BigQuery, SQL, or CLI access. |
| Admin (spage) | System configuration, deployment, troubleshooting. |

## 4. Architecture

### Serverless, Firebase-hosted

```
Firebase Hosting (static SPA)
    |
    v
Cloud Functions (API layer)
    |
    +---> BigQuery (read billing_new export data)
    +---> Firestore (config, markup profiles, customer mappings, job state)
    +---> Secret Manager (Xero OAuth tokens)
    +---> Xero API (create draft invoices/bills, manage contacts/accounts)
    |
Cloud Scheduler --> Cloud Functions (auto-process, opt-in via settings)

Google Channel Billing --> BigQuery: billing_new.reseller_billing_detailed_export_v1 (daily, automatic)
```

**Why this architecture:**
- Firebase Hosting + Firestore + Cloud Functions are all covered under the Blaze plan's free tier for low-volume usage
- BigQuery is only needed because Google exports billing data there — we read from it but don't use it as a processing engine
- All configuration and state lives in Firestore (not BigQuery tables), making it accessible to the web UI
- Cloud Functions replace both the Cloud Run jobs and the 5 BigQuery scheduled queries

### Data Flow & Billing Workflow

The default billing workflow is **user-initiated**. The user has full control over every step. Automated scheduling is implemented but disabled by default — the user can enable it from Settings when ready.

#### Three-Phase Billing Cycle

```
Phase 1: PROCESS (user clicks "Process Billing" — or auto-triggered if scheduling is enabled)
  Google BQ export  -->  Cloud Function reads + calculates  -->  Draft invoices in Firestore
  - Auto-refresh Xero OAuth token
  - Pull previous month's data from BigQuery
  - Classify subscriptions (NEW/RENEWAL/TRANSFER)
  - Apply markup rules (profile > customer override > SKU rule)
  - Map SKUs to Xero account codes
  - Resolve Google customers to Xero contacts
  - Distribute Voice taxes proportionally
  - Result: calculated line items stored in Firestore with status DRAFT
  - Nothing sent to Xero yet

Phase 2: REVIEW (user reviews in UI)
  - View all draft invoices grouped by customer
  - See line items, markups applied, totals, margins
  - Flag issues, make notes
  - Adjustments made in Xero after push (v3: edit directly in app)

Phase 3: SEND TO XERO (user clicks "Send to Xero")
  - Auto-refresh Xero OAuth token
  - Push all drafts to Xero as DRAFT invoices + DRAFT bills
  - User reviews/adjusts in Xero as needed
  - User approves and batch sends to customers from Xero or via "Send All" in easyG app
```

**Key principle:** The system never sends anything to customers without explicit user action. Even with auto-scheduling enabled, only Phase 1 runs automatically — Phases 2 and 3 always require the user.

## 5. Functional Requirements

### 5.1 Markup System

The markup system is the core business logic. It supports three tiers of configuration, resolved in priority order.

#### Markup Profiles

A **markup profile** is a named set of rates that can be assigned to multiple customers. This replaces the v1 approach of only having global defaults.

- **FR-1**: Users can create, edit, and delete markup profiles via UI
- **FR-2**: Each profile defines a markup factor (or percentage) per subscription type (NEW, RENEWAL, TRANSFER)
- **FR-3**: A "Default" profile exists and cannot be deleted — it applies to any customer not assigned a specific profile
- **FR-4**: Users can assign a profile to one or more customers via UI

**Default profile (matching current Google partner rates):**

| Subscription Type | Google Discount | Markup Factor | Effect |
|-------------------|----------------|---------------|--------|
| NEW | 20% | x1.25 | Cost $8 -> Bill $10 |
| RENEWAL | 12% | x1.1363 | Cost $8.80 -> Bill $10 |
| TRANSFER | 5% | x1.0526 | Cost $9.50 -> Bill $10 |

#### Per-Customer Overrides

- **FR-5**: Users can override any customer's markup independently of their profile (custom one-off rate)
- **FR-6**: Per-customer overrides take highest priority — they override both profiles and defaults
- **FR-7**: Overrides can be permanent or time-bounded (e.g., 12-month transfer window that auto-expires)
- **FR-8**: UI shows which customers have overrides and when they expire

#### Per-SKU Rules

- **FR-9**: Certain SKUs can have special markup rules regardless of customer (e.g., Google Voice usage is always pass-through at 0%)
- **FR-10**: Per-SKU rules take highest priority when present

#### Resolution Order

```
1. Per-SKU rule (e.g., Voice = 0% markup)
2. Per-customer override (if active and in date range)
3. Customer's assigned markup profile
4. Default profile
```

### 5.2 Customer Management

- **FR-11**: Dashboard showing all customers with current markup profile, overrides, last billed amount, and Xero contact status
- **FR-12**: Ability to assign/change markup profile per customer
- **FR-13**: Ability to set time-bounded overrides (e.g., "TRANSFER rate for 12 months starting Jan 2026")
- **FR-14**: Auto-detect new customers from billing data and flag for review
- **FR-15**: Show customer domain name (from Google export labels) alongside customer ID for readability

### 5.3 SKU / Xero Account Mapping

- **FR-16**: UI to view and edit SKU-to-Xero account code mappings
- **FR-17**: When a new SKU appears in billing data, flag it for mapping before processing
- **FR-18**: Auto-create Xero accounts if they don't exist (or prompt user to map)
- **FR-19**: Validate that all Xero account codes referenced in mappings actually exist in Xero

### 5.4 Billing Workflow

The billing workflow has three explicit phases. The user controls progression between phases. With auto-scheduling enabled, Phase 1 can run unattended, but Phases 2 and 3 always require user action.

#### Phase 1: Process

- **FR-20**: User selects a billing month and clicks "Process Billing" in the UI
- **FR-21**: System pulls that month's data from BigQuery, classifies subscriptions, applies markups, and stores calculated line items in Firestore with status `DRAFT`
- **FR-22**: Nothing is sent to Xero during this phase
- **FR-23**: Process any month on demand (current, previous, or historical backfill)
- **FR-24**: Handle negative line items (credits, seat reductions) as negative amounts
- **FR-25**: Handle mid-month subscription changes (weighted average seat counts)
- **FR-26**: Track which months have been processed to prevent accidental duplicates (with explicit option to re-process)
- **FR-27**: If issues are detected (unmapped SKUs, missing Xero contacts), flag them and block the run until resolved

#### Phase 2: Review

- **FR-28**: After processing, the UI shows a review screen with all draft invoices grouped by customer
- **FR-29**: Each invoice shows: customer name/domain, line items, SKU, quantity, cost, markup applied, customer price, margin
- **FR-30**: Summary totals: total revenue, total cost, total margin, invoice count
- **FR-31**: Month-over-month comparison: flag significant changes in customer billing amounts
- **FR-32**: User can add notes or flag items for attention

#### Phase 3: Send to Xero

- **FR-33**: User clicks "Send to Xero" to push all draft invoices to Xero
- **FR-34**: Creates DRAFT invoices (ACCREC) in Xero — one per customer per period, with line items per SKU
- **FR-35**: Creates DRAFT bills (ACCPAY) in Xero — corresponding COS entries
- **FR-36**: Updates Firestore line items with Xero invoice/bill IDs and status `SENT_TO_XERO`
- **FR-37**: User reviews and makes any final adjustments in Xero

#### Batch Send to Customers

- **FR-38**: "Send All" button in easyG app that approves and emails all draft invoices in Xero in one action
- **FR-39**: If Xero's API supports batch approval, use it; otherwise guide the user to Xero's bulk-approve flow

#### Automated Scheduling (implemented, disabled by default)

- **FR-40**: Settings toggle: "Auto-process on the 2nd of each month"
- **FR-41**: When enabled, Phase 1 runs automatically via Cloud Scheduler; Phases 2 and 3 still require manual action
- **FR-42**: In-app notification when auto-processing completes, prompting user to review

### 5.5 Xero Integration

#### Contact & Account Management

- **FR-43**: Auto-resolve Google customer to Xero contact (by domain name match)
- **FR-44**: Auto-create Xero contact if no match found (flag for review)
- **FR-45**: Auto-create Xero account codes if missing (or flag unmapped SKUs)
- **FR-46**: Apply tracking categories (pricing model: Commit/Flex; subscription status: New/Renewal/Transfer)

#### OAuth Token Management

- **FR-47**: Auto-refresh the Xero OAuth token at the start of any billing action (Process or Send to Xero). The token refresh is transparent to the user — it happens automatically before API calls are made.
- **FR-48**: Persist refreshed token to Secret Manager after each successful refresh
- **FR-49**: If the token is expired beyond recovery (>60 days inactive), show a clear re-authentication prompt in the UI with a one-click OAuth flow
- **FR-50**: Display Xero connection status on the dashboard (connected, token age, last successful API call)

### 5.6 Voice Tax Processing

- **FR-51**: Calculate each customer's proportional share of total Voice usage
- **FR-52**: Distribute lump-sum Voice tax across customers proportionally
- **FR-53**: Add as line items on the corresponding invoices/bills during Phase 1 (Process)

### 5.7 Dashboard & Monitoring

- **FR-54**: Dashboard showing: Xero connection status, last billing run, run history with success/failure
- **FR-55**: Per-run detail view: list of all invoices, amounts, statuses (Draft / Sent to Xero), any errors
- **FR-56**: Alerts in the UI when a run has items needing attention (unmapped SKUs, missing contacts, failed Xero pushes)
- **FR-57**: If auto-scheduling is enabled, show next scheduled run date

### 5.8 Error Handling

- **FR-58**: Retry failed Xero API calls with backoff
- **FR-59**: Per-line-item error tracking and display in UI
- **FR-60**: Ability to retry failed items from UI (e.g., re-send a single invoice that failed)
- **FR-61**: Graceful handling of Xero rate limits

## 6. Data Model (Firestore)

All configuration and state in Firestore. BigQuery is read-only (source data).

```
/markupProfiles/{profileId}
  name, description, rates: { NEW: 1.25, RENEWAL: 1.1363, TRANSFER: 1.0526 }, isDefault, createdAt, updatedAt

/customers/{customerId}
  googleCustomerName, domain, xeroContactId, xeroContactName, markupProfileId, isActive, firstSeen, lastBilled, createdAt

/customerOverrides/{overrideId}
  customerId, overrideType (TRANSFER/NEW/RENEWAL/CUSTOM), markupFactor, startMonth, endMonth, notes, createdBy, createdAt

/skuMappings/{skuId}
  skuName, category, revenueAccountCode, cosAccountCode, xeroItemCode, specialMarkup (optional), isActive

/billingRuns/{runId}
  billingPeriod, phase (PROCESSED/REVIEWED/SENT_TO_XERO), status (running/completed/failed),
  startedAt, completedAt, sentToXeroAt, triggeredBy (manual/scheduled),
  summary: { customerCount, invoiceCount, totalRevenue, totalCost, totalMargin, errorCount }

/billingRuns/{runId}/invoices/{invoiceId}
  customerId, customerDomain, customerName, xeroContactId,
  phase (DRAFT/SENT_TO_XERO/APPROVED/SENT_TO_CUSTOMER), xeroInvoiceId, xeroInvoiceNumber, xeroBillId, xeroBillNumber,
  totalCost, totalRevenue, totalMargin, lineItemCount, errorMessage, notes

/billingRuns/{runId}/invoices/{invoiceId}/lineItems/{itemId}
  skuId, skuName, subscriptionType, pricingModel, quantity,
  costAmount, markupFactor, customerPrice, margin,
  revenueAccountCode, cosAccountCode, appliedRule (profile/override/sku)

/settings/xero
  lastTokenRefresh, tokenExpiresAt, tenantId, connectionStatus (connected/expired/disconnected), lastSuccessfulCall

/settings/system
  exportDatasetId (billing_new), autoScheduleEnabled (false), autoScheduleDay (2)
```

## 7. Web UI (Firebase Hosted SPA)

### Pages

1. **Dashboard** — Xero connection status, current billing cycle phase, recent activity, alerts/flags
2. **Billing** — The main workflow page:
   - Select month -> "Process Billing" button (Phase 1)
   - Review draft invoices with line item detail (Phase 2)
   - "Send to Xero" button (Phase 3)
   - "Send All to Customers" button (batch approve + email from Xero)
   - History of past billing runs with drill-down
3. **Customers** — List with profile assignments, overrides, last billed amount, Xero contact status
4. **Markup Profiles** — Create/edit profiles, assign to customers
5. **SKU Mappings** — View/edit product-to-Xero account mappings, flag unmapped
6. **Settings** — Xero connection/re-auth, auto-schedule toggle, system config

### Design Principles

- Doug should never need to open GCP Console, BigQuery, or a terminal
- All configuration changes happen through the UI
- Sensible defaults everywhere — the system should work out of the box with the Default markup profile
- The user is always in control — nothing happens without an explicit button click (unless auto-schedule is enabled, and even then only Phase 1)
- Show what's going to happen before it happens (review before sending to Xero)
- Clear status indicators: what phase is the current billing cycle in, what needs attention

## 8. Infrastructure

| Component | Service | Cost |
|-----------|---------|------|
| Frontend | Firebase Hosting (static SPA) | Free tier |
| API | Cloud Functions (2nd gen, Node.js 22) — 2 functions: `api` + `xeroCallback` | Free tier (2M invocations/month) |
| Config/State | Firestore (us-east1, native mode) | Free tier (1 GiB storage, 50K reads/day) |
| Billing Data | BigQuery (`billing_new`) | Minimal (Google populates; we query ~once/month) |
| Secrets | Secret Manager | Free tier (6 active versions) |
| Scheduling | Cloud Scheduler (disabled by default) | Free tier (3 jobs) |
| Auth | Firebase Auth (Google sign-in, restricted to `@easygcloud.com`) | Free tier |

**Deployed URLs:**
- Web app: `https://markup.easygcloud.com` (custom domain) / `https://white-dispatch-481617-f8.web.app` (Firebase)
- API function: configured in `web/.env.production` (VITE_API_URL)
- Xero OAuth callback: configured in `functions/src/config.ts` (XERO_CALLBACK_URL)

**Expected monthly cost: $0** for normal operation. BigQuery on-demand queries for one month of ~20K rows are well under the 1 TB/month free tier.

**Note on Xero scopes:** Apps created after March 2, 2026 must use granular scopes. We use `accounting.invoices` (not the deprecated `accounting.transactions`), plus `accounting.contacts` and `accounting.settings` which are unchanged.

**Authentication patterns:** All GCP services (BigQuery, Firestore, Secret Manager) use Application Default Credentials (ADC) — no service account keys in the codebase. Xero OAuth tokens are managed in Secret Manager with automatic refresh. All configurable values are centralized in `functions/src/config.ts` with environment variable overrides.

## 9. Migration & Cleanup Plan

### Data to migrate from v1

| Source (BigQuery `billing` dataset) | Destination | Notes |
|-------------------------------------|-------------|-------|
| `markup_rules` (4 rules) | Firestore `/markupProfiles/default` | Becomes the Default profile |
| `sku_to_xero_account` (22 SKUs) | Firestore `/skuMappings/*` | Direct migration |
| `customer_to_xero_contact` | Firestore `/customers/*` | Merge with billing_new customer list |
| `subscription_overrides` | Firestore `/customerOverrides/*` | Check if any are still active |
| `tracking_categories` | Firestore `/settings/xero` | 5 tracking dimensions |

### GCP cleanup (v1 teardown)

| Resource | Action |
|----------|--------|
| 5 FAILED BQ scheduled queries | Delete |
| Artifact Registry images (5.5 GB) | Delete |
| Cloud Build source bucket contents | Delete |
| `billing` dataset (14 tables, 317 MB) | Archive then delete after migration validated |
| Cloud Scheduler `billing-monthly-trigger` | Delete (replaced by new scheduler) |
| Cloud Scheduler `voice-tax-monthly-trigger` | Delete (voice tax merged into main function) |
| Unused APIs (Vertex AI, Cloud SQL, Dataform, Dataplex, Dataproc, Datastream) | Disable |

### Backfill

Jan-Mar 2026 billing was never processed. The system supports backfill on demand — Doug can process any historical month from the Billing page. Whether to actually backfill is a business decision (Doug may have invoiced manually).

## 10. Future Scope (not v2)

- **In-app invoice editing**: Edit line items, adjust amounts, add custom charges directly in the easyG app before sending to Xero (v3)
- **Time tracking**: Track custom billed services (hourly/project work) and add to Xero invoices
- **Multi-currency support**
- **Customer-facing portal** (self-service invoice access)
- **Margin analytics and reporting dashboard**

## 11. Open Questions

1. **Backfill decision**: Should we process Jan-Mar 2026, or has Doug invoiced manually? Need to confirm before running to avoid duplicates in Xero.
2. ~~**Xero re-auth**~~: Resolved — new Xero app created under easyG account (client ID `7F5A...`). Doug needs to authorize via the web UI since he has org-level access.
3. ~~**Original source code**~~: Resolved — clean-room rebuild completed. No Ivan code used.
4. ~~**Frontend framework**~~: Resolved — React 19 + Vite + TypeScript.
5. **billing_new scheduling**: The Google export to `billing_new` appears to be running daily automatically. Need to confirm this is reliable and understand if there's a manual step to maintain it.
6. **Voice tax source**: Where does the lump-sum Voice tax come from? Is it in the same export table, or a separate data source?
7. **Xero account auto-creation**: Does Doug want the system to auto-create Xero accounts, or just flag missing ones for manual setup?
8. **Batch send via Xero API**: Need to verify Xero API supports batch approve + email of draft invoices. If not, the "Send All to Customers" button may need to iterate invoices individually.
