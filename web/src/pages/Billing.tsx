import React, { useEffect, useState, useCallback } from "react";
import {
  listBillingRuns,
  getBillingRun,
  processBilling,
  sendToXero,
  batchSendToCustomers,
  BillingRun,
  Invoice,
  LineItem,
} from "../services/api";
import DataTable, { Column } from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";

function formatCurrency(amount: number): string {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

function generateMonthOptions(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

function phaseVariant(phase: string): "info" | "warning" | "success" {
  switch (phase) {
    case "PROCESSED":
      return "info";
    case "REVIEWED":
      return "warning";
    case "SENT_TO_XERO":
      return "success";
    default:
      return "info";
  }
}

function statusVariant(status: string): "success" | "info" | "error" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "info";
    case "failed":
      return "error";
    default:
      return "info";
  }
}

function invoicePhaseVariant(phase: string): "info" | "warning" | "success" | "neutral" {
  switch (phase) {
    case "DRAFT":
      return "neutral";
    case "SENT_TO_XERO":
      return "info";
    case "APPROVED":
      return "warning";
    case "SENT_TO_CUSTOMER":
      return "success";
    default:
      return "neutral";
  }
}

export default function Billing(): React.ReactElement {
  const monthOptions = generateMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[1] ?? monthOptions[0]);
  const [runs, setRuns] = useState<BillingRun[]>([]);
  const [activeRun, setActiveRun] = useState<BillingRun | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [sendingToXero, setSendingToXero] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const result = await listBillingRuns();
      setRuns(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  async function handleProcess() {
    setProcessing(true);
    setError(null);
    setActionMessage(null);
    try {
      // Convert YYYY-MM to YYYYMM for the backend
      const run = await processBilling(selectedMonth.replace("-", ""));
      setActiveRun(run);
      setActionMessage(`Billing processed for ${selectedMonth}. ${run.summary.invoiceCount} invoices generated.`);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  async function handleSendToXero() {
    if (!activeRun) return;
    setSendingToXero(true);
    setError(null);
    setActionMessage(null);
    try {
      const run = await sendToXero(activeRun.id);
      setActiveRun(run);
      setActionMessage("Invoices sent to Xero successfully.");
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send to Xero");
    } finally {
      setSendingToXero(false);
    }
  }

  async function handleBatchSend() {
    if (!activeRun) return;
    setBatchSending(true);
    setError(null);
    setActionMessage(null);
    try {
      const run = await batchSendToCustomers(activeRun.id);
      setActiveRun(run);
      setActionMessage("All invoices approved in Xero. Use Xero to email them to customers.");
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch send failed");
    } finally {
      setBatchSending(false);
    }
  }

  async function handleViewRun(run: BillingRun) {
    try {
      const detailed = await getBillingRun(run.id);
      setActiveRun(detailed);
      setExpandedInvoices(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing run details");
    }
  }

  function toggleInvoiceExpand(invoiceId: string) {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  }

  if (loading) {
    return <LoadingSpinner message="Loading billing data..." />;
  }

  const invoices = activeRun?.invoices ?? [];
  const summaryTotals = activeRun
    ? {
        count: invoices.length,
        revenue: invoices.reduce((s, inv) => s + inv.totalRevenue, 0),
        cost: invoices.reduce((s, inv) => s + inv.totalCost, 0),
        margin: invoices.reduce((s, inv) => s + inv.totalMargin, 0),
      }
    : null;

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: "expand",
      header: "",
      width: "40px",
      render: (row: Invoice) => (
        <button
          className="btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            toggleInvoiceExpand(row.id);
          }}
        >
          {expandedInvoices.has(row.id) ? "\u25BC" : "\u25B6"}
        </button>
      ),
    },
    { key: "customerName", header: "Customer", sortable: true },
    {
      key: "customerDomain",
      header: "Domain",
      sortable: true,
      render: (row: Invoice) => row.customerDomain ?? "\u2014",
    },
    {
      key: "phase",
      header: "Status",
      render: (row: Invoice) => (
        <StatusBadge variant={invoicePhaseVariant(row.phase)} label={row.phase.replace(/_/g, " ")} size="sm" />
      ),
    },
    { key: "lineItemCount", header: "Items", sortable: true },
    {
      key: "totalCost",
      header: "Cost",
      sortable: true,
      render: (row: Invoice) => formatCurrency(row.totalCost),
    },
    {
      key: "totalRevenue",
      header: "Revenue",
      sortable: true,
      render: (row: Invoice) => formatCurrency(row.totalRevenue),
    },
    {
      key: "totalMargin",
      header: "Margin",
      sortable: true,
      render: (row: Invoice) => (
        <span className={row.totalMargin < 0 ? "text-danger" : ""}>
          {formatCurrency(row.totalMargin)}
          {row.totalRevenue > 0 && (
            <span className="text-muted ml-1">
              ({formatPercent((row.totalMargin / row.totalRevenue) * 100)})
            </span>
          )}
        </span>
      ),
    },
    {
      key: "errorMessage",
      header: "",
      width: "40px",
      render: (row: Invoice) =>
        row.errorMessage ? (
          <span className="text-danger" title={row.errorMessage}>
            !
          </span>
        ) : null,
    },
  ];

  const runColumns: Column<BillingRun>[] = [
    { key: "billingPeriod", header: "Period", sortable: true },
    {
      key: "phase",
      header: "Phase",
      render: (row: BillingRun) => (
        <StatusBadge variant={phaseVariant(row.phase)} label={row.phase.replace(/_/g, " ")} size="sm" />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: BillingRun) => (
        <StatusBadge variant={statusVariant(row.status)} label={row.status.toUpperCase()} size="sm" />
      ),
    },
    {
      key: "summary.invoiceCount",
      header: "Invoices",
      getValue: (row: BillingRun) => row.summary.invoiceCount,
      render: (row: BillingRun) => String(row.summary.invoiceCount),
    },
    {
      key: "summary.totalRevenue",
      header: "Revenue",
      getValue: (row: BillingRun) => row.summary.totalRevenue,
      render: (row: BillingRun) => formatCurrency(row.summary.totalRevenue),
    },
    {
      key: "triggeredBy",
      header: "Trigger",
      render: (row: BillingRun) => row.triggeredBy,
    },
    {
      key: "startedAt",
      header: "Started",
      sortable: true,
      render: (row: BillingRun) =>
        row.startedAt ? new Date(row.startedAt).toLocaleString() : "\u2014",
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      render: (row: BillingRun) => (
        <button className="btn btn-sm btn-secondary" onClick={() => handleViewRun(row)}>
          View
        </button>
      ),
    },
  ];

  function renderLineItems(invoice: Invoice) {
    const items = invoice.lineItems ?? [];
    if (items.length === 0) {
      return <p className="text-muted p-1">No line items available. Load full run details to view.</p>;
    }
    return (
      <table className="data-table nested-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Cost</th>
            <th>Markup</th>
            <th>Price</th>
            <th>Margin</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: LineItem, idx: number) => (
            <tr key={idx}>
              <td title={item.skuId}>{item.skuName}</td>
              <td>{item.subscriptionType}</td>
              <td>{item.quantity}</td>
              <td>{formatCurrency(item.costAmount)}</td>
              <td>{(1 + item.markupFactor).toFixed(4)}x</td>
              <td>{formatCurrency(item.customerPrice)}</td>
              <td className={item.margin < 0 ? "text-danger" : ""}>{formatCurrency(item.margin)}</td>
              <td>
                <StatusBadge
                  variant={item.appliedRule === "default" ? "neutral" : item.appliedRule === "override" ? "warning" : "info"}
                  label={item.appliedRule}
                  size="sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Billing</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {actionMessage && <div className="alert alert-success">{actionMessage}</div>}

      <div className="card">
        <div className="card-header">
          <h3>Process Billing</h3>
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="month-select">Billing Month</label>
              <select
                id="month-select"
                className="form-select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={processing}
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group form-actions-inline">
              <button
                className="btn btn-primary"
                onClick={handleProcess}
                disabled={processing}
              >
                {processing ? "Processing..." : "Process Billing (Phase 1)"}
              </button>
            </div>
          </div>
          {processing && <LoadingSpinner size={24} message="Processing billing data from BigQuery..." />}
        </div>
      </div>

      {activeRun && (
        <>
          <div className="card mt-2">
            <div className="card-header">
              <h3>
                Run: {activeRun.billingPeriod}{" "}
                <StatusBadge variant={statusVariant(activeRun.status)} label={activeRun.status.toUpperCase()} size="sm" />
                {" "}
                <StatusBadge variant={phaseVariant(activeRun.phase)} label={activeRun.phase.replace(/_/g, " ")} size="sm" />
              </h3>
              <div className="btn-group">
                {activeRun.phase === "PROCESSED" && activeRun.status === "completed" && (
                  <button
                    className="btn btn-primary"
                    onClick={handleSendToXero}
                    disabled={sendingToXero}
                  >
                    {sendingToXero ? "Sending..." : "Send to Xero (Phase 3)"}
                  </button>
                )}
                {activeRun.phase === "SENT_TO_XERO" && activeRun.status === "completed" && (
                  <button
                    className="btn btn-primary"
                    onClick={handleBatchSend}
                    disabled={batchSending}
                  >
                    {batchSending ? "Approving..." : "Approve All in Xero"}
                  </button>
                )}
              </div>
            </div>
            <div className="card-body">
              {summaryTotals && (
                <div className="summary-bar">
                  <div className="summary-item">
                    <span className="summary-label">Invoices</span>
                    <span className="summary-value">{summaryTotals.count}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Total Revenue</span>
                    <span className="summary-value">{formatCurrency(summaryTotals.revenue)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Total Cost</span>
                    <span className="summary-value">{formatCurrency(summaryTotals.cost)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Total Margin</span>
                    <span className="summary-value">{formatCurrency(summaryTotals.margin)}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Margin %</span>
                    <span className="summary-value">
                      {summaryTotals.revenue > 0
                        ? formatPercent((summaryTotals.margin / summaryTotals.revenue) * 100)
                        : "\u2014"}
                    </span>
                  </div>
                </div>
              )}

              <DataTable<Invoice>
                columns={invoiceColumns}
                data={invoices}
                keyField="id"
                emptyMessage="No invoices in this run"
                expandedRows={expandedInvoices}
                expandedRowRender={(row) => renderLineItems(row)}
                onRowClick={(row) => toggleInvoiceExpand(row.id)}
              />
            </div>
          </div>
        </>
      )}

      <div className="card mt-2">
        <div className="card-header">
          <h3>Billing Run History</h3>
        </div>
        <div className="card-body">
          <DataTable<BillingRun>
            columns={runColumns}
            data={runs}
            keyField="id"
            emptyMessage="No billing runs yet"
          />
        </div>
      </div>
    </div>
  );
}
