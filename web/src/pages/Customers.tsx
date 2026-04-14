import React, { useEffect, useState, useCallback } from "react";
import {
  listCustomers,
  updateCustomer,
  listMarkupProfiles,
  listCustomerOverrides,
  createCustomerOverride,
  deleteCustomerOverride,
  Customer,
  MarkupProfile,
  CustomerOverride,
} from "../services/api";
import DataTable, { Column } from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import Modal from "../components/Modal";

function formatCurrency(amount: number): string {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface OverrideFormData {
  overrideType: "TRANSFER" | "NEW" | "RENEWAL" | "CUSTOM";
  markupFactor: number;
  startMonth: string;
  endMonth: string;
  notes: string;
}

const emptyOverrideForm: OverrideFormData = {
  overrideType: "NEW",
  markupFactor: 1.25,
  startMonth: "",
  endMonth: "",
  notes: "",
};

export default function Customers(): React.ReactElement {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profiles, setProfiles] = useState<MarkupProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());
  const [customerOverrides, setCustomerOverrides] = useState<Record<string, CustomerOverride[]>>({});
  const [loadingOverrides, setLoadingOverrides] = useState<Set<string>>(new Set());

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideCustomerId, setOverrideCustomerId] = useState<string | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideFormData>(emptyOverrideForm);
  const [savingOverride, setSavingOverride] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [custResult, profResult] = await Promise.all([
        listCustomers(),
        listMarkupProfiles(),
      ]);
      setCustomers(custResult);
      setProfiles(profResult);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function loadOverrides(customerId: string) {
    if (customerOverrides[customerId] || loadingOverrides.has(customerId)) return;
    setLoadingOverrides((prev) => new Set(prev).add(customerId));
    try {
      const overrides = await listCustomerOverrides(customerId);
      setCustomerOverrides((prev) => ({ ...prev, [customerId]: overrides }));
    } catch {
      // silently fail - user will see empty overrides
    } finally {
      setLoadingOverrides((prev) => {
        const next = new Set(prev);
        next.delete(customerId);
        return next;
      });
    }
  }

  function toggleExpand(customerId: string) {
    setExpandedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
        loadOverrides(customerId);
      }
      return next;
    });
  }

  async function handleProfileChange(customerId: string, profileId: string) {
    try {
      await updateCustomer(customerId, { markupProfileId: profileId || null });
      setCustomers((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, markupProfileId: profileId || null } : c))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update customer");
    }
  }

  function openOverrideModal(customerId: string) {
    setOverrideCustomerId(customerId);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setOverrideForm({ ...emptyOverrideForm, startMonth: month });
    setOverrideModalOpen(true);
  }

  async function handleSaveOverride() {
    if (!overrideCustomerId) return;
    setSavingOverride(true);
    try {
      const payload = {
        overrideType: overrideForm.overrideType,
        markupFactor: overrideForm.markupFactor - 1,
        startMonth: overrideForm.startMonth,
        endMonth: overrideForm.endMonth || null,
        notes: overrideForm.notes,
      };
      const created = await createCustomerOverride(overrideCustomerId, payload);
      setCustomerOverrides((prev) => ({
        ...prev,
        [overrideCustomerId]: [...(prev[overrideCustomerId] ?? []), created],
      }));
      setOverrideModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create override");
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleDeleteOverride(customerId: string, overrideId: string) {
    if (!confirm("Delete this override?")) return;
    try {
      await deleteCustomerOverride(customerId, overrideId);
      setCustomerOverrides((prev) => ({
        ...prev,
        [customerId]: (prev[customerId] ?? []).filter((o) => o.id !== overrideId),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete override");
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading customers..." />;
  }

  const filtered = customers.filter((c) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      (c.googleCustomerName?.toLowerCase().includes(q)) ||
      (c.domain?.toLowerCase().includes(q)) ||
      (c.markupProfileName?.toLowerCase().includes(q))
    );
  });

  const columns: Column<Customer>[] = [
    {
      key: "expand",
      header: "",
      width: "40px",
      render: (row: Customer) => (
        <button
          className="btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(row.id);
          }}
        >
          {expandedCustomers.has(row.id) ? "\u25BC" : "\u25B6"}
        </button>
      ),
    },
    { key: "googleCustomerName", header: "Customer Name", sortable: true },
    {
      key: "domain",
      header: "Domain",
      sortable: true,
      render: (row: Customer) => row.domain ?? "\u2014",
    },
    {
      key: "markupProfileId",
      header: "Markup Profile",
      render: (row: Customer) => (
        <select
          className="form-select form-select-sm"
          value={row.markupProfileId ?? ""}
          onChange={(e) => handleProfileChange(row.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">-- Default --</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "overrideCount",
      header: "Overrides",
      sortable: true,
      render: (row: Customer) => {
        const count = row.overrideCount ?? customerOverrides[row.id]?.length ?? 0;
        return count > 0 ? (
          <StatusBadge variant="warning" label={String(count)} size="sm" />
        ) : (
          "0"
        );
      },
    },
    {
      key: "lastBilled",
      header: "Last Billed",
      sortable: true,
      render: (row: Customer) => row.lastBilled ?? "Never",
    },
    {
      key: "xeroContactId",
      header: "Xero",
      render: (row: Customer) =>
        row.xeroContactId ? (
          <StatusBadge variant="success" label="Linked" size="sm" />
        ) : (
          <StatusBadge variant="neutral" label="Unlinked" size="sm" />
        ),
    },
    {
      key: "isActive",
      header: "Active",
      render: (row: Customer) =>
        row.isActive ? (
          <StatusBadge variant="success" label="Yes" size="sm" />
        ) : (
          <StatusBadge variant="neutral" label="No" size="sm" />
        ),
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (row: Customer) => (
        <button
          className="btn btn-sm btn-secondary"
          onClick={(e) => {
            e.stopPropagation();
            openOverrideModal(row.id);
          }}
        >
          Add Override
        </button>
      ),
    },
  ];

  function renderExpandedCustomer(row: Customer) {
    const overrides = customerOverrides[row.id];
    const isLoading = loadingOverrides.has(row.id);

    return (
      <div className="expanded-content">
        <div className="info-grid mb-1">
          <div className="info-item">
            <span className="info-label">Google Customer Name</span>
            <span className="info-value">{row.googleCustomerName}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Domain</span>
            <span className="info-value">{row.domain ?? "\u2014"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Xero Contact</span>
            <span className="info-value">{row.xeroContactName ?? "Not linked"}</span>
          </div>
          <div className="info-item">
            <span className="info-label">First Seen</span>
            <span className="info-value">{row.firstSeen}</span>
          </div>
        </div>

        <h4>Overrides</h4>
        {isLoading ? (
          <LoadingSpinner size={20} />
        ) : !overrides || overrides.length === 0 ? (
          <p className="text-muted">No active overrides</p>
        ) : (
          <table className="data-table nested-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Markup Factor</th>
                <th>Start</th>
                <th>End</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td>{o.overrideType}</td>
                  <td>{(1 + o.markupFactor).toFixed(4)}x</td>
                  <td>{o.startMonth}</td>
                  <td>{o.endMonth ?? "Ongoing"}</td>
                  <td>{o.notes || "\u2014"}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDeleteOverride(row.id, o.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Customers</h1>
        <span className="text-muted">{filtered.length} of {customers.length} customers</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="search-bar mb-2">
        <input
          type="text"
          className="form-input"
          placeholder="Search by name, domain, or profile..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <DataTable<Customer>
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage="No customers found"
        expandedRows={expandedCustomers}
        expandedRowRender={(row) => renderExpandedCustomer(row)}
        onRowClick={(row) => toggleExpand(row.id)}
      />

      <Modal
        open={overrideModalOpen}
        title="Add Customer Override"
        onClose={() => setOverrideModalOpen(false)}
        width="500px"
      >
        <div className="form-stack">
          <div className="form-group">
            <label>Override Type</label>
            <select
              className="form-select"
              value={overrideForm.overrideType}
              onChange={(e) =>
                setOverrideForm({ ...overrideForm, overrideType: e.target.value as OverrideFormData["overrideType"] })
              }
            >
              <option value="NEW">NEW</option>
              <option value="RENEWAL">RENEWAL</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
          <div className="form-group">
            <label>Markup Factor</label>
            <input
              type="number"
              className="form-input"
              step="0.0001"
              min="0"
              value={overrideForm.markupFactor}
              onChange={(e) =>
                setOverrideForm({ ...overrideForm, markupFactor: parseFloat(e.target.value) || 0 })
              }
            />
            <span className="form-hint">e.g. 1.25 = 25% markup</span>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Start Month</label>
              <input
                type="month"
                className="form-input"
                value={overrideForm.startMonth}
                onChange={(e) => setOverrideForm({ ...overrideForm, startMonth: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>End Month (optional)</label>
              <input
                type="month"
                className="form-input"
                value={overrideForm.endMonth}
                onChange={(e) => setOverrideForm({ ...overrideForm, endMonth: e.target.value })}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Notes</label>
            <textarea
              className="form-textarea"
              rows={3}
              value={overrideForm.notes}
              onChange={(e) => setOverrideForm({ ...overrideForm, notes: e.target.value })}
            />
          </div>
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setOverrideModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveOverride}
              disabled={savingOverride || !overrideForm.startMonth}
            >
              {savingOverride ? "Saving..." : "Create Override"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
