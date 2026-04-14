import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { REGION, ALLOWED_DOMAIN } from "./config";
import router from "./api/router";

// ---------------------------------------------------------------------------
// Express app — single API function handling all authenticated operations
// ---------------------------------------------------------------------------

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/**
 * Firebase Auth middleware.
 * Verifies the Firebase ID token and restricts to ALLOWED_DOMAIN.
 */
app.use(async (req, res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    const email = decodedToken.email || "";
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      res.status(403).json({ error: `Access restricted to @${ALLOWED_DOMAIN} accounts` });
      return;
    }
    (req as express.Request & { user?: admin.auth.DecodedIdToken }).user = decodedToken;
    next();
  } catch (err) {
    console.error("Auth verification failed:", err);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
});

app.use(router);

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

/**
 * Main API function — handles all CRUD, billing processing, and Xero push.
 */
export const api = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: "1GiB" },
  app,
);

// ---------------------------------------------------------------------------
// xeroCallback — separate public function (no Firebase Auth required)
// ---------------------------------------------------------------------------

/**
 * Xero OAuth callback. Xero redirects here with ?code=...&state=...
 * This must be a separate function because it's called by Xero's redirect,
 * not by our authenticated frontend.
 */
export const xeroCallback = onRequest(
  { region: REGION, timeoutSeconds: 60, memory: "512MiB" },
  async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }
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

    const stateData = stateDoc.data();
    const createdAt = stateData?.createdAt?.toMillis?.() ?? 0;
    const TEN_MINUTES = 10 * 60 * 1000;
    if (Date.now() - createdAt > TEN_MINUTES) {
      await stateDoc.ref.delete();
      res.status(403).json({ error: "State parameter expired. Please try again." });
      return;
    }
    await stateDoc.ref.delete();

    try {
      // Use the configured callback URL (must match what's registered in Xero)
      const { XERO_CALLBACK_URL } = await import("./config");
      const redirectUri = XERO_CALLBACK_URL;
      const queryString = req.url.split("?")[1] || "";
      const fullCallbackUrl = `${redirectUri}?${queryString}`;

      const { handleCallback } = await import("./xero/auth");
      const tenantId = await handleCallback(fullCallbackUrl, redirectUri);
      res.json({ success: true, message: "Xero connected successfully", tenantId });
    } catch (err) {
      console.error("Xero OAuth callback error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `OAuth callback failed: ${message}` });
    }
  },
);
