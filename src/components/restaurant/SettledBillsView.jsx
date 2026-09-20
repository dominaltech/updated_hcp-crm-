import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import BillEditModal from './BillEditModal';

export default function SettledBillsView({ onPrintBill, onResettle, department = 'restaurant' }) {
  const { showToast, showConfirm } = useApp();

  const [bills, setBills] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingBill, setEditingBill] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSettledBills = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = department === 'bar'
        ? await api.getBarSettledBills()
        : await api.getRestaurantSettledBills();
      const list = Array.isArray(data) ? data : (data?.orders || data?.bills || []);
      setBills(list);
    } catch (err) {
      showToast(`Error loading ${department} settled bills: ` + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [department, showToast]);

  useEffect(() => {
    loadSettledBills();
  }, [loadSettledBills]);

  const filteredBills = bills.filter((b) => {
    if (dateFrom && b.created_at < dateFrom) return false;
    if (dateTo && b.created_at > `${dateTo}T23:59:59`) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchOrder = String(b.id).includes(q) || (b.order_number && String(b.order_number).toLowerCase().includes(q));
      const matchTable = (b.table_name && b.table_name.toLowerCase().includes(q)) || (b.table_number && String(b.table_number).toLowerCase().includes(q));
      const matchCust = b.customer_name && b.customer_name.toLowerCase().includes(q);
      return matchOrder || matchTable || matchCust;
    }
    return true;
  });

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(filteredBills.map((b) => b.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleDeleteSelected = async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const confirmed = await showConfirm({
      title: `Delete ${count} Settled Bills?`,
      message: `Are you sure you want to permanently delete ${count} settled bill records?`,
      icon: '🗑️',
      confirmText: 'Delete Selected',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      for (const id of selectedIds) {
        if (department === 'bar') {
          await api.delete(`/bar/orders/${id}`);
        } else {
          await api.deleteRestaurantSettledBill(id);
        }
      }
      showToast(`${count} bills deleted.`, 'green');
      setSelectedIds(new Set());
      loadSettledBills();
    } catch (err) {
      showToast('Error deleting bills: ' + err.message, 'red');
    }
  };

  return (
    <div className="rest-sub-content active" id="rest-subview-settled">
      {/* Toolbar */}
      <div
        className="section-toolbar"
        style={{
          marginBottom: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>From:</span>
            <input
              type="date"
              className="form-input form-input-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: '140px' }}
            />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>To:</span>
            <input
              type="date"
              className="form-input form-input-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: '140px' }}
            />
          </div>
          <input
            type="text"
            className="form-input form-input-sm"
            placeholder="Search Order # or Table..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '220px' }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <span>✕</span> Clear Dates
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadSettledBills}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <span>🔄</span> Refresh
          </button>
        </div>

        {selectedIds.size > 0 && (
          <button
            type="button"
            className="btn-danger"
            onClick={handleDeleteSelected}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              fontWeight: 750,
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <span>🗑️</span> Delete Selected ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="settled-table-container">
        <table className="owner-rooms-table" id="settled-bills-table">
          <thead>
            <tr>
              <th style={{ width: '50px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={filteredBills.length > 0 && selectedIds.size === filteredBills.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  style={{ cursor: 'pointer', width: '19px', height: '19px', accentColor: '#0071e3' }}
                />
              </th>
              <th>Order #</th>
              <th>Table / Counter</th>
              <th>Token</th>
              <th>Items Ordered</th>
              <th>Grand Total</th>
              <th>Payment Mode</th>
              <th>Settled At</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBills.map((b) => {
              const isEdited = (b.resettle_count > 0) || (Array.isArray(b.logs) && b.logs.length > 0) || Boolean(b.is_edited);

              return (
                <tr
                  key={b.id}
                  onClick={() => setEditingBill(b)}
                  style={{
                    cursor: 'pointer',
                    background: isEdited ? '#fffdf0' : '#ffffff',
                    borderLeft: isEdited ? '4.5px solid #f59e0b' : '4px solid transparent',
                    transition: 'background 0.15s ease'
                  }}
                  title="Click row to edit, add/remove items, or view audit logs"
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(b.id)}
                      onChange={() => handleToggleSelect(b.id)}
                      style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: '#0071e3' }}
                    />
                  </td>
                  <td style={{ fontWeight: 800 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: isEdited ? '#b45309' : '#0f172a' }}>
                        #{b.order_number || b.id}
                      </span>
                      {isEdited && (
                        <span
                          style={{
                            background: '#fef3c7',
                            color: '#b45309',
                            border: '1px solid #fde68a',
                            padding: '2px 7px',
                            borderRadius: '6px',
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          ✏️ EDITED (v{(b.resettle_count || 1) + 1})
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{b.table_name || (b.table_number ? `Table ${b.table_number}` : 'Walk-in')}</td>
                  <td>
                    <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.8rem' }}>
                      Token #{b.token_number || 1}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.items_summary || (Array.isArray(b.items) ? b.items.map((i) => `${i.name} (${i.qty || i.quantity || 1})`).join(', ') : 'Dining Items')}
                  </td>
                  <td style={{ fontWeight: 850, color: isEdited ? '#b45309' : '#0f172a' }}>
                    {formatCurrency(b.grand_total || b.total || b.total_amount)}
                  </td>
                  <td>
                    <span style={{ textTransform: 'uppercase', fontSize: '0.76rem', fontWeight: 800, background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px' }}>
                      {b.payment_mode || 'Cash'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {formatDateTime(b.created_at || b.settled_at)}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="filter-chip"
                      onClick={() => setEditingBill(b)}
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        marginRight: '6px',
                        background: isEdited ? '#fef3c7' : '#f1f5f9',
                        color: isEdited ? '#b45309' : '#0f172a',
                        border: isEdited ? '1px solid #fde68a' : '1px solid #cbd5e1'
                      }}
                      title="Edit this bill: add/remove items and resettle"
                    >
                      ✏️ Edit Bill
                    </button>
                    <button
                      type="button"
                      className="filter-chip"
                      onClick={() => onPrintBill && onPrintBill(b)}
                      style={{ fontSize: '0.76rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      🖨️ Reprint
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredBills.length === 0 && !isLoading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            No settled bills found matching the selected dates or search query.
          </div>
        )}
      </div>

      {/* Bill Edit & Resettle Modal */}
      {editingBill && (
        <BillEditModal
          isOpen={Boolean(editingBill)}
          bill={editingBill}
          department={department}
          onClose={() => setEditingBill(null)}
          onSaveSuccess={() => {
            loadSettledBills();
            if (onResettle) onResettle();
          }}
          onReprint={(billData) => {
            if (onPrintBill) onPrintBill(billData);
          }}
        />
      )}
    </div>
  );
}

