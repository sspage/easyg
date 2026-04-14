import { auth } from "./firebase";

const FUNCTIONS_URL = "https://api-mkcuchvdya-uc.a.run.app";
const BASE_URL = import.meta.env.DEV ? "/api" : `${FUNCTIONS_URL}/api`;

async function getHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not authenticated");
  }
  const token = await user.getIdToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers = await getHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.message || text;
    } catch {
      message = text;
    }
    throw new Error(`API ${method} ${path} failed (${res.status}): ${message}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

// ---------- Types (frontend-facing, no Timestamp dependency) ----------

export interface MarkupProfile {
  id: string;
  name: string;
  description: string;
  rates: {
    NEW: number;
    RENEWAL: number;
    TRANSFER: number;
  };
  isDefault: boolean;
  customerCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  googleCustomerName: string;
  domain: string | null;
  xeroContactId: string | null;
  xeroContactName: string | null;
  markupProfileId: string | null;
  markupProfileName?: string;
  isActive: boolean;
  firstSeen: string;
  lastBilled: string | null;
  overrideCount?: number;
  createdAt: string;
}

export interface CustomerOverride {
  id: string;
  customerId: string;
  overrideType: "TRANSFER" | "NEW" | "RENEWAL" | "CUSTOM";
  markupFactor: number;
  startMonth: string;
  endMonth: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface SkuMapping {
  id: string;
  skuName: string;
  category: string;
  revenueAccountCode: string;
  cosAccountCode: string;
  xeroItemCode: string | null;
  specialMarkup: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface Invoice {
  id: string;
  customerId: string;
  customerDomain: string | null;
  customerName: string;
  xeroContactId: string | null;
  phase: "DRAFT" | "SENT_TO_XERO" | "APPROVED" | "SENT_TO_CUSTOMER";
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
  lineItems?: LineItem[];
}

export interface BillingRunSummary {
  customerCount: number;
  invoiceCount: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  errorCount: number;
}

export interface BillingRun {
  id: string;
  billingPeriod: string;
  phase: "PROCESSED" | "REVIEWED" | "SENT_TO_XERO";
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  sentToXeroAt: string | null;
  triggeredBy: "manual" | "scheduled";
  summary: BillingRunSummary;
  invoices?: Invoice[];
}

export interface XeroStatus {
  connectionStatus: "connected" | "expired" | "disconnected";
  lastTokenRefresh: string | null;
  tokenExpiresAt: string | null;
  tenantId: string | null;
  lastSuccessfulCall: string | null;
}

export interface SystemSettings {
  exportDatasetId: string;
  autoScheduleEnabled: boolean;
  autoScheduleDay: number;
}

export interface DashboardData {
  xeroStatus: XeroStatus;
  lastBillingRun: BillingRun | null;
  totalCustomers: number;
  activeCustomers: number;
  unmappedSkuCount: number;
  alerts: DashboardAlert[];
}

export interface DashboardAlert {
  type: "error" | "warning" | "info";
  message: string;
}

// ---------- Markup Profiles ----------

export async function listMarkupProfiles(): Promise<MarkupProfile[]> {
  return request<MarkupProfile[]>("GET", "/markup-profiles");
}

export async function getMarkupProfile(id: string): Promise<MarkupProfile> {
  return request<MarkupProfile>("GET", `/markup-profiles/${id}`);
}

export async function createMarkupProfile(
  data: Omit<MarkupProfile, "id" | "createdAt" | "updatedAt" | "customerCount">
): Promise<MarkupProfile> {
  return request<MarkupProfile>("POST", "/markup-profiles", data);
}

export async function updateMarkupProfile(
  id: string,
  data: Partial<Omit<MarkupProfile, "id" | "createdAt" | "updatedAt">>
): Promise<MarkupProfile> {
  return request<MarkupProfile>("PUT", `/markup-profiles/${id}`, data);
}

export async function deleteMarkupProfile(id: string): Promise<void> {
  return request<void>("DELETE", `/markup-profiles/${id}`);
}

// ---------- Customers ----------

export async function listCustomers(): Promise<Customer[]> {
  return request<Customer[]>("GET", "/customers");
}

export async function getCustomer(id: string): Promise<Customer> {
  return request<Customer>("GET", `/customers/${id}`);
}

export async function updateCustomer(
  id: string,
  data: Partial<Omit<Customer, "id" | "createdAt">>
): Promise<Customer> {
  return request<Customer>("PUT", `/customers/${id}`, data);
}

// ---------- Customer Overrides ----------

export async function listCustomerOverrides(
  customerId: string
): Promise<CustomerOverride[]> {
  return request<CustomerOverride[]>(
    "GET",
    `/customers/${customerId}/overrides`
  );
}

export async function createCustomerOverride(
  customerId: string,
  data: Omit<CustomerOverride, "id" | "customerId" | "createdBy" | "createdAt">
): Promise<CustomerOverride> {
  return request<CustomerOverride>(
    "POST",
    `/customers/${customerId}/overrides`,
    data
  );
}

export async function updateCustomerOverride(
  customerId: string,
  overrideId: string,
  data: Partial<Omit<CustomerOverride, "id" | "customerId" | "createdBy" | "createdAt">>
): Promise<CustomerOverride> {
  return request<CustomerOverride>(
    "PUT",
    `/customers/${customerId}/overrides/${overrideId}`,
    data
  );
}

export async function deleteCustomerOverride(
  customerId: string,
  overrideId: string
): Promise<void> {
  return request<void>(
    "DELETE",
    `/customers/${customerId}/overrides/${overrideId}`
  );
}

// ---------- SKU Mappings ----------

export async function listSkuMappings(): Promise<SkuMapping[]> {
  return request<SkuMapping[]>("GET", "/sku-mappings");
}

export async function getSkuMapping(id: string): Promise<SkuMapping> {
  return request<SkuMapping>("GET", `/sku-mappings/${id}`);
}

export async function updateSkuMapping(
  id: string,
  data: Partial<Omit<SkuMapping, "id" | "createdAt" | "updatedAt">>
): Promise<SkuMapping> {
  return request<SkuMapping>("PUT", `/sku-mappings/${id}`, data);
}

export async function refreshSkuMappings(): Promise<{ newSkus: number }> {
  return request<{ newSkus: number }>("POST", "/sku-mappings/refresh");
}

// ---------- Billing Runs ----------

export async function listBillingRuns(): Promise<BillingRun[]> {
  return request<BillingRun[]>("GET", "/billing-runs");
}

export async function getBillingRun(id: string): Promise<BillingRun> {
  return request<BillingRun>("GET", `/billing-runs/${id}`);
}

export async function processBilling(
  month: string
): Promise<BillingRun> {
  return request<BillingRun>("POST", "/billing-runs/process", { month });
}

export async function sendToXero(runId: string): Promise<BillingRun> {
  return request<BillingRun>("POST", `/billing-runs/${runId}/send-to-xero`);
}

export async function batchSendToCustomers(
  runId: string
): Promise<BillingRun> {
  return request<BillingRun>(
    "POST",
    `/billing-runs/${runId}/batch-send`
  );
}

// ---------- Dashboard ----------

export async function getDashboard(): Promise<DashboardData> {
  return request<DashboardData>("GET", "/dashboard");
}

// ---------- Settings ----------

export async function getSystemSettings(): Promise<SystemSettings> {
  return request<SystemSettings>("GET", "/settings/system");
}

export async function updateSystemSettings(
  data: Partial<SystemSettings>
): Promise<SystemSettings> {
  return request<SystemSettings>("PUT", "/settings/system", data);
}

export async function getXeroStatus(): Promise<XeroStatus> {
  return request<XeroStatus>("GET", "/settings/xero");
}

export async function initiateXeroAuth(): Promise<{ authUrl: string }> {
  return request<{ authUrl: string }>("POST", "/settings/xero-auth");
}
