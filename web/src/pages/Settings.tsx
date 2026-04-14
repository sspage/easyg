import React, { useEffect, useState, useCallback } from "react";
import {
  getSystemSettings,
  updateSystemSettings,
  getXeroStatus,
  initiateXeroAuth,
  SystemSettings,
  XeroStatus,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";

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

export default function Settings(): React.ReactElement {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [xeroStatus, setXeroStatus] = useState<XeroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const [autoScheduleEnabled, setAutoScheduleEnabled] = useState(false);
  const [autoScheduleDay, setAutoScheduleDay] = useState(5);

  const loadData = useCallback(async () => {
    try {
      const [settingsResult, xeroResult] = await Promise.all([
        getSystemSettings(),
        getXeroStatus(),
      ]);
      setSettings(settingsResult);
      setXeroStatus(xeroResult);
      setAutoScheduleEnabled(settingsResult.autoScheduleEnabled);
      setAutoScheduleDay(settingsResult.autoScheduleDay);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveSchedule() {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await updateSystemSettings({
        autoScheduleEnabled,
        autoScheduleDay,
      });
      setSettings(updated);
      setSuccessMessage("Settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleXeroAuth() {
    setAuthenticating(true);
    setError(null);
    try {
      const result = await initiateXeroAuth();
      window.location.href = result.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate Xero authentication");
      setAuthenticating(false);
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading settings..." />;
  }

  const dayOptions: number[] = [];
  for (let i = 1; i <= 28; i++) {
    dayOptions.push(i);
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMessage && <div className="alert alert-success">{successMessage}</div>}

      <div className="card">
        <div className="card-header">
          <h3>Xero Connection</h3>
        </div>
        <div className="card-body">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Status</span>
              <span className="info-value">
                {xeroStatus ? (
                  <StatusBadge
                    variant={xeroStatusVariant(xeroStatus.connectionStatus)}
                    label={xeroStatus.connectionStatus.toUpperCase()}
                  />
                ) : (
                  <StatusBadge variant="error" label="UNKNOWN" />
                )}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Last Token Refresh</span>
              <span className="info-value">
                {xeroStatus?.lastTokenRefresh
                  ? new Date(xeroStatus.lastTokenRefresh).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Token Expires</span>
              <span className="info-value">
                {xeroStatus?.tokenExpiresAt
                  ? new Date(xeroStatus.tokenExpiresAt).toLocaleString()
                  : "\u2014"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Tenant ID</span>
              <span className="info-value mono-text">
                {xeroStatus?.tenantId ?? "Not configured"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Last Successful Call</span>
              <span className="info-value">
                {xeroStatus?.lastSuccessfulCall
                  ? new Date(xeroStatus.lastSuccessfulCall).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
          <div className="mt-2">
            <button
              className="btn btn-primary"
              onClick={handleXeroAuth}
              disabled={authenticating}
            >
              {authenticating
                ? "Redirecting..."
                : xeroStatus?.connectionStatus === "connected"
                  ? "Re-authenticate with Xero"
                  : "Connect to Xero"}
            </button>
          </div>
        </div>
      </div>

      <div className="card mt-2">
        <div className="card-header">
          <h3>Auto-Schedule Billing</h3>
        </div>
        <div className="card-body">
          <div className="form-stack">
            <div className="form-group">
              <label className="toggle-label">
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoScheduleEnabled}
                    onChange={(e) => setAutoScheduleEnabled(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </span>
                <span className="toggle-text">
                  {autoScheduleEnabled ? "Enabled" : "Disabled"}
                </span>
              </label>
              <span className="form-hint">
                Automatically process billing on a set day each month.
              </span>
            </div>

            {autoScheduleEnabled && (
              <div className="form-group">
                <label>Day of Month</label>
                <select
                  className="form-select"
                  value={autoScheduleDay}
                  onChange={(e) => setAutoScheduleDay(parseInt(e.target.value, 10))}
                >
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}
                    </option>
                  ))}
                </select>
                <span className="form-hint">
                  Billing will be processed for the previous month on this day.
                </span>
              </div>
            )}

            <div className="form-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveSchedule}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Schedule Settings"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-2">
        <div className="card-header">
          <h3>System Information</h3>
        </div>
        <div className="card-body">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Project ID</span>
              <span className="info-value mono-text">white-dispatch-481617-f8</span>
            </div>
            <div className="info-item">
              <span className="info-label">BigQuery Dataset</span>
              <span className="info-value mono-text">
                {settings?.exportDatasetId ?? "billing_new"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Region</span>
              <span className="info-value mono-text">us-central1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
