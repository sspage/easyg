import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const PROJECT_ID = "white-dispatch-481617-f8";
export const DATASET_ID = "billing_new";
export const BILLING_TABLE = "reseller_billing_detailed_export_v1";
export const REGION = "us-central1";
