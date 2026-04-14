import React, { useEffect, useState, useCallback } from "react";
import {
  listMarkupProfiles,
  createMarkupProfile,
  updateMarkupProfile,
  deleteMarkupProfile,
  listCustomers,
  MarkupProfile,
  Customer,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import LoadingSpinner from "../components/LoadingSpinner";
import Modal from "../components/Modal";

interface ProfileFormData {
  name: string;
  description: string;
  rateNew: number;
  rateRenewal: number;
  rateTransfer: number;
  isDefault: boolean;
}

const emptyForm: ProfileFormData = {
  name: "",
  description: "",
  rateNew: 1.25,
  rateRenewal: 1.25,
  rateTransfer: 1.25,
  isDefault: false,
};

export default function MarkupProfiles(): React.ReactElement {
  const [profiles, setProfiles] = useState<MarkupProfile[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [profResult, custResult] = await Promise.all([
        listMarkupProfiles(),
        listCustomers(),
      ]);
      setProfiles(profResult);
      setCustomers(custResult);
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

  function getCustomersForProfile(profileId: string): Customer[] {
    return customers.filter((c) => c.markupProfileId === profileId);
  }

  function getDefaultCustomers(): Customer[] {
    return customers.filter((c) => !c.markupProfileId);
  }

  function openCreateModal() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditModal(profile: MarkupProfile) {
    setEditingId(profile.id);
    setForm({
      name: profile.name,
      description: profile.description,
      rateNew: 1 + profile.rates.NEW,
      rateRenewal: 1 + profile.rates.RENEWAL,
      rateTransfer: 1 + profile.rates.TRANSFER,
      isDefault: profile.isDefault,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        rates: {
          NEW: form.rateNew - 1,
          RENEWAL: form.rateRenewal - 1,
          TRANSFER: form.rateTransfer - 1,
        },
        isDefault: form.isDefault,
      };
      if (editingId) {
        await updateMarkupProfile(editingId, payload);
      } else {
        await createMarkupProfile(payload);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(profile: MarkupProfile) {
    if (profile.isDefault) return;
    const custCount = getCustomersForProfile(profile.id).length;
    const msg = custCount > 0
      ? `This profile is assigned to ${custCount} customer(s). They will fall back to the default profile. Delete "${profile.name}"?`
      : `Delete profile "${profile.name}"?`;
    if (!confirm(msg)) return;
    try {
      await deleteMarkupProfile(profile.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    }
  }

  if (loading) {
    return <LoadingSpinner message="Loading markup profiles..." />;
  }

  const sortedProfiles = [...profiles].sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  function formatRate(rate: number): string {
    return (1 + rate).toFixed(4) + "x";
  }

  function formatRateAsPercent(rate: number): string {
    return (rate * 100).toFixed(2) + "%";
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>Markup Profiles</h1>
        <button className="btn btn-primary" onClick={openCreateModal}>
          Create Profile
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="profile-grid">
        {sortedProfiles.map((profile) => {
          const assignedCustomers = profile.isDefault
            ? getDefaultCustomers()
            : getCustomersForProfile(profile.id);

          return (
            <div key={profile.id} className={`card profile-card ${profile.isDefault ? "profile-card-default" : ""}`}>
              <div className="card-header">
                <h3>
                  {profile.name}
                  {profile.isDefault && (
                    <StatusBadge variant="info" label="DEFAULT" size="sm" />
                  )}
                </h3>
                <div className="btn-group">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => openEditModal(profile)}
                  >
                    Edit
                  </button>
                  {!profile.isDefault && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(profile)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="card-body">
                {profile.description && (
                  <p className="text-muted mb-1">{profile.description}</p>
                )}
                <div className="rate-grid">
                  <div className="rate-item">
                    <span className="rate-label">NEW</span>
                    <span className="rate-value">{formatRate(profile.rates.NEW)}</span>
                    <span className="rate-percent">{formatRateAsPercent(profile.rates.NEW)}</span>
                  </div>
                  <div className="rate-item">
                    <span className="rate-label">RENEWAL</span>
                    <span className="rate-value">{formatRate(profile.rates.RENEWAL)}</span>
                    <span className="rate-percent">{formatRateAsPercent(profile.rates.RENEWAL)}</span>
                  </div>
                  <div className="rate-item">
                    <span className="rate-label">TRANSFER</span>
                    <span className="rate-value">{formatRate(profile.rates.TRANSFER)}</span>
                    <span className="rate-percent">{formatRateAsPercent(profile.rates.TRANSFER)}</span>
                  </div>
                </div>

                <div className="profile-customers mt-1">
                  <h4>
                    Assigned Customers
                    <span className="count-badge">{assignedCustomers.length}</span>
                  </h4>
                  {assignedCustomers.length === 0 ? (
                    <p className="text-muted">No customers assigned</p>
                  ) : (
                    <ul className="customer-list">
                      {assignedCustomers.slice(0, 10).map((c) => (
                        <li key={c.id} className="customer-list-item">
                          {c.domain ?? c.googleCustomerName}
                        </li>
                      ))}
                      {assignedCustomers.length > 10 && (
                        <li className="customer-list-item text-muted">
                          ...and {assignedCustomers.length - 10} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={modalOpen}
        title={editingId ? "Edit Markup Profile" : "Create Markup Profile"}
        onClose={() => setModalOpen(false)}
        width="500px"
      >
        <div className="form-stack">
          <div className="form-group">
            <label>Profile Name</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Premium, Standard"
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              className="form-textarea"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div className="form-group">
            <label>NEW Rate (markup factor)</label>
            <input
              type="number"
              className="form-input"
              step="0.0001"
              min="0"
              value={form.rateNew}
              onChange={(e) => setForm({ ...form, rateNew: parseFloat(e.target.value) || 0 })}
            />
            <span className="form-hint">
              {form.rateNew > 0 ? `${((form.rateNew - 1) * 100).toFixed(2)}% markup` : ""}
            </span>
          </div>
          <div className="form-group">
            <label>RENEWAL Rate (markup factor)</label>
            <input
              type="number"
              className="form-input"
              step="0.0001"
              min="0"
              value={form.rateRenewal}
              onChange={(e) => setForm({ ...form, rateRenewal: parseFloat(e.target.value) || 0 })}
            />
            <span className="form-hint">
              {form.rateRenewal > 0 ? `${((form.rateRenewal - 1) * 100).toFixed(2)}% markup` : ""}
            </span>
          </div>
          <div className="form-group">
            <label>TRANSFER Rate (markup factor)</label>
            <input
              type="number"
              className="form-input"
              step="0.0001"
              min="0"
              value={form.rateTransfer}
              onChange={(e) => setForm({ ...form, rateTransfer: parseFloat(e.target.value) || 0 })}
            />
            <span className="form-hint">
              {form.rateTransfer > 0 ? `${((form.rateTransfer - 1) * 100).toFixed(2)}% markup` : ""}
            </span>
          </div>
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
            >
              {saving ? "Saving..." : editingId ? "Update Profile" : "Create Profile"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
