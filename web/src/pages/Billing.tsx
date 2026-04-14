import React, { useEffect, useState, useCallback } from "react";
import {
  listBillingRuns,
  getBillingRun,
  deleteBillingRun,
  processBilling,
  sendToXero,
  batchSendToCustomers,
  BillingRun,
  Invoice,
  LineItem,
} from "../services/api";
import DataTable, { Column } from "../components/DataTable";
import Modal from "../components/Modal";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "$0.00";
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "0.00%";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

function generateMonthOptions(): string[] {
  const months: string[] = [];
  const now = new Date();
  // Data available from Dec 2025 onward
  const earliest = new Date(2025, 11, 1); // Dec 2025
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    if (d < earliest) break;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

function displayCustomer(invoice: Invoice): string {
  // Show domain if available, otherwise extract short ID from resource name
  if (invoice.customerDomain) return invoice.customerDomain;
  const name = invoice.customerName || invoice.customerId || "";
  const match = name.match(/\/([^/]+)$/);
  return match ? match[1] : name;
}

function phaseVariant(phase: string): "info" | "warning" | "success" | "neutral" {
  switch (phase) {
    case "PROCESSING":
      return "neutral";
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
  const [isTestRun, setIsTestRun] = useState(false);
  const [viewModalRun, setViewModalRun] = useState<BillingRun | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
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

  // Poll for run list updates while any run is in "running" state
  const hasRunningRuns = runs.some((r) => r.status === "running") || processing || sendingToXero || batchSending;
  useEffect(() => {
    if (!hasRunningRuns) return;
    const interval = setInterval(async () => {
      const updated = await listBillingRuns();
      setRuns(updated);
      // Only update activeRun from polling if it's still running (no detailed data loaded yet).
      // Once the user clicks "View" and loads invoices, don't overwrite with the summary-only list data.
      if (activeRun && activeRun.status === "running") {
        const match = updated.find((r) => r.id === activeRun.id);
        if (match) {
          // Preserve invoices if we already loaded them
          if (activeRun.invoices) {
            setActiveRun({ ...match, invoices: activeRun.invoices });
          } else {
            setActiveRun(match);
          }
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [hasRunningRuns, activeRun]);

  async function handleProcess() {
    setProcessing(true);
    setError(null);
    setActionMessage(null);
    try {
      const run = await processBilling(selectedMonth.replace("-", ""), { isTestRun });
      setActiveRun(run);
      // Immediately refresh runs so the new run appears in the list and polling starts
      const updatedRuns = await listBillingRuns();
      setRuns(updatedRuns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
      // Always refresh runs so failed runs are visible too
      const finalRuns = await listBillingRuns();
      setRuns(finalRuns);
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
      await loadRuns();
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
      await loadRuns();
    }
  }

  async function handleDeleteRun(run: BillingRun) {
    if (!confirm(`Delete billing run for ${run.billingPeriod}? This cannot be undone.`)) return;
    try {
      await deleteBillingRun(run.id);
      if (activeRun?.id === run.id) setActiveRun(null);
      if (viewModalRun?.id === run.id) setViewModalRun(null);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete run");
    }
  }

  async function handleViewRun(run: BillingRun) {
    setViewLoading(true);
    setViewModalRun(run);
    setActiveRun(run);
    try {
      const detailed = await getBillingRun(run.id);
      setViewModalRun(detailed);
      setActiveRun(detailed);
      setExpandedInvoices(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing run details");
      setViewModalRun(null);
    } finally {
      setViewLoading(false);
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
    {
      key: "customerDisplay",
      header: "Customer",
      sortable: true,
      render: (row: Invoice) => displayCustomer(row),
      getValue: (row: Invoice) => displayCustomer(row),
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
    {
      key: "billingPeriod",
      header: "Period",
      sortable: true,
      render: (row: BillingRun) => (
        <>{row.billingPeriod}{row.isTestRun ? " " : ""}{row.isTestRun && <StatusBadge variant="warning" label="TEST" size="sm" />}</>
      ),
    },
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
        <div className="action-icons">
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); handleViewRun(row); }}
            title="View details"
          >&#128065;</button>
          {row.status !== "running" && (
            <button
              className="icon-btn icon-btn-danger"
              onClick={(e) => { e.stopPropagation(); handleDeleteRun(row); }}
              title="Delete run"
            >&#128465;</button>
          )}
        </div>
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
            <div className="form-group" title="Run calculations without sending to Xero. Use to verify billing against past periods.">
              <label className="toggle-label">
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={isTestRun}
                    onChange={(e) => setIsTestRun(e.target.checked)}
                    disabled={processing}
                  />
                  <span className="toggle-slider"></span>
                </span>
                <span className="toggle-text">Test Mode</span>
              </label>
            </div>
            <div className="form-group form-actions-inline">
              <button
                className={`btn ${isTestRun ? "btn-secondary" : "btn-primary"}`}
                onClick={handleProcess}
                disabled={processing}
              >
                {processing ? "Processing..." : isTestRun ? "Run Test" : "Process Billing (Phase 1)"}
              </button>
            </div>
          </div>
          {processing && <LoadingSpinner size={24} message="Processing billing data from BigQuery..." />}
        </div>
      </div>

      {activeRun && (
        <div className="card mt-2">
          <div className="card-header">
            <h3>
              Run: {activeRun.billingPeriod}{" "}
              <StatusBadge variant={statusVariant(activeRun.status)} label={activeRun.status.toUpperCase()} size="sm" />
              {" "}
              <StatusBadge variant={phaseVariant(activeRun.phase)} label={activeRun.phase.replace(/_/g, " ")} size="sm" />
              {activeRun.isTestRun && (
                <>
                  {" "}
                  <StatusBadge variant="warning" label="TEST RUN" size="sm" />
                </>
              )}
            </h3>
            <div className="btn-group">
              {!activeRun.isTestRun && activeRun.phase === "PROCESSED" && activeRun.status === "completed" && (
                <button className="btn btn-primary" onClick={handleSendToXero} disabled={sendingToXero}>
                  {sendingToXero ? "Sending..." : "Send to Xero"}
                </button>
              )}
              {!activeRun.isTestRun && activeRun.phase === "SENT_TO_XERO" && activeRun.status === "completed" && (
                <button className="btn btn-primary" onClick={handleBatchSend} disabled={batchSending}>
                  {batchSending ? "Approving..." : "Approve All in Xero"}
                </button>
              )}
              {activeRun.status === "completed" && (
                <button className="btn btn-secondary" onClick={() => handleViewRun(activeRun)}>
                  View Details
                </button>
              )}
            </div>
          </div>
          <div className="card-body">
            {activeRun.status === "running" && (
              <div className="progress-bar-container">
                <div className="progress-bar-track">
                  <div className="progress-bar-fill progress-bar-indeterminate"></div>
                </div>
                <span className="progress-text">
                  {activeRun.progress || "Starting..."}
                </span>
              </div>
            )}
            {activeRun.status === "completed" && activeRun.summary && (
              <div className="summary-bar">
                <span className="summary-stat"><strong>{activeRun.summary.invoiceCount}</strong> invoices</span>
                <span className="summary-stat">Cost: <strong>{formatCurrency(activeRun.summary.totalCost)}</strong></span>
                <span className="summary-stat">Revenue: <strong>{formatCurrency(activeRun.summary.totalRevenue)}</strong></span>
                <span className="summary-stat">Margin: <strong>{formatCurrency(activeRun.summary.totalMargin)}</strong></span>
                {activeRun.summary.totalRevenue > 0 && (
                  <span className="summary-stat">
                    <strong>{formatPercent((activeRun.summary.totalMargin / activeRun.summary.totalRevenue) * 100)}</strong>
                  </span>
                )}
                {activeRun.isTestRun && <span className="text-muted">Test run — review only</span>}
              </div>
            )}
            {activeRun.status === "failed" && (
              <div className="alert alert-error">Run failed. Check logs for details.</div>
            )}
          </div>
        </div>
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

      {viewModalRun && (
        <Modal open={true} title={`Billing Run: ${viewModalRun.billingPeriod}${viewModalRun.isTestRun ? " (TEST)" : ""}`} onClose={() => setViewModalRun(null)} width="900px">
          {viewLoading ? (
            <LoadingSpinner message="Loading run details..." />
          ) : (
            <>
              <div className="summary-bar mb-2">
                <StatusBadge variant={statusVariant(viewModalRun.status)} label={viewModalRun.status.toUpperCase()} size="sm" />
                <StatusBadge variant={phaseVariant(viewModalRun.phase)} label={viewModalRun.phase.replace(/_/g, " ")} size="sm" />
                {viewModalRun.isTestRun && <StatusBadge variant="warning" label="TEST" size="sm" />}
                <span className="summary-stat"><strong>{viewModalRun.summary?.invoiceCount ?? 0}</strong> invoices</span>
                <span className="summary-stat">Cost: <strong>{formatCurrency(viewModalRun.summary?.totalCost)}</strong></span>
                <span className="summary-stat">Revenue: <strong>{formatCurrency(viewModalRun.summary?.totalRevenue)}</strong></span>
                <span className="summary-stat">Margin: <strong>{formatCurrency(viewModalRun.summary?.totalMargin)}</strong></span>
              </div>

              {viewModalRun.invoices && viewModalRun.invoices.length > 0 ? (
                <div className="table-wrapper" style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Items</th>
                        <th>Cost</th>
                        <th>Revenue</th>
                        <th>Margin</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewModalRun.invoices.map((inv) => (
                        <React.Fragment key={inv.id}>
                          <tr className={`clickable ${expandedInvoices.has(inv.id) ? "expanded" : ""}`}
                              onClick={() => toggleInvoiceExpand(inv.id)}>
                            <td>{displayCustomer(inv)}</td>
                            <td>{inv.lineItemCount}</td>
                            <td>{formatCurrency(inv.totalCost)}</td>
                            <td>{formatCurrency(inv.totalRevenue)}</td>
                            <td>{formatCurrency(inv.totalMargin)}</td>
                            <td><StatusBadge variant={invoicePhaseVariant(inv.phase)} label={inv.phase.replace(/_/g, " ")} size="sm" /></td>
                          </tr>
                          {expandedInvoices.has(inv.id) && (
                            <tr className="expanded-row">
                              <td colSpan={6}>
                                {renderLineItems(inv)}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted">No invoice details available.</p>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
