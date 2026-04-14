# easyG Billing Automation — Complete Handover

**Status:** ✅ Production Ready  
**Client:** Doug @ easyG (Google Cloud Partner, Miami)  
**Delivered:** December 23, 2025  
**Prepared by:** Ivan @ intelligents.agency

---

## Table of Contents

1. [What Was Built](#1-what-was-built)  
2. [Monthly Workflow](#2-monthly-workflow)  
3. [Markup Math](#3-markup-math)  
4. [Tables You Can Edit](#4-tables-you-can-edit)  
5. [How to Flag Transfer Customers](#5-how-to-flag-transfer-customers)  
6. [Useful Queries](#6-useful-queries)  
7. [Technical Reference](#7-technical-reference)  
8. [Go Live Commands](#8-go-live-commands)

---

## 1\. What Was Built

Automated billing system that:

1. Pulls Google Workspace costs from BigQuery (daily)  
2. Applies your markup based on customer type  
3. Creates invoices (to customers) and bills (from Google) in Xero  
4. All items created as **DRAFT** — nothing sent until you approve

---

## 2\. Monthly Workflow

### Automatic Process (Runs on 2nd of each month)

1. System pulls previous month's usage from BigQuery  
2. Applies markup based on customer classification  
3. Creates draft invoices \+ bills in Xero

### Your Review Process

1. Log into Xero  
2. Go to **Sales → Invoices → Draft**  
3. Review the invoices (spot-check amounts)  
4. Click **Approve** (or bulk approve)  
5. Send to customers  
6. Repeat for Bills: **Business → Bills to Pay → Draft**

---

## 3\. Markup Math

Google gives you a discount. You charge customers full list price. The difference is your margin.

| Customer Type | Google's Discount to You | Your Markup Factor | Example |
| :---- | :---- | :---- | :---- |
| **NEW** | 20% | ×1.25 (25%) | Google charges $8 → You bill $10 |
| **RENEWAL** | 12% | ×1.1363 (13.63%) | Google charges $8.80 → You bill $10 |
| **TRANSFER** | 5% | ×1.0526 (5.26%) | Google charges $9.50 → You bill $10 |

### 

**NEW customer example:**

- Google list price: $10/seat  
- Google charges you: $8 (20% partner discount)  
- To bill customer list price: $8 × 1.25 \= $10  
- Your margin: $2/seat

**TRANSFER customer example:**

- Google list price: $10/seat  
- Google charges you: $9.50 (only 5% discount for transfers)  
- To bill customer list price: $9.50 × 1.0526 \= $10  
- Your margin: $0.50/seat

### When Each Rate Applies

| Scenario | Classification | Markup |
| :---- | :---- | :---- |
| Brand new customer signs up | NEW | 25% |
| Existing customer renews | RENEWAL | 13.63% |
| Customer transfers from another reseller | TRANSFER | 5.26% |
| Existing customer adds new product (Vault, Voice) | RENEWAL | 13.63% |

**Note:** Adding products to existing customers is an upsell, not a new acquisition — uses RENEWAL rate.

---

## 4\. Tables You Can Edit

Edit these directly in BigQuery Console — no developer needed.

**Location:** BigQuery → `white-dispatch-481617-f8` → `billing` → click table

| Table | Purpose | When to Edit |
| :---- | :---- | :---- |
| `sku_to_xero_account` | Maps products to Xero account codes | When you add new products |
| `markup_rules` | Markup rates (NEW/RENEWAL/TRANSFER) | If Google changes partner discounts |
| `customer_to_xero_contact` | Google customer → Xero contact ID | Auto-populated cache; edit to fix mismatches or merge contacts |
| `subscription_overrides` | Force customer to specific rate | **When onboarding a transfer** |

## 

## 

## 

## 5\. How to Flag Transfer Customers

When you onboard a customer transferred from another reseller, you need to flag them for the TRANSFER rate (5.26% markup instead of 25%).

### The Query Template

Copy this into BigQuery and fill in the values:

INSERT INTO \`white-dispatch-481617-f8.billing.subscription\_overrides\`   
  (customer\_id, override\_type, start\_month, end\_month, notes, created\_by)  
VALUES (  
  'CUSTOMER\_ID\_HERE',    \-- Get from Partner Sales Console or BigQuery  
  'TRANSFER',            \-- Usually 'TRANSFER', can also be 'NEW' to override  
  '2025-01',             \-- Start month (YYYY-MM)  
  '2025-12',             \-- End month (YYYY-MM) \- typically 12 months for transfers  
  '12-month transfer discount from \[previous reseller\]',  
  'Doug'  
);

### Example: 12-Month Transfer Starting January 2026

INSERT INTO \`white-dispatch-481617-f8.billing.subscription\_overrides\`   
  (customer\_id, override\_type, start\_month, end\_month, notes, created\_by)  
VALUES (  
  'SDFIg7G5kByH0L',  
  'TRANSFER',  
  '2026-01',  
  '2026-12',  
  '12-month transfer from Ingram Micro',  
  'Doug'  
);

**Result:** On January 2nd, 2026, the system sees the override has expired and automatically bills them at RENEWAL rate. No need to remember to delete the row\!

### Finding Customer ID

**Option A: From BigQuery**

SELECT DISTINCT customer\_name,   
  (SELECT value FROM UNNEST(system\_labels)   
   WHERE key \= 'workspace.googleapis.com/domain\_name') as domain  
FROM \`white-dispatch-481617-f8.billing.reseller\_billing\_detailed\_export\_v1\`  
WHERE (SELECT value FROM UNNEST(system\_labels)   
       WHERE key \= 'workspace.googleapis.com/domain\_name') LIKE '%customerdomain.com%'

LIMIT 1;

**Option B: From Partner Sales Console** Customers → Click customer → URL shows `customers/Sxxxxxxx`

**`Option C:`** Visually on aggregated\_invoice\_items table \-\> Check for customer\_id

---

## 6\. Useful Queries

### Check Current Month Accrued Billing

SELECT   
  customer\_name,  
  ROUND(SUM(customer\_price), 2\) as total\_to\_bill,  
  ROUND(SUM(cost\_amount), 2\) as total\_cost,  
  ROUND(SUM(customer\_price) \- SUM(cost\_amount), 2\) as margin  
FROM \`white-dispatch-481617-f8.billing.invoice\_outbox\`  
WHERE billing\_period \= DATE\_TRUNC(CURRENT\_DATE(), MONTH)  
GROUP BY 1  
ORDER BY total\_to\_bill DESC;

### 

### 

### **View All Active Overrides**

SELECT \*   
FROM \`white-dispatch-481617-f8.billing.subscription\_overrides\`  
WHERE end\_month \>= FORMAT\_DATE('%Y-%m', CURRENT\_DATE())  
   OR end\_month IS NULL  
ORDER BY start\_month DESC;

### 

### 

### 

### **Check for Negative Costs (Credits/Adjustments)**

SELECT   
  customer\_name,  
  sku.description as product,  
  cost,  
  usage.amount as seats  
FROM \`white-dispatch-481617-f8.billing.reseller\_billing\_detailed\_export\_v1\`

WHERE cost \< 0

  AND invoice.month \= FORMAT\_DATE('%Y%m', DATE\_SUB(CURRENT\_DATE(), INTERVAL 1 MONTH))

ORDER BY cost;

### **List All Current SKUs**

SELECT DISTINCT sku.id, sku.description, COUNT(\*) as row\_count  
FROM \`white-dispatch-481617-f8.billing.reseller\_billing\_detailed\_export\_v1\`  
WHERE invoice.month \= FORMAT\_DATE('%Y%m', DATE\_SUB(CURRENT\_DATE(), INTERVAL 1 MONTH))  
GROUP BY 1, 2  
ORDER BY 3 DESC;

---

## 

## 

## **7\. Technical Reference**

### System Architecture

Google Cloud Channel

        ↓ (daily export)

BigQuery: reseller\_billing\_detailed\_export\_v1

        ↓ (daily processing)

BigQuery: invoice\_outbox (staging)

        ↓ (monthly, on 2nd)

Xero: Draft Invoices \+ Bills

        ↓ (manual)

Doug: Review → Approve → Send

### GCP Resources

| Resource | Value |
| :---- | :---- |
| Project ID | `white-dispatch-481617-f8` |
| Dataset | `billing` |
| Region | `us-central1` |
| Cloud Run Job | `gcs-billing-automation` |
| Cloud Scheduler | Runs 2nd of month, 8am ET |

### Credentials (Secret Manager)

| Secret | Purpose |
| :---- | :---- |
| `xero-client-id` | Xero OAuth app ID |
| `xero-client-secret` | Xero OAuth secret |
| `xero-refresh-token` | Long-lived refresh token |
| `xero-tenant-id` | Xero organization ID |

### Data Fields Used

| Field | Source | Purpose |
| :---- | :---- | :---- |
| `customer_name` | Google export | Customer identifier |
| `system_labels[domain_name]` | Google export | Domain for Xero contact matching |
| `sku.id` | Google export | Product → account code mapping |
| `cost` | Google export | What Google charges you (COS) |
| `usage.amount` | Google export | Seat count |
| `invoice.month` | Google export | Billing period (YYYYMM) |

---

## 8\. Go Live Commands (for Dev)

### Enable Production Mode (One Time)

gcloud run jobs update gcs-billing-automation \\

  \--set-env-vars='DRY\_RUN=false' \\  
  \--region us-central1

### Run Manually (If Needed)

gcloud run jobs execute gcs-billing-automation \--region us-central1

### Check Job Status

gcloud run jobs executions list \--job=gcs-billing-automation \--region us-central1

---

## Key Points for First Month

**December 2025 invoices (first run):**

- All customers at RENEWAL rate (13.63% markup)  
- These are existing customers — system recognizes them  
- If any are actually NEW, manually edit those drafts in Xero before approving  
- Starting January, system auto-detects new vs. renewal

**Negative line items:**

- When customers reduce seats, Google issues credits  
- Shows as negative line items on same invoice  
- Net total is correct — customer sees charge and credit together

**Customers without domains:**

- Some customers (Google Voice only) show as IDs (no domains) like `S5U9sVEMfzFa1R`  
- Rename these contacts in Xero after first run

---

## Questions?

Contact Ivan @ intelligents.agency

---

*Project delivered December 29, 2025* *Document updated December 29, 2025*  
