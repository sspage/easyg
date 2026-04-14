import React, { useEffect, useState, useCallback } from "react";
import {
  listSkuMappings,
  updateSkuMapping,
  refreshSkuMappings,
  SkuMapping,
} from "../services/api";
import DataTable, { Column } from "../components/DataTable";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";

export default function SkuMappings(): React.ReactElement {
  const [skus, setSkus] = useState<SkuMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterUnmapped, setFilterUnmapped] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await listSkuMappings();
      setSkus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SKU mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function isUnmapped(sku: SkuMapping): boolean {
    return !sku.revenueAccountCode || !sku.cosAccountCode;
  }

  function startEdit(id: string, field: string, currentValue: string) {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  }

  async function saveEdit() {
    if (!editingCell) return;
    try {
      const update: Record<string, string | number | null> = {};
      if (editingCell.field === "specialMarkup") {
        if (editValue === "" || editValue === "0") {
          update.specialMarkup = null;
        } else {
          const multiplier = parseFloat(editValue);
          if (isNaN(multiplier)) throw new Error("Invalid number");
          update.specialMarkup = multiplier - 1; // Convert 1.25x display to 0.25 storage
        }
      } else {
        update[editingCell.field] = editValue;
      }
      await updateSkuMapping(editingCell.id, update as Partial<SkuMapping>);
      const storedValue = editingCell.field === "specialMarkup" ? update.specialMarkup : editValue;
      setSkus((prev) =>
        prev.map((s) =>
          s.id === editingCell.id ? { ...s, [editingCell.field]: storedValue } : s
        )
      );
      setEditingCell(null);
      setEditValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update SKU mapping");
    }
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue("");
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await refreshSkuMappings();
      setSuccessMessage(
        result.newSkus > 0
          ? `Found ${result.newSkus} new SKU(s) from billing data.`
          : "No new SKUs found."
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh SKU mappings");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleToggleActive(sku: SkuMapping) {
    try {
      await updateSkuMapping(sku.id, { isActive: !sku.isActive });
      setSkus((prev) =>
        prev.map((s) => (s.id === sku.id ? { ...s, isActive: !s.isActive } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update SKU");
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading SKU mappings..." />;
  }

  const unmappedCount = skus.filter(isUnmapped).length;

  const filtered = skus.filter((s) => {
    if (filterUnmapped && !isUnmapped(s)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      s.skuName.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  function renderEditableCell(sku: SkuMapping, field: "revenueAccountCode" | "cosAccountCode" | "specialMarkup") {
    const isEditing = editingCell?.id === sku.id && editingCell?.field === field;
    const rawValue = sku[field];
    const displayValue = field === "specialMarkup"
      ? (rawValue != null ? `${(1 + Number(rawValue)).toFixed(4)}x` : "")
      : String(rawValue ?? "");
    const editInitValue = field === "specialMarkup"
      ? (rawValue != null ? String(1 + Number(rawValue)) : "")
      : String(rawValue ?? "");

    if (isEditing) {
      return (
        <div className="inline-edit">
          <input
            type="text"
            className="form-input form-input-sm"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={saveEdit}
            placeholder={field === "specialMarkup" ? "e.g. 1.25" : "Account code"}
            autoFocus
          />
        </div>
      );
    }

    const isEmpty = rawValue == null || rawValue === "";
    return (
      <span
        className={`editable-cell ${isEmpty ? "text-warning" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          startEdit(sku.id, field, editInitValue);
        }}
        title="Click to edit"
      >
        {displayValue || "(not set)"} <span className="edit-icon">&#9998;</span>
      </span>
    );
  }

  const columns: Column<SkuMapping>[] = [
    {
      key: "id",
      header: "SKU ID",
      sortable: true,
      render: (row: SkuMapping) => (
        <span className="mono-text">{row.id}</span>
      ),
    },
    {
      key: "skuName",
      header: "SKU Name",
      sortable: true,
      render: (row: SkuMapping) => (
        <span title={row.skuName} style={{ cursor: "help" }}>{row.skuName}</span>
      ),
    },
    { key: "category", header: "Category", sortable: true },
    {
      key: "revenueAccountCode",
      header: "Revenue Account",
      render: (row: SkuMapping) => renderEditableCell(row, "revenueAccountCode"),
    },
    {
      key: "cosAccountCode",
      header: "COS Account",
      render: (row: SkuMapping) => renderEditableCell(row, "cosAccountCode"),
    },
    {
      key: "specialMarkup",
      header: "Special Markup",
      sortable: true,
      render: (row: SkuMapping) => renderEditableCell(row, "specialMarkup"),
    },
    {
      key: "isActive",
      header: "Active",
      render: (row: SkuMapping) => (
        <button
          className={`btn btn-sm ${row.isActive ? "btn-success-outline" : "btn-secondary"}`}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleActive(row);
          }}
        >
          {row.isActive ? "Active" : "Inactive"}
        </button>
      ),
    },
    {
      key: "unmapped",
      header: "",
      width: "40px",
      render: (row: SkuMapping) =>
        isUnmapped(row) ? (
          <StatusBadge variant="warning" label="!" size="sm" />
        ) : null,
    },
  ];

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>SKU Mappings</h1>
        <div className="btn-group">
          {unmappedCount > 0 && (
            <StatusBadge variant="warning" label={`${unmappedCount} unmapped`} />
          )}
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh from Billing Data"}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMessage && <div className="alert alert-success">{successMessage}</div>}

      <div className="filter-bar mb-2">
        <input
          type="text"
          className="form-input"
          placeholder="Search by SKU ID, name, or category..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <label className="toggle-label" title="Filter to show only SKUs missing account code mappings">
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={filterUnmapped}
              onChange={(e) => setFilterUnmapped(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </span>
          <span className="toggle-text">Unmapped only</span>
        </label>
      </div>

      <DataTable<SkuMapping>
        columns={columns}
        data={filtered}
        keyField="id"
        emptyMessage={filterUnmapped ? "No unmapped SKUs" : "No SKU mappings found"}
      />
    </div>
  );
}
