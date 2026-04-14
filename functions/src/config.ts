import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();

// All configuration in one place. Values come from environment variables
// with sensible defaults for the current deployment.
export const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "white-dispatch-481617-f8";
export const DATASET_ID = process.env.BQ_DATASET || "billing_new";
export const BILLING_TABLE = "reseller_billing_detailed_export_v1";
export const HISTORICAL_TABLE = "reseller_billing_historical_v1";
export const REGION = process.env.FUNCTION_REGION || "us-central1";
export const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "easygcloud.com";
export const APP_DOMAIN = process.env.APP_DOMAIN || "markup.easygcloud.com";

// Xero OAuth — callback URL is the xeroCallback function URL.
// This must match what's registered in the Xero developer portal.
export const XERO_CALLBACK_URL = process.env.XERO_CALLBACK_URL || "https://xerocallback-mkcuchvdya-uc.a.run.app";
