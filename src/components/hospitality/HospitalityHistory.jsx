import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime, formatTaxInvoiceNumber, cleanVoucherNumber } from '../../utils/formatters';
import { printCashReceipt, downloadReceiptPDF, printPettyCashVoucher, printGuestRegistrationA4, printFinalBillA4, downloadGuestRegistrationPDF, printGuestPaymentSummary, printGuestActivitiesSummary, downloadGuestActivitiesSummaryPDF } from '../../services/printService';
import ImageLightbox from '../common/ImageLightbox';
import DocumentActionModal from './DocumentActionModal';
import DocumentScannerModal from '../common/DocumentScannerModal';
import { compressBase64Image } from '../../utils/imageCompressor';

// Module-level in-memory cache for instant 0ms navigation
let globalHistoryCache = null;

export default function HospitalityHistory({ onViewDetail, onChangePaymentStatus }) {
  const { showToast, showConfirm, currentUser } = useApp();
  const [records, setRecords] = useState(() => (globalHistoryCache && Array.isArray(globalHistoryCache) ? globalHistoryCache : []));
  const [isLoading, setIsLoading] = useState(() => !globalHistoryCache || globalHistoryCache.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Advanced Filter Drawer State (Invoice/Voucher range & Date range)
  const [filterFromNo, setFilterFromNo] = useState('');
  const [filterToNo, setFilterToNo] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [filterShowScope, setFilterShowScope] = useState('all'); // 'all' | 'checkin' | 'checkout' | 'number_range'
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterFromNoRef = useRef(null);

  // Long-press (Click & Hold) Refs
  const longPressTimerRef = useRef(null);
  const isLongPressTriggeredRef = useRef(false);
  const pressStartPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Stay Detail & Payment History Modal State
  const [detailBooking, setDetailBooking] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [docActionModal, setDocActionModal] = useState({ isOpen: false, type: 'info', data: null });
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);

  // Settle BTC Modal State
  const [settleBtcTarget, setSettleBtcTarget] = useState(null);
  const [settleBtcMode, setSettleBtcMode] = useState('upi');
  const [settleBtcAmount, setSettleBtcAmount] = useState('');
  const [settleBtcUtr, setSettleBtcUtr] = useState('');
  const [settleBtcChequeNo, setSettleBtcChequeNo] = useState('');
  const [settleBtcChequeBank, setSettleBtcChequeBank] = useState('');
  const [settleBtcChequePhoto, setSettleBtcChequePhoto] = useState(null);
  const [settleBtcChequeStatus, setSettleBtcChequeStatus] = useState('realized');
  const [settleBtcCashier, setSettleBtcCashier] = useState('');
  const [settleBtcNotes, setSettleBtcNotes] = useState('');
  const [settleBtcSubmitting, setSettleBtcSubmitting] = useState(false);

  // Change Payment Method State (for bounced cheques / resettlement)
  const [changePaymentTarget, setChangePaymentTarget] = useState(null);
  const [changePaymentNewMode, setChangePaymentNewMode] = useState('upi');
  const [changePaymentAmount, setChangePaymentAmount] = useState('');
  const [changePaymentRef, setChangePaymentRef] = useState('');
  const [changePaymentChequeNo, setChangePaymentChequeNo] = useState('');
  const [changePaymentChequeBank, setChangePaymentChequeBank] = useState('');
  const [changePaymentReason, setChangePaymentReason] = useState('');
  const [changePaymentSubmitting, setChangePaymentSubmitting] = useState(false);

  // Cheque Scan & Pass Modal State
  const [chequeScanTarget, setChequeScanTarget] = useState(null);
  const [chequeScanPhoto, setChequeScanPhoto] = useState(null);
  const [chequeScanNo, setChequeScanNo] = useState('');
  const [chequeScanBank, setChequeScanBank] = useState('');
  const [isChequeCamOpen, setIsChequeCamOpen] = useState(false);
  const [chequeCamTargetMode, setChequeCamTargetMode] = useState('scan_modal'); // 'scan_modal' | 'settle_btc'
  const [chequeScanSubmitting, setChequeScanSubmitting] = useState(false);
  const [isHardwareScanning, setIsHardwareScanning] = useState(false);
  const [detectedScanner, setDetectedScanner] = useState(null);

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
      if (dateRange !== 'all' && dateRange !== 'pending_btc' && dateRange !== 'all_btc') params.push(`range=${dateRange}`);
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

  // Robust BTC Booking Identifier
  const isBtcBookingRecord = useCallback((r) => {
    if (!r) return false;
    return Boolean(
      r.booking_source === 'BTC' ||
      r.btc_company_id !== null ||
      (r.btc_company_name && String(r.btc_company_name).trim().length > 0) ||
      r.final_payment_mode === 'btc' ||
      r.advance_payment_mode === 'btc' ||
      r.final_settlement_mode === 'btc' ||
      r.payment_status === 'pending_from_company'
    );
  }, []);

  // Robust Cheque Passed/Realized Identifier
  const isChequePassedRecord = useCallback((r) => {
    if (!r) return false;
    const status = (r.cheque_status || r.advance_cheque_status || '').toLowerCase();
    const isPassedStatus = status === 'realized' || status === 'passed';
    return isPassedStatus && (r.payment_status === 'settled' || r.advance_cheque_status === 'realized');
  }, []);

  // Robust Pending BTC Identifier:
  // A BTC booking remains pending if:
  // 1) It has a cheque (scanned/attached/recorded) and that cheque has NOT passed/realized yet.
  // 2) Or if it has no cheque and payment_status is not settled.
  // "If cheque passes then only should be clear and should not show in pendings BTC"
  const isBtcPendingRecord = useCallback((r) => {
    if (!r) return false;
    if (!isBtcBookingRecord(r)) return false;

    const hasCheque = Boolean(
      (Number(r.split_cheque || 0) > 0) ||
      r.advance_payment_mode === 'cheque' ||
      r.final_payment_mode === 'cheque' ||
      r.final_settlement_mode === 'cheque' ||
      r.settlement_cheque_no ||
      r.advance_cheque_no ||
      r.cheque_photo ||
      r.settlement_cheque_photo
    );

    if (hasCheque) {
      return !isChequePassedRecord(r);
    }

    return r.payment_status !== 'settled';
  }, [isBtcBookingRecord, isChequePassedRecord]);

  const pendingBtcCount = records.filter(isBtcPendingRecord).length;
  const allBtcCount = records.filter(isBtcBookingRecord).length;

  const activeFilterCount = (filterFromNo.trim() ? 1 : 0) + (filterToNo.trim() ? 1 : 0) + (filterFromDate ? 1 : 0) + (filterToDate ? 1 : 0) + (filterShowScope !== 'all' ? 1 : 0);

  const extractDigits = (str) => {
    if (!str) return null;
    const m = String(str).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  };

  const matchesNumberRange = (record, fromStr, toStr) => {
    if (!fromStr && !toStr) return true;
    const candidates = [
      record.id,
      record.invoice_no,
      record.voucher_no,
      record.voucher_number,
      record.checkin_voucher_no,
      record.room_number
    ].filter(v => v !== undefined && v !== null && String(v).trim().length > 0);

    const fromNum = extractDigits(fromStr);
    const toNum = extractDigits(toStr);
    const cleanFrom = String(fromStr || '').trim().toLowerCase();
    const cleanTo = String(toStr || '').trim().toLowerCase();

    for (const c of candidates) {
      const cStr = String(c).trim().toLowerCase();
      const cNum = extractDigits(c);

      if (cNum !== null) {
        if (fromNum !== null && toNum !== null) {
          if (cNum >= fromNum && cNum <= toNum) return true;
        } else if (fromNum !== null) {
          if (cNum >= fromNum) return true;
        } else if (toNum !== null) {
          if (cNum <= toNum) return true;
        }
      }

      if (cleanFrom && cleanTo) {
        if (cStr >= cleanFrom && cStr <= cleanTo) return true;
      } else if (cleanFrom && cStr.includes(cleanFrom)) {
        return true;
      } else if (cleanTo && cStr.includes(cleanTo)) {
        return true;
      }
    }
    return false;
  };

  const matchesDateRange = (record, fromDateStr, toDateStr, scope = 'all') => {
    if (!fromDateStr && !toDateStr) return true;
    let rawDate = null;
    if (scope === 'checkin') {
      rawDate = record.checkin_time || record.created_at;
    } else if (scope === 'checkout') {
      rawDate = record.actual_checkout_time || record.checkout_time || record.approx_checkout_time;
    } else {
      rawDate = record.actual_checkout_time || record.checkout_time || record.checkin_time || record.created_at;
    }
    if (!rawDate) return false;
    const itemDate = new Date(rawDate);
    if (isNaN(itemDate.getTime())) return false;

    if (fromDateStr) {
      const fromD = new Date(`${fromDateStr}T00:00:00`);
      if (itemDate < fromD) return false;
    }
    if (toDateStr) {
      const toD = new Date(`${toDateStr}T23:59:59`);
      if (itemDate > toD) return false;
    }
    return true;
  };

  // Helper to get latest modified/activity timestamp for sorting
  const getActivityTimestamp = (r) => {
    if (r.last_activity_time) {
      const t = new Date(r.last_activity_time).getTime();
      if (!isNaN(t)) return t;
    }
    const dates = [
      r.actual_checkout_time,
      r.checkout_time,
      r.checkin_time,
      r.created_at
    ].map(d => (d ? new Date(d).getTime() : 0)).filter(t => !isNaN(t) && t > 0);
    return dates.length > 0 ? Math.max(...dates) : Number(r.id || 0);
  };

  const filteredRecords = records.filter((r) => {
    if (dateRange === 'pending_btc') {
      if (!isBtcPendingRecord(r)) return false;
    } else if (dateRange === 'all_btc') {
      if (!isBtcBookingRecord(r)) return false;
    }

    if (filterShowScope === 'checkin') {
      const isCheckedIn = r.status === 'active' || (!r.actual_checkout_time && r.status !== 'checked_out');
      if (!isCheckedIn) return false;
    } else if (filterShowScope === 'checkout') {
      const isCheckedOut = r.status === 'checked_out' || Boolean(r.actual_checkout_time);
      if (!isCheckedOut) return false;
    }

    if (filterFromNo.trim() || filterToNo.trim()) {
      if (!matchesNumberRange(r, filterFromNo, filterToNo)) return false;
    }

    if (filterFromDate || filterToDate) {
      if (!matchesDateRange(r, filterFromDate, filterToDate, filterShowScope)) return false;
    }

    return true;
  }).sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));

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
    setSettleBtcChequeNo(booking.settlement_cheque_no || booking.advance_cheque_no || '');
    let initialPhoto = (typeof booking.settlement_cheque_photo === 'string' && booking.settlement_cheque_photo.length > 20)
      ? booking.settlement_cheque_photo
      : (typeof booking.cheque_photo === 'string' && booking.cheque_photo.length > 20 ? booking.cheque_photo : null);
    setSettleBtcChequePhoto(initialPhoto);
    if (!initialPhoto && (booking.cheque_photo || booking.settlement_cheque_photo || booking.has_cheque_photo)) {
      api.getBookingDetails(booking.id).then(full => {
        if (full?.booking) {
          const loaded = full.booking.settlement_cheque_photo || full.booking.cheque_photo || null;
          if (loaded) setSettleBtcChequePhoto(loaded);
        }
      }).catch(() => {});
    }
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
        cheque_photo: settleBtcChequePhoto || null,
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
            checked_out_by: (settleBtcCashier || (currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier_1')).trim()
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

  const handleHardwareScanCheque = async () => {
    setIsHardwareScanning(true);
    try {
      showToast('⚡ Communicating with scanner... Scanner carriage is reading cheque.', 'info', 6000);
      const res = await api.scanHardwareDocument();
      if (res && res.success && res.image) {
        const compressed = await compressBase64Image(res.image);
        if (chequeCamTargetMode === 'settle_btc') {
          setSettleBtcChequePhoto(compressed || res.image);
        } else {
          setChequeScanPhoto(compressed || res.image);
        }
        if (res.device) setDetectedScanner(res.device);
        showToast(`✓ Cheque scanned successfully from ${res.device || detectedScanner || 'scanner'}!`, 'green', 4000);
      } else {
        throw new Error(res?.error || 'No scanned image returned from scanner.');
      }
    } catch (err) {
      console.error('Cheque scan error:', err);
      const errMsg = err?.message || 'Scanner acquisition failed. Ensure scanner is turned on and connected via USB.';
      showToast(`Scanner Error: ${errMsg}`, 'red', 6000);
    } finally {
      setIsHardwareScanning(false);
    }
  };

  const handleGrabLatestScanCheque = async () => {
    try {
      const res = await api.getLatestScannedDocument();
      if (res && res.found && res.image) {
        const compressed = await compressBase64Image(res.image);
        if (chequeCamTargetMode === 'settle_btc') {
          setSettleBtcChequePhoto(compressed || res.image);
        } else {
          setChequeScanPhoto(compressed || res.image);
        }
        showToast(`✓ Retrieved latest scan (${res.filename || 'Scans folder'})!`, 'green', 4000);
      } else {
        showToast('No recent scans found in Windows Scans folder. Click "Scan from Scanner" to trigger direct scan.', 'info', 4000);
      }
    } catch (err) {
      showToast('Could not check Scans folder: ' + err.message, 'red');
    }
  };

  const handleOpenScanCheque = (booking) => {
    if (!booking) return;
    setChequeScanTarget(booking);
    let initialPhoto = (typeof booking.cheque_photo === 'string' && booking.cheque_photo.length > 20)
      ? booking.cheque_photo
      : (typeof booking.settlement_cheque_photo === 'string' && booking.settlement_cheque_photo.length > 20 ? booking.settlement_cheque_photo : null);
    setChequeScanPhoto(initialPhoto);
    if (!initialPhoto && (booking.cheque_photo || booking.settlement_cheque_photo || booking.has_cheque_photo)) {
      api.getBookingDetails(booking.id).then(full => {
        if (full?.booking) {
          const loaded = full.booking.settlement_cheque_photo || full.booking.cheque_photo || null;
          if (loaded) setChequeScanPhoto(loaded);
        }
      }).catch(() => {});
    }
    setChequeScanNo(booking.settlement_cheque_no || booking.advance_cheque_no || '');
    setChequeScanBank(booking.settlement_cheque_bank || booking.advance_cheque_bank || '');
    setChequeCamTargetMode('scan_modal');
    // Re-check scanner connection in background
    api.getScannerDevices().then(res => {
      if (res && res.devices && res.devices.length > 0) setDetectedScanner(res.devices[0]);
    }).catch(() => {});
  };

  const handleSaveChequeScan = async (andPass = false) => {
    if (!chequeScanTarget) return;
    if (!chequeScanPhoto && !andPass) {
      showToast('Please capture or upload a cheque photo first.', 'red');
      return;
    }
    setChequeScanSubmitting(true);
    try {
      if (chequeScanPhoto) {
        const photoRes = await api.uploadChequePhoto(chequeScanTarget.id, {
          cheque_photo: chequeScanPhoto,
          cheque_no: chequeScanNo.trim() || undefined,
          bank_name: chequeScanBank.trim() || undefined
        });
        if (!photoRes || !photoRes.success) {
          throw new Error(photoRes?.error || 'Failed to save cheque photo');
        }
      }

      if (andPass) {
        const passRes = await api.passCheque(chequeScanTarget.id, {
          cashier_name: (currentUser?.full_name || currentUser?.username || 'Accounts Staff').trim(),
          cheque_no: chequeScanNo.trim() || undefined,
          bank_name: chequeScanBank.trim() || undefined
        });
        if (passRes && passRes.success) {
          showToast(`✓ Cheque passed! Amount credited to hotel account.`, 'green', 5000);
        } else {
          throw new Error(passRes?.error || 'Failed to pass cheque');
        }
      } else {
        showToast('✓ Scanned cheque saved and attached to booking!', 'green', 4000);
      }

      setChequeScanTarget(null);
      loadHistory(true);
      if (detailBooking && detailBooking.id === chequeScanTarget.id) {
        handleOpenDetail(chequeScanTarget.id);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'red');
    } finally {
      setChequeScanSubmitting(false);
    }
  };

  const handlePassCheque = async (booking) => {
    if (!booking) return;
    const chequeAmt = parseFloat(booking.split_cheque || 0) > 0 
      ? parseFloat(booking.split_cheque) 
      : (parseFloat(booking.total_room_charge || 0) || parseFloat(booking.total_paid || 0));
    const chequeNo = booking.settlement_cheque_no || booking.advance_cheque_no || 'Cheque';

    const confirmed = await showConfirm({
      title: 'Pass Cheque into Hotel Account?',
      message: `Pass ${chequeNo} for Booking #${booking.id} (${booking.guest_name || 'Guest'})?\n\nAmount: ${formatCurrency(chequeAmt)}\n\nThis will mark the cheque as REALIZED and credit ${formatCurrency(chequeAmt)} into the hotel accounts ledger immediately.`,
      icon: '🏛️',
      confirmText: '✅ Yes, Pass Cheque',
      isDestructive: false
    });
    if (!confirmed) return;

    try {
      const res = await api.passCheque(booking.id, {
        cashier_name: (currentUser?.full_name || currentUser?.username || 'Accounts Staff').trim(),
        cheque_no: booking.settlement_cheque_no || booking.advance_cheque_no || undefined,
        bank_name: booking.settlement_cheque_bank || booking.advance_cheque_bank || undefined
      });
      if (res && res.success) {
        showToast(`✓ Cheque passed! ${formatCurrency(chequeAmt)} credited to hotel account.`, 'green', 5000);
        loadHistory(true);
        if (detailBooking && detailBooking.id === booking.id) {
          handleOpenDetail(booking.id);
        }
      } else {
        showToast(res?.error || 'Failed to pass cheque', 'red');
      }
    } catch (err) {
      showToast('Error passing cheque: ' + err.message, 'red');
    }
  };

  const handleMarkChequeBounced = async (booking) => {
    if (!booking) return;
    const chequeNo = booking.settlement_cheque_no || booking.advance_cheque_no || 'Cheque';
    const confirmed = await showConfirm({
      title: 'Mark Cheque as Bounced?',
      message: `Mark ${chequeNo} as BOUNCED / DISHONORED for Booking #${booking.id} (${booking.guest_name || 'Guest'})?\n\nThis will record a bounced cheque log and allow changing the payment method to Cash, UPI, Card, or NEFT.`,
      icon: '⚠️',
      confirmText: 'Yes, Mark Bounced',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      const res = await api.bounceCheque(booking.id, {
        cashier_name: (currentUser?.full_name || currentUser?.username || 'Accounts Staff').trim(),
        reason: `Cheque #${chequeNo} bounced / dishonored.`
      });
      if (res && res.success) {
        showToast(`⚠️ Cheque #${chequeNo} marked as bounced. Please change payment method.`, 'amber', 5000);
        loadHistory(true);
        if (detailBooking && detailBooking.id === booking.id) {
          handleOpenDetail(booking.id);
        }
        handleOpenChangePayment(booking);
      } else {
        showToast(res?.error || 'Failed to update cheque status', 'red');
      }
    } catch (err) {
      showToast('Error marking cheque bounced: ' + err.message, 'red');
    }
  };

  const handleOpenChangePayment = (booking) => {
    if (!booking) return;
    const dueAmt = Math.max(0, (Number(booking.total_room_charge || booking.total_cost || 0) + Number(booking.extra_bed_charge || 0)) - Number(booking.total_paid || 0)) || Number(booking.total_room_charge || 0);
    setChangePaymentTarget(booking);
    setChangePaymentNewMode('upi');
    setChangePaymentAmount(String(dueAmt || ''));
    setChangePaymentRef('');
    setChangePaymentChequeNo('');
    setChangePaymentChequeBank('');
    setChangePaymentReason(`Cheque bounced. Resettled via UPI`);
  };

  const handleExecuteChangePayment = async () => {
    if (!changePaymentTarget) return;
    const cleanAmt = parseFloat(changePaymentAmount);
    if (isNaN(cleanAmt) || cleanAmt <= 0) {
      showToast('Please enter a valid payment amount.', 'red');
      return;
    }
    if ((changePaymentNewMode === 'upi' || changePaymentNewMode === 'bank_transfer') && !changePaymentRef.trim()) {
      showToast('Please enter the UTR / Bank Reference Number.', 'red');
      return;
    }
    if (changePaymentNewMode === 'cheque' && !changePaymentChequeNo.trim()) {
      showToast('Please enter the replacement Cheque Number.', 'red');
      return;
    }

    setChangePaymentSubmitting(true);
    try {
      const res = await api.changePaymentMethod(changePaymentTarget.id, {
        new_mode: changePaymentNewMode,
        amount: cleanAmt,
        reference_no: changePaymentRef.trim() || undefined,
        cheque_no: changePaymentChequeNo.trim() || undefined,
        bank_name: changePaymentChequeBank.trim() || undefined,
        reason: changePaymentReason.trim() || `Payment method changed to ${changePaymentNewMode.toUpperCase()}`,
        cashier_name: (currentUser?.full_name || currentUser?.username || 'Accounts Staff').trim()
      });

      if (res && res.success) {
        showToast(`✓ Payment method changed to ${changePaymentNewMode.toUpperCase()}! Receipt #${res.receipt_no || ''}`, 'green', 5000);
        const targetId = changePaymentTarget.id;
        setChangePaymentTarget(null);
        loadHistory(true);
        if (detailBooking && detailBooking.id === targetId) {
          handleOpenDetail(targetId);
        }
      } else {
        showToast(res?.error || 'Failed to change payment method.', 'red');
      }
    } catch (err) {
      showToast('Error changing payment method: ' + err.message, 'red');
    } finally {
      setChangePaymentSubmitting(false);
    }
  };

  // Clipboard paste listener: paste scanned cheque photo directly with Ctrl+V
  useEffect(() => {
    const handlePaste = (e) => {
      if (!chequeScanTarget) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (evt) => {
              setChequeScanPhoto(evt.target.result);
              showToast('✓ Cheque photo pasted from clipboard', 'green');
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [chequeScanTarget, showToast]);

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

  const startLongPress = (id, clientX, clientY) => {
    cancelLongPress();
    isLongPressTriggeredRef.current = false;
    pressStartPosRef.current = { x: clientX, y: clientY };

    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      setIsSelectionMode(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch (_) {}
      }
    }, 450);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e, id) => {
    if (e.button !== undefined && e.button !== 0) return;
    startLongPress(id, e.clientX || 0, e.clientY || 0);
  };

  const handlePointerMove = (e) => {
    if (!longPressTimerRef.current) return;
    const dx = Math.abs((e.clientX || 0) - pressStartPosRef.current.x);
    const dy = Math.abs((e.clientY || 0) - pressStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelLongPress();
    }
  };

  const handlePointerUp = () => {
    cancelLongPress();
  };

  const handleRowClick = (id) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }

    if (isSelectionMode) {
      handleToggleSelect(id);
      return;
    }

    handleOpenDetail(id);
  };

  const handleExitSelection = () => {
    cancelLongPress();
    setIsSelectionMode(false);
    setSelectedIds(new Set());
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
        setIsSelectionMode(false);
        loadHistory(true);
      }
    } catch (err) {
      showToast('Error deleting records: ' + err.message, 'red');
    }
  };

  // Keep focused row index within bounds when filteredRecords changes
  useEffect(() => {
    if (filteredRecords.length > 0) {
      setFocusedRowIndex((prev) => (prev >= filteredRecords.length ? filteredRecords.length - 1 : (prev < 0 ? 0 : prev)));
    } else {
      setFocusedRowIndex(-1);
    }
  }, [filteredRecords.length]);

  // Keyboard navigation for History table rows (Up / Down arrows & Enter)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // If modal/overlay is open, only handle Escape to close
      if (isDetailOpen || settleBtcTarget || chequeScanTarget || changePaymentTarget || isChequeCamOpen || docActionModal?.isOpen || lightboxImg) {
        if (e.key === 'Escape') {
          if (isDetailOpen) {
            setIsDetailOpen(false);
            setDetailBooking(null);
          }
        }
        return;
      }

      if (filteredRecords.length === 0) return;

      const activeEl = document.activeElement;
      const targetTag = activeEl?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';

      if (isInput) {
        // If in search input and user presses Down arrow
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeEl.blur();
          setFocusedRowIndex((prev) => (prev < 0 ? 0 : Math.min(filteredRecords.length - 1, prev + 1)));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        // If in text input (like search box) and user hits Enter
        if (e.key === 'Enter' && activeEl.type === 'text') {
          e.preventDefault();
          const targetIndex = focusedRowIndex >= 0 && focusedRowIndex < filteredRecords.length ? focusedRowIndex : 0;
          const targetRec = filteredRecords[targetIndex];
          if (targetRec) handleOpenDetail(targetRec.id);
          return;
        }
        // In other inputs/date fields, let normal key typing happen
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIndex((prev) => {
          const next = prev < 0 ? 0 : Math.min(filteredRecords.length - 1, prev + 1);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIndex((prev) => {
          if (prev <= 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return 0;
          }
          const next = prev - 1;
          if (next === 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const targetIndex = focusedRowIndex >= 0 && focusedRowIndex < filteredRecords.length ? focusedRowIndex : 0;
        const targetRec = filteredRecords[targetIndex];
        if (targetRec) {
          handleOpenDetail(targetRec.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    filteredRecords,
    focusedRowIndex,
    isDetailOpen,
    settleBtcTarget,
    chequeScanTarget,
    changePaymentTarget,
    isChequeCamOpen,
    docActionModal,
    lightboxImg
  ]);

  // Smoothly scroll the focused row into view with header offset consideration
  useEffect(() => {
    if (focusedRowIndex >= 0 && !isDetailOpen) {
      if (focusedRowIndex === 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const rowEl = document.querySelector(`[data-history-row-index="${focusedRowIndex}"]`);
      if (rowEl) {
        const rect = rowEl.getBoundingClientRect();
        const headerOffset = 150;
        if (rect.top < headerOffset) {
          window.scrollBy({ top: rect.top - headerOffset, behavior: 'smooth' });
        } else if (rect.bottom > window.innerHeight) {
          rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }, [focusedRowIndex, isDetailOpen]);

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
            <button
              type="button"
              className={`history-filter-toggle-btn ${isFilterOpen || activeFilterCount > 0 ? 'active' : ''}`}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              title="Open Filter (Invoice / Voucher Range & Date Range)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontSize: '0.70rem',
                    fontWeight: 900
                  }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`history-chip ${dateRange === 'pending_btc' ? 'active' : ''}`}
              onClick={() => setDateRange(prev => prev === 'pending_btc' ? 'all' : 'pending_btc')}
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

            <button
              type="button"
              className={`history-chip ${dateRange === 'all_btc' ? 'active' : ''}`}
              onClick={() => setDateRange(prev => prev === 'all_btc' ? 'all' : 'all_btc')}
              style={{
                background: dateRange === 'all_btc' ? '#1e40af' : (allBtcCount > 0 ? '#eff6ff' : undefined),
                color: dateRange === 'all_btc' ? '#ffffff' : (allBtcCount > 0 ? '#1d4ed8' : undefined),
                borderColor: dateRange === 'all_btc' ? '#1d4ed8' : (allBtcCount > 0 ? '#93c5fd' : undefined),
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Filter and show all BTC bookings (Both Pending and Paid/Settled)"
            >
              <span>🏢 All BTC</span>
              {allBtcCount > 0 && (
                <span
                  style={{
                    background: dateRange === 'all_btc' ? '#ffffff' : '#1d4ed8',
                    color: dateRange === 'all_btc' ? '#1d4ed8' : '#ffffff',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '0.72rem',
                    fontWeight: 900
                  }}
                >
                  {allBtcCount}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isSelectionMode ? (
              <>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '8px',
                    background: selectedIds.size > 0 ? '#eff6ff' : '#f8fafc',
                    border: `1.5px solid ${selectedIds.size > 0 ? '#bfdbfe' : '#e2e8f0'}`,
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    color: selectedIds.size > 0 ? '#1d4ed8' : '#64748b'
                  }}
                >
                  <span>{selectedIds.size > 0 ? '✓' : '☐'}</span>
                  <span>{selectedIds.size} Selected</span>
                </div>

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
                  onClick={handleExitSelection}
                  style={{
                    color: '#334155',
                    borderColor: '#cbd5e1',
                    background: '#ffffff',
                    fontWeight: 800
                  }}
                  title="Exit Selection Mode"
                >
                  ✕ Done
                </button>
              </>
            ) : null}

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
          </div>
        </div>

        {/* Collapsible Filter Panel (Invoice/Voucher range & Date range) */}
        {isFilterOpen && (
          <div className="history-filter-panel">
            <div className="filter-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span style={{ fontWeight: 800, fontSize: '0.90rem', color: 'var(--text-primary, #0f172a)' }}>
                  Filter by Invoice / Voucher Number &amp; Date Range
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#64748b' }}
                title="Close Filter Drawer"
              >
                ✕
              </button>
            </div>

            {/* Quick Filter Selection: Side heading 'Show:' with buttons Checkin, Checkout, Voucher/Invoice No */}
            <div
              className="filter-show-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '16px',
                paddingBottom: '14px',
                borderBottom: '1.5px solid var(--border-color, #e2e8f0)',
                flexWrap: 'wrap'
              }}
            >
              <span
                style={{
                  fontWeight: 850,
                  fontSize: '0.86rem',
                  color: 'var(--text-secondary, #475569)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Show:
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`filter-scope-btn scope-all ${filterShowScope === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterShowScope('all')}
                >
                  All Stays
                </button>
                <button
                  type="button"
                  className={`filter-scope-btn scope-checkin ${filterShowScope === 'checkin' ? 'active' : ''}`}
                  onClick={() => setFilterShowScope(prev => prev === 'checkin' ? 'all' : 'checkin')}
                >
                  {filterShowScope === 'checkin' ? '✓ ' : ''}Checkin
                </button>
                <button
                  type="button"
                  className={`filter-scope-btn scope-checkout ${filterShowScope === 'checkout' ? 'active' : ''}`}
                  onClick={() => setFilterShowScope(prev => prev === 'checkout' ? 'all' : 'checkout')}
                >
                  {filterShowScope === 'checkout' ? '✓ ' : ''}Checkout
                </button>
                <button
                  type="button"
                  className={`filter-scope-btn scope-range ${filterShowScope === 'number_range' ? 'active' : ''}`}
                  onClick={() => {
                    setFilterShowScope(prev => prev === 'number_range' ? 'all' : 'number_range');
                    if (filterFromNoRef.current) {
                      filterFromNoRef.current.focus();
                    }
                  }}
                >
                  {filterShowScope === 'number_range' ? '✓ ' : ''}Voucher / Invoice No
                </button>
              </div>
            </div>

            <div className="filter-panel-grid">
              {/* Invoice or Voucher Range */}
              <div className="filter-group">
                <label className="filter-label">
                  <span>Invoice / Voucher # Range</span>
                  <span className="filter-sublabel">(Invoice #, Voucher #, or Booking ID)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    ref={filterFromNoRef}
                    type="text"
                    className="filter-input"
                    placeholder="From # (e.g. 15 or 550)"
                    value={filterFromNo}
                    onChange={(e) => setFilterFromNo(e.target.value)}
                  />
                  <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.85rem' }}>to</span>
                  <input
                    type="text"
                    className="filter-input"
                    placeholder="To # (e.g. 25 or 560)"
                    value={filterToNo}
                    onChange={(e) => setFilterToNo(e.target.value)}
                  />
                </div>
              </div>

              {/* Date Range */}
              <div className="filter-group">
                <label className="filter-label">
                  <span>Date Range</span>
                  <span className="filter-sublabel">(Stay Check-In / Check-Out date)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="date"
                    className="filter-input"
                    value={filterFromDate}
                    onChange={(e) => setFilterFromDate(e.target.value)}
                  />
                  <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.85rem' }}>to</span>
                  <input
                    type="date"
                    className="filter-input"
                    value={filterToDate}
                    onChange={(e) => setFilterToDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="filter-panel-actions">
              <button
                type="button"
                className="filter-btn-clear"
                onClick={() => {
                  setFilterFromNo('');
                  setFilterToNo('');
                  setFilterFromDate('');
                  setFilterToDate('');
                  setFilterShowScope('all');
                }}
              >
                Reset Filters
              </button>
              <button
                type="button"
                className="filter-btn-apply"
                onClick={() => setIsFilterOpen(false)}
              >
                Apply &amp; Done {activeFilterCount > 0 ? `(${activeFilterCount} active)` : ''}
              </button>
            </div>
          </div>
        )}
      </div>


      {/* History Data Table */}
      <div className="history-table-container">
        <table className="history-data-table">
          <thead>
            <tr>
              {isSelectionMode && (
                <th style={{ width: '44px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filteredRecords.length > 0 && selectedIds.size === filteredRecords.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    title="Select / Deselect All Rows"
                    style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#dc2626' }}
                  />
                </th>
              )}
              <th className="history-col-booking" style={{ width: '75px', whiteSpace: 'nowrap' }}>Booking</th>
              <th className="history-col-rooms" style={{ width: '90px' }}>Room</th>
              <th className="history-col-guest">Guest Name</th>
              <th className="history-col-voucher" style={{ width: '125px', whiteSpace: 'nowrap' }}>Voucher No</th>
              <th className="history-col-invoice" style={{ width: '105px', whiteSpace: 'nowrap' }}>Invoice No</th>
              <th className="history-col-checkin" style={{ width: '160px', minWidth: '155px', whiteSpace: 'nowrap' }}>Check-In</th>
              <th className="history-col-checkout" style={{ width: '160px', minWidth: '155px', whiteSpace: 'nowrap' }}>Check-Out</th>
              <th className="history-col-amount" style={{ width: '140px' }}>Amount Paid</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map((r, idx) => {
              const isCheckedOut = r.status === 'checked_out' || Boolean(r.actual_checkout_time);
              const isSelected = selectedIds.has(r.id);
              const isFocused = focusedRowIndex === idx;

              const isBtcBooking = isBtcBookingRecord(r);
              const isChequePassed = isChequePassedRecord(r);
              const isBtcPending = isBtcPendingRecord(r);

              const hasCheque =
                (r.final_settlement_mode && r.final_settlement_mode.toLowerCase() === 'cheque') ||
                (r.final_payment_mode && r.final_payment_mode.toLowerCase() === 'cheque') ||
                (r.advance_payment_mode && r.advance_payment_mode.toLowerCase() === 'cheque') ||
                Number(r.split_cheque || 0) > 0 ||
                Boolean(r.settlement_cheque_no) ||
                Boolean(r.advance_cheque_no) ||
                Boolean(r.cheque_photo) ||
                Boolean(r.settlement_cheque_photo);

              const isPending =
                isBtcPending ||
                (hasCheque && !isChequePassed) ||
                r.payment_status === 'pending' ||
                r.payment_status === 'pending_from_company';

              const isPrepaid = Boolean(
                r.is_prepaid === 1 ||
                r.is_prepaid === '1' ||
                r.is_prepaid === true ||
                r.rate_type === 'prepaid' ||
                ((r.booking_source && r.booking_source.toUpperCase() === 'OTA') && (
                  r.is_prepaid ||
                  (r.final_settlement_mode && r.final_settlement_mode.toLowerCase().includes('prepaid')) ||
                  (r.final_payment_mode && r.final_payment_mode.toLowerCase().includes('prepaid')) ||
                  (r.advance_payment_mode && r.advance_payment_mode.toLowerCase().includes('prepaid')) ||
                  Number(r.total_paid || 0) === 0
                ))
              );

              const hotelPaid = Number(r.total_paid || 0);

              let modeLabel = 'CASH';
              if (hasCheque) {
                modeLabel = Number(r.split_cheque || 0) > 0 && r.final_settlement_mode === 'split' ? 'SPLIT + CHEQUE' : 'CHEQUE';
              } else if (isPrepaid) {
                if (hotelPaid === 0) {
                  modeLabel = 'PREPAID';
                } else {
                  const extraMode = (r.final_settlement_mode || r.final_payment_mode || r.advance_payment_mode || 'Cash').toUpperCase();
                  modeLabel = `PREPAID + ${extraMode}`;
                }
              } else {
                modeLabel = (
                  r.final_settlement_mode ||
                  r.final_payment_mode ||
                  r.advance_payment_mode ||
                  (isBtcBooking ? 'BTC' : 'Cash')
                ).toUpperCase();
              }

              const roomNumberClean = r.room_number || (r.all_group_rooms ? r.all_group_rooms.map(x => typeof x === 'object' && x !== null ? (x.room_number || x.number) : x).filter(Boolean).join(', ') : '-');

              return (
                <tr
                  key={r.id}
                  data-history-row-index={idx}
                  tabIndex={0}
                  onPointerDown={(e) => handlePointerDown(e, r.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onMouseEnter={() => setFocusedRowIndex(idx)}
                  onClick={() => {
                    setFocusedRowIndex(idx);
                    handleRowClick(r.id);
                  }}
                  onContextMenu={(e) => {
                    if (isLongPressTriggeredRef.current) e.preventDefault();
                  }}
                  className={`${isBtcPending ? 'history-row-btc-pending' : ''} ${isSelected ? 'history-row-selected' : ''} ${isFocused ? 'history-row-focused' : ''}`}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: isBtcPending ? '#fff1f2' : undefined,
                    borderLeft: isBtcPending ? '4px solid #ef4444' : undefined,
                    transition: 'all 0.1s ease',
                    userSelect: isSelectionMode ? 'none' : 'auto'
                  }}
                  title={isSelectionMode ? (isSelected ? 'Click to deselect' : 'Click to select') : 'Click or press Enter to view stay folio'}
                >
                  {isSelectionMode && (
                    <td
                      style={{ textAlign: 'center' }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(r.id);
                      }}
                    >
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
                  )}

                  {/* Booking ID - Clean number, no # below header */}
                  <td className="history-col-booking" style={{ fontWeight: 800, color: isBtcPending ? '#dc2626' : '#64748b', fontSize: '0.86rem', whiteSpace: 'nowrap' }}>
                    {r.id}
                  </td>

                  {/* Room - Box with only number, no key icon and no # */}
                  <td className="history-col-rooms" style={{ whiteSpace: 'nowrap' }}>
                    <span className="history-room-badge">
                      {roomNumberClean}
                    </span>
                  </td>

                  {/* Guest Name */}
                  <td className="history-col-guest">
                    <div className="history-guest-name" style={{ fontWeight: 750, color: 'var(--text-primary, #0f172a)', fontSize: '0.90rem' }}>
                      {r.guest_name || 'N/A'}
                    </div>
                    {r.mobile && (
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '1px' }}>
                        {r.mobile}
                      </div>
                    )}
                  </td>

                  {/* Voucher No */}
                  <td className="history-col-voucher" style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', whiteSpace: 'nowrap' }}>
                      {cleanVoucherNumber(r.voucher_number || r.voucher_no || r.checkin_voucher_no) || (r.id ? `V-${r.id}` : '-')}
                    </div>
                  </td>

                  {/* Invoice No */}
                  <td className="history-col-invoice" style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#1e40af', whiteSpace: 'nowrap' }}>
                      {r.invoice_no || formatTaxInvoiceNumber(r.voucher_number || r.voucher_no || r.checkin_voucher_no || r.id)}
                    </div>
                  </td>

                  {/* Check-In - strictly single line, no overflow */}
                  <td className="history-col-checkin" style={{ whiteSpace: 'nowrap' }}>
                    <div className="history-checkin-date" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary, #0f172a)', whiteSpace: 'nowrap' }}>
                      {formatShortDT(r.checkin_time)}
                    </div>
                    {r.booking_source && (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {r.booking_source}
                      </div>
                    )}
                  </td>

                  {/* Check-Out - strictly single line, no overflow */}
                  <td className="history-col-checkout" style={{ whiteSpace: 'nowrap' }}>
                    <div
                      className="history-checkout-date"
                      style={{
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        color: isCheckedOut ? '#0071e3' : '#64748b',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {formatShortDT(r.checkout_time || r.approx_checkout_time)}
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          padding: '2px 7px',
                          borderRadius: '5px',
                          background: isCheckedOut ? '#dcfce7' : '#eff6ff',
                          color: isCheckedOut ? '#166534' : '#1d4ed8',
                          whiteSpace: 'nowrap',
                          display: 'inline-block'
                        }}
                      >
                        {isCheckedOut ? 'CHECKED OUT' : 'ACTIVE STAY'}
                      </span>
                    </div>
                  </td>

                  {/* Amount Paid Number & Mode in Little */}
                  <td className="history-col-amount" style={{ whiteSpace: 'nowrap' }}>
                    {isBtcPending ? (
                      <div>
                        <div
                          style={{
                            fontSize: '0.95rem',
                            fontWeight: 900,
                            color: '#dc2626'
                          }}
                        >
                          {formatCurrency(Math.max(0, (Number(r.total_room_charge || r.total_cost || 0) + Number(r.extra_bed_charge || 0)) - Number(r.total_paid || 0)) || Number(r.total_room_charge || 0))} Due
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 700, marginTop: '1px' }}>
                          (pending btc)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div
                          style={{
                            fontSize: '0.95rem',
                            fontWeight: 800,
                            color: isPrepaid && hotelPaid === 0 ? '#6b21a8' : (isPending ? '#b45309' : '#15803d')
                          }}
                        >
                          {formatCurrency(isPrepaid && hotelPaid === 0 ? 0 : (r.total_paid || r.total_room_charge || 0))}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: isPrepaid ? '#7c3aed' : '#64748b', fontWeight: 600, marginTop: '1px' }}>
                          ({modeLabel.toLowerCase()})
                        </div>
                      </div>
                    )}
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

      {/* Floating Scroll to Top Row (Up Button) */}
      <button
        type="button"
        id="btn-history-scroll-top"
        className="history-scroll-top-btn"
        onClick={() => {
          setFocusedRowIndex(0);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        title="Scroll to Top Row (Up)"
      >
        ▲
      </button>

      {/* Full-Page Stay Detail & Folio View (Entire height & width, not a popup) */}
      {isDetailOpen && (
        <div
          className="history-fullscreen-view"
          style={{
            zIndex: 10050,
            padding: 0,
            margin: 0,
            width: '100vw',
            height: '100vh',
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-app, #f8fafc)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Full-Page Top Bar */}
          <div
            style={{
              padding: '12px 28px',
              borderBottom: '1.5px solid var(--border-color, #e2e8f0)',
              background: 'var(--bg-surface, #ffffff)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                type="button"
                className="history-back-btn"
                onClick={() => {
                  setIsDetailOpen(false);
                  setDetailBooking(null);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 14px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  fontSize: '0.86rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                }}
                title="Return to History Table"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Back to History</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem', padding: '4px 8px', background: 'rgba(56, 189, 248, 0.15)', borderRadius: '8px' }}>📜</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                    Stay Details &amp; Payment Folio {detailBooking ? `— Booking #${detailBooking.id} (Room ${detailBooking.room_number || '-'})` : ''}
                  </h3>
                  <p style={{ margin: '1px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
                    Archived stay folio, billing breakdown, cashier audit trail, and corporate settlement
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {detailBooking && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setDocActionModal({
                        isOpen: true,
                        type: 'invoice',
                        data: {
                          room: detailBooking,
                          calc: {
                            grossTariff: detailBooking.total_room_charge || detailBooking.room_rate,
                            roomCharge: detailBooking.total_room_charge || detailBooking.room_rate,
                            roomTariffNet: detailBooking.total_room_charge,
                            tariffTax5Pct: Math.round((detailBooking.total_room_charge || 0) * 0.05),
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
                            settleAmt: detailBooking.final_settle_amount || detailBooking.total_paid || 0,
                            refundAmt: detailBooking.refund_amount || 0,
                            settled_at: detailBooking.actual_checkout_time || detailBooking.checkout_time || new Date(),
                            invoiceNo: detailBooking.invoice_no || formatTaxInvoiceNumber(detailBooking.voucher_number || detailBooking.voucher_no || detailBooking.checkin_voucher_no || detailBooking.id),
                            checked_out_by: detailBooking.checked_out_by || (currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier_1')
                          }
                        }
                      });
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      borderRadius: '8px',
                      background: '#eff6ff',
                      color: '#1e40af',
                      border: '1.5px solid #bfdbfe',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                    title="Official Tax Invoice"
                  >
                    <span>🧾</span> Tax Invoice
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDocActionModal({ isOpen: true, type: 'checkin', data: detailBooking });
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 14px',
                      borderRadius: '8px',
                      background: '#faf5ff',
                      color: '#6b21a8',
                      border: '1.5px solid #d8b4fe',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                    title="Check-In Registration Form"
                  >
                    <span>📄</span> Form
                  </button>
                </>
              )}

              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setIsDetailOpen(false);
                  setDetailBooking(null);
                }}
                style={{ fontSize: '1.4rem', padding: '4px 10px' }}
                title="Close"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', margin: '0 auto' }}>
            {isDetailLoading || !detailBooking ? (
              <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--text-secondary, #64748b)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⏳</div>
                <div>Loading stay &amp; payment records...</div>
              </div>
            ) : (
              <>
                {/* BTC Settlement & Cheque Scanning Section if Pending */}
                {Boolean(
                  (detailBooking.booking_source === 'BTC' || detailBooking.btc_company_id !== null || detailBooking.final_payment_mode === 'btc' || detailBooking.payment_status === 'pending_from_company') &&
                  detailBooking.payment_status !== 'settled'
                ) && (
                  <div style={{ padding: '16px 20px', background: '#fff1f2', border: '2px solid #f87171', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '1.8rem' }}>🏢</span>
                        <div>
                          <div style={{ fontWeight: 850, color: '#dc2626', fontSize: '1rem' }}>
                            Payment Pending from Company: {formatCurrency(Math.max(0, (Number(detailBooking.total_room_charge || 0) + Number(detailBooking.extra_bed_charge || 0)) - Number(detailBooking.total_paid || 0)) || Number(detailBooking.total_room_charge || 0))} Due
                          </div>
                          <div style={{ fontSize: '0.80rem', color: '#991b1b', marginTop: '2px' }}>
                            Company: <strong>{detailBooking.btc_company_name || 'Corporate'}</strong> {detailBooking.btc_approval_ref ? `• Approval Ref: ${detailBooking.btc_approval_ref}` : ''}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenScanCheque(detailBooking)}
                          style={{
                            padding: '8px 16px',
                            fontSize: '0.84rem',
                            fontWeight: 800,
                            background: '#d97706',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 5px rgba(217, 119, 6, 0.25)'
                          }}
                          title="Scan or upload physical cheque for this BTC booking"
                        >
                          <span>🖨️ / 📷</span> Scan Physical Cheque
                        </button>

                        {Boolean(detailBooking.settlement_cheque_no || detailBooking.advance_cheque_no || detailBooking.cheque_photo || detailBooking.settlement_cheque_photo) && (
                          <>
                            <button
                              type="button"
                              onClick={() => handlePassCheque(detailBooking)}
                              style={{
                                padding: '8px 16px',
                                fontSize: '0.84rem',
                                fontWeight: 850,
                                background: '#16a34a',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                boxShadow: '0 2px 5px rgba(22, 163, 74, 0.25)'
                              }}
                              title="Pass Cheque and realize payment into accounts"
                            >
                              <span>✅</span> Pass Cheque
                            </button>

                            <button
                              type="button"
                              onClick={() => handleMarkChequeBounced(detailBooking)}
                              style={{
                                padding: '8px 14px',
                                fontSize: '0.84rem',
                                fontWeight: 800,
                                background: '#fee2e2',
                                color: '#b91c1c',
                                border: '1.5px solid #fca5a5',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                              title="Mark cheque as bounced and change payment method"
                            >
                              <span>⚠️</span> Cheque Bounced
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleOpenChangePayment(detailBooking)}
                          style={{
                            padding: '8px 14px',
                            fontSize: '0.84rem',
                            fontWeight: 800,
                            background: '#fef3c7',
                            color: '#b45309',
                            border: '1.5px solid #fde68a',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          title="Change payment method to Cash, UPI, Card, or NEFT"
                        >
                          <span>🔄</span> Change Payment Method
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenSettleBtc(detailBooking)}
                          style={{
                            padding: '8px 16px',
                            fontSize: '0.84rem',
                            fontWeight: 850,
                            background: '#dc2626',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 5px rgba(220, 38, 38, 0.25)'
                          }}
                        >
                          <span>💳</span> Settle BTC
                        </button>
                      </div>
                    </div>

                    {/* Scanned Cheque Photo preview if present */}
                    {(detailBooking.cheque_photo || detailBooking.settlement_cheque_photo) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fecaca' }}>
                        <img
                          src={detailBooking.cheque_photo || detailBooking.settlement_cheque_photo}
                          alt="Scanned Cheque"
                          onClick={() => {
                            setLightboxImg(detailBooking.cheque_photo || detailBooking.settlement_cheque_photo);
                            setLightboxTitle(`Scanned Cheque - Booking #${detailBooking.id} (${detailBooking.guest_name})`);
                          }}
                          style={{ width: '100px', height: '52px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', border: '1px solid #cbd5e1' }}
                          title="Click to zoom cheque"
                        />
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#1e293b' }}>
                            Physical Cheque Attached (Click to enlarge)
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                            Cheque No: <strong>{detailBooking.settlement_cheque_no || detailBooking.advance_cheque_no || 'Recorded'}</strong> • Bank: <strong>{detailBooking.settlement_cheque_bank || detailBooking.advance_cheque_bank || 'Bank'}</strong>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Room Shift / Transfer Activity Log */}
                    {(() => {
                      let logs = [];
                      try {
                        logs = detailBooking.extension_logs_json ? JSON.parse(detailBooking.extension_logs_json) : [];
                      } catch (_) { logs = []; }
                      if (!Array.isArray(logs)) logs = [];

                      const transferLogs = logs.filter((l) => l.type === 'room_transfer');
                      if (transferLogs.length === 0) return null;

                      return (
                        <div style={{ marginTop: '12px', padding: '12px 16px', background: '#f5f3ff', borderRadius: '10px', border: '1.5px solid #c4b5fd' }}>
                          <div style={{ fontWeight: 850, fontSize: '0.86rem', color: '#5b21b6', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🔄</span> Room Shift / Transfer Audit Log ({transferLogs.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {transferLogs.map((log, idx) => (
                              <div
                                key={idx}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  background: '#ffffff',
                                  border: '1px solid #ddd6fe',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  gap: '12px'
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#6d28d9' }}>
                                    Room Shift: #{log.from_room_number} ➔ #{log.to_room_number}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: '#4c1d95', marginTop: '2px' }}>
                                    {log.room_type ? `Room Type: ${log.room_type} • ` : ''}{log.reason || 'Guest room shift (same room type)'}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#6b21a8', whiteSpace: 'nowrap' }}>
                                  <div>{formatDateTime(log.transferred_at || log.created_at)}</div>
                                  <div style={{ fontWeight: 700 }}>by {log.transferred_by || 'Front Desk'}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Payment & Cheque Activity Log */}
                    {(() => {
                      let logs = [];
                      try {
                        logs = detailBooking.extension_logs_json ? JSON.parse(detailBooking.extension_logs_json) : [];
                      } catch (_) { logs = []; }
                      if (!Array.isArray(logs)) logs = [];

                      const paymentLogs = logs.filter(l => l.type === 'cheque_bounced' || l.type === 'payment_method_changed');
                      const paymentsList = detailBooking.payments || [];

                      if (paymentLogs.length === 0 && paymentsList.length === 0) return null;

                      return (
                        <div style={{ marginTop: '12px', padding: '12px 16px', background: '#ffffff', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
                          <div style={{ fontWeight: 850, fontSize: '0.86rem', color: '#1e293b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📜</span> Payment &amp; Cheque Audit Log
                          </div>

                          {paymentLogs.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: paymentsList.length > 0 ? '10px' : 0 }}>
                              {paymentLogs.map((log, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    background: log.type === 'cheque_bounced' ? '#fff1f2' : '#f0fdf4',
                                    border: `1.5px solid ${log.type === 'cheque_bounced' ? '#fca5a5' : '#86efac'}`,
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    justifyContent: 'space-between',
                                    gap: '12px'
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 800, fontSize: '0.82rem', color: log.type === 'cheque_bounced' ? '#dc2626' : '#15803d' }}>
                                      {log.type === 'cheque_bounced' ? '⚠️ Cheque Bounced' : '✓ Payment Method Changed'}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '2px' }}>
                                      {log.note}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                    <div>{formatDateTime(log.timestamp)}</div>
                                    <div style={{ fontWeight: 700 }}>by {log.changed_by || 'Staff'}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {paymentsList.length > 0 && (
                            <div style={{ marginTop: '6px' }}>
                              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', marginBottom: '5px', textTransform: 'uppercase' }}>
                                Recorded Payment Transactions ({paymentsList.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {paymentsList.map((p, idx) => (
                                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.78rem' }}>
                                    <div>
                                      <strong>{formatCurrency(p.amount)}</strong> via <span style={{ textTransform: 'uppercase', fontWeight: 800 }}>{p.payment_mode}</span>
                                      {p.cheque_no ? ` • Cheque #${p.cheque_no}` : ''}
                                      {p.cheque_status ? ` • Status: ${p.cheque_status.toUpperCase()}` : ''}
                                      {p.transaction_id ? ` • Ref/UTR: ${p.transaction_id}` : ''}
                                    </div>
                                    <div style={{ color: '#64748b', fontSize: '0.72rem' }}>
                                      {formatDateTime(p.created_at)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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

                    {(() => {
                      const isDetailPrepaidStay = Boolean(
                        detailBooking.is_prepaid === 1 ||
                        detailBooking.is_prepaid === '1' ||
                        detailBooking.is_prepaid === true ||
                        detailBooking.rate_type === 'prepaid' ||
                        ((detailBooking.booking_source && detailBooking.booking_source.toUpperCase() === 'OTA') && (
                          detailBooking.is_prepaid || 
                          (detailBooking.final_settlement_mode && detailBooking.final_settlement_mode.toLowerCase().includes('prepaid')) ||
                          (detailBooking.final_payment_mode && detailBooking.final_payment_mode.toLowerCase().includes('prepaid')) ||
                          (detailBooking.advance_payment_mode && detailBooking.advance_payment_mode.toLowerCase().includes('prepaid')) ||
                          Number(detailBooking.total_paid || 0) === 0
                        ))
                      );
                      const isZeroHotelPaid = Number(detailBooking.total_paid || 0) === 0;

                      return (
                        <div style={{ padding: '12px', background: isDetailPrepaidStay && isZeroHotelPaid ? '#faf5ff' : '#f0fdf4', borderRadius: '10px', border: `1px solid ${isDetailPrepaidStay && isZeroHotelPaid ? '#e9d5ff' : '#bbf7d0'}` }}>
                          <span style={{ fontSize: '0.74rem', fontWeight: 750, color: isDetailPrepaidStay && isZeroHotelPaid ? '#6b21a8' : '#166534', textTransform: 'uppercase' }}>Total Stay Revenue</span>
                          <div style={{ fontSize: '1.25rem', fontWeight: 900, color: isDetailPrepaidStay && isZeroHotelPaid ? '#7c3aed' : '#15803d', marginTop: '2px' }}>
                            {isDetailPrepaidStay && isZeroHotelPaid && detailBooking.ota_bill_amount > 0 ? formatCurrency(detailBooking.ota_bill_amount) : formatCurrency(detailBooking.total_paid || detailBooking.total_room_charge || 0)}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: isDetailPrepaidStay && isZeroHotelPaid ? '#7c3aed' : '#166534', fontWeight: 600 }}>
                            {isDetailPrepaidStay && isZeroHotelPaid ? `Prepaid Online (${detailBooking.ota_platform || 'OTA'}) • Hotel Paid: ₹0` : 'Settled & Completed'}
                          </div>
                        </div>
                      );
                    })()}
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
                        {Boolean(
                          detailBooking.is_prepaid === 1 ||
                          detailBooking.is_prepaid === '1' ||
                          detailBooking.is_prepaid === true ||
                          detailBooking.rate_type === 'prepaid' ||
                          ((detailBooking.booking_source && detailBooking.booking_source.toUpperCase() === 'OTA') && (
                            detailBooking.is_prepaid || 
                            (detailBooking.final_settlement_mode && detailBooking.final_settlement_mode.toLowerCase().includes('prepaid')) ||
                            (detailBooking.final_payment_mode && detailBooking.final_payment_mode.toLowerCase().includes('prepaid')) ||
                            (detailBooking.advance_payment_mode && detailBooking.advance_payment_mode.toLowerCase().includes('prepaid')) ||
                            Number(detailBooking.total_paid || 0) === 0
                          ))
                        ) && Number(detailBooking.total_paid || 0) === 0
                          ? `Prepaid stay (${detailBooking.ota_platform || 'OTA'}) • Official Tax Invoice available below (No Cash Receipt required)`
                          : 'Click "Receipt" to print official cash receipt (Receipt 1, 2-on-A4)'}
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
                            const isDetailPrepaid = Boolean(
                              detailBooking.is_prepaid === 1 ||
                              detailBooking.is_prepaid === '1' ||
                              detailBooking.is_prepaid === true ||
                              detailBooking.rate_type === 'prepaid' ||
                              ((detailBooking.booking_source && detailBooking.booking_source.toUpperCase() === 'OTA') && (
                                detailBooking.is_prepaid || 
                                (detailBooking.final_settlement_mode && detailBooking.final_settlement_mode.toLowerCase().includes('prepaid')) ||
                                (detailBooking.final_payment_mode && detailBooking.final_payment_mode.toLowerCase().includes('prepaid')) ||
                                (detailBooking.advance_payment_mode && detailBooking.advance_payment_mode.toLowerCase().includes('prepaid')) ||
                                Number(detailBooking.total_paid || 0) === 0
                              ))
                            );

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
                                const isPrepaidZeroRow = isDetailPrepaid && Number(p.amount) === 0 && !isRefundRow;
                                const pMode = isPrepaidZeroRow ? 'PREPAID' : (p.payment_mode || 'CASH');

                                return (
                                  <tr key={p.id} style={{ background: isRefundRow ? '#fff1f2' : (isPrepaidZeroRow ? '#faf5ff' : 'inherit') }}>
                                    <td style={{ fontWeight: 800, color: isRefundRow ? '#b91c1c' : (isPrepaidZeroRow ? '#6b21a8' : '#0f172a') }}>
                                      {isPrepaidZeroRow ? 'PREPAID' : (p.receipt_no || `RCP-${p.id}`)}
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
                                      ) : isPrepaidZeroRow ? (
                                        <div>
                                          <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#0f172a' }}>
                                            Prepaid Stay ({detailBooking.ota_platform || 'OTA'})
                                          </span>
                                          <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                                            Room Tariff &amp; Accommodation
                                          </div>
                                        </div>
                                      ) : (
                                        <span style={{ textTransform: 'capitalize', fontSize: '0.8rem', fontWeight: 700 }}>
                                          {p.payment_type ? p.payment_type.replace('_', ' ') : 'Stay Payment'}
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      <span style={{
                                        textTransform: 'uppercase',
                                        fontSize: '0.74rem',
                                        fontWeight: 800,
                                        background: isRefundRow ? '#fee2e2' : (isPrepaidZeroRow ? '#f3e8ff' : '#eff6ff'),
                                        color: isRefundRow ? '#991b1b' : (isPrepaidZeroRow ? '#6b21a8' : '#1d4ed8'),
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        border: isRefundRow ? '1px solid #fca5a5' : (isPrepaidZeroRow ? '1px solid #d8b4fe' : 'none')
                                      }}>
                                        {pMode}
                                      </span>
                                      {p.utr_number && (
                                        <div style={{ fontSize: '0.70rem', color: '#0369a1', marginTop: '2px' }}>
                                          UTR: {p.utr_number}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      <strong style={{ color: isRefundRow ? '#dc2626' : (isPrepaidZeroRow ? '#6b21a8' : '#15803d'), fontSize: '0.95rem' }}>
                                        {isRefundRow ? `- ${formatCurrency(Math.abs(p.amount))}` : formatCurrency(p.amount)}
                                      </strong>
                                      {isPrepaidZeroRow && (
                                        <div style={{ fontSize: '0.70rem', color: '#7c3aed', fontWeight: 600, marginTop: '2px' }}>
                                          Prepaid via {detailBooking.ota_platform || 'OTA'}
                                          {detailBooking.ota_bill_amount > 0 ? ` (₹${Number(detailBooking.ota_bill_amount).toLocaleString('en-IN')})` : ''}
                                        </div>
                                      )}
                                      {!isRefundRow && !isPrepaidZeroRow && Number(p.card_surcharge) > 0 && (
                                        <div style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                                          Base: {formatCurrency(p.split_card > 0 ? p.split_card : p.amount - p.card_surcharge)} + ₹{p.card_surcharge} Fee
                                        </div>
                                      )}
                                      {!isRefundRow && !isPrepaidZeroRow && Number(p.upi_tax) > 0 && (
                                        <div style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                                          Base: {formatCurrency(p.split_online > 0 ? p.split_online : p.amount - p.upi_tax)} + ₹{p.upi_tax} Fee
                                        </div>
                                      )}
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
                                      ) : isPrepaidZeroRow ? (
                                        <span
                                          style={{
                                            fontSize: '0.74rem',
                                            padding: '4px 10px',
                                            borderRadius: '6px',
                                            background: '#f8fafc',
                                            color: '#64748b',
                                            fontWeight: 750,
                                            border: '1px solid #e2e8f0',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                          }}
                                          title="Guest prepaid full tariff online. No cash receipt needed. Official Tax Invoice is available below."
                                        >
                                          ✓ Prepaid Online (No Receipt)
                                        </span>
                                      ) : (
                                        <>
                                        <button
                                          type="button"
                                          className="filter-chip"
                                          onClick={() => {
                                            const pMode = (p.payment_mode || '').toLowerCase();
                                            const serialNo = (p.receipt_no && !p.receipt_no.includes('/') && /^(CR|UPI|POS|CHQ|BTC)\d+/i.test(p.receipt_no))
                                              ? p.receipt_no
                                              : (pMode.includes('upi') ? 'UPI01' : pMode.includes('card') ? 'POS01' : pMode.includes('cheque') ? 'CHQ01' : 'CR01');

                                            const cardFee = Number(p.card_surcharge || p.cardSurcharge || 0);
                                            const upiFee = Number(p.upi_tax || p.upiTax || 0);
                                            const rawAmt = Number(p.amount) || 0;

                                            let baseAmt = Number(p.base_amount);
                                            if (!baseAmt || isNaN(baseAmt)) {
                                              if (Number(p.split_card) > 0 && (pMode.includes('card') || pMode.includes('pos'))) {
                                                baseAmt = Number(p.split_card);
                                              } else if (Number(p.split_online) > 0 && (pMode.includes('upi') || pMode.includes('online'))) {
                                                baseAmt = Number(p.split_online);
                                              } else if (Number(p.split_cash) > 0 && pMode.includes('cash')) {
                                                baseAmt = Number(p.split_cash);
                                              } else if (cardFee > 0 && rawAmt > cardFee) {
                                                baseAmt = rawAmt - cardFee;
                                              } else if (upiFee > 0 && rawAmt > upiFee) {
                                                baseAmt = rawAmt - upiFee;
                                              } else {
                                                baseAmt = rawAmt;
                                              }
                                            } else if (baseAmt === rawAmt && cardFee > 0 && rawAmt > cardFee) {
                                              baseAmt = rawAmt - cardFee;
                                            } else if (baseAmt === rawAmt && upiFee > 0 && rawAmt > upiFee) {
                                              baseAmt = rawAmt - upiFee;
                                            }

                                            const entireAmt = rawAmt > 0 && rawAmt >= (baseAmt + cardFee + upiFee)
                                              ? rawAmt
                                              : (baseAmt + cardFee + upiFee);

                                            const paymentStage = p.payment_type === 'bill_settlement' 
                                              ? 'checkout' 
                                              : (p.payment_type === 'advance' ? 'checkin' : 'living');

                                            const stageDescription = p.payment_type === 'bill_settlement'
                                              ? `Room #${detailBooking.room_number} - Checkout Settlement`
                                              : (p.payment_type === 'advance' ? `Room #${detailBooking.room_number} - Check-In Advance` : `Room #${detailBooking.room_number} - Stay Payment`);

                                            const receiptObj = {
                                              receipt_no: serialNo,
                                              voucher_number: detailBooking.voucher_number || detailBooking.voucherNumber,
                                              receipt_date: p.created_at,
                                              guest_name: detailBooking.guest_name,
                                              amount: entireAmt,
                                              base_amount: baseAmt,
                                              card_surcharge: cardFee,
                                              upi_tax: upiFee,
                                              payment_mode: p.payment_mode,
                                              split_cash: p.split_cash,
                                              split_online: p.split_online,
                                              split_card: p.split_card,
                                              split_cheque: p.split_cheque,
                                              utr_number: p.utr_number,
                                              cheque_no: p.cheque_no,
                                              bank_name: p.bank_name,
                                              room_numbers: detailBooking.room_number,
                                              particulars: stageDescription,
                                              payment_stage: paymentStage,
                                              cashier_name: p.cashier_name || p.cashier || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                            };
                                            printCashReceipt(receiptObj);
                                          }}
                                          style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                                          title="Print Official Cash Receipt (2-on-A4)"
                                        >
                                          🖨️ Receipt
                                        </button>
                                        <button
                                          type="button"
                                          className="filter-chip"
                                          onClick={() => {
                                            const receiptObj = {
                                              receipt_no: serialNo,
                                              voucher_number: detailBooking.voucher_number || detailBooking.voucherNumber,
                                              receipt_date: p.created_at,
                                              guest_name: detailBooking.guest_name,
                                              amount: entireAmt,
                                              base_amount: baseAmt,
                                              card_surcharge: cardFee,
                                              upi_tax: upiFee,
                                              payment_mode: p.payment_mode,
                                              split_cash: p.split_cash,
                                              split_online: p.split_online,
                                              split_card: p.split_card,
                                              split_cheque: p.split_cheque,
                                              utr_number: p.utr_number,
                                              cheque_no: p.cheque_no,
                                              bank_name: p.bank_name,
                                              room_numbers: detailBooking.room_number,
                                              particulars: stageDescription,
                                              payment_stage: paymentStage,
                                              cashier_name: p.cashier_name || p.cashier || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                            };
                                            downloadReceiptPDF(receiptObj);
                                          }}
                                          style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#047857', borderColor: '#a7f3d0', background: '#ecfdf5', marginLeft: '6px' }}
                                          title="Download Official Receipt PDF"
                                        >
                                          📥 Download
                                        </button>
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                );
                              });
                            }

                            if (isDetailPrepaid) {
                              return (
                                <tr style={{ background: '#faf5ff' }}>
                                  <td style={{ fontWeight: 800, color: '#6b21a8' }}>
                                    PREPAID
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                    {formatDateTime(detailBooking.checkin_time)}
                                  </td>
                                  <td>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#0f172a' }}>
                                      Prepaid Stay ({detailBooking.ota_platform || 'OTA'})
                                    </span>
                                    <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                                      Room Tariff &amp; Accommodation
                                    </div>
                                  </td>
                                  <td>
                                    <span style={{
                                      textTransform: 'uppercase',
                                      fontSize: '0.74rem',
                                      fontWeight: 800,
                                      background: '#f3e8ff',
                                      color: '#6b21a8',
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      border: '1px solid #d8b4fe'
                                    }}>
                                      PREPAID
                                    </span>
                                  </td>
                                  <td>
                                    <strong style={{ color: '#6b21a8', fontSize: '0.95rem' }}>
                                      ₹0
                                    </strong>
                                    <div style={{ fontSize: '0.70rem', color: '#7c3aed', fontWeight: 600, marginTop: '2px' }}>
                                      Prepaid via {detailBooking.ota_platform || 'OTA'}
                                      {detailBooking.ota_bill_amount > 0 ? ` (₹${Number(detailBooking.ota_bill_amount).toLocaleString('en-IN')})` : ''}
                                    </div>
                                  </td>
                                  <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                    {detailBooking.checked_in_by || detailBooking.checked_out_by || 'Front Desk'}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span
                                      style={{
                                        fontSize: '0.74rem',
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        background: '#f8fafc',
                                        color: '#64748b',
                                        fontWeight: 750,
                                        border: '1px solid #e2e8f0',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                      }}
                                      title="Guest prepaid entire stay online. No cash receipt needed. Official Tax Invoice is available below."
                                    >
                                      ✓ Prepaid Online (No Receipt)
                                    </span>
                                  </td>
                                </tr>
                              );
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
                                    {detailBooking.final_settlement_mode || detailBooking.final_payment_mode || detailBooking.advance_payment_mode || 'CASH'}
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
                                    onClick={() => {
                                      const sMode = (detailBooking.final_settlement_mode || detailBooking.final_payment_mode || detailBooking.advance_payment_mode || 'Cash').toLowerCase();
                                      const serialNo = (detailBooking.advance_receipt_no && !detailBooking.advance_receipt_no.includes('/') && /^(CR|UPI|POS|CHQ|BTC)\d+/i.test(detailBooking.advance_receipt_no))
                                        ? detailBooking.advance_receipt_no
                                        : (sMode.includes('upi') ? 'UPI01' : sMode.includes('card') ? 'POS01' : sMode.includes('cheque') ? 'CHQ01' : 'CR01');

                                      const cardFee = Number(detailBooking.final_card_surcharge || detailBooking.card_surcharge || detailBooking.advance_card_surcharge || 0);
                                      const upiFee = Number(detailBooking.final_upi_tax || detailBooking.upi_tax || 0);
                                      const rawAmt = Number(detailBooking.total_paid || detailBooking.total_room_charge || 0);
                                      let baseAmt = rawAmt;
                                      if (cardFee > 0 && rawAmt > cardFee) baseAmt = rawAmt - cardFee;
                                      else if (upiFee > 0 && rawAmt > upiFee) baseAmt = rawAmt - upiFee;

                                      printCashReceipt({
                                        receipt_no: serialNo,
                                        voucher_number: detailBooking.voucher_number || detailBooking.voucherNumber,
                                        receipt_date: detailBooking.checkout_time || detailBooking.checkin_time,
                                        guest_name: detailBooking.guest_name,
                                        amount: rawAmt,
                                        base_amount: baseAmt,
                                        card_surcharge: cardFee,
                                        upi_tax: upiFee,
                                        payment_mode: detailBooking.final_settlement_mode || detailBooking.final_payment_mode || 'Cash',
                                        split_cash: detailBooking.split_cash || detailBooking.final_split_cash,
                                        split_online: detailBooking.split_online || detailBooking.final_split_online,
                                        split_card: detailBooking.split_card || detailBooking.final_split_card,
                                        split_cheque: detailBooking.split_cheque || detailBooking.final_split_cheque,
                                        utr_number: detailBooking.utr_number || detailBooking.advance_utr_number || detailBooking.final_settlement_utr,
                                        cheque_no: detailBooking.cheque_no || detailBooking.advance_cheque_no,
                                        bank_name: detailBooking.bank_name || detailBooking.advance_cheque_bank,
                                        room_numbers: detailBooking.room_number,
                                        particulars: `Stay Settlement - Room ${detailBooking.room_number}`,
                                        payment_stage: 'checkout',
                                        cashier_name: detailBooking.checked_out_by || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                      });
                                    }}
                                    style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                                    title="Print Official Cash Receipt (2-on-A4)"
                                  >
                                    🖨️ Receipt
                                  </button>
                                  <button
                                    type="button"
                                    className="filter-chip"
                                    onClick={() => {
                                      const sMode = (detailBooking.final_settlement_mode || detailBooking.final_payment_mode || detailBooking.advance_payment_mode || 'Cash').toLowerCase();
                                      const serialNo = (detailBooking.advance_receipt_no && !detailBooking.advance_receipt_no.includes('/') && /^(CR|UPI|POS|CHQ|BTC)\d+/i.test(detailBooking.advance_receipt_no))
                                        ? detailBooking.advance_receipt_no
                                        : (sMode.includes('upi') ? 'UPI01' : sMode.includes('card') ? 'POS01' : sMode.includes('cheque') ? 'CHQ01' : 'CR01');

                                      const cardFee = Number(detailBooking.final_card_surcharge || detailBooking.card_surcharge || detailBooking.advance_card_surcharge || 0);
                                      const upiFee = Number(detailBooking.final_upi_tax || detailBooking.upi_tax || 0);
                                      const rawAmt = Number(detailBooking.total_paid || detailBooking.total_room_charge || 0);
                                      let baseAmt = rawAmt;
                                      if (cardFee > 0 && rawAmt > cardFee) baseAmt = rawAmt - cardFee;
                                      else if (upiFee > 0 && rawAmt > upiFee) baseAmt = rawAmt - upiFee;

                                      downloadReceiptPDF({
                                        receipt_no: serialNo,
                                        voucher_number: detailBooking.voucher_number || detailBooking.voucherNumber,
                                        receipt_date: detailBooking.checkout_time || detailBooking.checkin_time,
                                        guest_name: detailBooking.guest_name,
                                        amount: rawAmt,
                                        base_amount: baseAmt,
                                        card_surcharge: cardFee,
                                        upi_tax: upiFee,
                                        payment_mode: detailBooking.final_settlement_mode || detailBooking.final_payment_mode || 'Cash',
                                        split_cash: detailBooking.split_cash || detailBooking.final_split_cash,
                                        split_online: detailBooking.split_online || detailBooking.final_split_online,
                                        split_card: detailBooking.split_card || detailBooking.final_split_card,
                                        split_cheque: detailBooking.split_cheque || detailBooking.final_split_cheque,
                                        utr_number: detailBooking.utr_number || detailBooking.advance_utr_number || detailBooking.final_settlement_utr,
                                        cheque_no: detailBooking.cheque_no || detailBooking.advance_cheque_no,
                                        bank_name: detailBooking.bank_name || detailBooking.advance_cheque_bank,
                                        room_numbers: detailBooking.room_number,
                                        particulars: `Stay Settlement - Room ${detailBooking.room_number}`,
                                        payment_stage: 'checkout',
                                        cashier_name: detailBooking.checked_out_by || detailBooking.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                                      });
                                    }}
                                    style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#047857', borderColor: '#a7f3d0', background: '#ecfdf5', marginLeft: '6px' }}
                                    title="Download Official Receipt PDF"
                                  >
                                    📥 Download
                                  </button>
                                </td>
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Cheque Realization & Scan Status in Stay Details */}
                  {(() => {
                    const detailHasCheque = (
                      (detailBooking.final_settlement_mode && detailBooking.final_settlement_mode.toLowerCase() === 'cheque') ||
                      (detailBooking.final_payment_mode && detailBooking.final_payment_mode.toLowerCase() === 'cheque') ||
                      (detailBooking.advance_payment_mode && detailBooking.advance_payment_mode.toLowerCase() === 'cheque') ||
                      Number(detailBooking.split_cheque || 0) > 0 ||
                      Boolean(detailBooking.settlement_cheque_no) ||
                      Boolean(detailBooking.advance_cheque_no) ||
                      Boolean(detailBooking.cheque_photo) ||
                      Boolean(detailBooking.settlement_cheque_photo) ||
                      (detailBooking.booking_source === 'BTC' || detailBooking.btc_company_id !== null || Boolean(detailBooking.btc_company_name))
                    );

                    if (!detailHasCheque) return null;

                    const chqPhoto = detailBooking.cheque_photo || detailBooking.settlement_cheque_photo;
                    const isChqPassed = (detailBooking.cheque_status === 'realized' || detailBooking.cheque_status === 'passed') && detailBooking.payment_status === 'settled';
                    const chqNo = detailBooking.settlement_cheque_no || detailBooking.advance_cheque_no || detailBooking.cheque_no || 'N/A';
                    const chqBank = detailBooking.settlement_cheque_bank || detailBooking.advance_cheque_bank || detailBooking.bank_name || '-';

                    return (
                      <div style={{ marginTop: '20px', padding: '16px 20px', background: '#f8fafc', borderRadius: '12px', border: '1.5px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.4rem' }}>🏛️</span>
                            <div>
                              <strong style={{ fontSize: '0.98rem', color: '#0f172a' }}>Cheque Settlement &amp; Verification</strong>
                              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                                Cheque #{chqNo} • Bank: {chqBank}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                padding: '4px 10px',
                                borderRadius: '8px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                background: detailBooking.cheque_status === 'bounced' || detailBooking.advance_cheque_status === 'bounced'
                                  ? '#fee2e2'
                                  : isChqPassed
                                    ? '#dcfce7'
                                    : '#fffbeb',
                                color: detailBooking.cheque_status === 'bounced' || detailBooking.advance_cheque_status === 'bounced'
                                  ? '#b91c1c'
                                  : isChqPassed
                                    ? '#166534'
                                    : '#b45309',
                                border: `1px solid ${
                                  detailBooking.cheque_status === 'bounced' || detailBooking.advance_cheque_status === 'bounced'
                                    ? '#fca5a5'
                                    : isChqPassed
                                      ? '#86efac'
                                      : '#fde68a'
                                }`
                              }}
                            >
                              {detailBooking.cheque_status === 'bounced' || detailBooking.advance_cheque_status === 'bounced'
                                ? '⚠️ Cheque Bounced / Dishonored'
                                : isChqPassed
                                  ? '✓ Cheque Realized (Credited to Account)'
                                  : '⏳ Pending Bank Clearance'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenScanCheque(detailBooking)}
                              style={{
                                padding: '5px 12px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                background: chqPhoto ? '#f0fdf4' : '#0071e3',
                                color: chqPhoto ? '#15803d' : '#ffffff',
                                border: chqPhoto ? '1.5px solid #86efac' : 'none',
                                borderRadius: '6px',
                                cursor: 'pointer'
                              }}
                            >
                              {chqPhoto ? '🔍 View / Re-scan Cheque' : '📷 Scan Cheque'}
                            </button>
                            {!isChqPassed && (detailBooking.cheque_status !== 'bounced' && detailBooking.advance_cheque_status !== 'bounced') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handlePassCheque(detailBooking)}
                                  style={{
                                    padding: '5px 14px',
                                    fontSize: '0.78rem',
                                    fontWeight: 850,
                                    background: '#16a34a',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)'
                                  }}
                                >
                                  ✅ Pass Cheque (Credit Account)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMarkChequeBounced(detailBooking)}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '0.78rem',
                                    fontWeight: 800,
                                    background: '#fee2e2',
                                    color: '#b91c1c',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '6px',
                                    cursor: 'pointer'
                                  }}
                                  title="Mark cheque as bounced / dishonored"
                                >
                                  ⚠️ Cheque Bounced
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenChangePayment(detailBooking)}
                              style={{
                                padding: '5px 12px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                background: '#fef3c7',
                                color: '#b45309',
                                border: '1px solid #fde68a',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              title="Change payment method to Cash, UPI, Card, or NEFT"
                            >
                              <span>🔄</span> Change Payment Method
                            </button>
                          </div>
                        </div>

                        {chqPhoto && (
                          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <img
                              src={chqPhoto}
                              alt="Physical Cheque Scan"
                              onClick={() => {
                                setLightboxImg(chqPhoto);
                                setLightboxTitle(`Cheque #${chqNo} - Booking #${detailBooking.id}`);
                              }}
                              style={{
                                height: '70px',
                                width: '130px',
                                objectFit: 'cover',
                                borderRadius: '8px',
                                border: '1.5px solid #cbd5e1',
                                cursor: 'zoom-in',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)'
                              }}
                              title="Click to Zoom Fullscreen"
                            />
                            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                              Physical cheque copy scanned and verified. Click image to enlarge.
                            </span>
                          </div>
                        )}

                        {/* Room Shift / Transfer Activity Log */}
                        {(() => {
                          let logs = [];
                          try {
                            logs = detailBooking.extension_logs_json ? JSON.parse(detailBooking.extension_logs_json) : [];
                          } catch (_) { logs = []; }
                          if (!Array.isArray(logs)) logs = [];

                          const transferLogs = logs.filter((l) => l.type === 'room_transfer');
                          if (transferLogs.length === 0) return null;

                          return (
                            <div style={{ marginTop: '14px', padding: '12px 16px', background: '#f5f3ff', borderRadius: '10px', border: '1.5px solid #c4b5fd' }}>
                              <div style={{ fontWeight: 850, fontSize: '0.84rem', color: '#5b21b6', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>🔄</span> Room Shift / Transfer Audit Log ({transferLogs.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {transferLogs.map((log, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: '8px 12px',
                                      borderRadius: '8px',
                                      background: '#ffffff',
                                      border: '1px solid #ddd6fe',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      justifyContent: 'space-between',
                                      gap: '12px'
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#6d28d9' }}>
                                        Room Shift: #{log.from_room_number} ➔ #{log.to_room_number}
                                      </div>
                                      <div style={{ fontSize: '0.78rem', color: '#4c1d95', marginTop: '2px' }}>
                                        {log.room_type ? `Room Type: ${log.room_type} • ` : ''}{log.reason || 'Guest room shift (same room type)'}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#6b21a8', whiteSpace: 'nowrap' }}>
                                      <div>{formatDateTime(log.transferred_at || log.created_at)}</div>
                                      <div style={{ fontWeight: 700 }}>by {log.transferred_by || 'Front Desk'}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Payment & Cheque Audit Log directly below this cheque section */}
                        {(() => {
                          let logs = [];
                          try {
                            logs = detailBooking.extension_logs_json ? JSON.parse(detailBooking.extension_logs_json) : [];
                          } catch (_) { logs = []; }
                          if (!Array.isArray(logs)) logs = [];

                          const paymentLogs = logs.filter(l => l.type === 'cheque_bounced' || l.type === 'payment_method_changed');
                          if (paymentLogs.length === 0) return null;

                          return (
                            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #cbd5e1' }}>
                              <div style={{ fontWeight: 850, fontSize: '0.84rem', color: '#1e293b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>📜</span> Payment &amp; Cheque Audit Log
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {paymentLogs.map((log, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: '8px 12px',
                                      borderRadius: '8px',
                                      background: log.type === 'cheque_bounced' ? '#fff1f2' : '#f0fdf4',
                                      border: `1.5px solid ${log.type === 'cheque_bounced' ? '#fca5a5' : '#86efac'}`,
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      justifyContent: 'space-between',
                                      gap: '12px'
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontWeight: 800, fontSize: '0.82rem', color: log.type === 'cheque_bounced' ? '#dc2626' : '#15803d' }}>
                                        {log.type === 'cheque_bounced' ? '⚠️ Cheque Bounced' : '✓ Payment Method Changed'}
                                      </div>
                                      <div style={{ fontSize: '0.78rem', color: '#334155', marginTop: '2px' }}>
                                        {log.note}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: 'right', fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                      <div>{formatDateTime(log.timestamp)}</div>
                                      <div style={{ fontWeight: 700 }}>by {log.changed_by || 'Staff'}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
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
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => {
                          setDocActionModal({ isOpen: true, type: 'activities', data: detailBooking });
                        }}
                        style={{ fontWeight: 800, padding: '8px 14px', fontSize: '0.85rem', background: '#f5f3ff', color: '#6d28d9', borderColor: '#c4b5fd' }}
                        title="Comprehensive Guest Activities & Financial Summary Statement (Save, Print, or Save & Print)"
                      >
                        📑 Activities Summary
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
                                  invoiceNo: detailBooking.invoice_no || formatTaxInvoiceNumber(detailBooking.voucher_number || detailBooking.voucher_no || detailBooking.checkin_voucher_no || detailBooking.id),
                                  checked_out_by: detailBooking.checked_out_by || (currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier_1')
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
                  {/* Cheque Confirmation Box */}
                  <div style={{ marginTop: '12px', padding: '12px 16px', background: settleBtcChequeStatus === 'realized' ? '#f0fdf4' : '#fffbeb', borderRadius: '10px', border: `1.5px solid ${settleBtcChequeStatus === 'realized' ? '#86efac' : '#fde68a'}` }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        id="settleBtcChequePassConfirm"
                        checked={settleBtcChequeStatus === 'realized'}
                        onChange={(e) => setSettleBtcChequeStatus(e.target.checked ? 'realized' : 'pending')}
                        style={{ width: '18px', height: '18px', accentColor: '#16a34a', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: settleBtcChequeStatus === 'realized' ? '#15803d' : '#92400e' }}>
                        ✓ Confirm Cheque Passed &amp; Cleared (Credit Accounts Ledger)
                      </span>
                    </label>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', marginLeft: '28px' }}>
                      {settleBtcChequeStatus === 'realized'
                        ? 'Cheque is confirmed passed. It will immediately credit hotel accounts and settle this stay.'
                        : 'Cheque is pending clearing. Settle as pending until bank confirms.'}
                    </div>
                  </div>

                  {/* Cheque Photo Scan / Upload for BTC */}
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #cbd5e1' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '6px' }}>
                      Physical Cheque Photo / Scan
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleHardwareScanCheque}
                        disabled={isHardwareScanning}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: isHardwareScanning ? '#94a3b8' : '#0284c7',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: isHardwareScanning ? 'not-allowed' : 'pointer'
                        }}
                        title="Scan cheque using physical flatbed scanner"
                      >
                        <span>🖨️</span> {isHardwareScanning ? 'Scanning...' : 'Scan Scanner'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChequeCamTargetMode('settle_btc');
                          setIsChequeCamOpen(true);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: '#0071e3',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        <span>📷</span> Scan Camera
                      </button>
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          background: '#f1f5f9',
                          color: '#334155',
                          border: '1px solid #cbd5e1',
                          fontWeight: 800,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        <span>📁</span> Upload
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (evt) => {
                                setSettleBtcChequePhoto(evt.target.result);
                                showToast('✓ Cheque photo selected', 'green');
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </label>
                      {settleBtcChequePhoto && (
                        <button
                          type="button"
                          onClick={() => setSettleBtcChequePhoto(null)}
                          style={{
                            padding: '4px 8px',
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fca5a5',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          🗑️ Remove Photo
                        </button>
                      )}
                    </div>

                    {settleBtcChequePhoto && (
                      <div style={{ marginTop: '8px' }}>
                        <img
                          src={settleBtcChequePhoto}
                          alt="Cheque Scan"
                          onClick={() => {
                            setLightboxImg(settleBtcChequePhoto);
                            setLightboxTitle(`BTC Settlement Cheque #${settleBtcChequeNo || ''}`);
                          }}
                          style={{
                            height: '60px',
                            width: '120px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            border: '1.5px solid #86efac',
                            cursor: 'zoom-in'
                          }}
                          title="Click to Zoom"
                        />
                      </div>
                    )}
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
                ✓ {settleBtcSubmitting ? 'Settling...' : (settleBtcMode === 'cheque' && settleBtcChequeStatus === 'realized' ? 'Pass Cheque & Settle BTC' : 'Confirm Settlement & Release Invoice')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Payment Method Modal (Bounced Cheque / Resettle) */}
      {changePaymentTarget && (
        <div className="modal-overlay active" style={{ zIndex: 10100 }}>
          <div className="modal-container" style={{ maxWidth: '540px', width: '95%' }}>
            <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1.5px solid var(--border-color, #e2e8f0)', background: 'var(--bg-surface, #ffffff)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem', padding: '6px 10px', background: '#fef3c7', borderRadius: '10px', color: '#d97706' }}>🔄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
                    Change Payment Method (Resettle)
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)' }}>
                    Booking #{changePaymentTarget.id} • {changePaymentTarget.guest_name} • Prev Cheque: #{changePaymentTarget.settlement_cheque_no || changePaymentTarget.advance_cheque_no || 'Recorded'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setChangePaymentTarget(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              {/* Amount to Settle */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Payment Amount Received (₹) *
                </label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  step="any"
                  value={changePaymentAmount}
                  onChange={(e) => setChangePaymentAmount(e.target.value)}
                  style={{ height: '42px', fontSize: '1rem', fontWeight: 800 }}
                  required
                />
              </div>

              {/* New Payment Mode Selection */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  New Payment Mode *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'upi', label: 'Online / UPI', icon: '📱' },
                    { id: 'bank_transfer', label: 'NEFT / RTGS', icon: '🏦' },
                    { id: 'cash', label: 'Cash', icon: '💵' },
                    { id: 'card', label: 'Card / POS', icon: '💳' },
                    { id: 'cheque', label: 'New Cheque', icon: '🏛️' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setChangePaymentNewMode(m.id)}
                      style={{
                        padding: '10px 6px',
                        borderRadius: '8px',
                        border: changePaymentNewMode === m.id ? '2px solid #2563eb' : '1.5px solid var(--border-color, #e2e8f0)',
                        background: changePaymentNewMode === m.id ? '#eff6ff' : 'var(--bg-surface, #ffffff)',
                        color: changePaymentNewMode === m.id ? '#1d4ed8' : 'var(--text-primary, #0f172a)',
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

              {/* Conditional inputs */}
              {(changePaymentNewMode === 'upi' || changePaymentNewMode === 'bank_transfer') && (
                <div style={{ marginBottom: '14px', padding: '12px', background: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e40af', display: 'block', marginBottom: '5px' }}>
                    UTR / Bank Reference No. *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter 12-digit UTR or Bank Ref No."
                    value={changePaymentRef}
                    onChange={(e) => setChangePaymentRef(e.target.value)}
                    style={{ height: '38px', background: '#ffffff', color: '#0f172a', fontWeight: 750 }}
                    required
                  />
                </div>
              )}

              {changePaymentNewMode === 'cheque' && (
                <div style={{ marginBottom: '14px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569', display: 'block', marginBottom: '4px' }}>
                        New Cheque Number *
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 000543"
                        value={changePaymentChequeNo}
                        onChange={(e) => setChangePaymentChequeNo(e.target.value)}
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
                        placeholder="e.g. SBI Bank"
                        value={changePaymentChequeBank}
                        onChange={(e) => setChangePaymentChequeBank(e.target.value)}
                        style={{ height: '38px' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Reason / Notes */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', display: 'block', marginBottom: '6px' }}>
                  Change Reason / Audit Note
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={changePaymentReason}
                  onChange={(e) => setChangePaymentReason(e.target.value)}
                  style={{ height: '38px' }}
                />
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1.5px solid var(--border-color, #e2e8f0)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-custom-cancel"
                onClick={() => setChangePaymentTarget(null)}
                style={{ padding: '8px 18px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleExecuteChangePayment}
                disabled={changePaymentSubmitting}
                style={{ padding: '8px 22px', fontWeight: 850, background: '#16a34a', border: 'none' }}
              >
                ✓ {changePaymentSubmitting ? 'Updating...' : 'Confirm & Settle Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cheque Scanning & Realization Modal */}
      {chequeScanTarget && (
        <div
          className="modal-overlay active"
          style={{
            zIndex: 10080,
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            className="modal-container"
            style={{
              width: '100%',
              maxWidth: '620px',
              maxHeight: '92vh',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              background: 'var(--bg-app, #ffffff)',
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div
              className="modal-header"
              style={{
                padding: '16px 22px',
                background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem' }}>📷</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 850, color: '#ffffff' }}>
                    Scan &amp; Pass Cheque
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                    Booking #{chequeScanTarget.id} • Room #{chequeScanTarget.room_number || '-'} • {chequeScanTarget.guest_name || 'Guest'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChequeScanTarget(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  color: '#ffffff',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="modal-body" style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
              {/* Booking & Financial Info Banner */}
              <div
                style={{
                  padding: '12px 16px',
                  background: '#f8fafc',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                    Cheque Amount / Total Bill
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 850, color: '#15803d' }}>
                    {formatCurrency(
                      parseFloat(chequeScanTarget.split_cheque || 0) > 0
                        ? parseFloat(chequeScanTarget.split_cheque)
                        : (parseFloat(chequeScanTarget.total_room_charge || 0) || parseFloat(chequeScanTarget.total_paid || 0))
                    )}
                  </div>
                  {chequeScanTarget.btc_company_name && (
                    <div style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 700, marginTop: '2px' }}>
                      🏢 Corporate: {chequeScanTarget.btc_company_name}
                    </div>
                  )}
                </div>
                <div>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      background: (chequeScanTarget.cheque_status === 'realized' || chequeScanTarget.cheque_status === 'passed') ? '#dcfce7' : '#fffbeb',
                      color: (chequeScanTarget.cheque_status === 'realized' || chequeScanTarget.cheque_status === 'passed') ? '#166534' : '#b45309',
                      border: `1.5px solid ${(chequeScanTarget.cheque_status === 'realized' || chequeScanTarget.cheque_status === 'passed') ? '#86efac' : '#fde68a'}`
                    }}
                  >
                    {(chequeScanTarget.cheque_status === 'realized' || chequeScanTarget.cheque_status === 'passed')
                      ? '✓ Realized / Passed'
                      : '⏳ Pending Clearance'}
                  </span>
                </div>
              </div>

              {/* Cheque Details Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '5px' }}>
                    Cheque Number *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 000452"
                    value={chequeScanNo}
                    onChange={(e) => setChequeScanNo(e.target.value)}
                    style={{ height: '38px', fontWeight: 750 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '5px' }}>
                    Bank &amp; Branch Name
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. SBI, Solapur Branch"
                    value={chequeScanBank}
                    onChange={(e) => setChequeScanBank(e.target.value)}
                    style={{ height: '38px' }}
                  />
                </div>
              </div>

              {/* Scan / Upload Controls */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  Cheque Physical Copy / Scan
                </label>

                {/* Scanner Connection Status */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: detectedScanner ? '#f0fdf4' : '#f8fafc',
                  border: detectedScanner ? '1.5px solid #86efac' : '1.5px solid #e2e8f0',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  marginBottom: '10px',
                  fontSize: '0.78rem',
                  fontWeight: 750,
                  color: detectedScanner ? '#15803d' : '#64748b'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{detectedScanner ? '🟢' : '⚪'}</span>
                    <span>{detectedScanner ? `Hardware Scanner: ${detectedScanner}` : 'Optical flatbed scanner bridge ready'}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleHardwareScanCheque}
                    disabled={isHardwareScanning}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 18px',
                      borderRadius: '8px',
                      background: isHardwareScanning ? '#94a3b8' : '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 850,
                      fontSize: '0.86rem',
                      cursor: isHardwareScanning ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)'
                    }}
                    title="Read physical cheque directly from flatbed optical scanner (Canon / HP / Epson)"
                  >
                    <span>🖨️</span> {isHardwareScanning ? '⚡ Reading Scanner...' : 'Scan from Scanner'}
                  </button>

                  <button
                    type="button"
                    onClick={handleGrabLatestScanCheque}
                    disabled={isHardwareScanning}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 14px',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      color: '#0369a1',
                      border: '1.5px solid #bae6fd',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer'
                    }}
                    title="Retrieve latest scanned file from Windows Scans folder"
                  >
                    <span>📂</span> Grab Latest Scan
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setChequeCamTargetMode('scan_modal');
                      setIsChequeCamOpen(true);
                    }}
                    disabled={isHardwareScanning}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 14px',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1.5px solid #cbd5e1',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer'
                    }}
                    title="Capture cheque using webcam / camera"
                  >
                    <span>📷</span> Camera
                  </button>

                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 14px',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1.5px solid #cbd5e1',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer'
                    }}
                  >
                    <span>📁</span> Upload Photo
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = async (evt) => {
                            const compressed = await compressBase64Image(evt.target.result);
                            setChequeScanPhoto(compressed || evt.target.result);
                            showToast('✓ Cheque photo selected', 'green');
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>

                  <span style={{ fontSize: '0.74rem', color: '#64748b', fontStyle: 'italic' }}>
                    Tip: Press <strong>Ctrl+V</strong> to paste
                  </span>
                </div>

                {isHardwareScanning && (
                  <div style={{ marginTop: '8px', padding: '8px 12px', background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: '8px', color: '#0369a1', fontSize: '0.80rem', fontWeight: 750, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #0284c7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <span>Scanner carriage is reading physical cheque... Please wait.</span>
                  </div>
                )}
              </div>

              {/* Photo Preview or Empty State */}
              {chequeScanPhoto ? (
                <div
                  style={{
                    position: 'relative',
                    background: '#0f172a',
                    borderRadius: '12px',
                    padding: '8px',
                    textAlign: 'center',
                    border: '2px solid #22c55e',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                  }}
                >
                  <img
                    src={chequeScanPhoto}
                    alt="Scanned Cheque"
                    onClick={() => {
                      setLightboxImg(chequeScanPhoto);
                      setLightboxTitle(`Scanned Cheque #${chequeScanNo || 'Photo'} - Booking #${chequeScanTarget.id}`);
                    }}
                    style={{
                      maxHeight: '260px',
                      width: '100%',
                      objectFit: 'contain',
                      borderRadius: '8px',
                      cursor: 'zoom-in'
                    }}
                    title="Click to Zoom Fullscreen"
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '6px',
                      padding: '0 4px'
                    }}
                  >
                    <span style={{ fontSize: '0.74rem', color: '#86efac', fontWeight: 700 }}>
                      ✓ Cheque image attached • Click photo to zoom
                    </span>
                    <button
                      type="button"
                      onClick={() => setChequeScanPhoto(null)}
                      style={{
                        background: '#ef4444',
                        color: '#ffffff',
                        border: 'none',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      🗑️ Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    border: '2px dashed #cbd5e1',
                    borderRadius: '12px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    background: '#f8fafc'
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '6px' }}>🖨️</div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#475569' }}>
                    No cheque photo attached yet
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    Click <strong>Scan from Scanner</strong> above to scan physical cheque, or choose file / camera
                  </div>
                </div>
              )}
            </div>

            {/* Footer with Actions */}
            <div
              className="modal-footer"
              style={{
                padding: '14px 22px',
                background: '#f8fafc',
                borderTop: '1.5px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <button
                type="button"
                className="btn-custom-cancel"
                onClick={() => setChequeScanTarget(null)}
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleSaveChequeScan(false)}
                  disabled={chequeScanSubmitting || !chequeScanPhoto}
                  style={{
                    padding: '8px 22px',
                    borderRadius: '8px',
                    background: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 850,
                    fontSize: '0.86rem',
                    cursor: chequeScanSubmitting || !chequeScanPhoto ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 8px rgba(22, 163, 74, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Save attached cheque photo to booking record"
                >
                  <span>💾</span> {chequeScanSubmitting ? 'Saving...' : 'Save Cheque Scan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Camera Scanner for Cheques */}
      <DocumentScannerModal
        isOpen={isChequeCamOpen}
        onClose={() => setIsChequeCamOpen(false)}
        onCapture={(photoDataUrl) => {
          if (chequeCamTargetMode === 'settle_btc') {
            setSettleBtcChequePhoto(photoDataUrl);
          } else {
            setChequeScanPhoto(photoDataUrl);
          }
          setIsChequeCamOpen(false);
          showToast('✓ Cheque scanned from camera!', 'green');
        }}
        title="Scan Physical Cheque"
        subtitle="Align the physical cheque within the frame and click Snap Photo"
      />

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
