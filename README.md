# easyG Billing Automation

Automated billing system for easyG Cloud, a Google Cloud Partner reseller. Pulls Google Workspace and Voice usage costs from BigQuery, applies configurable markup pricing, and creates draft invoices and bills in Xero.

## Architecture

Serverless on Google Cloud / Firebase:

| Component | Service | Details |
|-----------|---------|---------|
| Frontend | Firebase Hosting | React 19 + Vite + TypeScript SPA |
| API | Cloud Functions (2nd gen) | Express on Node.js 22, 1 GiB / 540s timeout |
| Database | Cloud Firestore | us-east1, native mode |
| Billing Data | BigQuery | Google Channel Services daily export |
| Secrets | Secret Manager | Xero OAuth credentials |
| Auth | Firebase Auth | Google sign-in, restricted to `@easygcloud.com` |

### URLs

| Resource | URL |
|----------|-----|
| Web App (custom domain) | https://markup.easygcloud.com |
| Web App (Firebase) | https://white-dispatch-481617-f8.web.app |
| API Function | https://api-mkcuchvdya-uc.a.run.app |
| Xero OAuth Callback | https://xerocallback-mkcuchvdya-uc.a.run.app |

DNS for `markup.easygcloud.com` is managed in Cloudflare (controlled by Doug).

### Cloud Functions

Only two functions deployed (consolidated from the original four):

| Function | Purpose |
|----------|---------|
| `api` | Express API handling all authenticated operations: CRUD, billing processing, Xero push |
| `xeroCallback` | Xero OAuth2 redirect handler (public, no Firebase Auth — separate because Xero redirects here directly) |

## GCP Project

| Field | Value |
|-------|-------|
| Project ID | `white-dispatch-481617-f8` |
| Project Name | Google2XeroTest |
| Project Number | 909964402298 |
| Region | us-central1 (functions), us-east1 (Firestore) |
| Organization ID | 312660871352 |

The GCP project is controlled by Doug at easyG Cloud (`hello@easygcloud.com`).

### BigQuery

- **`billing_new.reseller_billing_detailed_export_v1`** -- Live billing data, auto-populated daily by Google Channel Services
- **`billing_new.reseller_billing_historical_v1`** -- Historical snapshot (Dec 2025 - Apr 2026) from the v1 system

### Service Accounts

| Name | Email | Purpose |
|------|-------|---------|
| billing-service | `billing-service@white-dispatch-481617-f8.iam.gserviceaccount.com` | BigQuery Admin, Firestore, Secret Manager access |
| Default compute | `909964402298-compute@developer.gserviceaccount.com` | Used by Cloud Functions runtime |

## Xero Integration

| Field | Value |
|-------|-------|
| App Name | easyG Billing Automation |
| Client ID | Stored in Secret Manager (`xero-client-id`) |
| OAuth Callback | https://xerocallback-mkcuchvdya-uc.a.run.app |
| Scopes | `openid profile email offline_access accounting.invoices accounting.contacts accounting.settings` |

The Xero developer app is controlled by Doug (`support@easygcloud.com`). Apps created after March 2, 2026 must use **granular scopes** (e.g., `accounting.invoices` instead of the deprecated `accounting.transactions`). See `docs/` and memory files for details.

Token refresh is automatic -- the system refreshes the OAuth token at the start of any billing action. If the token has been inactive for >60 days, the UI prompts for re-authentication.

## Billing Workflow

Three-phase, user-initiated:

1. **Process** -- User selects a month, clicks "Process Billing". System reads BigQuery, classifies subscriptions (NEW/RENEWAL/TRANSFER), applies markup profiles, stores draft invoices in Firestore.
2. **Review** -- User reviews invoices in the UI (modal view with customer/SKU/markup detail).
3. **Send to Xero** -- User clicks to push drafts to Xero as DRAFT invoices (ACCREC) and bills (ACCPAY).

Test mode is available for back-testing against historical periods without sending to Xero.

Auto-scheduling (Cloud Scheduler for Phase 1) is implemented but disabled by default. Configurable in Settings.

## Markup System

Resolution order (highest priority first):

1. **Per-SKU rule** -- e.g., Google Voice = 0% (pass-through)
2. **Per-customer override** -- time-bounded or permanent
3. **Customer's assigned markup profile** -- named set of rates
4. **Default profile** -- NEW 25%, RENEWAL 13.63%, TRANSFER 5.26%

Rates are stored as additive factors (e.g., `0.25` for 25% markup). The UI displays them as multipliers (e.g., `1.25x`).

## Project Structure

```
easyg/
  firebase.json          # Firebase config (hosting, functions, firestore)
  firestore.rules        # Firestore security rules (@easygcloud.com only)
  functions/
    src/
      index.ts           # Cloud Function exports
      config.ts          # Firebase Admin init, constants
      types.ts           # Shared TypeScript interfaces
      api/router.ts      # Express API routes
      billing/process.ts # Phase 1 billing processor
      billing/sendToXero.ts  # Phase 3 Xero push
      xero/auth.ts       # OAuth token management
      xero/client.ts     # Xero API wrapper
      migration/migrate.ts   # One-time BQ -> Firestore migration
  web/
    src/
      App.tsx            # Main app with auth gate
      services/api.ts    # API client
      services/firebase.ts   # Firebase config
      pages/             # Dashboard, Billing, Customers, MarkupProfiles, SkuMappings, Settings
      components/        # Layout, DataTable, Modal, StatusBadge, LoadingSpinner
  docs/                  # PRD, architecture plan, current state report, handoff doc
```

## Development

### Prerequisites

- Node.js 22
- Firebase CLI (`npm install -g firebase-tools`)
- Authenticated: `firebase login` and `gcloud auth login`
- Project set: `gcloud config set project white-dispatch-481617-f8`

### Local Development

```bash
# Functions
cd functions && npm install && npm run build:watch

# Web (separate terminal)
cd web && npm install && npm run dev
```

The Vite dev server proxies `/api` to the local functions emulator.

### Configuration

All backend configuration lives in `functions/src/config.ts` with environment variable overrides:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GCLOUD_PROJECT` | `white-dispatch-481617-f8` | GCP project ID |
| `BQ_DATASET` | `billing_new` | BigQuery dataset |
| `FUNCTION_REGION` | `us-central1` | Cloud Functions region |
| `ALLOWED_DOMAIN` | `easygcloud.com` | Auth domain restriction |
| `APP_DOMAIN` | `markup.easygcloud.com` | Public app domain |
| `XERO_CALLBACK_URL` | `https://xerocallback-mkcuchvdya-uc.a.run.app` | Xero OAuth redirect (must match Xero app config) |

Frontend configuration is in `web/.env.production`:

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Cloud Functions API URL |
| `VITE_ALLOWED_DOMAIN` | Auth domain restriction (UX only, enforced server-side) |
| `VITE_PROJECT_ID` | Displayed in Settings page |

Firebase web config (apiKey, appId, etc.) is in `web/src/services/firebase.ts`. These are public values by design.

### Deploying

```bash
# Deploy everything
FUNCTIONS_DISCOVERY_TIMEOUT=60000 firebase deploy --only functions,hosting

# Deploy only hosting (frontend changes)
cd web && npx vite build && firebase deploy --only hosting

# Deploy only functions (backend changes)
cd functions && npx tsc && FUNCTIONS_DISCOVERY_TIMEOUT=60000 firebase deploy --only functions
```

Note: `FUNCTIONS_DISCOVERY_TIMEOUT=60000` is required on WSL2 due to slow filesystem I/O during function discovery.

### Running the Data Migration

One-time migration of seed data from the old BigQuery `billing` dataset to Firestore. Already completed -- only needed if Firestore is recreated.

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json GOOGLE_CLOUD_PROJECT=white-dispatch-481617-f8 npx ts-node src/migration/migrate.ts
```

## Code Reviews

Code reviews are performed using an automated Claude + Codex collaboration workflow. See `.claude/docs/codex_collaboration.md` for the full process. In summary:

1. Codex runs in read-only mode against uncommitted changes
2. Claude fixes all bugs found
3. Codex re-reviews until clean (typically 4-6 rounds)
4. Only then is the code deployed

Run a review:
```bash
codex exec -s read-only "Review the uncommitted changes in this repository. Provide a code review with any issues, suggestions, or concerns." 2>/dev/null
```

## External Services

| Service | Controlled By | Notes |
|---------|---------------|-------|
| **GCP Project** | Doug (`hello@easygcloud.com`), dev account: `devgc@easygcloud.com` | Billing, IAM, all cloud resources |
| **Xero Developer App** | Doug (`support@easygcloud.com`) | OAuth app for API access to easyG Cloud Xero org |
| **GitHub Repo** | Doug (`sspage/easyg`) | Source code repository |
| **Cloudflare DNS** | Doug | DNS hosting for easygcloud.com domain |
| **Firebase** | Linked to GCP project | Console: https://console.firebase.google.com/project/white-dispatch-481617-f8 |

## Documentation

Detailed documentation is in the `docs/` directory:

- `PRD.md` -- Product requirements, functional specs, data model
- `gcp-architecture-plan.md` -- Infrastructure plan, service inventory, transition steps
- `current-state-report.md` -- Assessment of the v1 system (historical reference)
- `gcp-project.md` -- Validated GCP project state
- `easyG Billing Automation — Complete Handover.md` -- Original v1 handoff doc from Ivan @ intelligents.agency
