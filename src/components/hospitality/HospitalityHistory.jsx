import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { printCashReceipt, printPettyCashVoucher, printGuestRegistrationA4, printFinalBillA4, downloadGuestRegistrationPDF, printGuestPaymentSummary } from '../../services/printService';
import ImageLightbox from '../common/ImageLightbox';
import DocumentActionModal from './DocumentActionModal';

// Module-level in-memory cache for instant 0ms navigation
let globalHistoryCache = null;

export default function HospitalityHistory({ onViewDetail, onChangePaymentStatus }) {
  const { showToast, showConfirm, currentUser } = useApp();
  const [records, setRecords] = useState(() => (globalHistoryCache && Array.isArray(globalHistoryCache) ? globalHistoryCache : []));
  const [isLoading, setIsLoading] = useState(() => !globalHistoryCache || globalHistoryCache.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Stay Detail & Payment History Modal State
  const [detailBooking, setDetailBooking] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [docActionModal, setDocActionModal] = useState({ isOpen: false, type: 'info', data: null });

  // Settle BTC Modal State
  const [settleBtcTarget, setSettleBtcTarget] = useState(null);
  const [settleBtcMode, setSettleBtcMode] = useState('upi');
  const [settleBtcAmount, setSettleBtcAmount] = useState('');
  const [settleBtcUtr, setSettleBtcUtr] = useState('');
  const [settleBtcChequeNo, setSettleBtcChequeNo] = useState('');
  const [settleBtcChequeBank, setSettleBtcChequeBank] = useState('');
  const [settleBtcChequeStatus, setSettleBtcChequeStatus] = useState('realized');
  const [settleBtcCashier, setSettleBtcCashier] = useState('');
  const [settleBtcNotes, setSettleBtcNotes] = useState('');
  const [settleBtcSubmitting, setSettleBtcSubmitting] = useState(false);

  // Image Lightbox State for Click-to-Zoom
  const [lightboxImg, setLightboxImg] = useState(null);
  const [lightboxTitle, setLightboxTitle] = useState('Document Preview');

  const loadHistory = useCallback(async (isSilent = false) => {
    // Only show full-screen blocking loader if we have zero cached records and not a silent refresh
    const hasCachedData = globalHistoryCache && globalHistoryCache.length > 0;
    if (!isSilent && !hasCachedData) {
      setIsLoading(true);
    }

    try {
      let params = [];
      if (dateRange !== 'all' && dateRange !== 'pending_btc') params.push(`range=${dateRange}`);
      if (searchQuery.trim()) params.push(`q=${encodeURIComponent(searchQuery.trim())}`);
      const paramStr = params.join('&');
      const res = await api.getStayHistory(paramStr);
      let list = [];
      if (res && Array.isArray(res.history)) {
        list = res.history;
      } else if (Array.isArray(res)) {
        list = res;
      }
      setRecords(list);
      globalHistoryCache = list;
    } catch (err) {
      if (!isSilent) showToast('Error loading history: ' + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [dateRange, searchQuery, showToast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const pendingBtcCount = records.filter((r) => {
    return (r.booking_source === 'BTC' || r.btc_company_id !== null || r.final_payment_mode === 'btc' || r.payment_status === 'pending_from_company') &&
      r.payment_status !== 'settled';
  }).length;

  const filteredRecords = records.filter((r) => {
    if (dateRange === 'pending_btc') {
      return (r.booking_source === 'BTC' || r.btc_company_id !== null || r.final_payment_mode === 'btc' || r.payment_status === 'pending_from_company') &&
        r.payment_status !== 'settled';
    }
    if (dateRange === 'today') {
      const itemDate = new Date(r.checkout_time || r.checkin_time);
      const today = new Date();
      return itemDate.toDateString() === today.toDateString();
    }
    if (dateRange === 'week') {
      const itemDate = new Date(r.checkout_time || r.checkin_time);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      return itemDate >= oneWeekAgo;
    }
    if (dateRange === 'month') {
      const itemDate = new Date(r.checkout_time || r.checkin_time);
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      return itemDate >= oneMonthAgo;
    }
    return true;
  });

  const totalRev = filteredRecords.reduce(
    (acc, r) => acc + parseFloat(r.total_room_charge || r.total_paid || 0),
    0
  );

  const handleOpenSettleBtc = (booking) => {
    if (!booking) return;
    setSettleBtcTarget(booking);
    setSettleBtcMode('upi');
    const totalDue = Math.max(0, (booking.total_room_charge || 0) - (booking.total_paid || 0)) || booking.total_room_charge || 0;
    setSettleBtcAmount(totalDue > 0 ? String(totalDue) : String(booking.total_room_charge || ''));
    setSettleBtcUtr('');
    setSettleBtcChequeNo('');
    setSettleBtcChequeBank('');
    setSettleBtcChequeStatus('realized');
    setSettleBtcCashier(currentUser?.full_name || currentUser?.username || 'Accounts');
    setSettleBtcNotes(`Corporate BTC settlement for ${booking.guest_name || 'Guest'}${booking.btc_company_name ? ` (${booking.btc_company_name})` : ''}`);
  };

  const handleExecuteSettleBtc = async () => {
    if (!settleBtcTarget) return;
    const cleanAmt = parseFloat(settleBtcAmount);
    if (isNaN(cleanAmt) || cleanAmt <= 0) {
      showToast('Please enter a valid settlement amount.', 'red');
      return;
    }
    if ((settleBtcMode === 'upi' || settleBtcMode === 'bank_transfer') && !settleBtcUtr.trim()) {
      showToast('Please enter the UTR / Bank Reference Number.', 'red');
      return;
    }
    if (settleBtcMode === 'cheque' && !settleBtcChequeNo.trim()) {
      showToast('Please enter the Cheque Number.', 'red');
      return;
    }

    setSettleBtcSubmitting(true);
    try {
      const payload = {
        payment_status: 'settled',
        settlement_mode: settleBtcMode,
        amount_paid: cleanAmt,
        cashier_name: (settleBtcCashier || 'Front Desk / Accounts').trim(),
        transaction_id: settleBtcUtr.trim() || null,
        reference_no: settleBtcUtr.trim() || null,
        cheque_no: settleBtcChequeNo.trim() || null,
        bank_name: settleBtcChequeBank.trim() || null,
        cheque_status: settleBtcChequeStatus || 'realized',
        notes: settleBtcNotes.trim() || `BTC Company Settlement via ${settleBtcMode.toUpperCase()}`
      };

      const res = await api.updatePaymentStatus(settleBtcTarget.id, payload);
      if (res && res.success) {
        showToast(`✓ BTC Payment of ${formatCurrency(cleanAmt)} settled successfully! Tax invoice is released.`, 'green', 5000);
        const settledId = settleBtcTarget.id;
        const targetCopy = { ...settleBtcTarget, payment_status: 'settled', final_settlement_mode: settleBtcMode };
        setSettleBtcTarget(null);
        loadHistory(true);

        // If detail modal is open, refresh detail booking
        if (detailBooking && detailBooking.id === settledId) {
          handleOpenDetail(settledId);
        }

        // Trigger official A4 Tax Invoice release
        try {
          printFinalBillA4(targetCopy, {
            grossTariff: targetCopy.total_room_charge,
            roomCharge: targetCopy.total_room_charge,
            roomTariffNet: targetCopy.total_room_charge,
            tariffTax5Pct: Math.round(targetCopy.total_room_charge * 0.05),
            foodTotal: targetCopy.food_total || 0,
            barTotal: targetCopy.bar_total || 0,
            hotelExtrasCharge: targetCopy.extra_bed_charge || 0,
            advancePaid: cleanAmt,
            chargedDays: targetCopy.charged_days || 1,
            billableDays: targetCopy.charged_days || 1,
            discountPct: 0,
            discountAmount: 0
          }, {
            settleAmt: cleanAmt,
            refundAmt: 0,
            settled_at: new Date(),
            invoiceNo: `L${targetCopy.id}`,
            checked_out_by: (settleBtcCashier || 'Front Desk / Accounts').trim()
          });
        } catch (printErr) {
          console.warn('Error releasing Tax Invoice:', printErr);
        }
      } else {
        showToast(res?.error || 'Failed to settle BTC payment.', 'red');
      }
    } catch (err) {
      showToast('Error settling payment: ' + err.message, 'red');
    } finally {
      setSettleBtcSubmitting(false);
    }
  };

  const formatShortDT = (dt) => {
    if (!dt) return '-';
    const d = new Date(dt);
    return `${d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short'
    })} ${d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })}`;
  };

  const handleOpenDetail = async (bookingId) => {
    if (onViewDetail) onViewDetail(bookingId);
    setIsDetailOpen(true);
    setIsDetailLoading(true);
    try {
      const res = await api.getBookingDetails(bookingId);
      if (res && res.booking) {
        setDetailBooking(res.booking);
      } else {
        const found = records.find((r) => r.id === bookingId);
        setDetailBooking(found || null);
      }
    } catch (err) {
      const found = records.find((r) => r.id === bookingId);
      setDetailBooking(found || null);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(filteredRecords.map((r) => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteRecord = async (bookingId) => {
    const confirmed = await showConfirm({
      title: 'Delete Stay History Record?',
      message: `Are you sure you want to permanently delete booking record #${bookingId}? This cannot be undone.`,
      icon: '🗑️',
      confirmText: 'Yes, Delete',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      const res = await api.delete(`/hospitality/history/${bookingId}`);
      if (res && res.success) {
        showToast(`Stay record #${bookingId} deleted.`, 'green');
        loadHistory(true);
      }
    } catch (err) {
      showToast('Error deleting record: ' + err.message, 'red');
    }
  };

  const handleDeleteSelected = async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const confirmed = await showConfirm({
      title: `Delete ${count} Selected Records?`,
      message: `Are you sure you want to delete ${count} booking records?`,
      icon: '🗑️',
      confirmText: 'Delete Selected',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      const idList = Array.from(selectedIds);
      const res = await api.post('/hospitality/history/bulk-delete', {
        ids: idList,
        booking_ids: idList
      });
      if (res && res.success) {
        showToast(`${count} records deleted.`, 'green');
        setSelectedIds(new Set());
        loadHistory(true);
      }
    } catch (err) {
      showToast('Error deleting records: ' + err.message, 'red');
    }
  };

  const handleClearAll = async () => {
    const confirmed = await showConfirm({
      title: 'Clear All Completed Stay Records?',
      message: 'This will permanently delete all completed checkout records. Active stays will remain untouched.',
      icon: '⚠️',
      confirmText: 'Clear All History',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      const res = await api.post('/hospitality/history/clear-all');
      if (res && res.success) {
        showToast('All completed stay records cleared.', 'green');
        loadHistory(true);
      }
    } catch (err) {
      showToast('Error clearing records: ' + err.message, 'red');
    }
  };

  return (
    <div className="hosp-sub-content active" id="hosp-subview-history">
      {/* History Toolbar with Live Search and Filters */}
      <div className="history-toolbar-card">
        <div className="history-search-row">
          <div className="history-search-box">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by Guest Name, Mobile, Room #, Booking ID, or Cashier Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            )}
          </div>

          <div className="history-filter-chips">
            {['all', 'today', 'week', 'month'].map((range) => (
              <button
                key={range}
                type="button"
                className={`history-chip ${dateRange === range ? 'active' : ''}`}
                onClick={() => setDateRange(range)}
              >
                {range === 'all'
                  ? 'All Time'
                  : range === 'today'
                  ? 'Today'
                  : range === 'week'
                  ? 'This Week'
                  : 'This Month'}
              </button>
            ))}
            <button
              type="button"
              className={`history-chip ${dateRange === 'pending_btc' ? 'active' : ''}`}
              onClick={() => setDateRange('pending_btc')}
              style={{
                background: dateRange === 'pending_btc' ? '#dc2626' : (pendingBtcCount > 0 ? '#fef2f2' : undefined),
                color: dateRange === 'pending_btc' ? '#ffffff' : (pendingBtcCount > 0 ? '#dc2626' : undefined),
                borderColor: dateRange === 'pending_btc' ? '#b91c1c' : (pendingBtcCount > 0 ? '#f87171' : undefined),
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Filter by Pending Bill to Company (BTC) Bookings"
            >
              <span>🏢 Pending BTC</span>
              {pendingBtcCount > 0 && (
                <span
                  style={{
                    background: dateRange === 'pending_btc' ? '#ffffff' : '#dc2626',
                    color: dateRange === 'pending_btc' ? '#dc2626' : '#ffffff',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '0.72rem',
                    fontWeight: 900
                  }}
                >
                  {pendingBtcCount}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {selectedIds.size > 0 && (
              <button
                type="button"
                className="btn-refresh-history"
                onClick={handleDeleteSelected}
                style={{
                  color: '#dc2626',
                  borderColor: '#fca5a5',
                  background: '#fee2e2',
                  fontWeight: 800
                }}
                title="Delete Selected Records"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            )}

            <button
              type="button"
              className="btn-refresh-history"
              onClick={() => loadHistory(true)}
              title="Reload History Records"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>Refresh</span>
            </button>

            <button
              type="button"
              className="btn-refresh-history"
              onClick={handleClearAll}
              style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fff1f2' }}
              title="Clear All Completed Stay Records"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              <span>Clear All</span>
            </button>
          </div>
        </div>

        <div className="history-stats-bar">
          <span>Showing {filteredRecords.length} completed stays</span>
          <span className="stats-sep">•</span>
          <span>Total Revenue: {formatCurrency(totalRev)}</span>
          {pendingBtcCount > 0 && (
            <>
              <span className="stats-sep">•</span>
              <span style={{ color: '#dc2626', fontWeight: 800 }}>
                🏢 {pendingBtcCount} Pending BTC Stay{pendingBtcCount > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      </div>

      {/* History Data Table */}
      <div className="history-table-container">
        <table className="history-data-table">
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={filteredRecords.length > 0 && selectedIds.size === filteredRecords.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  title="Select / Deselect All Rows"
                  style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#dc2626' }}
                />
              </th>
              <th style={{ width: '90px' }}>Booking #</th>
              <th style={{ width: '120px' }}>Room(s)</th>
              <th>Guest Details</th>
              <th style={{ width: '160px' }}>Check-In</th>
              <th style={{ width: '160px' }}>Check-Out</th>
              <th style={{ width: '130px' }}>Stay Duration</th>
              <th style={{ width: '150px' }}>Amount Paid</th>
              <th style={{ width: '170px' }}>Cashier Staff</th>
              <th style={{ width: '160px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((r) => {
              const isCheckedOut = r.status === 'checked_out';
              const isSelected = selectedIds.has(r.id);
              const isBtcPending =
                (r.booking_source === 'BTC' || r.btc_company_id !== null || r.final_payment_mode === 'btc' || r.payment_status === 'pending_from_company') &&
                r.payment_status !== 'settled';
              const isPending =
                isBtcPending ||
                r.payment_status === 'pending' ||
                r.payment_status === 'pending_from_company';

              const guestAvatar = r.guest_photo ? (
                <img
                  src={r.guest_photo}
                  alt={r.guest_name}
                  onClick={() => {
                    setLightboxImg(r.guest_photo);
                    setLightboxTitle(`${r.guest_name} - Guest Photo`);
                  }}
                  title="Click to zoom / scroll"
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    objectFit: 'cover',
                    border: '1.5px solid #e2e8f0',
                    cursor: 'pointer'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.1rem'
                  }}
                >
                  👤
                </div>
              );

              const modeLabel = (
                r.final_payment_mode ||
                r.advance_payment_mode ||
                'Cash'
              ).toUpperCase();

              return (
                <tr
                  key={r.id}
                  onClick={() => handleOpenDetail(r.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(r.id)}
                      style={{
                        width: '17px',
                        height: '17px',
                        cursor: 'pointer',
                        accentColor: '#dc2626'
                      }}
                    />
                  </td>
                  <td style={{ fontWeight: 800, color: '#64748b', fontSize: '0.82rem' }}>
                    #{r.id}
                  </td>
                  <td>
                    <span
                      style={{
                        fontWeight: 800,
                        color: '#0071e3',
                        background: '#eff6ff',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #dbeafe'
                      }}
                    >
                      🔑 #{r.room_number || (r.all_group_rooms ? r.all_group_rooms.map(x => typeof x === 'object' && x !== null ? (x.room_number || x.number) : x).filter(Boolean).join(', #') : '')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {guestAvatar}
                      <div>
                        <div style={{ fontWeight: 750, color: '#0f172a', fontSize: '0.9rem' }}>
                          {r.guest_name || 'N/A'}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                          📱 {r.mobile || '-'} • {r.doc_type || 'ID'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                      {formatShortDT(r.checkin_time)}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {r.booking_source || 'Walk-in'}
                    </div>
                  </td>
                  <td>
                    <div
                      style={{
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        color: isCheckedOut ? '#0071e3' : '#64748b'
                      }}
                    >
                      {formatShortDT(r.checkout_time || r.approx_checkout_time)}
                    </div>
                    <div>
                      {isCheckedOut ? (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: '#dcfce7',
                            color: '#166534'
                          }}
                        >
                          CHECKED OUT
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: '#eff6ff',
                            color: '#1d4ed8'
                          }}
                        >
                          ACTIVE STAY
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div>
                      <span style={{ fontWeight: 750, color: '#334155', fontSize: '0.82rem' }}>
                        {r.stay_duration_str || '1 Day'}
                      </span>
                      {r.expected_stay_str && (
                        <div style={{ fontSize: '0.70rem', color: '#dc2626', fontWeight: 750, marginTop: '2px' }}>
                          ⚡ Early (Exp: {r.expected_stay_str})
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 850,
                        color: isBtcPending ? '#dc2626' : (isPending ? '#b45309' : '#15803d')
                      }}
                    >
                      {formatCurrency(r.total_room_charge || r.total_paid || 0)}
                    </div>
                    {r.refund_amount > 0 && (
                      <div style={{ marginTop: '2px' }}>
                        <span
                          style={{
                            fontSize: '0.70rem',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '6px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fca5a5',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title={`Debit Voucher: ${r.refund_voucher_no || 'DEB'} • ${r.refund_reason || 'Early checkout refund'}`}
                        >
                          ↩️ Refund: -{formatCurrency(r.refund_amount)} ({String(r.refund_mode || 'CASH').toUpperCase()})
                        </span>
                      </div>
                    )}
                    <div style={{ marginTop: '3px' }}>
                      {isBtcPending ? (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSettleBtc(r);
                          }}
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 850,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: '#fef2f2',
                            color: '#dc2626',
                            border: '1.5px solid #f87171',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Click to Settle Pending BTC Payment from Company"
                        >
                          🏢 Pending BTC ✏️
                        </span>
                      ) : (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onChangePaymentStatus) onChangePaymentStatus(r);
                          }}
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '2px 7px',
                            borderRadius: '6px',
                            background: isPending ? '#fffbeb' : '#dcfce7',
                            color: isPending ? '#b45309' : '#166534',
                            border: `1px solid ${isPending ? '#fde68a' : '#bbf7d0'}`,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Click to Change Payment Status"
                        >
                          {isPending ? `⏳ Pending (${modeLabel}) ✏️` : `✓ Passed (${modeLabel}) ✏️`}
                        </span>
                      )}
                    </div>
                    {r.btc_company_name && (
                      <div style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 700, marginTop: '2px' }}>
                        🏢 {r.btc_company_name}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem' }}>
                      <span style={{ color: '#1e3a8a' }}>
                        📥 In: <strong>{r.checked_in_by || 'Front Desk'}</strong>
                      </span>
                      {r.checked_out_by && (
                        <span style={{ color: '#15803d' }}>
                          📤 Out: <strong>{r.checked_out_by}</strong>
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'nowrap' }}>
                      {isBtcPending && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSettleBtc(r);
                          }}
                          style={{
                            padding: '5px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 850,
                            background: '#dc2626',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)'
                          }}
                          title="Accept and Settle Corporate Bill from Company"
                        >
                          💳 Settle BTC
                        </button>
                      )}
                      {isBtcPending ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDocActionModal({ isOpen: true, type: 'checkin', data: r });
                          }}
                          style={{
                            padding: '5px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            background: '#faf5ff',
                            color: '#6b21a8',
                            border: '1.5px solid #d8b4fe',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                          title="Check-In Form (Save, Print, or Save & Print)"
                        >
                          📄 Form
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDocActionModal({
                              isOpen: true,
                              type: 'invoice',
                              data: {
                                room: r,
                                calc: {
                                  grossTariff: r.total_room_charge || r.room_rate,
                                  roomCharge: r.total_room_charge || r.room_rate,
                                  roomTariffNet: r.total_room_charge,
                                  tariffTax5Pct: Math.round((r.total_room_charge || 0) * 0.05),
                                  foodTotal: r.food_total || 0,
                                  barTotal: r.bar_total || 0,
                                  hotelExtrasCharge: r.extra_bed_charge || 0,
                                  advancePaid: r.initial_paid || r.total_paid || 0,
                                  chargedDays: r.charged_days || 1,
                                  billableDays: r.charged_days || 1,
                                  discountPct: r.discount_pct || 0,
                                  discountAmount: r.discount_amount || 0
                                },
                                settlement: {
                                  settleAmt: r.final_settle_amount || r.total_paid || 0,
                                  refundAmt: r.refund_amount || 0,
                                  settled_at: r.actual_checkout_time || r.checkout_time || new Date(),
                                  invoiceNo: r.invoice_no || (r.id ? `L${r.id}` : 'L1573'),
                                  checked_out_by: r.checked_out_by || 'Front Desk'
                                }
                              }
                            });
                          }}
                          style={{
                            padding: '5px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            background: '#eff6ff',
                            color: '#1e40af',
                            border: '1.5px solid #bfdbfe',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                          title="Official Tax Invoice (Save, Print, or Save & Print)"
                        >
                          🧾 Tax Invoice
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetail(r.id);
                        }}
                        style={{
                          padding: '5px 10px',
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          background: '#0071e3',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                        title="View Details & Payment History"
                      >
                        👁️ View
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRecord(r.id);
                        }}
                        style={{
                          padding: '5px 9px',
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          background: '#fff1f2',
                          color: '#dc2626',
                          border: '1.5px solid #fecaca',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                        title="Delete History Record"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredRecords.length === 0 && !isLoading && (
          <div className="history-empty-state">
            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>📜</div>
            <h3 style={{ margin: '0 0 4px', fontWeight: 800, color: '#334155' }}>No Stay History Found</h3>
            <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b' }}>
              Completed guest checkouts and past bookings will appear here automatically.
            </p>
          </div>
        )}
      </div>

      {/* Comprehensive Stay Detail & Payment History Modal (Points 6 & 12) */}
      {isDetailOpen && (
        <div
          className="modal-overlay active"
          style={{
            zIndex: 10050,
            padding: 0,
            margin: 0,
            width: '100vw',
            height: '100vh',
            maxWidth: '100vw',
            maxHeight: '100vh',
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'stretch'
          }}
        >
          <div
            className="modal-container"
            style={{
              width: '100vw',
              height: '100vh',
              maxWidth: '100vw',
              maxHeight: '100vh',
              borderRadius: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'none',
              border: 'none',
              background: 'var(--bg-app, #f8fafc)'
            }}
          >
            <div className="modal-header" style={{ padding: '16px 32px', borderBottom: '1.5px solid var(--border-color, #e2e8f0)', background: 'var(--bg-surface, #ffffff)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.6rem', padding: '6px 10px', background: 'rgba(56, 189, 248, 0.15)', borderRadius: '10px' }}>📜</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                    Stay Details &amp; Payment History — {detailBooking ? `Booking #${detailBooking.id}` : 'Loading...'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #64748b)' }}>
                    Archived stay folio, housekeeping cleaner records, and cash receipts
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setIsDetailOpen(false);
                  setDetailBooking(null);
                }}
              >
                &times;
              </button>
            </div>

            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
              {isDetailLoading || !detailBooking ? (
                <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--text-secondary, #64748b)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⏳</div>
                  <div>Loading stay &amp; payment records...</div>
                </div>
              ) : (
                <>
                  {/* BTC Settlement Alert Banner if Pending */}
                  {Boolean(
                    (detailBooking.booking_source === 'BTC' || detailBooking.btc_company_id !== null || detailBooking.final_payment_mode === 'btc' || detailBooking.payment_status === 'pending_from_company') &&
                    detailBooking.payment_status !== 'settled'
                  ) && (
                    <div style={{ padding: '14px 18px', background: '#fef2f2', border: '1.5px solid #f87171', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '1.6rem' }}>🏢</span>
                        <div>
                          <div style={{ fontWeight: 850, color: '#dc2626', fontSize: '0.95rem' }}>
                            Payment Pending from Company: {formatCurrency(detailBooking.total_room_charge || 0)}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#991b1b', marginTop: '2px' }}>
                            Company: <strong>{detailBooking.btc_company_name || 'Corporate'}</strong> {detailBooking.btc_approval_ref ? `• Approval Ref: ${detailBooking.btc_approval_ref}` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenSettleBtc(detailBooking)}
                        style={{
                          padding: '8px 18px',
                          fontSize: '0.85rem',
                          fontWeight: 850,
                          background: '#dc2626',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)'
                        }}
                      >
                        💳 Settle BTC Payment
                      </button>
                    </div>
                  )}

                  {/* Guest Identity Card */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '18px', padding: '18px', background: 'var(--bg-surface-secondary, #f8fafc)', borderRadius: '14px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <div>
                      {detailBooking.guest_photo ? (
                        <img
                          src={detailBooking.guest_photo}
                          alt={detailBooking.guest_name}
                          style={{ width: '80px', height: '80px', borderRadius: '12px', objectFit: 'cover', border: '2px solid var(--border-color, #cbd5e1)' }}
                        />
                      ) : (
                        <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.2rem' }}>
                          👤
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
                            {detailBooking.guest_name}
                          </h4>
                          <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '4px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                            <span>📱 <strong>{detailBooking.mobile || detailBooking.phone || '-'}</strong></span>
                            {detailBooking.email && <span>✉️ {detailBooking.email}</span>}
                            {detailBooking.father_name && <span>👨 Father: {detailBooking.father_name}</span>}
                            {detailBooking.aadhar_number && (
                              <span>
                                🆔 {(detailBooking.doc_type && detailBooking.doc_type.toLowerCase().includes('passport'))
                                  ? 'Passport'
                                  : (detailBooking.doc_type && (detailBooking.doc_type.toLowerCase().includes('licen') || detailBooking.doc_type.toLowerCase().includes('driving')))
                                    ? 'Driving License'
                                    : (detailBooking.doc_type && detailBooking.doc_type.toLowerCase().includes('pan'))
                                      ? 'PAN'
                                      : (detailBooking.doc_type && detailBooking.doc_type.toLowerCase().includes('voter'))
                                        ? 'Voter ID'
                                        : 'Aadhaar'}: <strong>{detailBooking.aadhar_number}</strong>
                              </span>
                            )}
                          </div>
                          {detailBooking.address && (
                            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '4px' }}>
                              📍 {detailBooking.address}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 800, padding: '4px 10px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '6px' }}>
                          Room #{detailBooking.room_number || '-'}
                        </span>
                      </div>

                      {/* ID proof scan badges */}
                      <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.76rem', fontWeight: 750, color: '#64748b' }}>
                          ID Proof: <strong style={{ color: '#0f172a' }}>{detailBooking.doc_type || 'Aadhar Card'}</strong>
                        </span>
                        {detailBooking.doc_front && (
                          <a
                            href={detailBooking.doc_front}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: '0.74rem', padding: '2px 8px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0071e3', textDecoration: 'none', fontWeight: 700 }}
                          >
                            📄 View Front ID
                          </a>
                        )}
                        {detailBooking.doc_back && (
                          <a
                            href={detailBooking.doc_back}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: '0.74rem', padding: '2px 8px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0071e3', textDecoration: 'none', fontWeight: 700 }}
                          >
                            📄 View Back ID
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Early Checkout & Refund / Debit Details Banner */}
                  {(detailBooking.refund_amount > 0 || detailBooking.refund_voucher_no) && (
                    <div style={{
                      padding: '16px 20px',
                      background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
                      border: '2px solid #fca5a5',
                      borderRadius: '14px',
                      boxShadow: '0 2px 10px rgba(220, 38, 38, 0.06)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.4rem' }}>💸</span>
                          <div>
                            <strong style={{ fontSize: '1.05rem', color: '#991b1b' }}>
                              Guest Refund / Debit Processed ({detailBooking.refund_voucher_no || 'DEB'})
                            </strong>
                            <div style={{ fontSize: '0.78rem', color: '#7f1d1d' }}>
                              Excess advance refunded to guest on early departure / billing adjustment
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.84rem', fontWeight: 850, background: '#fee2e2', color: '#991b1b', padding: '4px 12px', borderRadius: '10px', border: '1px solid #f87171' }}>
                          Returned: -{formatCurrency(detailBooking.refund_amount || 0)} via {String(detailBooking.refund_mode || 'CASH').toUpperCase()}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginTop: '10px', fontSize: '0.82rem' }}>
                        <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                          <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Stay Duration</span>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {detailBooking.stay_duration_str || '1 Day'} {detailBooking.expected_stay_str ? `(Expected: ${detailBooking.expected_stay_str})` : ''}
                          </div>
                        </div>
                        <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                          <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Voucher &amp; Account</span>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{detailBooking.refund_voucher_no || 'DEB'} • Guest Refund A/c</div>
                        </div>
                        <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                          <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Processed By</span>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{detailBooking.checked_out_by || 'Cashier'}</div>
                        </div>
                        {detailBooking.refund_utr && (
                          <div style={{ background: '#ffffff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                            <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700 }}>Online UTR Ref</span>
                            <div style={{ fontWeight: 800, color: '#0369a1' }}>{detailBooking.refund_utr}</div>
                          </div>
                        )}
                      </div>
                      {detailBooking.refund_reason && (
                        <div style={{ marginTop: '10px', fontSize: '0.80rem', color: '#7f1d1d', fontStyle: 'italic' }}>
                          Reason / Notes: {detailBooking.refund_reason}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Companion Room Members Section (Point 1) */}
                  {Array.isArray(detailBooking.member_documents) && detailBooking.member_documents.length > 0 && (
                    <div style={{ padding: '14px 18px', background: '#f8fafc', borderRadius: '12px', border: '1.5px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '1.1rem' }}>👥</span>
                          <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                            Room Companions &amp; Scanned Documents ({detailBooking.member_documents.length})
                          </span>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Scanned documents stored in system</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                        {detailBooking.member_documents.map((m, idx) => (
                          <div key={idx} style={{ padding: '10px', background: '#ffffff', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{m.name || `Member ${idx + 1}`}</strong>
                                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                                  {m.relation && <span style={{ marginRight: '8px' }}>Rel: <strong>{m.relation}</strong></span>}
                                  {(m.dob || m.age) && <span style={{ marginRight: '8px' }}>Age: <strong>{m.age ? `${m.age} Yrs` : m.dob}</strong></span>}
                                  {m.aadharNumber && <span>ID: <strong>{m.aadharNumber}</strong></span>}
                                </div>
                              </div>
                              <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                {m.docType || 'ID Proof'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              {m.docFront && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLightboxImg(m.docFront);
                                    setLightboxTitle(`${m.name} - Front ID`);
                                  }}
                                  style={{ background: 'none', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px', overflow: 'hidden', width: '56px', height: '40px', cursor: 'pointer' }}
                                  title="Click to zoom / scroll Front ID"
                                >
                                  <img src={m.docFront} alt="Front ID" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </button>
                              )}
                              {m.docBack && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLightboxImg(m.docBack);
                                    setLightboxTitle(`${m.name} - Back ID`);
                                  }}
                                  style={{ background: 'none', padding: 0, border: '1px solid #cbd5e1', borderRadius: '4px', overflow: 'hidden', width: '56px', height: '40px', cursor: 'pointer' }}
                                  title="Click to zoom / scroll Back ID"
                                >
                                  <img src={m.docBack} alt="Back ID" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stay Overview Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
                    <div style={{ padding: '12px', background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 750, color: '#64748b', textTransform: 'uppercase' }}>Check-In</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                        {formatDateTime(detailBooking.checkin_time)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b' }}>By: {detailBooking.checked_in_by || 'Cashier'}</div>
                    </div>

                    <div style={{ padding: '12px', background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 750, color: '#64748b', textTransform: 'uppercase' }}>Check-Out</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                        {formatDateTime(detailBooking.checkout_time || detailBooking.approx_checkout_time)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#15803d' }}>Out by: {detailBooking.checked_out_by || 'Cashier'}</div>
                    </div>

                    <div style={{ padding: '12px', background: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 750, color: '#64748b', textTransform: 'uppercase' }}>Source &amp; Plan</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                        {detailBooking.booking_source || 'Walk-in'}
                        {detailBooking.ota_platform ? ` (${detailBooking.ota_platform})` : ''}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309' }}>
                        {detailBooking.meal_plan === 'with_breakfast' ? '🍽️ With Breakfast' : 'Room Only'}
                      </div>
                    </div>

                    <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 750, color: '#166534', textTransform: 'uppercase' }}>Total Stay Revenue</span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', marginTop: '2px' }}>
                        {formatCurrency(detailBooking.total_paid || detailBooking.total_room_charge || 0)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#166534' }}>Settled &amp; Completed</div>
                    </div>
                  </div>

                  {/* Housekeeping & Cleanliness Info (Point 12) */}
                  <div style={{ padding: '14px 18px', background: '#f8fafc', borderRadius: '12px', border: '1.5px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.1rem' }}>🧹</span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        Housekeeping &amp; Inspection Record
                      </span>
                    </div>
                    <div style={{ fontSize: '0.95rem', color: '#334155' }}>
                      Room Cleaned &amp; Prepared By:{' '}
                      <strong style={{ color: '#0071e3', fontSize: '1.05rem' }}>
                        {detailBooking.cleaned_by || detailBooking.last_cleaned_by || 'Housekeeping Staff'}
                      </strong>
                      {detailBooking.cleaned_at && (
                        <span style={{ marginLeft: '12px', fontSize: '0.82rem', color: '#64748b' }}>
                          • Cleaned on {formatDateTime(detailBooking.cleaned_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Payment History & Cash Receipts Table (Point 6) */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.15rem' }}>💳</span>
                        <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 850, color: '#0f172a' }}>
                          Payment History &amp; Cash Receipts
                        </h4>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Click "Receipt" to print official cash receipt (Receipt 1, 2-on-A4)
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '12px', border: '1.5px solid #e2e8f0' }}>
                      <table className="owner-rooms-table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                          <tr>
                            <th>Receipt #</th>
                            <th>Date / Time</th>
                            <th>Type</th>
                            <th>Payment Mode</th>
                            <th>Amount (₹)</th>
                            <th>Cashier</th>
                            <th style={{ textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const allPayments = [...(Array.isArray(detailBooking.payments) ? detailBooking.payments : [])];
                            if (detailBooking.refund_amount > 0 && !allPayments.some(p => p.payment_type === 'refund')) {
                              allPayments.push({
                                id: `refund-${detailBooking.id}`,
                                receipt_no: detailBooking.refund_voucher_no || `DEB-${detailBooking.id}`,
                                payment_type: 'refund',
                                payment_mode: detailBooking.refund_mode || 'CASH',
                                amount: detailBooking.refund_amount,
                                created_at: detailBooking.checkout_time || detailBooking.actual_checkout_time || detailBooking.created_at || new Date().toISOString(),
                                cashier_name: detailBooking.checked_out_by || 'Front Desk',
                                notes: detailBooking.refund_reason || 'Early checkout adjustment',
                                utr_number: detailBooking.refund_utr || null
                              });
                            }

                            if (allPayments.length > 0) {
                              return allPayments.map((p) => {
                                const isRefundRow = p.payment_type === 'refund' || (p.notes && p.notes.toLowerCase().includes('refund')) || (p.amount < 0);
                                return (
                                  <tr key={p.id} style={{ background: isRefundRow ? '#fff1f2' : 'inherit' }}>
                                    <td style={{ fontWeight: 800, color: isRefundRow ? '#b91c1c' : '#0f172a' }}>
                                      {p.receipt_no || `RCP-${p.id}`}
                                      {isRefundRow && (
                                        <span style={{ fontSize: '0.66rem', fontWeight: 850, background: '#fee2e2', color: '#991b1b', padding: '2px 5px', borderRadius: '4px', marginLeft: '6px', border: '1px solid #fca5a5' }}>
                                          DEBIT
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                      {formatDateTime(p.created_at)}
                                    </td>
                                    <td>
                                      {isRefundRow ? (
                                        <div>
                                          <span style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 800 }}>
                                            💸 Refund / Debit
                                          </span>
                                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                            {p.notes || detailBooking.refund_reason || 'Early checkout adjustment'}
                                          </div>
                                        </div>
                                      ) : (
                                        <span style={{ textTransform: 'capitalize', fontSize: '0.8rem', fontWeight: 700 }}>
                                          {p.payment_type ? p.payment_type.replace('_', ' ') : 'Stay Payment'}
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      <span style={{ textTransform: 'uppercase', fontSize: '0.74rem', fontWeight: 800, background: isRefundRow ? '#fee2e2' : '#eff6ff', color: isRefundRow ? '#991b1b' : '#1d4ed8', padding: '2px 8px', borderRadius: '6px', border: isRefundRow ? '1px solid #fca5a5' : 'none' }}>
                                        {p.payment_mode || 'CASH'}
                                      </span>
                                      {p.utr_number && (
                                        <div style={{ fontSize: '0.70rem', color: '#0369a1', marginTop: '2px' }}>
                                          UTR: {p.utr_number}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      <strong style={{ color: isRefundRow ? '#dc2626' : '#15803d', fontSize: '0.95rem' }}>
                                        {isRefundRow ? `- ${formatCurrency(Math.abs(p.amount))}` : formatCurrency(p.amount)}
                                      </strong>
                                    </td>
                                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                      {p.cashier_name || 'Cashier'}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      {isRefundRow ? (
                                        <button
                                          type="button"
                                          className="filter-chip"
                                          onClick={() =>
                                            printPettyCashVoucher({
                                              voucher_no: p.receipt_no || detailBooking.refund_voucher_no || `DEB-${p.id}`,
                                              created_at: p.created_at,
                                              expense_date: p.created_at,
                                              guest_name: detailBooking.guest_name,
                                              paid_to: detailBooking.guest_name,
                                              amount: Math.abs(p.amount),
                                              payment_mode: p.payment_mode || 'cash',
                                              category: 'refund',
                                              debit_account: 'Guest Refund A/c',
                                              description: p.notes || detailBooking.refund_reason || 'Early checkout refund',
                                              room_number: detailBooking.room_number,
                                              cashier_name: p.cashier_name || detailBooking.checked_out_by || 'Front Desk'
                                            })
                                          }
                                          style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#b91c1c', borderColor: '#fca5a5', background: '#fff1f2' }}
                                          title="Print Official Debit / Refund Voucher"
                                        >
                                          🖨️ Debit Voucher
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="filter-chip"
                                          onClick={() =>
                                            printCashReceipt({
                                              receipt_no: p.receipt_no || `RCP-${p.id}`,
                                              receipt_date: p.created_at,
                                              guest_name: detailBooking.guest_name,
                                              amount: p.amount,
                                              payment_mode: p.payment_mode,
                                              split_cash: p.split_cash,
                                              split_online: p.split_online,
                                              split_card: p.split_card,
                                              split_cheque: p.split_cheque,
                                              utr_number: p.utr_number,
                                              cheque_no: p.cheque_no,
                                              bank_name: p.bank_name,
                                              room_numbers: detailBooking.room_number,
                                              particulars: `Stay Payment - Room ${detailBooking.room_number}`,
                                              cashier_name: p.cashier_name || p.cashier || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                            })
                                          }
                                          style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                                          title="Print Official Cash Receipt (2-on-A4)"
                                        >
                                          🖨️ Receipt
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              });
                            }

                            return (
                              <tr>
                                <td style={{ fontWeight: 800, color: '#0f172a' }}>
                                  {`RCP-${detailBooking.id}`}
                                </td>
                                <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                  {formatDateTime(detailBooking.checkout_time || detailBooking.checkin_time)}
                                </td>
                                <td>
                                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Stay Total Settlement</span>
                                </td>
                                <td>
                                  <span style={{ textTransform: 'uppercase', fontSize: '0.74rem', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '6px' }}>
                                    {detailBooking.final_payment_mode || detailBooking.advance_payment_mode || 'CASH'}
                                  </span>
                                </td>
                                <td>
                                  <strong style={{ color: '#15803d', fontSize: '0.95rem' }}>
                                    {formatCurrency(detailBooking.total_paid || detailBooking.total_room_charge || 0)}
                                  </strong>
                                </td>
                                <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                  {detailBooking.checked_out_by || detailBooking.checked_in_by || 'Cashier'}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="filter-chip"
                                    onClick={() =>
                                      printCashReceipt({
                                        receipt_no: `RCP-${detailBooking.id}`,
                                        receipt_date: detailBooking.checkout_time || detailBooking.checkin_time,
                                        guest_name: detailBooking.guest_name,
                                        amount: detailBooking.total_paid || detailBooking.total_room_charge || 0,
                                        payment_mode: detailBooking.final_payment_mode || 'Cash',
                                        split_cash: detailBooking.split_cash || detailBooking.final_split_cash,
                                        split_online: detailBooking.split_online || detailBooking.final_split_online,
                                        split_card: detailBooking.split_card || detailBooking.final_split_card,
                                        split_cheque: detailBooking.split_cheque || detailBooking.final_split_cheque,
                                        utr_number: detailBooking.utr_number || detailBooking.advance_utr_number || detailBooking.final_settlement_utr,
                                        cheque_no: detailBooking.cheque_no || detailBooking.advance_cheque_no,
                                        bank_name: detailBooking.bank_name || detailBooking.advance_cheque_bank,
                                        room_numbers: detailBooking.room_number,
                                        particulars: `Stay Settlement - Room ${detailBooking.room_number}`,
                                        cashier_name: detailBooking.checked_out_by || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                      })
                                    }
                                    style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                                    title="Print Official Cash Receipt (2-on-A4)"
                                  >
                                    🖨️ Receipt
                                  </button>
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '14px 32px', background: '#ffffff', borderTop: '1.5px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                {detailBooking && (() => {
                  const isDetailBtcPending = (
                    detailBooking.payment_status === 'pending_from_company' ||
                    detailBooking.is_btc_pending ||
                    detailBooking.isBtcPending ||
                    (
                      (detailBooking.booking_source === 'BTC' || Boolean(detailBooking.btc_company_id) || Boolean(detailBooking.btc_company_name)) &&
                      detailBooking.payment_status !== 'settled' &&
                      detailBooking.payment_status !== 'paid'
                    )
                  );

                  return (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => {
                          setDocActionModal({ isOpen: true, type: 'checkin', data: detailBooking });
                        }}
                        style={{
                          fontWeight: 800,
                          padding: '8px 14px',
                          fontSize: '0.85rem',
                          background: isDetailBtcPending ? '#faf5ff' : 'var(--bg-surface)',
                          color: isDetailBtcPending ? '#6b21a8' : 'inherit',
                          borderColor: isDetailBtcPending ? '#d8b4fe' : 'var(--border-color)'
                        }}
                        title="Official Guest Check-In Form (Print to Paper, Save PDF, or Save & Print)"
                      >
                        {isDetailBtcPending ? '📄 Check-In Form (BTC Details)' : '📋 Check-In Form'}
                      </button>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => {
                          setDocActionModal({ isOpen: true, type: 'info', data: detailBooking });
                        }}
                        style={{ fontWeight: 800, padding: '8px 14px', fontSize: '0.85rem', background: '#f0fdf4', color: '#166534', borderColor: '#86efac' }}
                        title="Guest Info & Verification Vault with all Scans & Photos (Print to Paper, Save PDF, or Save & Print)"
                      >
                        💾 Info
                      </button>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => {
                          setDocActionModal({ isOpen: true, type: 'summary', data: detailBooking });
                        }}
                        style={{ fontWeight: 800, padding: '8px 14px', fontSize: '0.85rem', background: '#eff6ff', color: '#1e40af', borderColor: '#93c5fd' }}
                        title="Customer Payment Summary Statement (Save, Print, or Save & Print)"
                      >
                        📄 Payment Summary
                      </button>
                      {isDetailBtcPending ? (
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => {
                            showToast('⚠️ Payment is pending from company. Settle BTC payment first to release official Tax Invoice.', 'amber', 5000);
                          }}
                          style={{ fontWeight: 800, padding: '8px 14px', fontSize: '0.85rem', background: '#f8fafc', color: '#94a3b8', borderColor: '#cbd5e1', cursor: 'not-allowed' }}
                          title="Tax invoice locked: Payment is pending from company. Settle BTC payment first to release Tax Invoice."
                        >
                          🔒 Tax Invoice (Pending Company Payment)
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => {
                            setDocActionModal({
                              isOpen: true,
                              type: 'invoice',
                              data: {
                                room: detailBooking,
                                calc: {
                                  grossTariff: detailBooking.grossTariff || detailBooking.total_room_charge || detailBooking.room_rate,
                                  roomCharge: detailBooking.total_room_charge || detailBooking.room_rate,
                                  roomTariffNet: detailBooking.grossTariff || detailBooking.total_room_charge,
                                  tariffTax5Pct: detailBooking.tax_amount || detailBooking.total_tax,
                                  foodTotal: detailBooking.food_total || 0,
                                  barTotal: detailBooking.bar_total || 0,
                                  hotelExtrasCharge: detailBooking.extra_bed_charge || 0,
                                  advancePaid: detailBooking.initial_paid || detailBooking.total_paid || 0,
                                  chargedDays: detailBooking.charged_days || 1,
                                  billableDays: detailBooking.charged_days || 1,
                                  discountPct: detailBooking.discount_pct || 0,
                                  discountAmount: detailBooking.discount_amount || 0
                                },
                                settlement: {
                                  settleAmt: detailBooking.final_settle_amount || 0,
                                  refundAmt: detailBooking.refund_amount || 0,
                                  settled_at: detailBooking.actual_checkout_time || detailBooking.checkout_time || new Date(),
                                  invoiceNo: detailBooking.invoice_no || (detailBooking.id ? `L${detailBooking.id}` : 'L1573'),
                                  checked_out_by: detailBooking.checked_out_by || 'Front Desk'
                                }
                              }
                            });
                          }}
                          style={{ fontWeight: 800, padding: '8px 14px', fontSize: '0.85rem', background: '#fef2f2', color: '#991b1b', borderColor: '#fca5a5' }}
                          title="Official Tax Invoice (Save, Print, or Save & Print)"
                        >
                          🧾 Tax Invoice
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setIsDetailOpen(false);
                  setDetailBooking(null);
                }}
                style={{ padding: '8px 22px', fontWeight: 800 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settle BTC Payment Modal */}
      {settleBtcTarget && (
        <div className="modal-overlay active" style={{ zIndex: 10100 }}>
          <div className="modal-container" style={{ maxWidth: '580px', width: '95%' }}>
            <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1.5px solid var(--border-color, #e2e8f0)', background: 'var(--bg-surface, #ffffff)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem', padding: '6px 10px', background: '#fee2e2', borderRadius: '10px', color: '#dc2626' }}>🏢</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
                    Settle Corporate BTC Payment
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
                    Booking #{settleBtcTarget.id} • {settleBtcTarget.guest_name} • Room #{settleBtcTarget.room_number || (settleBtcTarget.rooms ? settleBtcTarget.rooms.join(', #') : '-')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSettleBtcTarget(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              {/* Target info card */}
              <div style={{ padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>Company Name:</div>
                  <div style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 850 }}>
                    {settleBtcTarget.btc_company_name || 'Corporate Ledger'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700 }}>Total Billed:</div>
                  <div style={{ fontSize: '1.1rem', color: '#dc2626', fontWeight: 900 }}>
                    {formatCurrency(settleBtcTarget.total_room_charge || 0)}
                  </div>
                </div>
              </div>

              {/* Amount to Settle */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Settlement Amount Received (₹) *
                </label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  step="any"
                  value={settleBtcAmount}
                  onChange={(e) => setSettleBtcAmount(e.target.value)}
                  style={{ height: '42px', fontSize: '1rem', fontWeight: 800, background: 'var(--bg-app, #ffffff)', color: 'var(--text-primary, #0f172a)' }}
                  required
                />
              </div>

              {/* Payment Mode Selection */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Company Payment Mode *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'upi', label: 'Online / UPI', icon: '📱' },
                    { id: 'bank_transfer', label: 'NEFT / RTGS', icon: '🏦' },
                    { id: 'cheque', label: 'Cheque', icon: '🏛️' },
                    { id: 'cash', label: 'Cash', icon: '💵' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSettleBtcMode(m.id)}
                      style={{
                        padding: '10px 6px',
                        borderRadius: '8px',
                        border: settleBtcMode === m.id ? '2px solid #2563eb' : '1.5px solid var(--border-color, #e2e8f0)',
                        background: settleBtcMode === m.id ? '#eff6ff' : 'var(--bg-surface, #ffffff)',
                        color: settleBtcMode === m.id ? '#1d4ed8' : 'var(--text-primary, #0f172a)',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      <div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>{m.icon}</div>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditional fields based on mode */}
              {(settleBtcMode === 'upi' || settleBtcMode === 'bank_transfer') && (
                <div style={{ marginBottom: '14px', padding: '12px', background: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e40af', display: 'block', marginBottom: '5px' }}>
                    UTR / Bank Reference No. *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter 12-digit UTR or Bank Transfer Ref No."
                    value={settleBtcUtr}
                    onChange={(e) => setSettleBtcUtr(e.target.value)}
                    style={{ height: '38px', background: '#ffffff', color: '#0f172a', fontWeight: 750 }}
                    required
                  />
                </div>
              )}

              {settleBtcMode === 'cheque' && (
                <div style={{ marginBottom: '14px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '4px' }}>
                        Cheque Number *
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 000542"
                        value={settleBtcChequeNo}
                        onChange={(e) => setSettleBtcChequeNo(e.target.value)}
                        style={{ height: '38px' }}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '4px' }}>
                        Bank &amp; Branch Name
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. HDFC Bank, Solapur"
                        value={settleBtcChequeBank}
                        onChange={(e) => setSettleBtcChequeBank(e.target.value)}
                        style={{ height: '38px' }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: '10px' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '4px' }}>
                      Cheque Status
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setSettleBtcChequeStatus('realized')}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: settleBtcChequeStatus === 'realized' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                          background: settleBtcChequeStatus === 'realized' ? '#f0fdf4' : '#ffffff',
                          color: settleBtcChequeStatus === 'realized' ? '#15803d' : '#475569',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        ✓ Cleared / Realized (Inflow)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettleBtcChequeStatus('pending')}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: settleBtcChequeStatus === 'pending' ? '2px solid #d97706' : '1px solid #cbd5e1',
                          background: settleBtcChequeStatus === 'pending' ? '#fffbeb' : '#ffffff',
                          color: settleBtcChequeStatus === 'pending' ? '#b45309' : '#475569',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        ⏳ Pending Clearing
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cashier Staff */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Received / Verified By (Cashier / Staff)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={settleBtcCashier}
                  onChange={(e) => setSettleBtcCashier(e.target.value)}
                  style={{ height: '38px' }}
                />
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Narration / Notes
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={settleBtcNotes}
                  onChange={(e) => setSettleBtcNotes(e.target.value)}
                  placeholder="Optional payment notes"
                  style={{ height: '38px' }}
                />
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1.5px solid var(--border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-custom-cancel"
                onClick={() => setSettleBtcTarget(null)}
                style={{ padding: '8px 18px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleExecuteSettleBtc}
                disabled={settleBtcSubmitting}
                style={{ padding: '8px 22px', fontWeight: 850, background: '#16a34a', border: 'none' }}
              >
                ✓ {settleBtcSubmitting ? 'Settling...' : 'Confirm Settlement & Release Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Size Image Lightbox with Mouse Wheel Scroll to Zoom */}
      <ImageLightbox
        isOpen={Boolean(lightboxImg)}
        title={lightboxTitle}
        imageUrl={lightboxImg}
        onClose={() => setLightboxImg(null)}
      />

      <DocumentActionModal
        isOpen={docActionModal.isOpen}
        onClose={() => setDocActionModal(prev => ({ ...prev, isOpen: false }))}
        type={docActionModal.type}
        data={docActionModal.data}
      />
    </div>
  );
}
