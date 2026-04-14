import {
  Invoice as XeroInvoice,
  LineItem as XeroLineItem,
  Contact,
  LineAmountTypes,
} from "xero-node";
import { db } from "../config";
import { getXeroClient } from "./auth";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Read the Xero tenant ID from Firestore.
 */
async function getTenantId(): Promise<string> {
  const doc = await db.doc("settings/xero").get();
  const data = doc.data();
  if (!data?.tenantId) {
    throw new Error("Xero tenant ID not configured. Complete OAuth flow first.");
  }
  return data.tenantId;
}

export interface DraftLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string;
  itemCode?: string;
  trackingCategories?: Array<{ name: string; option: string }>;
}

export interface TrackingCategory {
  name: string;
  option: string;
}

/**
 * Map our line items to the Xero SDK format.
 */
function toXeroLineItems(
  lineItems: DraftLineItem[],
  trackingCategories?: TrackingCategory[],
): XeroLineItem[] {
  return lineItems.map((li) => {
    const xeroLi: XeroLineItem = {
      description: li.description,
      quantity: li.quantity,
      unitAmount: li.unitAmount,
      accountCode: li.accountCode,
      itemCode: li.itemCode ?? undefined,
      lineAmount: li.quantity * li.unitAmount,
    };

    const tracking = li.trackingCategories ?? trackingCategories;
    if (tracking && tracking.length > 0) {
      xeroLi.tracking = tracking.map((tc) => ({
        name: tc.name,
        option: tc.option,
      }));
    }

    return xeroLi;
  });
}

/**
 * Record a successful Xero API call timestamp.
 */
async function recordSuccessfulCall(): Promise<void> {
  await db.doc("settings/xero").set(
    { lastSuccessfulCall: Timestamp.now() },
    { merge: true },
  );
}

/**
 * Create a DRAFT sales invoice (ACCREC) in Xero.
 */
export async function createDraftInvoice(
  contactId: string,
  lineItems: DraftLineItem[],
  reference: string,
  date: string,
  trackingCategories?: TrackingCategory[],
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const xero = await getXeroClient();
  const tenantId = await getTenantId();

  const invoice: XeroInvoice = {
    type: XeroInvoice.TypeEnum.ACCREC,
    contact: { contactID: contactId },
    lineItems: toXeroLineItems(lineItems, trackingCategories),
    date: date,
    dueDate: date,
    reference: reference,
    status: XeroInvoice.StatusEnum.DRAFT,
    lineAmountTypes: LineAmountTypes.Exclusive,
  };

  const response = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoice],
  });

  const created = response.body?.invoices?.[0];
  if (!created?.invoiceID) {
    throw new Error("Failed to create draft invoice in Xero");
  }

  await recordSuccessfulCall();

  return {
    invoiceId: created.invoiceID,
    invoiceNumber: created.invoiceNumber ?? "",
  };
}

/**
 * Create a DRAFT bill (ACCPAY) in Xero.
 */
export async function createDraftBill(
  contactId: string,
  lineItems: DraftLineItem[],
  reference: string,
  date: string,
  trackingCategories?: TrackingCategory[],
): Promise<{ billId: string; billNumber: string }> {
  const xero = await getXeroClient();
  const tenantId = await getTenantId();

  const bill: XeroInvoice = {
    type: XeroInvoice.TypeEnum.ACCPAY,
    contact: { contactID: contactId },
    lineItems: toXeroLineItems(lineItems, trackingCategories),
    date: date,
    dueDate: date,
    reference: reference,
    status: XeroInvoice.StatusEnum.DRAFT,
    lineAmountTypes: LineAmountTypes.Exclusive,
  };

  const response = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [bill],
  });

  const created = response.body?.invoices?.[0];
  if (!created?.invoiceID) {
    throw new Error("Failed to create draft bill in Xero");
  }

  await recordSuccessfulCall();

  return {
    billId: created.invoiceID,
    billNumber: created.invoiceNumber ?? "",
  };
}

/**
 * Find an existing Xero contact by name, or create one if it does not exist.
 */
export async function findOrCreateContact(
  name: string,
  domain: string | null,
): Promise<string> {
  const xero = await getXeroClient();
  const tenantId = await getTenantId();

  // Search by exact name.
  try {
    const searchResponse = await xero.accountingApi.getContacts(
      tenantId,
      undefined, // ifModifiedSince
      `Name=="${name.replace(/"/g, "")}"`, // where clause
    );

    const contacts = searchResponse.body?.contacts ?? [];
    if (contacts.length > 0 && contacts[0].contactID) {
      return contacts[0].contactID;
    }
  } catch {
    // Contact not found by search, will create a new one.
  }

  // Create a new contact.
  const newContact: Contact = {
    name,
    emailAddress: domain ? `billing@${domain}` : undefined,
    contactStatus: Contact.ContactStatusEnum.ACTIVE,
  };

  const createResponse = await xero.accountingApi.createContacts(tenantId, {
    contacts: [newContact],
  });

  const created = createResponse.body?.contacts?.[0];
  if (!created?.contactID) {
    throw new Error(`Failed to create Xero contact for ${name}`);
  }

  await recordSuccessfulCall();

  return created.contactID;
}

/**
 * Batch-approve a list of invoices in Xero.
 */
export async function batchApproveInvoices(
  invoiceIds: string[],
): Promise<void> {
  if (invoiceIds.length === 0) return;

  const xero = await getXeroClient();
  const tenantId = await getTenantId();

  const invoices: XeroInvoice[] = invoiceIds.map((id) => ({
    invoiceID: id,
    status: XeroInvoice.StatusEnum.AUTHORISED,
  }));

  await xero.accountingApi.updateOrCreateInvoices(tenantId, {
    invoices,
  });

  await recordSuccessfulCall();
}

/**
 * Retrieve chart of accounts codes for validation purposes.
 */
export async function getAccountCodes(): Promise<
  Array<{ code: string; name: string; type: string }>
> {
  const xero = await getXeroClient();
  const tenantId = await getTenantId();

  const response = await xero.accountingApi.getAccounts(tenantId);
  const accounts = response.body?.accounts ?? [];

  await recordSuccessfulCall();

  return accounts.map((a) => ({
    code: a.code ?? "",
    name: a.name ?? "",
    type: a.type?.toString() ?? "",
  }));
}
