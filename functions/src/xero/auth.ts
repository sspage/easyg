import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { XeroClient } from "xero-node";
import { db, PROJECT_ID } from "../config";
import { Timestamp } from "firebase-admin/firestore";

const secretManager = new SecretManagerServiceClient();

const SECRET_NAMES = {
  clientId: "xero-client-id",
  clientSecret: "xero-client-secret",
  refreshToken: "xero-refresh-token",
  tenantId: "xero-tenant-id",
};

/**
 * Read the latest version of a secret from Secret Manager.
 */
export async function getSecret(name: string): Promise<string> {
  const [version] = await secretManager.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  const payload = version.payload?.data;
  if (!payload) {
    throw new Error(`Secret ${name} has no payload`);
  }
  if (typeof payload === "string") return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload).toString("utf8");
  return String(payload);
}

/**
 * Add or update a secret version in Secret Manager.
 */
async function setSecret(name: string, value: string): Promise<void> {
  await secretManager.addSecretVersion({
    parent: `projects/${PROJECT_ID}/secrets/${name}`,
    payload: { data: Buffer.from(value, "utf8") },
  });
}

/**
 * Build a XeroClient instance configured with credentials from Secret Manager.
 */
async function buildXeroClient(): Promise<XeroClient> {
  const [clientId, clientSecret] = await Promise.all([
    getSecret(SECRET_NAMES.clientId),
    getSecret(SECRET_NAMES.clientSecret),
  ]);

  const xero = new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [],
    scopes: [
      "openid",
      "profile",
      "email",
      "accounting.invoices",
      "accounting.contacts",
      "accounting.settings",
      "offline_access",
    ],
  });

  return xero;
}

/**
 * Refresh the Xero OAuth2 token.
 *
 * Reads the current refresh token from Secret Manager, exchanges it for a new
 * access + refresh pair via the Xero token endpoint, persists the new tokens
 * back to Secret Manager, and updates the Firestore xero-settings document.
 *
 * Returns a ready-to-use XeroClient with valid token set.
 */
export async function refreshToken(): Promise<XeroClient> {
  const xero = await buildXeroClient();

  const currentRefreshToken = await getSecret(SECRET_NAMES.refreshToken);

  // xero-node expects the token set to contain the refresh_token before
  // calling refreshWithRefreshToken.
  xero.setTokenSet({
    refresh_token: currentRefreshToken,
    // The remaining fields are placeholders; refreshWithRefreshToken only
    // needs refresh_token to perform the exchange.
    access_token: "",
    token_type: "Bearer",
    id_token: "",
    expires_at: 0,
  });

  const newTokenSet = await xero.refreshWithRefreshToken(
    await getSecret(SECRET_NAMES.clientId),
    await getSecret(SECRET_NAMES.clientSecret),
    currentRefreshToken,
  );

  // Persist the new refresh token so the next call uses it.
  if (newTokenSet.refresh_token) {
    await setSecret(SECRET_NAMES.refreshToken, newTokenSet.refresh_token);
  }

  // Update Firestore settings document.
  const now = Timestamp.now();
  const expiresAt = newTokenSet.expires_at
    ? Timestamp.fromMillis(newTokenSet.expires_at * 1000)
    : null;

  await db.doc("settings/xero").set(
    {
      lastTokenRefresh: now,
      tokenExpiresAt: expiresAt,
      connectionStatus: "connected",
    },
    { merge: true },
  );

  return xero;
}

// Cache the client within a single function invocation to avoid
// refreshing the token multiple times per billing run.
let cachedClient: XeroClient | null = null;
let cacheExpiry = 0;

/**
 * Return a XeroClient with a valid access token ready for API calls.
 * Caches the client for up to 25 minutes (Xero tokens last 30 min).
 */
export async function getXeroClient(): Promise<XeroClient> {
  if (cachedClient && Date.now() < cacheExpiry) {
    return cachedClient;
  }
  cachedClient = await refreshToken();
  cacheExpiry = Date.now() + 25 * 60 * 1000; // 25 minutes
  return cachedClient;
}

/**
 * Handle the Xero OAuth callback.
 *
 * Exchange the authorization code for tokens, persist them in Secret Manager
 * and Firestore, and return the tenant ID.
 */
export async function handleCallback(
  fullCallbackUrl: string,
  redirectUri: string,
): Promise<string> {
  const [clientId, clientSecret] = await Promise.all([
    getSecret(SECRET_NAMES.clientId),
    getSecret(SECRET_NAMES.clientSecret),
  ]);

  const xero = new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [redirectUri],
    scopes: [
      "openid",
      "profile",
      "email",
      "accounting.invoices",
      "accounting.contacts",
      "accounting.settings",
      "offline_access",
    ],
  });

  // Must initialize the OpenID client before calling apiCallback
  await xero.initialize();

  // apiCallback expects the full callback URL (not just the code)
  const tokenSet = await xero.apiCallback(fullCallbackUrl);

  if (!tokenSet.refresh_token) {
    throw new Error("No refresh token received from Xero");
  }

  // Persist tokens.
  await setSecret(SECRET_NAMES.refreshToken, tokenSet.refresh_token);

  // Read tenants so we can persist the tenant ID.
  await xero.updateTenants(false);
  const tenants = xero.tenants;
  if (!tenants || tenants.length === 0) {
    throw new Error("No Xero tenants found for this connection");
  }
  const tenantId = tenants[0].tenantId;
  await setSecret(SECRET_NAMES.tenantId, tenantId);

  const now = Timestamp.now();
  const expiresAt = tokenSet.expires_at
    ? Timestamp.fromMillis(tokenSet.expires_at * 1000)
    : null;

  await db.doc("settings/xero").set(
    {
      tenantId,
      lastTokenRefresh: now,
      tokenExpiresAt: expiresAt,
      connectionStatus: "connected",
      lastSuccessfulCall: now,
    },
    { merge: true },
  );

  return tenantId;
}
