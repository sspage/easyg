import { Router, Request, Response } from "express";
import { db, PROJECT_ID, DATASET_ID, BILLING_TABLE, XERO_CALLBACK_URL } from "../config";
import { Timestamp, FieldPath } from "firebase-admin/firestore";

const router = Router();

/**
 * Recursively convert Firestore Timestamp objects to ISO strings
 * so the frontend can parse them with new Date().
 */
function serializeTimestamps(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Timestamp) return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(serializeTimestamps);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeTimestamps(value);
    }
    return result;
  }
  return obj;
}

/** Serialize a Firestore doc for JSON response */
function docToJson(id: string, data: Record<string, unknown>): Record<string, unknown> {
  return serializeTimestamps({ id, ...data }) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Generic CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Build standard CRUD routes for a Firestore collection.
 * Handles GET (list), GET/:id, POST, PUT/:id, DELETE/:id.
 */
function crudRoutes(
  path: string,
  collectionName: string,
  options?: {
    /** Fields to set automatically on create. */
    onCreate?: (body: Record<string, unknown>) => Record<string, unknown>;
    /** Fields to set automatically on update. */
    onUpdate?: (body: Record<string, unknown>) => Record<string, unknown>;
    /** Validate body before create/update. Throw to reject. */
    validate?: (body: Record<string, unknown>, isCreate: boolean) => void;
  },
): void {
  const col = () => db.collection(collectionName);

  // LIST
  router.get(path, async (_req: Request, res: Response) => {
    try {
      const snapshot = await col().orderBy(FieldPath.documentId()).get();
      const items = snapshot.docs.map((doc) => docToJson(doc.id, doc.data()));
      res.json(items);
    } catch (err) {
      console.error(`GET ${path} error:`, err);
      res.status(500).json({ error: "Failed to list items" });
    }
  });

  // GET by ID
  router.get(`${path}/:id`, async (req: Request, res: Response) => {
    try {
      const doc = await col().doc(req.params.id as string).get();
      if (!doc.exists) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(docToJson(doc.id, doc.data()!));
    } catch (err) {
      console.error(`GET ${path}/:id error:`, err);
      res.status(500).json({ error: "Failed to get item" });
    }
  });

  // CREATE
  router.post(path, async (req: Request, res: Response) => {
    try {
      let data = { ...req.body };
      if (options?.validate) {
        options.validate(data, true);
      }
      if (options?.onCreate) {
        data = { ...data, ...options.onCreate(data) };
      }
      const ref = await col().add(data);
      const doc = await ref.get();
      res.status(201).json(docToJson(ref.id, doc.data()!));
    } catch (err) {
      console.error(`POST ${path} error:`, err);
      const message = err instanceof Error ? err.message : "Failed to create item";
      res.status(400).json({ error: message });
    }
  });

  // UPDATE
  router.put(`${path}/:id`, async (req: Request, res: Response) => {
    try {
      const ref = col().doc(req.params.id as string);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      let data = { ...req.body };
      if (options?.validate) {
        options.validate(data, false);
      }
      if (options?.onUpdate) {
        data = { ...data, ...options.onUpdate(data) };
      }
      await ref.update(data);
      const updated = await ref.get();
      res.json(docToJson(ref.id, updated.data()!));
    } catch (err) {
      console.error(`PUT ${path}/:id error:`, err);
      const message = err instanceof Error ? err.message : "Failed to update item";
      res.status(400).json({ error: message });
    }
  });

  // DELETE
  router.delete(`${path}/:id`, async (req: Request, res: Response) => {
    try {
      const ref = col().doc(req.params.id as string);
      const existing = await ref.get();
      if (!existing.exists) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await ref.delete();
      res.json({ id: req.params.id as string, deleted: true });
    } catch (err) {
      console.error(`DELETE ${path}/:id error:`, err);
      res.status(500).json({ error: "Failed to delete item" });
    }
  });
}

// ---------------------------------------------------------------------------
// Markup Profiles
// ---------------------------------------------------------------------------

crudRoutes("/api/markup-profiles", "markupProfiles", {
  onCreate: () => ({
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }),
  onUpdate: () => ({
    updatedAt: Timestamp.now(),
  }),
  validate: (body, isCreate) => {
    if (isCreate && !body.name) {
      throw new Error("name is required");
    }
    if (body.rates) {
      const rates = body.rates as Record<string, unknown>;
      if (
        typeof rates.NEW !== "number" ||
        typeof rates.RENEWAL !== "number" ||
        typeof rates.TRANSFER !== "number"
      ) {
        throw new Error("rates must include NEW, RENEWAL, and TRANSFER as numbers");
      }
    } else if (isCreate) {
      throw new Error("rates is required");
    }
  },
});

// ---------------------------------------------------------------------------
// Customers (custom list route that enriches with profile names)
// ---------------------------------------------------------------------------

// Override the generic list to add markupProfileName
router.get("/api/customers", async (_req: Request, res: Response) => {
  try {
    const [customersSnap, profilesSnap] = await Promise.all([
      db.collection("customers").orderBy(FieldPath.documentId()).get(),
      db.collection("markupProfiles").get(),
    ]);
    const profileMap = new Map<string, string>();
    profilesSnap.docs.forEach((d) => profileMap.set(d.id, d.data().name || d.id));

    const items = customersSnap.docs.map((doc) => {
      const data = doc.data();
      return docToJson(doc.id, {
        ...data,
        markupProfileName: data.markupProfileId ? profileMap.get(data.markupProfileId) || null : null,
      });
    });
    res.json(items);
  } catch (err) {
    console.error("GET /api/customers error:", err);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// Generic CRUD handles GET/:id, POST, PUT/:id, DELETE/:id
crudRoutes("/api/customers", "customers", {
  onCreate: () => ({
    createdAt: Timestamp.now(),
    isActive: true,
  }),
  validate: (body, isCreate) => {
    if (isCreate && !body.googleCustomerName) {
      throw new Error("googleCustomerName is required");
    }
  },
});

// ---------------------------------------------------------------------------
// Customer Overrides
// ---------------------------------------------------------------------------

// Customer overrides are accessed via nested routes under /api/customers/:customerId/overrides
// See below. No generic /api/customer-overrides CRUD to prevent bypassing ownership checks.

// Nested override routes (frontend uses /customers/:customerId/overrides)
router.get("/api/customers/:customerId/overrides", async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    const snap = await db.collection("customerOverrides")
      .where("customerId", "==", customerId).get();
    res.json(snap.docs.map((d) => docToJson(d.id, d.data())));
  } catch (err) {
    console.error("GET customer overrides error:", err);
    res.status(500).json({ error: "Failed to list overrides" });
  }
});

router.post("/api/customers/:customerId/overrides", async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    const validTypes = ["TRANSFER", "NEW", "RENEWAL", "CUSTOM"];
    if (!req.body.overrideType || !validTypes.includes(req.body.overrideType)) {
      throw new Error("overrideType must be one of: TRANSFER, NEW, RENEWAL, CUSTOM");
    }
    if (!req.body.startMonth) throw new Error("startMonth is required");
    // Only allow safe fields
    const data = {
      customerId,
      overrideType: req.body.overrideType,
      markupFactor: Number(req.body.markupFactor) || 0,
      startMonth: req.body.startMonth,
      endMonth: req.body.endMonth || null,
      notes: req.body.notes || "",
      createdBy: req.body.createdBy || "app",
      createdAt: Timestamp.now(),
    };
    const ref = await db.collection("customerOverrides").add(data);
    const doc = await ref.get();
    res.status(201).json(docToJson(ref.id, doc.data()!));
  } catch (err) {
    console.error("POST customer override error:", err);
    const message = err instanceof Error ? err.message : "Failed to create override";
    res.status(400).json({ error: message });
  }
});

router.put("/api/customers/:customerId/overrides/:id", async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    const ref = db.collection("customerOverrides").doc(req.params.id as string);
    const existing = await ref.get();
    if (!existing.exists) { res.status(404).json({ error: "Not found" }); return; }
    // Verify override belongs to this customer
    if (existing.data()?.customerId !== customerId) {
      res.status(403).json({ error: "Override does not belong to this customer" });
      return;
    }
    // Only allow safe fields, never let customerId be changed
    const allowed: Record<string, unknown> = {};
    if (req.body.overrideType !== undefined) allowed.overrideType = req.body.overrideType;
    if (req.body.markupFactor !== undefined) allowed.markupFactor = Number(req.body.markupFactor);
    if (req.body.startMonth !== undefined) allowed.startMonth = req.body.startMonth;
    if (req.body.endMonth !== undefined) allowed.endMonth = req.body.endMonth || null;
    if (req.body.notes !== undefined) allowed.notes = req.body.notes;
    await ref.update(allowed);
    const updated = await ref.get();
    res.json(docToJson(ref.id, updated.data()!));
  } catch (err) {
    console.error("PUT customer override error:", err);
    res.status(400).json({ error: "Failed to update override" });
  }
});

router.delete("/api/customers/:customerId/overrides/:id", async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    const ref = db.collection("customerOverrides").doc(req.params.id as string);
    const existing = await ref.get();
    if (!existing.exists) { res.status(404).json({ error: "Not found" }); return; }
    // Verify override belongs to this customer
    if (existing.data()?.customerId !== customerId) {
      res.status(403).json({ error: "Override does not belong to this customer" });
      return;
    }
    await ref.delete();
    res.json({ id: req.params.id as string, deleted: true });
  } catch (err) {
    console.error("DELETE customer override error:", err);
    res.status(500).json({ error: "Failed to delete override" });
  }
});

// ---------------------------------------------------------------------------
// SKU Mappings
// ---------------------------------------------------------------------------

crudRoutes("/api/sku-mappings", "skuMappings", {
  onCreate: () => ({
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isActive: true,
  }),
  onUpdate: () => ({
    updatedAt: Timestamp.now(),
  }),
  validate: (body, isCreate) => {
    if (isCreate) {
      if (!body.skuName) throw new Error("skuName is required");
      if (!body.category) throw new Error("category is required");
      if (!body.revenueAccountCode) throw new Error("revenueAccountCode is required");
      if (!body.cosAccountCode) throw new Error("cosAccountCode is required");
    }
  },
});

// SKU refresh: scan billing_new for SKUs not yet in skuMappings
router.post("/api/sku-mappings/refresh", async (_req: Request, res: Response) => {
  try {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const bq = new BigQuery({ projectId: PROJECT_ID });

    const [rows] = await bq.query({
      query: `SELECT DISTINCT
        COALESCE(sku.id, 'GOOGLE_VOICE_USAGE') AS sku_id,
        COALESCE(sku.description, 'Google Voice (Usage)') AS sku_name
      FROM \`${PROJECT_ID}.${DATASET_ID}.${BILLING_TABLE}\``,
    });

    const existingSnap = await db.collection("skuMappings").get();
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    let newSkus = 0;
    const batch = db.batch();
    for (const row of rows) {
      if (!existingIds.has(row.sku_id)) {
        const ref = db.collection("skuMappings").doc(row.sku_id);
        batch.set(ref, {
          skuName: row.sku_name,
          category: "Uncategorized",
          revenueAccountCode: "",
          cosAccountCode: "",
          xeroItemCode: null,
          specialMarkup: null,
          isActive: true,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        newSkus++;
      }
    }
    if (newSkus > 0) await batch.commit();

    res.json({ newSkus });
  } catch (err) {
    console.error("POST /api/sku-mappings/refresh error:", err);
    res.status(500).json({ error: "Failed to refresh SKU mappings" });
  }
});

// ---------------------------------------------------------------------------
// Billing Runs
// ---------------------------------------------------------------------------

// LIST billing runs (read-only).
router.get("/api/billing-runs", async (_req: Request, res: Response) => {
  try {
    const snapshot = await db
      .collection("billingRuns")
      .orderBy("startedAt", "desc")
      .limit(50)
      .get();

    const runs = snapshot.docs.map((doc) => docToJson(doc.id, doc.data()));
    res.json(runs);
  } catch (err) {
    console.error("GET /api/billing-runs error:", err);
    res.status(500).json({ error: "Failed to list billing runs" });
  }
});

// GET billing run detail (with invoices and their line items).
router.get("/api/billing-runs/:id", async (req: Request, res: Response) => {
  try {
    const runRef = db.collection("billingRuns").doc(req.params.id as string);
    const runDoc = await runRef.get();

    if (!runDoc.exists) {
      res.status(404).json({ error: "Billing run not found" });
      return;
    }

    // Load invoices.
    const invoicesSnap = await runRef.collection("invoices").get();
    const invoices = await Promise.all(
      invoicesSnap.docs.map(async (invoiceDoc) => {
        // Load line items for each invoice.
        const lineItemsSnap = await invoiceDoc.ref
          .collection("lineItems")
          .get();
        const lineItems = lineItemsSnap.docs.map((liDoc) => docToJson(liDoc.id, liDoc.data()));

        return {
          ...docToJson(invoiceDoc.id, invoiceDoc.data()),
          lineItems,
        };
      }),
    );

    res.json(serializeTimestamps({
      id: runDoc.id,
      ...runDoc.data(),
      invoices,
    }));
  } catch (err) {
    console.error("GET /api/billing-runs/:id error:", err);
    res.status(500).json({ error: "Failed to get billing run details" });
  }
});

// DELETE billing run and all sub-collections
router.delete("/api/billing-runs/:id", async (req: Request, res: Response) => {
  try {
    const runId = req.params.id as string;
    const runRef = db.collection("billingRuns").doc(runId);
    const runDoc = await runRef.get();
    if (!runDoc.exists) {
      res.status(404).json({ error: "Billing run not found" });
      return;
    }
    if (runDoc.data()?.status === "running") {
      res.status(409).json({ error: "Cannot delete a run that is still processing." });
      return;
    }

    // Delete line items and invoices sub-collections
    const invoicesSnap = await runRef.collection("invoices").get();
    const batches: FirebaseFirestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let opCount = 0;

    for (const invoiceDoc of invoicesSnap.docs) {
      const lineItemsSnap = await invoiceDoc.ref.collection("lineItems").get();
      for (const liDoc of lineItemsSnap.docs) {
        currentBatch.delete(liDoc.ref);
        opCount++;
        if (opCount >= 400) {
          batches.push(currentBatch);
          currentBatch = db.batch();
          opCount = 0;
        }
      }
      currentBatch.delete(invoiceDoc.ref);
      opCount++;
      if (opCount >= 400) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        opCount = 0;
      }
    }
    currentBatch.delete(runRef);
    batches.push(currentBatch);

    for (const b of batches) {
      await b.commit();
    }

    res.json({ id: runId, deleted: true });
  } catch (err) {
    console.error("DELETE /api/billing-runs/:id error:", err);
    res.status(500).json({ error: "Failed to delete billing run" });
  }
});

// ---------------------------------------------------------------------------
// System Settings
// ---------------------------------------------------------------------------

router.get("/api/settings/system", async (_req: Request, res: Response) => {
  try {
    const doc = await db.doc("settings/system").get();
    if (!doc.exists) {
      // Return defaults if not yet configured.
      res.json({
        exportDatasetId: "billing_new",
        autoScheduleEnabled: false,
        autoScheduleDay: 5,
      });
      return;
    }
    res.json(serializeTimestamps(doc.data()));
  } catch (err) {
    console.error("GET /api/settings/system error:", err);
    res.status(500).json({ error: "Failed to get system settings" });
  }
});

router.put("/api/settings/system", async (req: Request, res: Response) => {
  try {
    await db.doc("settings/system").set(req.body, { merge: true });
    const updated = await db.doc("settings/system").get();
    res.json(serializeTimestamps(updated.data()));
  } catch (err) {
    console.error("PUT /api/settings/system error:", err);
    res.status(500).json({ error: "Failed to update system settings" });
  }
});

// ---------------------------------------------------------------------------
// Xero Settings (read-only from API)
// ---------------------------------------------------------------------------

router.get("/api/settings/xero", async (_req: Request, res: Response) => {
  try {
    const doc = await db.doc("settings/xero").get();
    if (!doc.exists) {
      res.json({
        connectionStatus: "disconnected",
        tenantId: null,
        lastTokenRefresh: null,
        tokenExpiresAt: null,
        lastSuccessfulCall: null,
      });
      return;
    }
    res.json(serializeTimestamps(doc.data()));
  } catch (err) {
    console.error("GET /api/settings/xero error:", err);
    res.status(500).json({ error: "Failed to get Xero settings" });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get("/api/dashboard", async (_req: Request, res: Response) => {
  try {
    // Get latest billing run.
    const latestRunSnap = await db
      .collection("billingRuns")
      .orderBy("startedAt", "desc")
      .limit(1)
      .get();

    // Count customers.
    const customersSnap = await db
      .collection("customers")
      .where("isActive", "==", true)
      .get();
    const customerCount = customersSnap.size;

    // Count markup profiles.
    const profilesSnap = await db.collection("markupProfiles").get();
    const profileCount = profilesSnap.size;

    // Count active overrides.
    const overridesSnap = await db.collection("customerOverrides").get();
    const overrideCount = overridesSnap.size;

    // Count SKU mappings.
    const skuSnap = await db
      .collection("skuMappings")
      .where("isActive", "==", true)
      .get();
    const skuMappingCount = skuSnap.size;

    // Xero connection status.
    const xeroDoc = await db.doc("settings/xero").get();
    const xeroData = xeroDoc.exists ? xeroDoc.data() : {};
    const xeroStatus = {
      connectionStatus: xeroData?.connectionStatus ?? "disconnected",
      lastTokenRefresh: xeroData?.lastTokenRefresh ?? null,
      tokenExpiresAt: xeroData?.tokenExpiresAt ?? null,
      tenantId: xeroData?.tenantId ?? null,
      lastSuccessfulCall: xeroData?.lastSuccessfulCall ?? null,
    };

    // Count all customers (active + inactive) for totalCustomers.
    const allCustomersSnap = await db.collection("customers").get();

    // Count unmapped SKUs (isActive but missing account codes).
    const allSkuSnap = await db.collection("skuMappings").get();
    const unmappedSkuCount = allSkuSnap.docs.filter((d) => {
      const data = d.data();
      return data.isActive && (!data.revenueAccountCode || !data.cosAccountCode);
    }).length;

    const latestRun = latestRunSnap.empty
      ? null
      : docToJson(latestRunSnap.docs[0].id, latestRunSnap.docs[0].data());

    // Build alerts.
    const alerts: Array<{ type: string; message: string }> = [];
    if (xeroStatus.connectionStatus === "disconnected") {
      alerts.push({ type: "error", message: "Xero is not connected. Go to Settings to authenticate." });
    } else if (xeroStatus.connectionStatus === "expired") {
      alerts.push({ type: "warning", message: "Xero token has expired. Go to Settings to re-authenticate." });
    }
    if (unmappedSkuCount > 0) {
      alerts.push({ type: "warning", message: `${unmappedSkuCount} SKU(s) need account code mapping.` });
    }

    res.json(serializeTimestamps({
      xeroStatus,
      lastBillingRun: latestRun,
      totalCustomers: allCustomersSnap.size,
      activeCustomers: customerCount,
      unmappedSkuCount,
      alerts,
    }));
  } catch (err) {
    console.error("GET /api/dashboard error:", err);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

// ---------------------------------------------------------------------------
// Xero Auth
// ---------------------------------------------------------------------------

router.post("/api/settings/xero-auth", async (req: Request, res: Response) => {
  try {
    const { getSecret } = await import("../xero/auth");
    const crypto = await import("crypto");
    const clientId = await getSecret("xero-client-id");
    const redirectUri = XERO_CALLBACK_URL;
    const scopes = "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings";

    // Generate CSRF state token and store in Firestore
    const state = crypto.randomBytes(32).toString("hex");
    await db.collection("oauthStates").doc(state).set({
      createdAt: Timestamp.now(),
      userId: (req as Request & { user?: { uid?: string } }).user?.uid || "unknown",
    });

    const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;

    res.json({ authUrl });
  } catch (err) {
    console.error("POST /api/settings/xero-auth error:", err);
    res.status(500).json({ error: "Failed to build Xero auth URL" });
  }
});

// ---------------------------------------------------------------------------
// Billing Actions (delegates to billing modules, loaded lazily)
// ---------------------------------------------------------------------------

router.post("/api/billing-runs/process", async (req: Request, res: Response) => {
  const { month, isTestRun } = req.body;
  if (!month || !/^\d{6}$/.test(month)) {
    res.status(400).json({ error: "month is required in YYYYMM format" });
    return;
  }

  // Create the run document immediately and return it.
  // Processing happens in the background so the client doesn't time out.
  const runId = db.collection("billingRuns").doc().id;
  const runDoc = {
    billingPeriod: month,
    phase: "PROCESSING",
    status: "running",
    isTestRun: !!isTestRun,
    startedAt: Timestamp.now(),
    completedAt: null,
    sentToXeroAt: null,
    triggeredBy: "manual" as const,
    summary: {
      customerCount: 0,
      invoiceCount: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalMargin: 0,
      errorCount: 0,
    },
  };
  try {
    await db.collection("billingRuns").doc(runId).set(runDoc);
  } catch (err) {
    console.error("Failed to create billing run:", err);
    res.status(500).json({ error: "Failed to create billing run" });
    return;
  }

  // Process billing synchronously. The run doc is already in Firestore with
  // status "running", and the UI polls every 3 seconds for progress updates,
  // so the user sees real-time status even though this request takes a while.
  // The 540s function timeout is sufficient for our data volumes.
  try {
    const { processBilling } = await import("../billing/process");
    await processBilling(month, { isTestRun: !!isTestRun, existingRunId: runId });
    const completedDoc = await db.collection("billingRuns").doc(runId).get();
    res.json(docToJson(runId, completedDoc.data()!));
  } catch (err) {
    console.error("Billing processing failed:", err);
    const message = err instanceof Error ? err.message : "Billing processing failed";
    await db.collection("billingRuns").doc(runId).set({
      status: "failed",
      completedAt: Timestamp.now(),
      errorMessage: message,
    }, { merge: true });
    res.status(500).json({ error: message });
  }
});

router.post("/api/billing-runs/:id/send-to-xero", async (req: Request, res: Response) => {
  const runId = req.params.id as string;

  try {
    const { sendToXero } = await import("../billing/sendToXero");
    await sendToXero(runId);
    const doc = await db.collection("billingRuns").doc(runId).get();
    res.json(docToJson(doc.id, doc.data()!));
  } catch (err) {
    console.error("POST /api/billing-runs/:id/send-to-xero error:", err);
    const message = err instanceof Error ? err.message : "Send to Xero failed";
    res.status(500).json({ error: message });
  }
});

router.post("/api/billing-runs/:id/batch-send", async (req: Request, res: Response) => {
  const runId = req.params.id as string;

  try {
    const { batchApproveInvoices } = await import("../xero/client");
    const invoicesSnap = await db
      .collection("billingRuns")
      .doc(runId)
      .collection("invoices")
      .where("phase", "==", "SENT_TO_XERO")
      .get();

    const invoiceIds = invoicesSnap.docs
      .map((d) => d.data().xeroInvoiceId)
      .filter(Boolean) as string[];

    if (invoiceIds.length === 0) {
      res.status(400).json({ error: "No invoices ready to send" });
      return;
    }

    await batchApproveInvoices(invoiceIds);

    // Update invoice phases
    const batch = db.batch();
    for (const doc of invoicesSnap.docs) {
      batch.update(doc.ref, { phase: "APPROVED" });
    }
    await batch.commit();

    const updatedRun = await db.collection("billingRuns").doc(runId).get();
    res.json(docToJson(updatedRun.id, updatedRun.data()!));
  } catch (err) {
    console.error("POST /api/billing-runs/:id/batch-send error:", err);
    const message = err instanceof Error ? err.message : "Batch send failed";
    res.status(500).json({ error: message });
  }
});

export default router;
