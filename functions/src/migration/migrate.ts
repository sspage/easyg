import * as admin from "firebase-admin";
import { BigQuery } from "@google-cloud/bigquery";

// Initialize Firebase Admin
admin.initializeApp({
  projectId: "white-dispatch-481617-f8",
});

const db = admin.firestore();
const bq = new BigQuery({ projectId: "white-dispatch-481617-f8" });

async function migrateMarkupRules() {
  console.log("Migrating markup rules -> markupProfiles...");

  const [rows] = await bq.query({
    query: `SELECT * FROM \`white-dispatch-481617-f8.billing.markup_rules\` WHERE is_active = TRUE ORDER BY priority`,
  });

  // Group rules by subscription_type to build the default profile
  const rates: Record<string, number> = {};
  const skuRules: Array<{ skuId: string; markupFactor: number; description: string }> = [];

  for (const row of rows) {
    if (row.sku_id && !row.subscription_type) {
      // SKU-specific rule - will be stored as specialMarkup on the SKU mapping
      skuRules.push({
        skuId: row.sku_id,
        markupFactor: row.markup_factor,
        description: row.description,
      });
    } else if (row.subscription_type) {
      rates[row.subscription_type] = row.markup_factor;
    }
  }

  // Create default profile
  await db.collection("markupProfiles").doc("default").set({
    name: "Default",
    description: "Standard Google partner rates (NEW 25%, RENEWAL 13.63%, TRANSFER 5.26%)",
    rates: {
      NEW: rates["NEW"] ?? 0.25,
      RENEWAL: rates["RENEWAL"] ?? 0.1363,
      TRANSFER: rates["TRANSFER"] ?? 0.0526,
    },
    isDefault: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`  Created default markup profile with rates: NEW=${rates["NEW"]}, RENEWAL=${rates["RENEWAL"]}, TRANSFER=${rates["TRANSFER"]}`);
  console.log(`  Found ${skuRules.length} SKU-specific rules (will apply during SKU migration)`);

  return skuRules;
}

async function migrateSkuMappings(skuRules: Array<{ skuId: string; markupFactor: number }>) {
  console.log("Migrating sku_to_xero_account -> skuMappings...");

  const [rows] = await bq.query({
    query: `SELECT * FROM \`white-dispatch-481617-f8.billing.sku_to_xero_account\` WHERE is_active = TRUE`,
  });

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    const skuRule = skuRules.find((r) => r.skuId === row.sku_id);

    const docRef = db.collection("skuMappings").doc(row.sku_id);
    batch.set(docRef, {
      skuName: row.sku_name || "",
      category: row.sku_category || "Google Workspace",
      revenueAccountCode: row.revenue_account_code,
      cosAccountCode: row.cos_account_code,
      xeroItemCode: row.xero_item_code || null,
      specialMarkup: skuRule ? skuRule.markupFactor : null,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;
  }

  await batch.commit();
  console.log(`  Migrated ${count} SKU mappings`);
}

async function migrateCustomers() {
  console.log("Migrating customer_to_xero_contact -> customers...");

  const [rows] = await bq.query({
    query: `SELECT * FROM \`white-dispatch-481617-f8.billing.customer_to_xero_contact\` WHERE is_active = TRUE`,
  });

  // Also get unique customers from billing_new to fill in any gaps
  const [billingCustomers] = await bq.query({
    query: `
      SELECT DISTINCT
        customer_name,
        (SELECT value FROM UNNEST(system_labels) WHERE key = 'workspace.googleapis.com/domain_name' LIMIT 1) as domain
      FROM \`white-dispatch-481617-f8.billing_new.reseller_billing_detailed_export_v1\`
    `,
  });

  // Build map of customer_name -> domain from billing data
  const domainMap = new Map<string, string>();
  for (const bc of billingCustomers) {
    if (bc.domain) {
      domainMap.set(bc.customer_name, bc.domain);
    }
  }

  // Migrate existing xero contact mappings
  const migratedNames = new Set<string>();
  let batch = db.batch();
  let count = 0;

  for (const row of rows) {
    const customerId = row.customer_name.replace(/^accounts\/[^/]+\/customers\//, "");
    const docRef = db.collection("customers").doc(customerId);

    batch.set(docRef, {
      googleCustomerName: row.customer_name,
      domain: row.customer_domain || domainMap.get(row.customer_name) || null,
      xeroContactId: row.xero_contact_id || null,
      xeroContactName: row.xero_contact_name || null,
      markupProfileId: null,
      isActive: true,
      firstSeen: "202512",
      lastBilled: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    migratedNames.add(row.customer_name);
    count++;

    // Firestore batch limit is 500
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  // Add any customers from billing_new that weren't in the xero contact table
  for (const bc of billingCustomers) {
    if (!migratedNames.has(bc.customer_name)) {
      const customerId = bc.customer_name.replace(/^accounts\/[^/]+\/customers\//, "");
      const docRef = db.collection("customers").doc(customerId);

      batch.set(docRef, {
        googleCustomerName: bc.customer_name,
        domain: bc.domain || null,
        xeroContactId: null,
        xeroContactName: null,
        markupProfileId: null,
        isActive: true,
        firstSeen: "202604",
        lastBilled: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
  }

  await batch.commit();
  console.log(`  Migrated ${count} customers`);
}

async function migrateSubscriptionOverrides() {
  console.log("Migrating subscription_overrides -> customerOverrides...");

  const [rows] = await bq.query({
    query: `SELECT * FROM \`white-dispatch-481617-f8.billing.subscription_overrides\``,
  });

  if (rows.length === 0) {
    console.log("  No subscription overrides to migrate");
    return;
  }

  const batch = db.batch();
  let count = 0;

  for (const row of rows) {
    const docRef = db.collection("customerOverrides").doc();
    batch.set(docRef, {
      customerId: row.customer_id,
      overrideType: row.override_type,
      markupFactor: row.override_type === "TRANSFER" ? 0.0526 : row.override_type === "NEW" ? 0.25 : 0.1363,
      startMonth: row.start_month,
      endMonth: row.end_month || null,
      notes: row.notes || "",
      createdBy: row.created_by || "migration",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;
  }

  await batch.commit();
  console.log(`  Migrated ${count} subscription overrides`);
}

async function migrateTrackingCategories() {
  console.log("Migrating tracking_categories -> settings/xero...");

  const [rows] = await bq.query({
    query: `SELECT * FROM \`white-dispatch-481617-f8.billing.tracking_categories\` WHERE is_active = TRUE`,
  });

  const categories: Record<string, Array<{ optionKey: string; xeroTrackingOption: string }>> = {};

  for (const row of rows) {
    if (!categories[row.category_name]) {
      categories[row.category_name] = [];
    }
    categories[row.category_name].push({
      optionKey: row.option_key,
      xeroTrackingOption: row.xero_tracking_option,
    });
  }

  await db.collection("settings").doc("xero").set({
    lastTokenRefresh: null,
    tokenExpiresAt: null,
    tenantId: null,
    connectionStatus: "disconnected",
    lastSuccessfulCall: null,
    trackingCategories: categories,
  });

  console.log(`  Migrated ${rows.length} tracking categories in ${Object.keys(categories).length} groups`);
}

async function initSystemSettings() {
  console.log("Initializing system settings...");

  await db.collection("settings").doc("system").set({
    exportDatasetId: "billing_new",
    autoScheduleEnabled: false,
    autoScheduleDay: 2,
  });

  console.log("  System settings initialized");
}

async function main() {
  console.log("=== easyG Migration: BigQuery -> Firestore ===\n");

  try {
    const skuRules = await migrateMarkupRules();
    await migrateSkuMappings(skuRules);
    await migrateCustomers();
    await migrateSubscriptionOverrides();
    await migrateTrackingCategories();
    await initSystemSettings();

    console.log("\n=== Migration complete ===");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
