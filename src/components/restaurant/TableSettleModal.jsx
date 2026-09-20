import React, { useState, useEffect } from 'react';
import { formatCurrency } from '../../utils/formatters';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { printThermalBillSlip } from '../../services/printService';

export default function TableSettleModal({ isOpen, session, onClose, onSettleSuccess, department = 'restaurant' }) {
  const { showToast, currentUser, surchargeSettings } = useApp();
  const cardPct = surchargeSettings?.card_surcharge_pct !== undefined ? Number(surchargeSettings.card_surcharge_pct) : 2.5;
  const upiPct = surchargeSettings?.upi_tax_pct !== undefined ? Number(surchargeSettings.upi_tax_pct) : 0.4;
  const upiThresh = surchargeSettings?.upi_tax_threshold !== undefined ? Number(surchargeSettings.upi_tax_threshold) : 2000;

  const [paymentMode, setPaymentMode] = useState('cash'); // 'cash' | 'online' | 'card' | 'split'
  const [splitCash, setSplitCash] = useState(0);
  const [splitOnline, setSplitOnline] = useState(0);
  const [splitCard, setSplitCard] = useState(0);
  const [utrNumber, setUtrNumber] = useState('');
  const [isStayingGuest, setIsStayingGuest] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [occupiedRooms, setOccupiedRooms] = useState([]);
  const [roomBillStatus, setRoomBillStatus] = useState('paid'); // 'pending' | 'paid' (default paid for walk-in)
  const [roomServiceFor, setRoomServiceFor] = useState(null); // 'room_mates' | 'visitor' (must not select by default)
  const [isSubmitting, setIsSubmitting] = useState(false);

  const grandTotal = session ? session.grandTotal : 0;

  useEffect(() => {
    if (isOpen && session) {
      setPaymentMode('cash');
      setSplitCash(session.grandTotal);
      setSplitOnline(0);
      setSplitCard(0);
      setUtrNumber('');

      const isRS = session.table?.table_type === 'room_service' || String(session.table?.table_number || '').startsWith('RS-');
      const initialRoom = session.chargeToRoomId || session.table?.room_id || '';
      const initialIsStaying = Boolean(isRS || initialRoom);

      setIsStayingGuest(initialIsStaying);
      setRoomBillStatus(initialIsStaying ? 'pending' : 'paid');
      setRoomServiceFor(null);

      api.getRooms()
        .then((rooms) => {
          const roomList = Array.isArray(rooms) ? rooms : (rooms?.rooms || []);
          const occ = roomList.filter((r) => r.status === 'occupied');
          setOccupiedRooms(occ);

          let resolvedId = '';
          if (initialRoom) {
            resolvedId = String(initialRoom);
            const foundInitial = roomList.find((r) => String(r.id) === resolvedId);
            if (foundInitial && !occ.some((r) => String(r.id) === resolvedId)) {
              setOccupiedRooms((prev) => [foundInitial, ...prev]);
            }
          } else if (isRS) {
            const rNum = String(session.table?.table_number || '').replace(/^RS-/i, '').trim();
            const found = roomList.find((r) => String(r.room_number) === rNum);
            if (found) {
              resolvedId = String(found.id);
              if (!occ.some((r) => String(r.id) === resolvedId)) {
                setOccupiedRooms((prev) => [found, ...prev]);
              }
            } else if (occ.length > 0) {
              resolvedId = String(occ[0].id);
            }
          }
          if (resolvedId && initialIsStaying) {
            setSelectedRoomId(resolvedId);
          } else {
            setSelectedRoomId('');
          }
        })
        .catch((err) => console.warn('Could not load occupied rooms:', err));
    }
  }, [isOpen, session]);

  if (!isOpen || !session) return null;

  const handleQuickFill = (mode) => {
    setPaymentMode(mode);
    if (mode === 'cash') {
      setSplitCash(grandTotal);
      setSplitOnline(0);
      setSplitCard(0);
    } else if (mode === 'online') {
      setSplitCash(0);
      setSplitOnline(grandTotal);
      setSplitCard(0);
    } else if (mode === 'card') {
      setSplitCash(0);
      setSplitOnline(0);
      setSplitCard(grandTotal);
    }
  };

  const handleAmountChange = (mode, rawVal) => {
    const val = Math.max(0, parseFloat(rawVal) || 0);
    if (mode === 'cash') setSplitCash(val);
    if (mode === 'online') setSplitOnline(val);
    if (mode === 'card') setSplitCard(val);
  };

  // Dynamic card EDC swipe surcharge & UPI Tax
  const cardSurcharge = (splitCard > 0 && cardPct > 0) ? Math.round((splitCard * cardPct) / 100) : 0;
  const cardTotalSwipe = splitCard + cardSurcharge;
  const upiTax = (splitOnline > upiThresh && upiPct > 0) ? Math.round((splitOnline * upiPct) / 100) : 0;
  const upiTotalPay = splitOnline + upiTax;
  const totalSurcharges = cardSurcharge + upiTax;

  const totalAllocated = (Number(splitCash) || 0) + (Number(splitOnline) || 0) + (Number(splitCard) || 0);
  const remainingAlloc = grandTotal - totalAllocated;
  const isAllocationValid = Math.abs(remainingAlloc) < 0.01;

  const selectedRoom = occupiedRooms.find((r) => String(r.id) === String(selectedRoomId));

  const handleSettle = async () => {
    const isRS = session.table?.table_type === 'room_service' || String(session.table?.table_number || '').startsWith('RS-');

    if (isStayingGuest) {
      if (!selectedRoomId) {
        showToast('Please select an occupied room.', 'red');
        return;
      }

      if (!roomServiceFor) {
        showToast('Please select who this order is for: "For room mates" or "For visitor" (Mandatory).', 'red');
        return;
      }
    }

    const isPaid = (!isStayingGuest || roomBillStatus === 'paid') ? 1 : 0;

    if (isPaid) {
      if (!isAllocationValid) {
        showToast(`Payment split must total ${formatCurrency(grandTotal)}. Current total is ${formatCurrency(totalAllocated)}.`, 'red');
        return;
      }
      if (splitOnline > 0 && !utrNumber.trim()) {
        showToast('Please enter the UTR / Transaction Reference ID for Online payment.', 'red');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const isPaid = roomBillStatus === 'paid' ? 1 : 0;
      let finalPaymentMode = 'room_folio';
      if (isPaid) {
        const activeCount = (splitCash > 0 ? 1 : 0) + (splitOnline > 0 ? 1 : 0) + (splitCard > 0 ? 1 : 0);
        if (activeCount > 1) {
          finalPaymentMode = 'split';
        } else if (splitOnline > 0) {
          finalPaymentMode = 'online';
        } else if (splitCard > 0) {
          finalPaymentMode = 'card';
        } else {
          finalPaymentMode = 'cash';
        }
      }

      const itemsList = (Array.isArray(session.cart) && session.cart.length > 0)
        ? session.cart
        : ((Array.isArray(session.table?.cart) && session.table.cart.length > 0) ? session.table.cart : []);

      const payload = {
        cart: itemsList,
        items: itemsList,
        paymentMode: finalPaymentMode,
        payment_mode: finalPaymentMode,
        splitCash: isPaid ? splitCash : 0,
        split_cash: isPaid ? splitCash : 0,
        splitOnline: isPaid ? splitOnline : 0,
        split_online: isPaid ? splitOnline : 0,
        utr_number: isPaid && splitOnline > 0 ? utrNumber.trim() : null,
        online_utr: isPaid && splitOnline > 0 ? utrNumber.trim() : null,
        splitCard: isPaid ? splitCard : 0,
        split_card: isPaid ? splitCard : 0,
        cardSurcharge: isPaid ? cardSurcharge : 0,
        card_surcharge: isPaid ? cardSurcharge : 0,
        upiTax: isPaid ? upiTax : 0,
        upi_tax: isPaid ? upiTax : 0,
        subtotal: session.subtotal,
        gst: session.gst,
        grandTotal: session.grandTotal,
        chargeToRoomId: isStayingGuest ? selectedRoomId : null,
        room_id: isStayingGuest ? selectedRoomId : null,
        room_service_for: isStayingGuest ? roomServiceFor : null,
        roomServiceFor: isStayingGuest ? roomServiceFor : null,
        guest_phone: isStayingGuest ? (selectedRoom?.guest_mobile || selectedRoom?.mobile || null) : null,
        customer_name: isStayingGuest ? (selectedRoom?.guest_name || `Room ${selectedRoom?.room_number}`) : (session.table?.name || `Table ${session.table?.table_number} Guest`),
        is_paid: isPaid,
        settledBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier'
      };

      const isBar = department === 'bar' || session.department === 'bar';
      const res = isBar
        ? await api.settleBarTable(session.table.id, payload)
        : await api.settleRestaurantTable(session.table.id, payload);

      if (res && res.success) {
        showToast(`Bill settled for ${session.table.name || `Table ${session.table.table_number}`}!`, 'green', 3500);

        // Automatic Mobile WhatsApp PDF summary dispatch if mobile number is present
        const guestMobile = selectedRoom?.guest_mobile || selectedRoom?.mobile;
        if (guestMobile && res.order?.id) {
          api.post('/orders/send-bill-mobile', {
            orderId: res.order.id,
            department: isBar ? 'bar' : 'restaurant',
            mobileNumber: guestMobile
          }).then((mobileRes) => {
            if (mobileRes?.whatsappUrl && !isPaid) {
              window.open(mobileRes.whatsappUrl, '_blank');
            }
          }).catch((err) => console.warn('Mobile bill dispatch notice:', err));
        }

        onClose();
        if (onSettleSuccess) {
          onSettleSuccess(res);
        } else {
          printThermalBillSlip(res, isBar ? 'HOTEL CITY PARK - BAR & LOUNGE' : 'HOTEL CITY PARK - RESTAURANT');
        }
      } else {
        showToast('Settlement failed: ' + (res?.message || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Settlement error: ' + err.message, 'red');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay active" id="rest-settle-modal" style={{ zIndex: 10050, padding: 0, margin: 0, width: '100%', height: '100%', display: 'flex', position: 'fixed', inset: 0 }}>
      <div
        className="modal-container"
        style={{
          width: '100%',
          maxWidth: '100%',
          height: '100%',
          maxHeight: '100%',
          borderRadius: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-app, #f8fafc)',
          boxShadow: 'none',
          border: 'none'
        }}
      >
        {/* Full Header with Universal Top-Left Back & Top-Right Close Buttons */}
        <div
          className="modal-header"
          style={{
            padding: '16px 36px',
            background: '#ffffff',
            borderBottom: '1.5px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              type="button"
              className="universal-back-btn"
              id="btn-dining-settle-back"
              onClick={onClose}
              title="Back to Session"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '2rem', padding: '8px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>💳</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  Settle Bill — {session.table.name || `Table ${session.table.table_number}`}
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: '0.90rem', fontWeight: 700, color: '#64748b' }}>
                  Token #{session.table.token_number || 1} • {department === 'bar' ? 'Bar Lounge' : 'Dining'} Order Settlement &amp; Thermal Bill Slip
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="universal-close-btn modal-close-btn"
            onClick={onClose}
            title="Close Settle"
          >
            &times;
          </button>
        </div>

        {/* Full Page Body */}
        <div
          className="modal-body"
          style={{
            flex: 1,
            padding: '30px 48px',
            overflowY: 'auto',
            background: 'var(--bg-app, #f8fafc)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          {/* Summary Hero Card */}
          <div
            style={{
              background: '#ffffff',
              padding: '24px 32px',
              borderRadius: '18px',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 4px 18px rgba(15, 23, 42, 0.05)'
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'center' }}>
              <div style={{ padding: '14px 18px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {department === 'bar' ? 'Drink Subtotal' : 'Food Subtotal'}
                </span>
                <div style={{ fontSize: '1.65rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>{formatCurrency(session.subtotal)}</div>
              </div>

              <div style={{ padding: '14px 18px', background: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.04em' }}>GST (5%)</span>
                <div style={{ fontSize: '1.65rem', fontWeight: 900, color: '#d97706', marginTop: '4px' }}>+ {formatCurrency(session.gst)}</div>
              </div>

              <div style={{ padding: '14px 22px', background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', borderRadius: '12px', border: '2px solid #3b82f6' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 900, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Grand Total Due</span>
                <div style={{ fontSize: '2.2rem', fontWeight: 950, color: '#1d4ed8', marginTop: '2px' }}>{formatCurrency(session.grandTotal)}</div>
              </div>
            </div>
          </div>

          {/* Customer Category Selector: Walk-in Diner vs In-House Hotel Guest */}
          <div
            style={{
              background: '#ffffff',
              padding: '16px 24px',
              borderRadius: '18px',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 4px 18px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>👤</span> Customer Category:
              </div>
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                Normal walk-in diner or in-house hotel staying guest
              </span>
            </div>

            <div style={{ display: 'inline-flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '12px' }}>
              {/* Option 1: Walk-in / Outside diner (Default) */}
              <button
                type="button"
                onClick={() => {
                  setIsStayingGuest(false);
                  setRoomBillStatus('paid');
                  setSelectedRoomId('');
                  setRoomServiceFor(null);
                  if (totalAllocated === 0) setSplitCash(grandTotal);
                }}
                style={{
                  padding: '9px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: !isStayingGuest ? 900 : 700,
                  fontSize: '0.90rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: !isStayingGuest ? '#ffffff' : 'transparent',
                  color: !isStayingGuest ? '#0f172a' : '#64748b',
                  boxShadow: !isStayingGuest ? '0 2px 8px rgba(0, 0, 0, 0.10)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>🍽️</span>
                <span>Walk-in Diner (Non-Staying)</span>
              </button>

              {/* Option 2: Staying Hotel Guest */}
              <button
                type="button"
                onClick={() => {
                  setIsStayingGuest(true);
                  if (!selectedRoomId && occupiedRooms.length > 0) {
                    setSelectedRoomId(String(occupiedRooms[0].id));
                  }
                  setRoomBillStatus('pending');
                }}
                style={{
                  padding: '9px 20px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: isStayingGuest ? 900 : 700,
                  fontSize: '0.90rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: isStayingGuest ? '#0071e3' : 'transparent',
                  color: isStayingGuest ? '#ffffff' : '#64748b',
                  boxShadow: isStayingGuest ? '0 2px 8px rgba(0, 113, 227, 0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>🏨</span>
                <span>In-House Hotel Guest (Staying)</span>
              </button>
            </div>
          </div>

          {/* Room Attribution Card (Rendered ONLY if in-house staying guest) */}
          {isStayingGuest && (
            <div
              style={{
                background: '#ffffff',
                padding: '22px 28px',
                borderRadius: '18px',
                border: '1.5px solid #e2e8f0',
                boxShadow: '0 4px 18px rgba(15, 23, 42, 0.04)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '1rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🏨</span> Link / Attribute to Occupied Room:
                  </label>
                  <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                    Select the in-house guest room for this dining bill
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <select
                    className="form-select"
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    style={{ height: '42px', minWidth: '260px', fontWeight: 800, fontSize: '0.95rem', borderRadius: '10px', borderColor: '#cbd5e1' }}
                  >
                    <option value="" disabled>-- Select Occupied Room --</option>
                    {occupiedRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        Room #{r.room_number} — {r.guest_name || 'Guest'}
                      </option>
                    ))}
                  </select>
                  {selectedRoom && (
                    <span style={{ padding: '6px 14px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 850, borderRadius: '8px', fontSize: '0.88rem', border: '1px solid #bfdbfe' }}>
                      🔑 Room #{selectedRoom.room_number}
                    </span>
                  )}
                </div>
              </div>

              {/* Mandatory Radio Selection: For room mates vs For visitor (Neither selected by default) */}
              <div
                style={{
                  marginTop: '16px',
                  padding: '14px 18px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: roomServiceFor ? '1.5px solid #3b82f6' : '1.5px dashed #f59e0b',
                  boxShadow: roomServiceFor ? '0 2px 8px rgba(59, 130, 246, 0.12)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ fontSize: '0.88rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>👥</span> Order Attribution (Mandatory - Select One):
                  </label>
                  {!roomServiceFor && (
                    <span style={{ fontSize: '0.74rem', fontWeight: 850, color: '#b45309', background: '#fef3c7', padding: '3px 10px', borderRadius: '6px', border: '1px solid #fde68a' }}>
                      ⚠️ Required (Choose One)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                  {/* Option 1: For room mates */}
                  <label
                    style={{
                      flex: '1',
                      minWidth: '180px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      fontSize: '0.94rem',
                      fontWeight: roomServiceFor === 'room_mates' ? 950 : 700,
                      color: roomServiceFor === 'room_mates' ? '#1e40af' : '#334155',
                      background: roomServiceFor === 'room_mates' ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' : '#ffffff',
                      padding: '12px 18px',
                      borderRadius: '12px',
                      border: roomServiceFor === 'room_mates' ? '2.5px solid #2563eb' : '1.5px solid #cbd5e1',
                      boxShadow: roomServiceFor === 'room_mates' ? '0 4px 12px rgba(37, 99, 235, 0.20)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <input
                      type="radio"
                      name="roomServiceAttribution"
                      value="room_mates"
                      checked={roomServiceFor === 'room_mates'}
                      onChange={() => setRoomServiceFor('room_mates')}
                      style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                    <span>👥 For room mates</span>
                  </label>

                  {/* Option 2: For visitor */}
                  <label
                    style={{
                      flex: '1',
                      minWidth: '180px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      fontSize: '0.94rem',
                      fontWeight: roomServiceFor === 'visitor' ? 950 : 700,
                      color: roomServiceFor === 'visitor' ? '#1e40af' : '#334155',
                      background: roomServiceFor === 'visitor' ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' : '#ffffff',
                      padding: '12px 18px',
                      borderRadius: '12px',
                      border: roomServiceFor === 'visitor' ? '2.5px solid #2563eb' : '1.5px solid #cbd5e1',
                      boxShadow: roomServiceFor === 'visitor' ? '0 4px 12px rgba(37, 99, 235, 0.20)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <input
                      type="radio"
                      name="roomServiceAttribution"
                      value="visitor"
                      checked={roomServiceFor === 'visitor'}
                      onChange={() => setRoomServiceFor('visitor')}
                      style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                    <span>👤 For visitor</span>
                  </label>
                </div>
              </div>

              {/* Room Folio Settle Option: PENDING vs PAID NOW */}
              <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 900, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '12px' }}>
                  Bill Settlement Option:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
                  {/* ⏳ PENDING */}
                  <button
                    type="button"
                    onClick={() => setRoomBillStatus('pending')}
                    style={{
                      padding: '16px 20px',
                      borderRadius: '14px',
                      border: roomBillStatus === 'pending' ? '2.5px solid #d97706' : '1.5px solid #cbd5e1',
                      background: roomBillStatus === 'pending' ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' : '#ffffff',
                      color: roomBillStatus === 'pending' ? '#92400e' : '#475569',
                      fontWeight: 900,
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: roomBillStatus === 'pending' ? '0 4px 14px rgba(217, 119, 6, 0.20)' : 'none',
                      transition: 'all 0.18s ease'
                    }}
                  >
                    <div style={{ fontSize: '1.05rem', fontWeight: 950, marginBottom: '4px' }}>
                      ⏳ PENDING (Add to Room Bill, Pay at Checkout)
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 650, opacity: 0.9 }}>
                      Charges to guest room folio. Collected when guest checks out.
                    </div>
                  </button>

                  {/* ✅ PAID NOW */}
                  <button
                    type="button"
                    onClick={() => {
                      setRoomBillStatus('paid');
                      if (totalAllocated === 0) setSplitCash(grandTotal);
                    }}
                    style={{
                      padding: '16px 20px',
                      borderRadius: '14px',
                      border: roomBillStatus === 'paid' ? '2.5px solid #16a34a' : '1.5px solid #cbd5e1',
                      background: roomBillStatus === 'paid' ? 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)' : '#ffffff',
                      color: roomBillStatus === 'paid' ? '#166534' : '#475569',
                      fontWeight: 950,
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: roomBillStatus === 'paid' ? '0 4px 14px rgba(22, 163, 74, 0.20)' : 'none',
                      transition: 'all 0.18s ease'
                    }}
                  >
                    <div style={{ fontSize: '1.05rem', fontWeight: 950, marginBottom: '4px' }}>
                      ✅ PAID NOW (Guest paid at Counter)
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 650, opacity: 0.9 }}>
                      Guest pays now via Cash, Online UPI, or Card Swipe.
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* If In-House Staying Guest & PENDING: Informational banner */}
          {isStayingGuest && roomBillStatus === 'pending' && (
            <div
              style={{
                background: '#fffbeb',
                padding: '20px 24px',
                borderRadius: '16px',
                border: '1.5px solid #fde68a',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
              }}
            >
              <span style={{ fontSize: '2rem' }}>🏨</span>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#92400e' }}>
                  Bill Added to Room Folio (Pending at Checkout)
                </h4>
                <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: '#78350f', fontWeight: 600 }}>
                  This order of <strong>{formatCurrency(grandTotal)}</strong> will be linked to <strong>Room #{selectedRoom?.room_number || '-'}</strong>.
                  It will display as <span style={{ color: '#b91c1c', fontWeight: 800 }}>PENDING</span> in the Room Folio and be settled during check-out.
                </p>
              </div>
            </div>
          )}

          {/* If Walk-in Diner OR (Staying Guest & PAID NOW): SHOW SELECT PAYMENT METHOD */}
          {(!isStayingGuest || roomBillStatus === 'paid') && (
            <div
              style={{
                background: '#ffffff',
                padding: '24px 30px',
                borderRadius: '18px',
                border: '1.5px solid #e2e8f0',
                boxShadow: '0 4px 18px rgba(15, 23, 42, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <label style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
                  Select Payment Method:
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('cash')}
                    style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}
                  >
                    100% Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('online')}
                    style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}
                  >
                    100% UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('card')}
                    style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}
                  >
                    100% Card
                  </button>
                </div>
              </div>

              {/* 3 Payment Methods (Splitable / Multi-selectable) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {/* 💵 Cash Payment */}
                <div
                  style={{
                    padding: '18px 20px',
                    borderRadius: '14px',
                    border: splitCash > 0 ? '2.5px solid #16a34a' : '1.5px solid #cbd5e1',
                    background: splitCash > 0 ? '#f0fdf4' : '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                    transition: 'all 0.18s ease'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: splitCash > 0 ? '#166534' : '#0f172a', marginBottom: '4px' }}>
                      💵 Cash Payment
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                      Accept physical currency at counter
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Cash Amount</span>
                    <div style={{ position: 'relative', marginTop: '4px' }}>
                      <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#64748b' }}>₹</span>
                      <input
                        type="number"
                        min={0}
                        max={grandTotal}
                        value={splitCash || ''}
                        onChange={(e) => handleAmountChange('cash', e.target.value)}
                        placeholder="0"
                        style={{
                          width: '100%',
                          height: '42px',
                          paddingLeft: '28px',
                          paddingRight: '10px',
                          fontSize: '1.15rem',
                          fontWeight: 900,
                          borderRadius: '8px',
                          border: splitCash > 0 ? '2px solid #16a34a' : '1.5px solid #cbd5e1',
                          background: '#ffffff',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* 📱 Online / UPI QR */}
                <div
                  style={{
                    padding: '18px 20px',
                    borderRadius: '14px',
                    border: splitOnline > 0 ? '2.5px solid #0284c7' : '1.5px solid #cbd5e1',
                    background: splitOnline > 0 ? '#f0f9ff' : '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                    transition: 'all 0.18s ease'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: splitOnline > 0 ? '#0369a1' : '#0f172a', marginBottom: '4px' }}>
                      📱 Online / UPI QR
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                      Instant UPI QR or NetBanking transfer
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Online Amount</span>
                    <div style={{ position: 'relative', marginTop: '4px' }}>
                      <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#64748b' }}>₹</span>
                      <input
                        type="number"
                        min={0}
                        max={grandTotal}
                        value={splitOnline || ''}
                        onChange={(e) => handleAmountChange('online', e.target.value)}
                        placeholder="0"
                        style={{
                          width: '100%',
                          height: '42px',
                          paddingLeft: '28px',
                          paddingRight: '10px',
                          fontSize: '1.15rem',
                          fontWeight: 900,
                          borderRadius: '8px',
                          border: splitOnline > 0 ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                          background: '#ffffff',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    {splitOnline > upiThresh && upiPct > 0 && (
                      <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                        + {upiPct}% UPI Tax: ₹{upiTax} (Pay: ₹{upiTotalPay})
                      </div>
                    )}
                    {splitOnline > 0 && (splitOnline <= upiThresh || upiPct === 0) && (
                      <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                        ✓ 0% Tax (UPI ≤ ₹{upiThresh.toLocaleString('en-IN')})
                      </div>
                    )}
                  </div>
                </div>

                {/* 💳 Card POS Swipe */}
                <div
                  style={{
                    padding: '18px 20px',
                    borderRadius: '14px',
                    border: splitCard > 0 ? '2.5px solid #7c3aed' : '1.5px solid #cbd5e1',
                    background: splitCard > 0 ? '#faf5ff' : '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                    transition: 'all 0.18s ease'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: splitCard > 0 ? '#6d28d9' : '#0f172a', marginBottom: '4px' }}>
                      💳 Card POS Swipe
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                      Debit / Credit card EDC machine swipe
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Card Base Amount</span>
                    <div style={{ position: 'relative', marginTop: '4px' }}>
                      <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#64748b' }}>₹</span>
                      <input
                        type="number"
                        min={0}
                        max={grandTotal}
                        value={splitCard || ''}
                        onChange={(e) => handleAmountChange('card', e.target.value)}
                        placeholder="0"
                        style={{
                          width: '100%',
                          height: '42px',
                          paddingLeft: '28px',
                          paddingRight: '10px',
                          fontSize: '1.15rem',
                          fontWeight: 900,
                          borderRadius: '8px',
                          border: splitCard > 0 ? '2px solid #7c3aed' : '1.5px solid #cbd5e1',
                          background: '#ffffff',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Surcharge Alert when splitCard > 0 and cardPct > 0 */}
              {splitCard > 0 && cardPct > 0 && (
                <div
                  style={{
                    padding: '12px 18px',
                    background: '#fffbeb',
                    borderRadius: '12px',
                    border: '1.5px solid #fde68a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.92rem'
                  }}
                >
                  <span style={{ fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💳</span> {cardPct}% EDC Card Processing Fee: <strong>+₹{cardSurcharge}</strong>
                  </span>
                  <span style={{ fontWeight: 950, color: '#b45309', fontSize: '1.05rem' }}>
                    Total Swipe on Card Machine: {formatCurrency(cardTotalSwipe)}
                  </span>
                </div>
              )}

              {/* UPI Tax Alert when splitOnline > upiThresh and upiPct > 0 */}
              {splitOnline > upiThresh && upiPct > 0 && (
                <div
                  style={{
                    padding: '12px 18px',
                    background: '#f0f9ff',
                    borderRadius: '12px',
                    border: '1.5px solid #bae6fd',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.92rem'
                  }}
                >
                  <span style={{ fontWeight: 800, color: '#0369a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📱</span> {upiPct}% UPI Convenience Tax (&gt; ₹{upiThresh.toLocaleString('en-IN')}): <strong>+₹{upiTax}</strong>
                  </span>
                  <span style={{ fontWeight: 950, color: '#0284c7', fontSize: '1.05rem' }}>
                    Total UPI Payment: {formatCurrency(upiTotalPay)}
                  </span>
                </div>
              )}

              {/* Mandatory Online Payment UTR / Ref ID Panel when splitOnline > 0 */}
              {splitOnline > 0 && (
                <div
                  id="pos-online-utr-panel"
                  style={{
                    padding: '16px 20px',
                    background: '#eff6ff',
                    borderRadius: '14px',
                    border: '1.5px solid #93c5fd',
                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: 850, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>📱</span> Online / UPI Transaction UTR Reference ID <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                    </label>
                    <span style={{ fontSize: '0.78rem', fontWeight: 800, background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '6px' }}>
                      Online Amount: {formatCurrency(splitOnline)}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter 12-digit UTR No. / UPI Ref ID (e.g. 423589123456)"
                    value={utrNumber}
                    onChange={(e) => setUtrNumber(e.target.value)}
                    style={{
                      height: '42px',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      background: '#ffffff',
                      border: !utrNumber.trim() ? '2px solid #ef4444' : '1.5px solid #3b82f6',
                      color: '#0f172a'
                    }}
                    required
                  />
                  {!utrNumber.trim() && (
                    <div style={{ fontSize: '0.76rem', color: '#dc2626', fontWeight: 700, marginTop: '5px' }}>
                      ⚠️ UTR ID is mandatory to confirm online / QR payment settlement.
                    </div>
                  )}
                </div>
              )}

              {/* Allocation Validation Bar */}
              <div
                style={{
                  padding: '12px 18px',
                  borderRadius: '12px',
                  background: isAllocationValid ? '#f0fdf4' : '#fff1f2',
                  border: isAllocationValid ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.9rem'
                }}
              >
                <div>
                  <span style={{ fontWeight: 800, color: '#475569' }}>Total Allocated: </span>
                  <strong style={{ fontSize: '1.1rem', color: isAllocationValid ? '#15803d' : '#b91c1c' }}>
                    {formatCurrency(totalAllocated)}
                  </strong>
                  <span style={{ color: '#64748b', fontSize: '0.85rem', marginLeft: '6px' }}>
                    of {formatCurrency(grandTotal)}
                  </span>
                </div>
                <div>
                  {isAllocationValid ? (
                    <span style={{ color: '#15803d', fontWeight: 850, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      ✅ Exact Bill Amount Allocated {totalSurcharges > 0 ? `(+ ${formatCurrency(totalSurcharges)} Surcharges/Tax)` : ''}
                    </span>
                  ) : remainingAlloc > 0 ? (
                    <span style={{ color: '#b91c1c', fontWeight: 850 }}>
                      ⚠️ Remaining to allocate: {formatCurrency(remainingAlloc)}
                    </span>
                  ) : (
                    <span style={{ color: '#b91c1c', fontWeight: 850 }}>
                      ⚠️ Overallocated by: {formatCurrency(-remainingAlloc)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Full Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '18px 48px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
            borderTop: '1.5px solid #e2e8f0',
            flexShrink: 0
          }}
        >
          <div style={{ fontSize: '0.92rem', color: '#64748b' }}>
            {!isStayingGuest ? (
              <span>Billing mode: <strong style={{ color: '#0f172a' }}>🍽️ Walk-in Diner (Direct Payment)</strong></span>
            ) : roomBillStatus === 'pending' ? (
              <span>Billing mode: <strong style={{ color: '#d97706' }}>🏨 Room Folio (Pending at Checkout)</strong></span>
            ) : (
              <span>Billing mode: <strong style={{ color: '#16a34a' }}>🏨 In-House Guest (Paid at Counter)</strong></span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '14px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{ padding: '12px 28px', fontSize: '1.05rem', fontWeight: 800, borderRadius: '12px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSettle}
              disabled={
                isSubmitting ||
                (isStayingGuest && !selectedRoomId) ||
                (isStayingGuest && !roomServiceFor) ||
                ((!isStayingGuest || roomBillStatus === 'paid') && (!isAllocationValid || (splitOnline > 0 && !utrNumber.trim())))
              }
              style={{
                padding: '12px 36px',
                fontSize: '1.1rem',
                fontWeight: 900,
                borderRadius: '12px',
                background: (isStayingGuest && roomBillStatus === 'pending') ? '#d97706' : '#16a34a',
                color: '#ffffff',
                boxShadow: (isStayingGuest && roomBillStatus === 'pending') ? '0 4px 16px rgba(217, 119, 6, 0.3)' : '0 4px 16px rgba(22, 163, 74, 0.3)',
                cursor: (isSubmitting || (isStayingGuest && (!selectedRoomId || !roomServiceFor)) || ((!isStayingGuest || roomBillStatus === 'paid') && (!isAllocationValid || (splitOnline > 0 && !utrNumber.trim())))) ? 'not-allowed' : 'pointer',
                opacity: (isSubmitting || (isStayingGuest && (!selectedRoomId || !roomServiceFor)) || ((!isStayingGuest || roomBillStatus === 'paid') && (!isAllocationValid || (splitOnline > 0 && !utrNumber.trim())))) ? 0.6 : 1
              }}
            >
              {isSubmitting
                ? 'Settling...'
                : (isStayingGuest && roomBillStatus === 'pending')
                ? `🏨 Charge to Room Folio (${formatCurrency(grandTotal)})`
                : `🖨️ Settle & Print Bill Slip (${formatCurrency(grandTotal + cardSurcharge)})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
