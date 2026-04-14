import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getDashboard,
  DashboardData,
  DashboardAlert,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";

function formatCurrency(amount: number): string {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

function xeroStatusVariant(status: string): "success" | "warning" | "error" {
  switch (status) {
    case "connected":
      return "success";
    case "expired":
      return "warning";
    default:
      return "error";
  }
}

function alertVariant(type: DashboardAlert["type"]): "error" | "warning" | "info" {
  return type;
}

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getDashboard();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!data) return <></>;

  const lastRun = data.lastBillingRun;
  const marginPercent =
    lastRun && lastRun.summary.totalRevenue > 0
      ? (lastRun.summary.totalMargin / lastRun.summary.totalRevenue) * 100
      : 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Dashboard</h1>
        <button
          className="btn btn-primary"
          onClick={() => navigate("/billing")}
        >
          Process Billing
        </button>
      </div>

      <div className="card-grid">
        <div className="card">
          <div className="card-header">
            <h3>Xero Connection</h3>
          </div>
          <div className="card-body card-center">
            <StatusBadge
              variant={xeroStatusVariant(data.xeroStatus.connectionStatus)}
              label={data.xeroStatus.connectionStatus.toUpperCase()}
            />
            {data.xeroStatus.lastTokenRefresh && (
              <p className="text-muted mt-1">
                Last refresh: {new Date(data.xeroStatus.lastTokenRefresh).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Total Customers</h3>
          </div>
          <div className="card-body card-center">
            <span className="stat-number">{data.totalCustomers}</span>
            <span className="stat-label">{data.activeCustomers} active</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Last Run Revenue</h3>
          </div>
          <div className="card-body card-center">
            <span className="stat-number">
              {lastRun ? formatCurrency(lastRun.summary.totalRevenue) : "\u2014"}
            </span>
            <span className="stat-label">
              {lastRun ? `${lastRun.billingPeriod}` : "No runs yet"}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Total Margin</h3>
          </div>
          <div className="card-body card-center">
            <span className="stat-number">
              {lastRun ? formatCurrency(lastRun.summary.totalMargin) : "\u2014"}
            </span>
            <span className="stat-label">
              {lastRun ? formatPercent(marginPercent) : ""}
            </span>
          </div>
        </div>
      </div>

      {lastRun && (
        <div className="card mt-2">
          <div className="card-header">
            <h3>Last Billing Run</h3>
            <StatusBadge
              variant={lastRun.status === "completed" ? "success" : lastRun.status === "running" ? "info" : "error"}
              label={lastRun.status.toUpperCase()}
            />
          </div>
          <div className="card-body">
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Period</span>
                <span className="info-value">{lastRun.billingPeriod}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Phase</span>
                <span className="info-value">{lastRun.phase.replace(/_/g, " ")}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Invoices</span>
                <span className="info-value">{lastRun.summary.invoiceCount}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Total Cost</span>
                <span className="info-value">{formatCurrency(lastRun.summary.totalCost)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Total Revenue</span>
                <span className="info-value">{formatCurrency(lastRun.summary.totalRevenue)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Errors</span>
                <span className="info-value">
                  {lastRun.summary.errorCount > 0 ? (
                    <StatusBadge variant="error" label={String(lastRun.summary.errorCount)} size="sm" />
                  ) : (
                    "0"
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {data.alerts.length > 0 && (
        <div className="card mt-2">
          <div className="card-header">
            <h3>Alerts</h3>
          </div>
          <div className="card-body">
            <ul className="alert-list">
              {data.alerts.map((alert, i) => (
                <li key={i} className={`alert-item alert-item-${alert.type}`}>
                  <StatusBadge variant={alertVariant(alert.type)} label={alert.type.toUpperCase()} size="sm" />
                  <span className="alert-message">{alert.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {data.unmappedSkuCount > 0 && (
        <div className="card mt-2">
          <div className="card-header">
            <h3>Unmapped SKUs</h3>
          </div>
          <div className="card-body">
            <p>
              <StatusBadge variant="warning" label={`${data.unmappedSkuCount} unmapped`} size="sm" />
              {" "}SKUs require account code mapping before billing.
            </p>
            <button className="btn btn-secondary mt-1" onClick={() => navigate("/sku-mappings")}>
              View SKU Mappings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
