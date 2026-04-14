import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { REGION } from "./config";
import router from "./api/router";

// Heavy modules (BigQuery, xero-node) are imported lazily inside handlers
// to avoid deployment timeout during function discovery.

const ALLOWED_DOMAIN = "easygcloud.com";

async function verifyAuth(req: express.Request, res: express.Response): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    if (!decoded.email?.endsWith(`@${ALLOWED_DOMAIN}`)) {
      res.status(403).json({ error: `Access restricted to @${ALLOWED_DOMAIN} accounts` });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Express app for web UI CRUD operations
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/**
 * Firebase Auth middleware.
 * Verifies the Firebase ID token from the Authorization header.
 * Rejects requests without a valid token.
 */
app.use(async (req, res, next) => {
  // Allow preflight requests through.
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email || "";
    if (!email.endsWith("@easygcloud.com")) {
      res.status(403).json({ error: "Access restricted to @easygcloud.com accounts" });
      return;
    }
    // Attach user info to the request for downstream use.
    (req as express.Request & { user?: admin.auth.DecodedIdToken }).user =
      decodedToken;
    next();
  } catch (err) {
    console.error("Auth verification failed:", err);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
});

app.use(router);

// Catch-all 404.
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

/**
 * HTTP Cloud Function (2nd gen) serving the Express API.
 */
export const api = onRequest(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  app,
);

// ---------------------------------------------------------------------------
// processBilling - Phase 1
// ---------------------------------------------------------------------------

/**
 * HTTP Cloud Function (2nd gen) that runs Phase 1 billing processing.
 *
 * Expects JSON body: { billingMonth: "YYYYMM" }
 */
export const processBilling = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (req, res) => {
    if (!(await verifyAuth(req as unknown as express.Request, res as unknown as express.Response))) return;

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const { billingMonth } = req.body;
    if (!billingMonth || !/^\d{6}$/.test(billingMonth)) {
      res.status(400).json({
        error: "billingMonth is required and must be in YYYYMM format",
      });
      return;
    }

    try {
      const { processBilling: runProcessBilling } = await import("./billing/process");
      const runId = await runProcessBilling(billingMonth);
      res.json({ success: true, billingRunId: runId });
    } catch (err) {
      console.error("processBilling error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Billing processing failed: ${message}` });
    }
  },
);

// ---------------------------------------------------------------------------
// sendToXero - Phase 3
// ---------------------------------------------------------------------------

/**
 * HTTP Cloud Function (2nd gen) that pushes billing run drafts to Xero.
 *
 * Expects JSON body: { billingRunId: "abc123" }
 */
export const sendToXero = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req, res) => {
    if (!(await verifyAuth(req as unknown as express.Request, res as unknown as express.Response))) return;

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    const { billingRunId } = req.body;
    if (!billingRunId) {
      res.status(400).json({ error: "billingRunId is required" });
      return;
    }

    try {
      const { sendToXero: runSendToXero } = await import("./billing/sendToXero");
      await runSendToXero(billingRunId);
      res.json({ success: true, billingRunId });
    } catch (err) {
      console.error("sendToXero error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Send to Xero failed: ${message}` });
    }
  },
);

// ---------------------------------------------------------------------------
// xeroCallback - OAuth callback
// ---------------------------------------------------------------------------

/**
 * HTTP Cloud Function (2nd gen) for Xero OAuth callback.
 *
 * Xero redirects to this URL with ?code=... after the user authorizes.
 */
export const xeroCallback = onRequest(
  {
    region: REGION,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    // Validate CSRF state token
    if (!state) {
      res.status(400).json({ error: "Missing state parameter" });
      return;
    }
    const { db } = await import("./config");
    const stateDoc = await db.collection("oauthStates").doc(state).get();
    if (!stateDoc.exists) {
      res.status(403).json({ error: "Invalid or expired state parameter" });
      return;
    }
    // Check TTL — state tokens expire after 10 minutes
    const stateData = stateDoc.data();
    const createdAt = stateData?.createdAt?.toMillis?.() ?? 0;
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - createdAt > TEN_MINUTES) {
      await stateDoc.ref.delete();
      res.status(403).json({ error: "State parameter expired. Please try again." });
      return;
    }
    // Delete used state token
    await stateDoc.ref.delete();

    try {
      // Build the redirect URI from the incoming request so it matches
      // whatever was registered with Xero.
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const redirectUri = `${protocol}://${host}${req.path}`;

      const { handleCallback } = await import("./xero/auth");
      const tenantId = await handleCallback(code, redirectUri);
      res.json({
        success: true,
        message: "Xero connected successfully",
        tenantId,
      });
    } catch (err) {
      console.error("Xero OAuth callback error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `OAuth callback failed: ${message}` });
    }
  },
);
