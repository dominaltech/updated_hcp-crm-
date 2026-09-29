import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

export const DEFAULT_EXPENSE_CATEGORIES = [
  {
    id: 'owner',
    name: 'Owner Expenses',
    purposes: ['Travel', 'Fuel Vehical', 'Personal', 'Medince', 'Other']
  },
  {
    id: 'store',
    name: 'Store Expenses',
    purposes: ['Market', 'Milk', 'Fuel Hotel', 'Transport Expensess Store', 'Home', 'Fuel DG', 'Other']
  },
  {
    id: 'maintenance',
    name: 'Maintainance Expenses',
    purposes: ['Purchase or material', 'AMC', 'Carpenter', 'Plumber', 'Water Heater', 'AC', 'DG', 'colouring painter', 'POP', 'Civil Work', 'Other']
  },
  {
    id: 'other',
    name: 'Other',
    purposes: ['Other']
  }
];

export const DEFAULT_EXPENSE_OWNERS = [
  { id: '1', name: 'Jaijeet Gadekar', phone: '' },
  { id: '2', name: 'Respected Mahesh Sir', phone: '' }
];

export function ExpenseCategoriesMasterContent({ categories, owners, onSaveSuccess, onCancel }) {
  const { showToast } = useApp();
  const [activeSubTab, setActiveSubTab] = useState('owners'); // 'owners' | 'categories'
  const [draftOwners, setDraftOwners] = useState([]);
  const [draftCategories, setDraftCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState('owner');
  const [newPurposeText, setNewPurposeText] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerPhone, setNewOwnerPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (Array.isArray(owners) && owners.length > 0 && Array.isArray(categories) && categories.length > 0) {
      setDraftOwners(JSON.parse(JSON.stringify(owners)));
      setDraftCategories(JSON.parse(JSON.stringify(categories)));
    } else {
      // Standalone mode: fetch directly from server API
      api.getExpenseCategoriesConfig()
        .then((res) => {
          if (res && res.success) {
            if (Array.isArray(res.owners) && res.owners.length > 0) {
              setDraftOwners(res.owners);
            } else {
              setDraftOwners(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_OWNERS)));
            }
            if (Array.isArray(res.categories) && res.categories.length > 0) {
              setDraftCategories(res.categories);
            } else {
              setDraftCategories(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)));
            }
          } else {
            setDraftOwners(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_OWNERS)));
            setDraftCategories(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)));
          }
        })
        .catch(() => {
          setDraftOwners(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_OWNERS)));
          setDraftCategories(JSON.parse(JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)));
        });
    }
  }, [owners, categories]);

  const handleOwnerPhoneChange = (idx, val) => {
    const clean = val.replace(/\D/g, '').slice(0, 10);
    const updated = [...draftOwners];
    updated[idx].phone = clean;
    setDraftOwners(updated);
  };

  const handleOwnerNameChange = (idx, val) => {
    const updated = [...draftOwners];
    updated[idx].name = val;
    setDraftOwners(updated);
  };

  const handleDeleteOwner = (idx) => {
    if (draftOwners.length <= 1) {
      showToast('At least one owner profile must remain.', 'orange');
      return;
    }
    const updated = draftOwners.filter((_, i) => i !== idx);
    setDraftOwners(updated);
  };

  const handleAddOwner = (e) => {
    e.preventDefault();
    if (!newOwnerName.trim()) {
      showToast('Owner name is required.', 'red');
      return;
    }
    const newOwner = {
      id: String(Date.now()),
      name: newOwnerName.trim(),
      phone: newOwnerPhone.replace(/\D/g, '').slice(0, 10)
    };
    setDraftOwners([...draftOwners, newOwner]);
    setNewOwnerName('');
    setNewOwnerPhone('');
    showToast(`Added owner: ${newOwner.name}`, 'green');
  };

  const handleAddPurpose = (e) => {
    e.preventDefault();
    const cleanP = newPurposeText.trim();
    if (!cleanP) return;

    setDraftCategories((prev) =>
      prev.map((c) => {
        if (c.id === selectedCatId) {
          if (c.purposes.includes(cleanP)) {
            showToast('Purpose already exists in this category.', 'orange');
            return c;
          }
          return { ...c, purposes: [...c.purposes, cleanP] };
        }
        return c;
      })
    );
    setNewPurposeText('');
  };

  const handleDeletePurpose = (catId, purposeNameToRemove) => {
    setDraftCategories((prev) =>
      prev.map((c) => {
        if (c.id === catId) {
          if (c.purposes.length <= 1) {
            showToast('A category must have at least one purpose.', 'orange');
            return c;
          }
          return { ...c, purposes: c.purposes.filter((p) => p !== purposeNameToRemove) };
        }
        return c;
      })
    );
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const res = await api.updateExpenseCategoriesConfig({
        categories: draftCategories,
        owners: draftOwners
      });
      if (res && res.success) {
        showToast('Debit categories & owners saved successfully!', 'green');
        if (onSaveSuccess) onSaveSuccess(draftCategories, draftOwners);
      } else {
        showToast('Failed to save settings: ' + (res?.error || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Error saving settings: ' + err.message, 'red');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCategory = draftCategories.find((c) => c.id === selectedCatId) || draftCategories[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('owners')}
          style={{
            padding: '8px 16px',
            borderRadius: '10px',
            border: activeSubTab === 'owners' ? '1.5px solid #059669' : '1px solid #cbd5e1',
            background: activeSubTab === 'owners' ? '#ecfdf5' : '#ffffff',
            color: activeSubTab === 'owners' ? '#047857' : '#475569',
            fontWeight: 850,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>👤</span> Owners &amp; WhatsApp Mobile
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('categories')}
          style={{
            padding: '8px 16px',
            borderRadius: '10px',
            border: activeSubTab === 'categories' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
            background: activeSubTab === 'categories' ? '#f0f9ff' : '#ffffff',
            color: activeSubTab === 'categories' ? '#0369a1' : '#475569',
            fontWeight: 850,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>🏷️</span> Debit Categories &amp; Child Purposes
        </button>
      </div>

      {/* TAB 1: OWNERS & WHATSAPP */}
      {activeSubTab === 'owners' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '12px', padding: '12px 16px', fontSize: '0.82rem', color: '#166534', lineHeight: 1.5 }}>
            <strong>📱 Instant WhatsApp Receipt Alert:</strong> When Front Desk records an expense under <em>Owner Expenses</em>, they can choose the owner here. The system can immediately dispatch the debit voucher / receipt details to their WhatsApp mobile number.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
              Registered Owners Directory ({draftOwners.length})
            </h4>

            {draftOwners.map((owner, idx) => (
              <div
                key={owner.id || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1.5fr auto',
                  gap: '12px',
                  alignItems: 'center',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '10px 14px'
                }}
              >
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 750, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                    Owner Name
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={owner.name}
                    onChange={(e) => handleOwnerNameChange(idx, e.target.value)}
                    style={{ height: '36px', fontWeight: 750 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 750, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                    WhatsApp Mobile Number (10 digits)
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: '10px', fontSize: '0.82rem', color: '#64748b', fontWeight: 750 }}>
                      +91
                    </span>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="e.g. 9876543210"
                      maxLength={10}
                      value={owner.phone || ''}
                      onChange={(e) => handleOwnerPhoneChange(idx, e.target.value)}
                      style={{ height: '36px', paddingLeft: '44px', fontWeight: 800, color: '#047857' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', paddingBottom: '2px' }}>
                  <button
                    type="button"
                    onClick={() => handleDeleteOwner(idx)}
                    title="Remove Owner"
                    style={{
                      height: '36px',
                      padding: '0 12px',
                      background: '#fff1f2',
                      border: '1px solid #fecaca',
                      color: '#dc2626',
                      borderRadius: '8px',
                      fontWeight: 750,
                      cursor: 'pointer'
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add Owner Form */}
          <div style={{ background: '#f8fafc', border: '1.5px dashed #cbd5e1', borderRadius: '12px', padding: '14px 18px' }}>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '0.86rem', fontWeight: 850, color: '#334155' }}>
              + Add New Owner Profile
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr auto', gap: '12px', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 750, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                  New Owner Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Respected Director Sir"
                  value={newOwnerName}
                  onChange={(e) => setNewOwnerName(e.target.value)}
                  style={{ height: '36px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 750, color: '#64748b', display: 'block', marginBottom: '2px' }}>
                  WhatsApp Phone Number
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="10-digit number"
                  maxLength={10}
                  value={newOwnerPhone}
                  onChange={(e) => setNewOwnerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  style={{ height: '36px' }}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={handleAddOwner}
                style={{ height: '36px', padding: '0 18px', fontWeight: 800, background: '#059669' }}
              >
                + Add Owner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CATEGORIES & PURPOSES */}
      {activeSubTab === 'categories' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Category Select Pills */}
          <div>
            <label style={{ fontSize: '0.76rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '6px' }}>
              Select Category to Manage Purposes:
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {draftCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCatId(c.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '20px',
                    border: selectedCatId === c.id ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: selectedCatId === c.id ? '#0284c7' : '#ffffff',
                    color: selectedCatId === c.id ? '#ffffff' : '#334155',
                    fontWeight: 850,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    boxShadow: selectedCatId === c.id ? '0 2px 8px rgba(2, 132, 199, 0.25)' : 'none'
                  }}
                >
                  {c.name} ({c.purposes.length})
                </button>
              ))}
            </div>
          </div>

          {/* Active Category Purpose Editor Card */}
          {selectedCategory && (
            <div style={{ background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '14px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                    {selectedCategory.name} &mdash; Child Purposes
                  </h4>
                  <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    These purposes populate the child dropdown in the expense &amp; debit voucher forms.
                  </span>
                </div>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, background: '#e0f2fe', color: '#0369a1', padding: '3px 10px', borderRadius: '12px' }}>
                  {selectedCategory.purposes.length} Purpose(s)
                </span>
              </div>

              {/* Purpose Chips Grid */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
                {selectedCategory.purposes.map((p) => {
                  const isOther = p.toLowerCase() === 'other';
                  return (
                    <div
                      key={p}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: isOther ? '#fef3c7' : '#f1f5f9',
                        border: isOther ? '1.5px solid #fcd34d' : '1px solid #cbd5e1',
                        color: isOther ? '#92400e' : '#1e293b',
                        padding: '6px 12px',
                        borderRadius: '16px',
                        fontSize: '0.84rem',
                        fontWeight: 750
                      }}
                    >
                      <span>{p}</span>
                      {!isOther && (
                        <button
                          type="button"
                          onClick={() => handleDeletePurpose(selectedCategory.id, p)}
                          title={`Delete "${p}"`}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#dc2626',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            lineHeight: 1,
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Purpose to Category */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder={`Add new purpose to ${selectedCategory.name}...`}
                  value={newPurposeText}
                  onChange={(e) => setNewPurposeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPurpose(e);
                    }
                  }}
                  style={{ height: '38px', flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleAddPurpose}
                  style={{ height: '38px', padding: '0 18px', fontWeight: 800, background: '#0284c7' }}
                >
                  + Add Purpose
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1.5px solid #e2e8f0', paddingTop: '14px', marginTop: '6px' }}>
        {onCancel && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            style={{ height: '40px', padding: '0 18px', fontWeight: 750 }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={isSaving}
          onClick={handleSaveAll}
          style={{
            height: '40px',
            padding: '0 24px',
            fontWeight: 850,
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>{isSaving ? '⏳' : '💾'}</span>
          {isSaving ? 'Saving Master Settings...' : 'Save Master Settings'}
        </button>
      </div>
    </div>
  );
}

export default function ExpenseCategoriesMasterModal({ isOpen, onClose, categories, owners, onSaveSuccess }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay active" style={{ zIndex: 10070, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="modal-container"
        style={{
          maxWidth: '720px',
          width: '95%',
          borderRadius: '18px',
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          border: '1.5px solid #cbd5e1',
          background: '#ffffff'
        }}
      >
        <div
          className="modal-header"
          style={{
            padding: '16px 22px',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🏷️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#fff' }}>
                Debit &amp; Receipt Categories Master
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: '#94a3b8' }}>
                Configure Dropdown Categories, Child Purposes &amp; Owner WhatsApp Alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            className="universal-close-btn"
            onClick={onClose}
            style={{ color: '#fff', background: 'transparent', border: 'none', fontSize: '1.6rem', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px', maxHeight: '78vh', overflowY: 'auto' }}>
          <ExpenseCategoriesMasterContent
            categories={categories}
            owners={owners}
            onSaveSuccess={(newCats, newOwners) => {
              if (onSaveSuccess) onSaveSuccess(newCats, newOwners);
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
