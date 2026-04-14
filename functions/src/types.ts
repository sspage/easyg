import { Timestamp } from "firebase-admin/firestore";

export interface MarkupProfile {
  name: string;
  description: string;
  rates: {
    NEW: number;
    RENEWAL: number;
    TRANSFER: number;
  };
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Customer {
  googleCustomerName: string;
  domain: string | null;
  xeroContactId: string | null;
  xeroContactName: string | null;
  markupProfileId: string | null;
  isActive: boolean;
  firstSeen: string;
  lastBilled: string | null;
  createdAt: Timestamp;
}

export interface CustomerOverride {
  customerId: string;
  overrideType: "TRANSFER" | "NEW" | "RENEWAL" | "CUSTOM";
  markupFactor: number;
  startMonth: string;
  endMonth: string | null;
  notes: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface SkuMapping {
  skuName: string;
  category: string;
  revenueAccountCode: string;
  cosAccountCode: string;
  xeroItemCode: string | null;
  specialMarkup: number | null;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type BillingRunPhase = "PROCESSED" | "REVIEWED" | "SENT_TO_XERO";
export type BillingRunStatus = "running" | "completed" | "failed";
export type InvoicePhase = "DRAFT" | "SENT_TO_XERO" | "APPROVED" | "SENT_TO_CUSTOMER";

export interface BillingRun {
  billingPeriod: string;
  phase: BillingRunPhase;
  status: BillingRunStatus;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  sentToXeroAt: Timestamp | null;
  triggeredBy: "manual" | "scheduled";
  summary: {
    customerCount: number;
    invoiceCount: number;
    totalRevenue: number;
    totalCost: number;
    totalMargin: number;
    errorCount: number;
  };
}

export interface Invoice {
  customerId: string;
  customerDomain: string | null;
  customerName: string;
  xeroContactId: string | null;
  phase: InvoicePhase;
  xeroInvoiceId: string | null;
  xeroInvoiceNumber: string | null;
  xeroBillId: string | null;
  xeroBillNumber: string | null;
  totalCost: number;
  totalRevenue: number;
  totalMargin: number;
  lineItemCount: number;
  errorMessage: string | null;
  notes: string | null;
}

export interface LineItem {
  skuId: string;
  skuName: string;
  subscriptionType: "NEW" | "RENEWAL" | "TRANSFER";
  pricingModel: string;
  quantity: number;
  costAmount: number;
  markupFactor: number;
  customerPrice: number;
  margin: number;
  revenueAccountCode: string;
  cosAccountCode: string;
  appliedRule: "sku" | "override" | "profile" | "default";
}

export interface XeroSettings {
  lastTokenRefresh: Timestamp | null;
  tokenExpiresAt: Timestamp | null;
  tenantId: string | null;
  connectionStatus: "connected" | "expired" | "disconnected";
  lastSuccessfulCall: Timestamp | null;
}

export interface SystemSettings {
  exportDatasetId: string;
  autoScheduleEnabled: boolean;
  autoScheduleDay: number;
}

export interface BqBillingRow {
  customer_name: string;
  cost: number;
  cost_at_list: number;
  currency: string;
  sku: { id: string | null; description: string };
  invoice: { month: string };
  usage: { amount: number; unit: string };
  system_labels: Array<{ key: string; value: string }>;
  cost_type: string;
  payer_billing_account_id: string;
  credits: Array<{ amount: number; type: string }>;
  entitlement_name: string | null;
}
