import { BigQuery } from "@google-cloud/bigquery";
import { db, PROJECT_ID, DATASET_ID, BILLING_TABLE } from "../config";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  BqBillingRow,
  MarkupProfile,
  CustomerOverride,
  SkuMapping,
  BillingRun,
  Invoice,
  LineItem,
} from "../types";

const bigquery = new BigQuery({ projectId: PROJECT_ID });

// ---------------------------------------------------------------------------
// Types local to processing
// ---------------------------------------------------------------------------

interface AggKey {
  customerId: string;
  customerName: string;
  domain: string | null;
  skuId: string;
  skuName: string;
  subscriptionType: "NEW" | "RENEWAL" | "TRANSFER";
  pricingModel: string;
}

interface AggBucket {
  key: AggKey;
  quantity: number;
  totalCost: number;
  totalCostAtList: number;
  markupFactor: number;
  appliedRule: "sku" | "override" | "profile" | "default";
  revenueAccountCode: string;
  cosAccountCode: string;
  isVoice: boolean;
}

const GOOGLE_VOICE_SKU_ID = "GOOGLE_VOICE_USAGE";
const GOOGLE_VOICE_SKU_NAME = "Google Voice Usage";
const VOICE_PAYER_FRAGMENT = "46401";

// Default account codes when no SKU mapping exists.
const DEFAULT_REVENUE_ACCOUNT = "4000";
const DEFAULT_COS_ACCOUNT = "5000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCustomerId(customerName: string): string {
  const match = customerName.match(/\/customers\/(.+)$/);
  return match ? match[1] : customerName;
}

function extractDomain(
  systemLabels: Array<{ key: string; value: string }>,
): string | null {
  const label = systemLabels.find(
    (l) => l.key === "workspace.googleapis.com/domain_name",
  );
  return label?.value ?? null;
}

function isVoiceSku(row: BqBillingRow): boolean {
  return (
    row.payer_billing_account_id.includes(VOICE_PAYER_FRAGMENT) ||
    row.sku.id === null
  );
}

function netCost(row: BqBillingRow): number {
  const creditsSum = (row.credits ?? []).reduce(
    (sum, c) => sum + (c.amount ?? 0),
    0,
  );
  return row.cost + creditsSum;
}

// ---------------------------------------------------------------------------
// Firestore loaders
// ---------------------------------------------------------------------------

async function loadMarkupProfiles(): Promise<Map<string, MarkupProfile>> {
  const snap = await db.collection("markupProfiles").get();
  const map = new Map<string, MarkupProfile>();
  snap.forEach((doc) => map.set(doc.id, doc.data() as MarkupProfile));
  return map;
}

async function loadDefaultProfile(): Promise<{
  id: string;
  profile: MarkupProfile;
} | null> {
  const snap = await db
    .collection("markupProfiles")
    .where("isDefault", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, profile: doc.data() as MarkupProfile };
}

function normalizeMonth(m: string): string {
  // Accept both YYYY-MM and YYYYMM, normalize to YYYYMM
  return m.replace(/-/g, "");
}

async function loadCustomerOverrides(
  billingMonth: string,
): Promise<Map<string, CustomerOverride>> {
  const snap = await db.collection("customerOverrides").get();

  const map = new Map<string, CustomerOverride>();
  snap.forEach((doc) => {
    const override = doc.data() as CustomerOverride;
    const start = normalizeMonth(override.startMonth);
    const end = override.endMonth ? normalizeMonth(override.endMonth) : null;
    // Only include if startMonth <= billingMonth and endMonth is null or >= billingMonth.
    if (start <= billingMonth && (end === null || end >= billingMonth)) {
      // If multiple overrides exist for a customer, the latest startMonth wins.
      const existing = map.get(override.customerId);
      const existingStart = existing ? normalizeMonth(existing.startMonth) : "";
      if (!existing || start > existingStart) {
        map.set(override.customerId, override);
      }
    }
  });
  return map;
}

async function loadSkuMappings(): Promise<Map<string, SkuMapping>> {
  const snap = await db
    .collection("skuMappings")
    .where("isActive", "==", true)
    .get();
  const map = new Map<string, SkuMapping>();
  snap.forEach((doc) => {
    const mapping = doc.data() as SkuMapping;
    // Key by SKU name for lookup.
    map.set(mapping.skuName, mapping);
  });
  return map;
}

async function loadCustomers(): Promise<
  Map<string, { profileId: string | null; domain: string | null; lastBilled: string | null }>
> {
  const snap = await db.collection("customers").get();
  const map = new Map<
    string,
    { profileId: string | null; domain: string | null; lastBilled: string | null }
  >();
  snap.forEach((doc) => {
    const data = doc.data();
    map.set(doc.id, {
      profileId: data.markupProfileId ?? null,
      domain: data.domain ?? null,
      lastBilled: data.lastBilled ?? null,
    });
  });
  return map;
}

// ---------------------------------------------------------------------------
// BigQuery query
// ---------------------------------------------------------------------------

const HISTORICAL_TABLE = "reseller_billing_historical_v1";

async function queryBillingData(billingMonth: string, useHistorical = false): Promise<BqBillingRow[]> {
  const table = useHistorical ? HISTORICAL_TABLE : BILLING_TABLE;
  const query = `
    SELECT
      customer_name,
      cost,
      cost_at_list,
      currency,
      sku,
      invoice,
      usage,
      system_labels,
      cost_type,
      payer_billing_account_id,
      credits,
      entitlement_name
    FROM \`${PROJECT_ID}.${DATASET_ID}.${table}\`
    WHERE invoice.month = @billingMonth
  `;

  const [rows] = await bigquery.query({
    query,
    params: { billingMonth },
    location: "US",
  });

  return rows as BqBillingRow[];
}

// ---------------------------------------------------------------------------
// Classification & markup
// ---------------------------------------------------------------------------

function classifySubscriptionType(
  customerId: string,
  overrides: Map<string, CustomerOverride>,
  existingCustomers: Map<
    string,
    { profileId: string | null; domain: string | null; lastBilled: string | null }
  >,
): "NEW" | "RENEWAL" | "TRANSFER" {
  // 1. Check explicit override.
  const override = overrides.get(customerId);
  if (
    override &&
    (override.overrideType === "NEW" ||
      override.overrideType === "RENEWAL" ||
      override.overrideType === "TRANSFER")
  ) {
    return override.overrideType;
  }

  // 2. Check if customer has been billed before (lastBilled is set).
  const existing = existingCustomers.get(customerId);
  if (existing && existing.lastBilled) {
    return "RENEWAL";
  }

  // 3. First-time customer (not in system, or never billed) = NEW.
  return "NEW";
}

function resolveMarkup(
  customerId: string,
  skuName: string,
  subscriptionType: "NEW" | "RENEWAL" | "TRANSFER",
  skuMappings: Map<string, SkuMapping>,
  overrides: Map<string, CustomerOverride>,
  customerProfiles: Map<
    string,
    { profileId: string | null; domain: string | null }
  >,
  allProfiles: Map<string, MarkupProfile>,
  defaultProfile: { id: string; profile: MarkupProfile } | null,
): {
  markupFactor: number;
  appliedRule: "sku" | "override" | "profile" | "default";
  revenueAccountCode: string;
  cosAccountCode: string;
} {
  const skuMapping = skuMappings.get(skuName);
  const revenueAccountCode =
    skuMapping?.revenueAccountCode ?? DEFAULT_REVENUE_ACCOUNT;
  const cosAccountCode = skuMapping?.cosAccountCode ?? DEFAULT_COS_ACCOUNT;

  // 1. SKU-level special markup.
  if (skuMapping?.specialMarkup !== null && skuMapping?.specialMarkup !== undefined) {
    return {
      markupFactor: skuMapping.specialMarkup,
      appliedRule: "sku",
      revenueAccountCode,
      cosAccountCode,
    };
  }

  // 2. Customer override with CUSTOM type and explicit markup factor.
  const override = overrides.get(customerId);
  if (override && override.overrideType === "CUSTOM") {
    return {
      markupFactor: override.markupFactor,
      appliedRule: "override",
      revenueAccountCode,
      cosAccountCode,
    };
  }

  // 3. Customer's assigned markup profile.
  const customerData = customerProfiles.get(customerId);
  if (customerData?.profileId) {
    const profile = allProfiles.get(customerData.profileId);
    if (profile) {
      return {
        markupFactor: profile.rates[subscriptionType],
        appliedRule: "profile",
        revenueAccountCode,
        cosAccountCode,
      };
    }
  }

  // 4. Default profile.
  if (defaultProfile) {
    return {
      markupFactor: defaultProfile.profile.rates[subscriptionType],
      appliedRule: "default",
      revenueAccountCode,
      cosAccountCode,
    };
  }

  // Absolute fallback (should not happen if system is configured).
  return {
    markupFactor: 0,
    appliedRule: "default",
    revenueAccountCode,
    cosAccountCode,
  };
}

// ---------------------------------------------------------------------------
// Main processing function
// ---------------------------------------------------------------------------

export async function processBilling(
  billingMonth: string,
  options: { isTestRun?: boolean } = {},
): Promise<string> {
  const isTestRun = options.isTestRun ?? false;

  // Validate format.
  if (!/^\d{6}$/.test(billingMonth)) {
    throw new Error(
      `Invalid billingMonth format: ${billingMonth}. Expected YYYYMM.`,
    );
  }

  // Create billing run document.
  const runRef = db.collection("billingRuns").doc();
  const runId = runRef.id;

  const runData: BillingRun = {
    billingPeriod: billingMonth,
    phase: "PROCESSED",
    status: "running",
    isTestRun,
    startedAt: Timestamp.now(),
    completedAt: null,
    sentToXeroAt: null,
    triggeredBy: "manual",
    summary: {
      customerCount: 0,
      invoiceCount: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalMargin: 0,
      errorCount: 0,
    },
  };

  await runRef.set(runData);

  try {
    // For test runs, try the live table first, fall back to historical.
    // For real runs, only use the live table.
    let billingRows: BqBillingRow[];
    const liveRows = await queryBillingData(billingMonth, false);
    if (liveRows.length > 0) {
      billingRows = liveRows;
    } else if (isTestRun) {
      billingRows = await queryBillingData(billingMonth, true);
      if (billingRows.length === 0) {
        throw new Error(`No billing data found for ${billingMonth} in live or historical tables.`);
      }
    } else {
      throw new Error(`No billing data found for ${billingMonth}.`);
    }

    // Load reference data in parallel.
    const [
      allProfiles,
      defaultProfile,
      overrides,
      skuMappings,
      existingCustomers,
    ] = await Promise.all([
      loadMarkupProfiles(),
      loadDefaultProfile(),
      loadCustomerOverrides(billingMonth),
      loadSkuMappings(),
      loadCustomers(),
    ]);

    const rows = billingRows;

    // -----------------------------------------------------------------------
    // Phase 1a: Process each row, compute aggregates.
    // -----------------------------------------------------------------------

    // Keyed by `${customerId}||${skuId}||${subscriptionType}`.
    const aggregates = new Map<string, AggBucket>();
    // Track total Voice cost per customer and globally for tax distribution.
    const voiceCostByCustomer = new Map<string, number>();
    let totalVoiceCost = 0;
    // Track total Voice tax across all rows.
    let totalVoiceTax = 0;

    for (const row of rows) {
      const customerId = extractCustomerId(row.customer_name);
      const domain = extractDomain(row.system_labels ?? []);
      const voice = isVoiceSku(row);
      const cost = netCost(row);

      const skuId = voice ? GOOGLE_VOICE_SKU_ID : (row.sku.id ?? "UNKNOWN");
      const skuName = voice
        ? GOOGLE_VOICE_SKU_NAME
        : (row.sku.description ?? "Unknown SKU");

      // For voice rows that are tax cost_type, accumulate for later distribution.
      if (voice && row.cost_type === "tax") {
        totalVoiceTax += cost;
        continue;
      }

      const subscriptionType = voice
        ? "RENEWAL" as const
        : classifySubscriptionType(customerId, overrides, existingCustomers);

      const markup = voice
        ? {
            markupFactor: 0,
            appliedRule: "sku" as const,
            revenueAccountCode:
              skuMappings.get(GOOGLE_VOICE_SKU_NAME)?.revenueAccountCode ??
              DEFAULT_REVENUE_ACCOUNT,
            cosAccountCode:
              skuMappings.get(GOOGLE_VOICE_SKU_NAME)?.cosAccountCode ??
              DEFAULT_COS_ACCOUNT,
          }
        : resolveMarkup(
            customerId,
            skuName,
            subscriptionType,
            skuMappings,
            overrides,
            existingCustomers,
            allProfiles,
            defaultProfile,
          );

      const aggKey = `${customerId}||${skuId}||${subscriptionType}`;
      const existing = aggregates.get(aggKey);

      if (existing) {
        existing.quantity += row.usage?.amount ?? 0;
        existing.totalCost += cost;
        existing.totalCostAtList += row.cost_at_list ?? 0;
      } else {
        aggregates.set(aggKey, {
          key: {
            customerId,
            customerName: row.customer_name,
            domain,
            skuId,
            skuName,
            subscriptionType,
            pricingModel: row.cost_type ?? "unknown",
          },
          quantity: row.usage?.amount ?? 0,
          totalCost: cost,
          totalCostAtList: row.cost_at_list ?? 0,
          markupFactor: markup.markupFactor,
          appliedRule: markup.appliedRule,
          revenueAccountCode: markup.revenueAccountCode,
          cosAccountCode: markup.cosAccountCode,
          isVoice: voice,
        });
      }

      // Track Voice usage for tax distribution.
      if (voice) {
        voiceCostByCustomer.set(
          customerId,
          (voiceCostByCustomer.get(customerId) ?? 0) + cost,
        );
        totalVoiceCost += cost;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 1b: Distribute Voice tax proportionally.
    // -----------------------------------------------------------------------

    // Create tax line items for each customer with Voice usage.
    if (totalVoiceTax !== 0 && totalVoiceCost !== 0) {
      for (const [customerId, customerVoiceCost] of voiceCostByCustomer) {
        const share = customerVoiceCost / totalVoiceCost;
        const customerTax = totalVoiceTax * share;

        const taxAggKey = `${customerId}||GOOGLE_VOICE_TAX||RENEWAL`;
        aggregates.set(taxAggKey, {
          key: {
            customerId,
            customerName: "", // will be populated from existing aggregate
            domain: null,
            skuId: "GOOGLE_VOICE_TAX",
            skuName: "Google Voice Tax",
            subscriptionType: "RENEWAL",
            pricingModel: "tax",
          },
          quantity: 1,
          totalCost: customerTax,
          totalCostAtList: customerTax,
          markupFactor: 0,
          appliedRule: "sku",
          revenueAccountCode:
            skuMappings.get(GOOGLE_VOICE_SKU_NAME)?.revenueAccountCode ??
            DEFAULT_REVENUE_ACCOUNT,
          cosAccountCode:
            skuMappings.get(GOOGLE_VOICE_SKU_NAME)?.cosAccountCode ??
            DEFAULT_COS_ACCOUNT,
          isVoice: true,
        });

        // Fill in customer name and domain from an existing aggregate for this customer.
        for (const bucket of aggregates.values()) {
          if (bucket.key.customerId === customerId && bucket.key.customerName) {
            const taxBucket = aggregates.get(taxAggKey)!;
            taxBucket.key.customerName = bucket.key.customerName;
            taxBucket.key.domain = bucket.key.domain;
            break;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Phase 1c: Group aggregates by customer to build invoices.
    // -----------------------------------------------------------------------

    const customerBuckets = new Map<string, AggBucket[]>();
    for (const bucket of aggregates.values()) {
      const existing = customerBuckets.get(bucket.key.customerId) ?? [];
      existing.push(bucket);
      customerBuckets.set(bucket.key.customerId, existing);
    }

    let totalRunRevenue = 0;
    let totalRunCost = 0;
    let invoiceCount = 0;
    let errorCount = 0;

    // -----------------------------------------------------------------------
    // Phase 1d: Write invoices and line items to Firestore.
    // -----------------------------------------------------------------------

    // Process customers in batches to avoid Firestore write limits.
    const customerEntries = Array.from(customerBuckets.entries());

    for (const [customerId, buckets] of customerEntries) {
      try {
        const invoiceRef = runRef.collection("invoices").doc();
        const firstBucket = buckets[0];

        let invoiceTotalCost = 0;
        let invoiceTotalRevenue = 0;
        const lineItems: Array<LineItem & { _docRef?: string }> = [];

        for (const bucket of buckets) {
          const costAmount = roundCurrency(bucket.totalCost);
          let customerPrice: number;

          if (bucket.isVoice) {
            // Voice: bill at list price (pass-through).
            customerPrice = roundCurrency(bucket.totalCostAtList);
          } else {
            // Regular SKU: cost * (1 + markup_factor).
            customerPrice = roundCurrency(
              costAmount * (1 + bucket.markupFactor),
            );
          }

          const margin = roundCurrency(customerPrice - costAmount);

          const lineItem: LineItem = {
            skuId: bucket.key.skuId,
            skuName: bucket.key.skuName,
            subscriptionType: bucket.key.subscriptionType,
            pricingModel: bucket.key.pricingModel,
            quantity: bucket.quantity,
            costAmount,
            markupFactor: bucket.markupFactor,
            customerPrice,
            margin,
            revenueAccountCode: bucket.revenueAccountCode,
            cosAccountCode: bucket.cosAccountCode,
            appliedRule: bucket.appliedRule,
          };

          lineItems.push(lineItem);
          invoiceTotalCost += costAmount;
          invoiceTotalRevenue += customerPrice;
        }

        const invoiceTotalMargin = roundCurrency(
          invoiceTotalRevenue - invoiceTotalCost,
        );

        const invoiceData: Invoice = {
          customerId,
          customerDomain: firstBucket.key.domain,
          customerName: firstBucket.key.customerName,
          xeroContactId: null,
          phase: "DRAFT",
          xeroInvoiceId: null,
          xeroInvoiceNumber: null,
          xeroBillId: null,
          xeroBillNumber: null,
          totalCost: roundCurrency(invoiceTotalCost),
          totalRevenue: roundCurrency(invoiceTotalRevenue),
          totalMargin: invoiceTotalMargin,
          lineItemCount: lineItems.length,
          errorMessage: null,
          notes: null,
        };

        // Write invoice document.
        await invoiceRef.set(invoiceData);

        // Write line items as sub-collection.
        const batch = db.batch();
        for (const li of lineItems) {
          const liRef = invoiceRef.collection("lineItems").doc();
          batch.set(liRef, li);
        }
        await batch.commit();

        totalRunCost += invoiceTotalCost;
        totalRunRevenue += invoiceTotalRevenue;
        invoiceCount++;

        // Upsert customer record.
        const customerRef = db.collection("customers").doc(customerId);
        await customerRef.set(
          {
            googleCustomerName: firstBucket.key.customerName,
            domain: firstBucket.key.domain,
            lastBilled: billingMonth,
            isActive: true,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        );

        // If customer does not exist yet, set firstSeen and createdAt.
        const customerDoc = await customerRef.get();
        if (!customerDoc.data()?.firstSeen) {
          await customerRef.set(
            {
              firstSeen: billingMonth,
              createdAt: Timestamp.now(),
              xeroContactId: null,
              xeroContactName: null,
              markupProfileId: null,
            },
            { merge: true },
          );
        }
      } catch (err) {
        errorCount++;
        console.error(`Error processing customer ${customerId}:`, err);
      }
    }

    // -----------------------------------------------------------------------
    // Phase 1e: Update billing run summary.
    // -----------------------------------------------------------------------

    const totalRunMargin = roundCurrency(totalRunRevenue - totalRunCost);

    await runRef.update({
      status: "completed",
      phase: "PROCESSED",
      completedAt: Timestamp.now(),
      summary: {
        customerCount: customerBuckets.size,
        invoiceCount,
        totalRevenue: roundCurrency(totalRunRevenue),
        totalCost: roundCurrency(totalRunCost),
        totalMargin: totalRunMargin,
        errorCount,
      },
    });

    return runId;
  } catch (err) {
    console.error("Billing processing failed:", err);
    await runRef.update({
      status: "failed",
      completedAt: Timestamp.now(),
      "summary.errorCount": FieldValue.increment(1),
    });
    throw err;
  }
}

/**
 * Round a number to 2 decimal places (currency precision).
 */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
