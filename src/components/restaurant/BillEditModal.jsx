import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export default function BillEditModal({
  isOpen,
  onClose,
  bill,
  department = 'restaurant',
  onSaveSuccess,
  onReprint
}) {
  const { showToast, surchargeSettings } = useApp();
  const cardPct = surchargeSettings?.card_surcharge_pct !== undefined ? Number(surchargeSettings.card_surcharge_pct) : 2.5;
  const upiPct = surchargeSettings?.upi_tax_pct !== undefined ? Number(surchargeSettings.upi_tax_pct) : 0.4;
  const upiThresh = surchargeSettings?.upi_tax_threshold !== undefined ? Number(surchargeSettings.upi_tax_threshold) : 2000;

  const [items, setItems] = useState([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [discountPct, setDiscountPct] = useState(0);
  const [auditReason, setAuditReason] = useState('');
  const [menuList, setMenuList] = useState([]);
  const [searchMenuQuery, setSearchMenuQuery] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load Order details, full items array, and audit logs
  useEffect(() => {
    if (!isOpen || !bill) return;

    let initialItems = [];
    if (Array.isArray(bill.items)) {
      initialItems = bill.items.map((it) => ({
        id: it.id || it.item_id || Math.random(),
        name: it.name,
        price: Number(it.price) || 0,
        qty: Number(it.qty || it.quantity || 1),
        is_veg: it.is_veg !== undefined ? it.is_veg : 1
      }));
    }
    setItems(initialItems);
    setPaymentMode(bill.payment_mode || 'cash');
    setDiscountPct(bill.discount_pct || 0);
    setAuditReason('');

    // Fetch full order details & logs from server
    setIsLoadingDetails(true);
    const fetchPromise = department === 'bar'
      ? api.getBarOrderDetail(bill.id)
      : api.getRestaurantOrderDetail(bill.id);

    fetchPromise
      .then((res) => {
        if (res && res.order) {
          const ord = res.order;
          if (Array.isArray(ord.items) && ord.items.length > 0) {
            setItems(ord.items.map((it) => ({
              id: it.id || it.item_id || Math.random(),
              name: it.name,
              price: Number(it.price) || 0,
              qty: Number(it.qty || it.quantity || 1),
              is_veg: it.is_veg !== undefined ? it.is_veg : 1
            })));
          }
          if (ord.payment_mode) setPaymentMode(ord.payment_mode);
        }
        if (res && (res.logs || res.audit_logs)) {
          setAuditLogs(res.logs || res.audit_logs || []);
        }
      })
      .catch((err) => {
        console.warn('Error fetching order details:', err);
      })
      .finally(() => {
        setIsLoadingDetails(false);
      });

    // Fetch menu catalog for adding new items
    const menuPromise = department === 'bar' ? api.getBarMenu() : api.getRestaurantMenu();
    menuPromise
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.items || data?.dishes || []);
        setMenuList(list);
      })
      .catch((e) => console.warn('Error loading menu catalog:', e));
  }, [isOpen, bill, department]);

  // Recalculate Financials
  const subtotal = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  }, [items]);

  const discountAmt = Math.round((subtotal * (parseFloat(discountPct) || 0)) / 100);
  const taxable = Math.max(0, subtotal - discountAmt);
  const gst = Math.round(taxable * 0.05); // 5% GST
  const grandTotal = taxable + gst;

  const cardFee = (paymentMode === 'card' && cardPct > 0) ? Math.round((grandTotal * cardPct) / 100) : 0;
  const upiFee = ((paymentMode === 'online' || paymentMode === 'upi') && grandTotal > upiThresh && upiPct > 0) ? Math.round((grandTotal * upiPct) / 100) : 0;
  const finalPayable = grandTotal + cardFee + upiFee;

  const originalTotal = Number(bill?.grand_total || bill?.total || 0);
  const totalDiff = grandTotal - originalTotal;

  // Filtered menu for adding new items
  const filteredCatalog = useMemo(() => {
    if (!searchMenuQuery.trim()) return menuList.slice(0, 8);
    const q = searchMenuQuery.toLowerCase().trim();
    return menuList.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      (m.shortcode && String(m.shortcode).toLowerCase().includes(q.replace('#', '')))
    ).slice(0, 15);
  }, [menuList, searchMenuQuery]);

  const handleAddItemFromMenu = (dish) => {
    setItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.id === dish.id || it.name.toLowerCase() === dish.name.toLowerCase());
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx].qty = (copy[existingIdx].qty || 1) + 1;
        return copy;
      }
      return [
        ...prev,
        {
          id: dish.id,
          name: dish.name,
          price: Number(dish.price) || 0,
          qty: 1,
          is_veg: dish.is_veg !== undefined ? dish.is_veg : 1
        }
      ];
    });
    setSearchMenuQuery('');
    showToast(`Added "${dish.name}" to bill`, 'info', 1500);
  };

  const handleUpdateQty = (idx, delta) => {
    setItems((prev) => {
      const copy = [...prev];
      const nextQty = (copy[idx].qty || 1) + delta;
      if (nextQty <= 0) {
        return copy.filter((_, i) => i !== idx);
      }
      copy[idx].qty = nextQty;
      return copy;
    });
  };

  const handleRemoveItem = (idx) => {
    const item = items[idx];
    setItems((prev) => prev.filter((_, i) => i !== idx));
    showToast(`Removed "${item.name}" from bill`, 'info', 1500);
  };

  const handleSaveResettle = async () => {
    if (items.length === 0) {
      showToast('Cannot save a bill with 0 items. Please add at least 1 item.', 'red');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        items,
        updated_items: items,
        payment_mode: paymentMode,
        card_surcharge: cardFee,
        cardSurcharge: cardFee,
        upi_tax: upiFee,
        upiTax: upiFee,
        discount_pct: parseFloat(discountPct) || 0,
        audit_reason: auditReason.trim() || 'Bill item modification'
      };

      const res = department === 'bar'
        ? await api.resettleBarOrder(bill.id, payload)
        : await api.resettleRestaurantOrder(bill.id, payload);

      showToast('Bill successfully updated & resettled!', 'green');
      if (onSaveSuccess) onSaveSuccess(res.order || res);
      onClose();
    } catch (err) {
      showToast('Error resettling bill: ' + err.message, 'red');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReprintCurrent = () => {
    if (onReprint) {
      const billData = {
        ...bill,
        items,
        items_json: items,
        subtotal,
        tax: gst,
        total: grandTotal,
        grand_total: grandTotal,
        grandTotal,
        payment_mode: paymentMode,
        card_surcharge: cardFee,
        cardSurcharge: cardFee,
        upi_tax: upiFee,
        upiTax: upiFee,
        is_revised: true,
        resettle_count: (bill.resettle_count || 0) + 1
      };
      onReprint(billData);
    }
  };

  if (!isOpen || !bill) return null;

  return (
    <div
      className="modal-backdrop-fixed"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10060,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        className="modal-card modal-container"
        style={{
          maxWidth: '920px',
          width: '95%',
          maxHeight: '88vh',
          background: 'var(--bg-surface, #ffffff)',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
          border: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1.5px solid var(--border-color, #f1f5f9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface-secondary, #f8fafc)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.8rem', padding: '6px 10px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              ✏️
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                  Edit &amp; Resettle Bill #{bill.order_number || bill.id}
                </h3>
                {bill.resettle_count > 0 && (
                  <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                    EDITED (v{(bill.resettle_count || 1) + 1})
                  </span>
                )}
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary, #64748b)' }}>
                {bill.table_name || `Table ${bill.table_number}`} • Token #{bill.token_number || 1} • Settled at {formatDateTime(bill.created_at || bill.settled_at)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'var(--bg-surface, #f1f5f9)',
              border: '1px solid var(--border-color, transparent)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary, #475569)'
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* 1. Add Items Search Bar */}
          <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: '12px 16px', borderRadius: '14px', border: '1.5px dashed var(--border-color, #cbd5e1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>➕ Add Dish / Item from Menu:</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder={`Search ${department === 'bar' ? 'drink' : 'dish'} name or shortcode to add...`}
                value={searchMenuQuery}
                onChange={(e) => setSearchMenuQuery(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
              />
              {searchMenuQuery && (
                <button
                  type="button"
                  onClick={() => setSearchMenuQuery('')}
                  style={{ position: 'absolute', right: '10px', top: '9px', background: 'none', border: 'none', color: 'var(--text-secondary, #94a3b8)', cursor: 'pointer' }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick-add chips */}
            {searchMenuQuery.trim() && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', maxHeight: '110px', overflowY: 'auto' }}>
                {filteredCatalog.map((dish) => (
                  <button
                    key={dish.id}
                    type="button"
                    onClick={() => handleAddItemFromMenu(dish)}
                    style={{
                      background: 'var(--bg-surface, #ffffff)',
                      border: '1px solid var(--border-color, #bfdbfe)',
                      color: 'var(--apple-blue, #0071e3)',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 750,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <span>+ {dish.name}</span>
                    <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(dish.price)}</strong>
                  </button>
                ))}
                {filteredCatalog.length === 0 && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #94a3b8)' }}>No items found matching search.</span>
                )}
              </div>
            )}
          </div>

          {/* 2. Items Table with +/- and Remove */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                Bill Items ({items.length})
              </h4>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
                Adjust quantities or remove items below
              </span>
            </div>

            <div style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-surface-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)', color: 'var(--text-secondary, #64748b)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 800 }}>Item</th>
                    <th style={{ padding: '8px 12px', fontWeight: 800 }}>Rate</th>
                    <th style={{ padding: '8px 12px', fontWeight: 800, textAlign: 'center', width: '110px' }}>Quantity</th>
                    <th style={{ padding: '8px 12px', fontWeight: 800, textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '8px 12px', width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const itemTotal = (Number(it.price) || 0) * (Number(it.qty) || 1);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 750, color: 'var(--text-primary, #0f172a)' }}>
                          <span style={{ marginRight: '6px' }}>{it.is_veg ? '🟢' : '🔴'}</span>
                          {it.name}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary, #64748b)' }}>
                          {formatCurrency(it.price)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(idx, -1)}
                              style={{
                                width: '22px',
                                height: '22px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color, #cbd5e1)',
                                background: 'var(--bg-surface, #ffffff)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 800,
                                fontSize: '0.85rem'
                              }}
                            >
                              -
                            </button>
                            <span style={{ fontWeight: 800, minWidth: '22px', textAlign: 'center', color: 'var(--text-primary)' }}>
                              {it.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateQty(idx, 1)}
                              style={{
                                width: '22px',
                                height: '22px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color, #cbd5e1)',
                                background: 'var(--bg-surface, #ffffff)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontWeight: 800,
                                fontSize: '0.85rem'
                              }}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                          {formatCurrency(itemTotal)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              fontSize: '1.1rem',
                              padding: 0
                            }}
                            title="Remove item"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary, #94a3b8)' }}>
                        No items in this bill. Use the search bar above to add items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Financial Summary & Audit Diff */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              background: 'var(--bg-surface-secondary, #f8fafc)',
              padding: '16px',
              borderRadius: '14px',
              border: '1px solid var(--border-color, #e2e8f0)'
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: 'var(--text-secondary, #475569)', marginBottom: '4px' }}>
                Payment Mode
              </label>
              <select
                className="form-select"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '8px' }}
              >
                <option value="cash">💵 Cash</option>
                <option value="card">💳 Credit / Debit Card</option>
                <option value="online">📱 UPI / Online Transfer</option>
                <option value="room_folio">🏨 Charge to Room Folio</option>
              </select>

              <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: 'var(--text-secondary, #475569)', marginTop: '10px', marginBottom: '4px' }}>
                Edit Reason / Audit Note <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Added extra roti after guest request, or correction"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.85rem', borderRadius: '8px' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px', fontSize: '0.86rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #64748b)' }}>
                <span>Subtotal:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #64748b)' }}>
                <span>GST (5%):</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(gst)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '6px',
                  borderTop: '1.5px solid var(--border-color, #cbd5e1)',
                  marginTop: '4px'
                }}
              >
                <span style={{ fontWeight: 800, color: 'var(--text-primary, #0f172a)', fontSize: '1rem' }}>New Total:</span>
                <span style={{ fontWeight: 900, color: 'var(--apple-blue, #0071e3)', fontSize: '1.2rem' }}>{formatCurrency(grandTotal)}</span>
              </div>

              {cardFee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309', fontWeight: 750, fontSize: '0.82rem' }}>
                  <span>Card POS Fee ({cardPct}%):</span>
                  <span>+ {formatCurrency(cardFee)}</span>
                </div>
              )}
              {upiFee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0369a1', fontWeight: 750, fontSize: '0.82rem' }}>
                  <span>UPI Tax ({upiPct}% &gt; ₹{upiThresh.toLocaleString('en-IN')}):</span>
                  <span>+ {formatCurrency(upiFee)}</span>
                </div>
              )}
              {(paymentMode === 'online' || paymentMode === 'upi') && (grandTotal <= upiThresh || upiPct === 0) && (
                <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700, textAlign: 'right' }}>
                  ✓ 0% Tax (UPI ≤ ₹{upiThresh.toLocaleString('en-IN')})
                </div>
              )}
              {(cardFee > 0 || upiFee > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary, #0f172a)', fontWeight: 800, fontSize: '0.88rem' }}>
                  <span>Total Payable:</span>
                  <span style={{ color: cardFee > 0 ? '#b45309' : '#0284c7' }}>{formatCurrency(finalPayable)}</span>
                </div>
              )}

              {totalDiff !== 0 && (
                <div style={{ textAlign: 'right', marginTop: '2px' }}>
                  <span
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      background: totalDiff > 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: totalDiff > 0 ? '#16a34a' : '#ef4444'
                    }}
                  >
                    Original: {formatCurrency(originalTotal)} • Diff: {totalDiff > 0 ? `+${formatCurrency(totalDiff)}` : `-${formatCurrency(Math.abs(totalDiff))}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 4. Audit Trail & Edit Logs Section */}
          <div style={{ borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '12px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.86rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📜</span>
              <span>Bill Audit Trail &amp; Edit History</span>
            </h5>

            {auditLogs.length === 0 ? (
              <div style={{ fontSize: '0.80rem', color: 'var(--text-secondary, #94a3b8)', fontStyle: 'italic', padding: '4px 0' }}>
                No prior resettle edits recorded for this bill.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: 'var(--bg-surface-secondary, #f8fafc)',
                      borderLeft: '3px solid var(--apple-blue, #0071e3)',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      fontSize: '0.78rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #64748b)', fontSize: '0.72rem', marginBottom: '2px' }}>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary, #0f172a)', textTransform: 'uppercase' }}>{log.action}</span>
                      <span>{formatDateTime(log.created_at)} • by {log.staff_user || 'Staff'}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary, #334155)' }}>
                      {log.change_summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1.5px solid var(--border-color, #f1f5f9)',
            background: 'var(--bg-surface, #ffffff)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.88rem' }}
          >
            Cancel
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleReprintCurrent}
              style={{
                padding: '8px 16px',
                borderRadius: '10px',
                fontSize: '0.88rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--bg-surface-secondary, #f1f5f9)',
                color: 'var(--text-primary, #0f172a)',
                border: '1px solid var(--border-color, #cbd5e1)'
              }}
            >
              <span>🖨️</span>
              <span>Reprint Revised Bill</span>
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveResettle}
              disabled={isSaving}
              style={{
                padding: '8px 20px',
                borderRadius: '10px',
                fontSize: '0.88rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #0071e3 0%, #0284c7 100%)',
                color: '#ffffff',
                border: 'none',
                cursor: isSaving ? 'wait' : 'pointer',
                boxShadow: '0 2px 8px rgba(0,113,227,0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>💾</span>
              <span>{isSaving ? 'Saving...' : 'Save & Resettle Bill'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
