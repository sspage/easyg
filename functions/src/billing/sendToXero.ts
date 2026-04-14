import { db } from "../config";
import { Timestamp } from "firebase-admin/firestore";
import { Invoice, LineItem, BillingRun } from "../types";
import {
  createDraftInvoice,
  createDraftBill,
  findOrCreateContact,
  DraftLineItem,
} from "../xero/client";

/**
 * Phase 3: Push billing run drafts to Xero as DRAFT invoices and bills.
 *
 * For each invoice in the billing run:
 *   1. Resolve or create the Xero contact.
 *   2. Build line items for the ACCREC invoice (revenue side) and ACCPAY bill (cost side).
 *   3. Create both in Xero as DRAFTs.
 *   4. Update Firestore with the Xero IDs.
 *
 * Finally, update the billing run phase to SENT_TO_XERO.
 */
export async function sendToXero(billingRunId: string): Promise<void> {
  const runRef = db.collection("billingRuns").doc(billingRunId);
  const runSnap = await runRef.get();

  if (!runSnap.exists) {
    throw new Error(`Billing run ${billingRunId} not found`);
  }

  const runData = runSnap.data() as BillingRun;

  if (runData.status !== "completed") {
    throw new Error(
      `Billing run ${billingRunId} is not in completed status (current: ${runData.status})`,
    );
  }

  // Allow retry if there were errors in the previous send attempt
  if (runData.phase === "SENT_TO_XERO" && runData.summary.errorCount === 0) {
    throw new Error(`Billing run ${billingRunId} has already been fully sent to Xero`);
  }

  // Load all invoices for this run.
  const invoicesSnap = await runRef.collection("invoices").get();

  if (invoicesSnap.empty) {
    throw new Error(`No invoices found for billing run ${billingRunId}`);
  }

  const billingPeriod = runData.billingPeriod;
  // Format as YYYY-MM for Xero date fields (first day of billing month).
  const year = billingPeriod.substring(0, 4);
  const month = billingPeriod.substring(4, 6);
  const invoiceDate = `${year}-${month}-01`;

  let errorCount = 0;

  for (const invoiceDoc of invoicesSnap.docs) {
    const invoiceData = invoiceDoc.data() as Invoice;
    const invoiceRef = invoiceDoc.ref;

    try {
      // Skip invoices that were already fully sent (both invoice and bill created).
      if (invoiceData.xeroInvoiceId && invoiceData.xeroBillId) {
        continue;
      }

      // 1. Resolve or create Xero contact.
      let xeroContactId = invoiceData.xeroContactId;

      if (!xeroContactId) {
        const contactName =
          invoiceData.customerName || invoiceData.customerId;
        xeroContactId = await findOrCreateContact(
          contactName,
          invoiceData.customerDomain,
        );

        // Store the contact ID on the invoice and customer doc.
        await invoiceRef.update({ xeroContactId });

        const customerRef = db
          .collection("customers")
          .doc(invoiceData.customerId);
        await customerRef.set(
          {
            xeroContactId,
            xeroContactName: contactName,
          },
          { merge: true },
        );
      }

      // 2. Load line items.
      const lineItemsSnap = await invoiceRef.collection("lineItems").get();
      const lineItems = lineItemsSnap.docs.map(
        (d) => d.data() as LineItem,
      );

      // 3. Build Xero line items for ACCREC invoice (revenue side).
      const revenueLines: DraftLineItem[] = lineItems.map((li) => ({
        description: `${li.skuName} (${li.subscriptionType})`,
        quantity: 1,
        unitAmount: li.customerPrice,
        accountCode: li.revenueAccountCode,
      }));

      // 4. Build Xero line items for ACCPAY bill (cost side).
      const costLines: DraftLineItem[] = lineItems.map((li) => ({
        description: `${li.skuName} (${li.subscriptionType})`,
        quantity: 1,
        unitAmount: li.costAmount,
        accountCode: li.cosAccountCode,
      }));

      const reference = `${billingPeriod}-${invoiceData.customerId}`;

      // 5. Create DRAFT invoice (ACCREC) — save ID immediately to prevent duplicates on retry.
      if (!invoiceData.xeroInvoiceId) {
        const invoiceResult = await createDraftInvoice(
          xeroContactId,
          revenueLines,
          reference,
          invoiceDate,
        );
        await invoiceRef.update({
          xeroInvoiceId: invoiceResult.invoiceId,
          xeroInvoiceNumber: invoiceResult.invoiceNumber,
        });
      }

      // 6. Create DRAFT bill (ACCPAY) — save ID immediately to prevent duplicates on retry.
      if (!invoiceData.xeroBillId) {
        const billResult = await createDraftBill(
          xeroContactId,
          costLines,
          reference,
          invoiceDate,
        );
        await invoiceRef.update({
          xeroBillId: billResult.billId,
          xeroBillNumber: billResult.billNumber,
        });
      }

      // 7. Mark as sent.
      await invoiceRef.update({
        phase: "SENT_TO_XERO",
        errorMessage: null,
      });
    } catch (err) {
      errorCount++;
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(
        `Error sending invoice ${invoiceDoc.id} to Xero:`,
        err,
      );
      await invoiceRef.update({
        errorMessage: `Xero push failed: ${errorMessage}`,
      });
    }
  }

  // Update billing run phase — only advance to SENT_TO_XERO if all invoices succeeded.
  // If there were errors, keep phase as PROCESSED so the user can retry.
  await runRef.update({
    phase: errorCount === 0 ? "SENT_TO_XERO" : "PROCESSED",
    sentToXeroAt: Timestamp.now(),
    "summary.errorCount": errorCount,
  });
}
