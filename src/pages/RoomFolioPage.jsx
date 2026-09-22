import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import ImageLightbox from '../components/common/ImageLightbox';
import FolioSettlementModal from '../components/hospitality/FolioSettlementModal';
import DocumentActionModal from '../components/hospitality/DocumentActionModal';
import { printCashReceipt, printGuestRegistrationA4, downloadGuestRegistrationPDF, printGuestPaymentSummary, printFinalBillA4 } from '../services/printService';
export const getFnbPaymentModeInfo = (ord) => {
  if (!ord) return { label: 'Unknown', shortLabel: 'Unknown', icon: '💰', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };

  const isPaid = ord.is_paid === 1;
  const rawMode = String(ord.payment_mode || '').toLowerCase().trim();

  // If unpaid / room_folio pending
  if (!isPaid || (rawMode === 'room_folio' && !isPaid)) {
    return {
      label: 'Room Folio (Pending Checkout)',
      shortLabel: 'Room Folio',
      icon: '🏨',
      bg: '#fff1f2',
      color: '#b91c1c',
      border: '#fca5a5',
      utr: null
    };
  }

  // Parse split details if any
  let split = null;
  if (ord.split_details_json) {
    try {
      split = typeof ord.split_details_json === 'string' ? JSON.parse(ord.split_details_json) : ord.split_details_json;
    } catch (e) { console.warn('Failed to parse split_details_json:', e.message); }
  }

  const splitCash = Number(ord.split_cash ?? split?.cash ?? 0);
  const splitOnline = Number(ord.split_online ?? split?.online ?? split?.upi ?? 0);
  const splitCard = Number(ord.split_card ?? split?.card ?? 0);
  const utr = ord.utr_number || ord.online_utr || split?.utr || null;

  const isSplit = rawMode === 'split' ||
    (splitCash > 0 && (splitOnline > 0 || splitCard > 0)) ||
    (splitOnline > 0 && splitCard > 0);

  if (isSplit) {
    const parts = [];
    if (splitCash > 0) parts.push(`Cash ₹${splitCash}`);
    if (splitOnline > 0) parts.push(`UPI ₹${splitOnline}`);
    if (splitCard > 0) parts.push(`Card ₹${splitCard}`);
    return {
      label: parts.length > 0 ? `Split (${parts.join(' + ')})` : 'Split Payment',
      shortLabel: parts.length > 0 ? `Split: ${parts.join(', ')}` : 'Split',
      icon: '🔀',
      bg: '#f5f3ff',
      color: '#6d28d9',
      border: '#c4b5fd',
      utr
    };
  }

  if (rawMode === 'cash' || (splitCash > 0 && !splitOnline && !splitCard) || (!rawMode && isPaid)) {
    return {
      label: 'Cash',
      shortLabel: 'Cash',
      icon: '💵',
      bg: '#ecfdf5',
      color: '#15803d',
      border: '#86efac',
      utr: null
    };
  }

  if (rawMode === 'online' || rawMode === 'upi' || (splitOnline > 0 && !splitCash && !splitCard)) {
    return {
      label: utr ? `UPI / Online (UTR: ${utr})` : 'UPI / Online',
      shortLabel: 'UPI / Online',
      icon: '📱',
      bg: '#f0f9ff',
      color: '#0369a1',
      border: '#7dd3fc',
      utr
    };
  }

  if (rawMode === 'card' || (splitCard > 0 && !splitCash && !splitOnline)) {
    return {
      label: 'Card POS',
      shortLabel: 'Card POS',
      icon: '💳',
      bg: '#fffbeb',
      color: '#92400e',
      border: '#fde68a',
      utr: null
    };
  }

  if (rawMode === 'cheque') {
    return {
      label: 'Cheque',
      shortLabel: 'Cheque',
      icon: '📑',
      bg: '#f8fafc',
      color: '#334155',
      border: '#cbd5e1',
      utr: null
    };
  }

  if (rawMode === 'room_folio' || rawMode === 'room') {
    return {
      label: 'Room Folio (Paid)',
      shortLabel: 'Room Folio',
      icon: '🏨',
      bg: '#f0fdf4',
      color: '#166534',
      border: '#bbf7d0',
      utr: null
    };
  }

  const capitalized = rawMode ? (rawMode.charAt(0).toUpperCase() + rawMode.slice(1)) : 'Cash';
  return {
    label: capitalized,
    shortLabel: capitalized,
    icon: '💵',
    bg: '#ecfdf5',
    color: '#15803d',
    border: '#86efac',
    utr
  };
};

export default function RoomFolioPage({ roomId, onBack, onReprintRegForm, onOpenVisitors, onCheckoutDone }) {
  const { showToast, showConfirm, currentUser } = useApp();
  const [folioData, setFolioData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtendOpen, setIsExtendOpen] = useState(false);
  const [extendDatetime, setExtendDatetime] = useState('');
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxTitle, setLightboxTitle] = useState('Preview');
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [docActionModal, setDocActionModal] = useState({ isOpen: false, type: 'info', data: null });
  const [selectedFnbOrder, setSelectedFnbOrder] = useState(null);
  const [fnbPayMode, setFnbPayMode] = useState('cash');
  const [fnbUtr, setFnbUtr] = useState('');
  const [fnbSplitCash, setFnbSplitCash] = useState('');
  const [fnbSplitOnline, setFnbSplitOnline] = useState('');
  const [fnbSplitCard, setFnbSplitCard] = useState('');
  const [fnbSplitCheque, setFnbSplitCheque] = useState('');
  const [isSettlingFnb, setIsSettlingFnb] = useState(false);
  const [isSendingMobile, setIsSendingMobile] = useState(false);

  useEffect(() => {
    if (selectedFnbOrder) {
      setFnbPayMode('cash');
      setFnbUtr('');
      setFnbSplitCash(selectedFnbOrder.total ? String(selectedFnbOrder.total) : '');
      setFnbSplitOnline('');
      setFnbSplitCard('');
      setFnbSplitCheque('');
    }
  }, [selectedFnbOrder]);

  const isAnySubModalOpen = Boolean(isSettlementOpen || lightboxImage || isExtendOpen || selectedFnbOrder);
  useEffect(() => {
    if (isAnySubModalOpen) {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    } else {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    };
  }, [isAnySubModalOpen]);

  const loadFolio = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getRoomFolio(roomId);
      const raw = res?.folio || res;
      const r = raw.room || {};
      const summary = raw.summary || {};

      const foodTotal = Number(summary.foodTotal ?? 0);
      const barTotal = Number(summary.barTotal ?? 0);
      const roomCharge = Number(summary.roomCharge ?? (r.total_room_charge || 0));
      const discountAmount = Number(summary.discountAmount ?? (r.discount_amount || 0));
      const discountPct = Number(summary.discountPct ?? (r.discount_pct || 0));
      const roomGrossTariff = Number(summary.roomGrossTariff ?? summary.roomTaxable ?? (roomCharge + discountAmount));
      const roomTaxable = Number(summary.roomTaxable ?? summary.stayTaxable ?? roomCharge);
      const stayTaxable = Number(summary.stayTaxable ?? roomTaxable);
      const stayTax = Number(summary.stayTax ?? summary.taxAmount ?? Math.max(0, roomCharge - roomTaxable));
      const grossTariff = Number(summary.roomGrossTariff ?? summary.grossTariff ?? (roomCharge + discountAmount));
      const netTotalCharge = Number(summary.netTotalCharge ?? (summary.grandTotal ?? (roomCharge + foodTotal + barTotal)));
      const advancePaid = Number(summary.advancePaid ?? (summary.initialPaid ?? (r.initial_paid || r.total_paid || 0)));
      const balanceDue = Number(summary.balanceDue ?? (netTotalCharge - advancePaid));
      const visitors = Array.isArray(raw.visitors) ? raw.visitors : [];
      const payments = Array.isArray(raw.payments) ? raw.payments : [];
      const visitorsCount = Number(summary.visitorsCount ?? visitors.length);

      const isBookingOta = (r.booking_source || raw.booking_source || r.source) === 'OTA';
      const isOtaPayAtHotel = isBookingOta && (
        summary.isOtaPayAtHotel === true ||
        r.is_prepaid === 0 ||
        r.is_prepaid === '0' ||
        r.is_prepaid === false ||
        String(r.rate_type || '').includes('hotel')
      );
      const isOtaPrepaid = isBookingOta && !isOtaPayAtHotel && (
        summary.isOtaPrepaid === true ||
        r.is_prepaid === 1 ||
        r.is_prepaid === '1' ||
        r.is_prepaid === true
      );

      const normalized = {
        ...raw,
        ...r,
        bookingId: r.booking_id || r.id,
        roomNumber: r.room_number,
        roomType: r.room_type,
        guestName: r.guest_name,
        fatherName: r.father_name,
        mobile: r.guest_phone || r.mobile,
        email: r.guest_email || r.email,
        dob: r.dob,
        address: r.address,
        docType: r.doc_type,
        docFront: r.doc_front,
        docBack: r.doc_back,
        guestPhoto: r.guest_photo,
        bookingSource: r.booking_source || r.source || 'Walk-in',
        btcCompanyName: r.btc_company_name || r.btcCompanyName,
        btcApprovalRef: r.btc_approval_ref || r.btcApprovalRef,
        btcCompanyId: r.btc_company_id || r.btcCompanyId,
        btcCompanyAddress: r.btc_address || r.btcCompanyAddress,
        btcCompanyGst: r.btc_gst_number || r.btcCompanyGst || r.gst_number,
        btcCompanyPan: r.btc_pan_number || r.btcCompanyPan,
        btcCompanyContactPerson: r.btc_contact_person || r.btcCompanyContactPerson,
        btcCompanyPhone: r.btc_contact_phone || r.btcCompanyPhone,
        btcCompanyEmail: r.btc_contact_email || r.btcCompanyEmail,
        companyName: r.btc_company_name || r.company_name,
        gstNumber: r.btc_gst_number || r.gst_number,
        otaPlatform: r.ota_platform || r.otaPlatform,
        otaBookingId: r.ota_booking_id || r.otaBookingId || r.ota_voucher_no || r.otaVoucherNo,
        ota_booking_id: r.ota_booking_id || r.otaBookingId || r.ota_voucher_no || r.otaVoucherNo,
        otaVoucherNo: r.ota_booking_id || r.otaBookingId || r.ota_voucher_no || r.otaVoucherNo,
        isEarlyCheckin: Boolean(r.is_early_checkin || raw.is_early_checkin),
        originalCheckinTime: r.original_checkin_time || raw.original_checkin_time || '12:00 PM',
        earlyCheckinTime: r.early_checkin_time || raw.early_checkin_time || '',
        mealPlan: r.meal_plan,
        approxCheckoutTime: r.approx_checkout_time,
        checkinTime: r.checkin_time,
        adultsMale: r.adults_male !== undefined && r.adults_male !== null ? r.adults_male : (r.adultsMale !== undefined ? r.adultsMale : 1),
        adultsFemale: r.adults_female !== undefined && r.adults_female !== null ? r.adults_female : (r.adultsFemale !== undefined ? r.adultsFemale : 0),
        adultsOther: r.adults_other !== undefined && r.adults_other !== null ? r.adults_other : (r.adultsOther || 0),
        children: r.children !== undefined && r.children !== null ? r.children : 0,
        extraBeds: r.extra_beds !== undefined && r.extra_beds !== null ? r.extra_beds : (r.extraBeds || 0),
        extraBedCharge: r.extra_bed_charge !== undefined && r.extra_bed_charge !== null ? r.extra_bed_charge : (r.extraBedCharge || 0),
        roomCharge,
        grossTariff,
        roomGrossTariff,
        roomTaxable,
        stayTaxable,
        stayTax,
        discountAmount,
        discountPct,
        netTotalCharge,
        advancePaid,
        initialPaid: advancePaid,
        balanceDue,
        foodTotal,
        barTotal,
        fnbTotal: foodTotal + barTotal,
        grandTotal: netTotalCharge,
        visitorsCount,
        restaurantOrders: raw.restaurantOrders || [],
        barOrders: raw.barOrders || [],
        visitors,
        payments,
        room: r,
        summary,
        is_prepaid: isOtaPrepaid ? 1 : (isOtaPayAtHotel ? 0 : (r.is_prepaid ?? 0)),
        isPrepaid: isOtaPrepaid,
        isOtaPayAtHotel,
        isOtaPrepaid,
        rateType: isOtaPayAtHotel ? 'pay_at_hotel' : (isOtaPrepaid ? 'prepaid' : (r.rate_type || 'standard')),
        rate_type: isOtaPayAtHotel ? 'pay_at_hotel' : (isOtaPrepaid ? 'prepaid' : (r.rate_type || 'standard')),
        isEarlyCheckout: Boolean(summary.isEarlyCheckout),
        earlyStayDays: summary.earlyStayDays || 1,
        earlyStayHours: summary.earlyStayHours || 0,
        earlyExtensionCharge: summary.earlyExtensionCharge || 0,
        stayDurationStr: summary.stayDurationStr || '',
        expectedNights: summary.expectedNights || 1,
        originalRoomCharge: summary.originalRoomCharge || roomCharge,
        recalculatedRoomCharge: summary.recalculatedRoomCharge || roomCharge,
        refundAmount: summary.refundAmount || 0,
        memberDocuments: Array.isArray(r.member_documents) ? r.member_documents : (Array.isArray(raw.member_documents) ? raw.member_documents : []),
        member_documents: Array.isArray(r.member_documents) ? r.member_documents : (Array.isArray(raw.member_documents) ? raw.member_documents : []),
        voucherNumber: r.voucher_number || raw.voucher_number || '',
        voucher_number: r.voucher_number || raw.voucher_number || '',
        aadharNumber: r.aadhar_number || raw.aadhar_number || '',
        aadhar_number: r.aadhar_number || raw.aadhar_number || '',
        extensionLogs: Array.isArray(r.extension_logs) ? r.extension_logs : (r.extension_logs_json ? JSON.parse(r.extension_logs_json) : (Array.isArray(raw.extension_logs) ? raw.extension_logs : [])),
        extension_logs: Array.isArray(r.extension_logs) ? r.extension_logs : (r.extension_logs_json ? JSON.parse(r.extension_logs_json) : (Array.isArray(raw.extension_logs) ? raw.extension_logs : []))
      };
      setFolioData(normalized);
      if (normalized.approxCheckoutTime) {
        setExtendDatetime(new Date(normalized.approxCheckoutTime).toISOString().slice(0, 16));
      }
    } catch (err) {
      showToast('Error loading folio: ' + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [roomId, showToast]);

  useEffect(() => {
    loadFolio();
  }, [loadFolio]);

  const handleSaveExtendCheckout = async () => {
    if (!extendDatetime) return;
    try {
      const cashierName = currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk';
      await api.extendCheckout(folioData.bookingId, {
        approx_checkout_time: extendDatetime,
        extended_by: cashierName,
        cashier_name: cashierName
      });
      showToast('Checkout date extended successfully.', 'green');
      setIsExtendOpen(false);
      loadFolio();
    } catch (err) {
      showToast('Error extending checkout time: ' + err.message, 'red');
    }
  };

  const openLightbox = (url, title) => {
    setLightboxImage(url);
    setLightboxTitle(title || 'Preview');
  };

  const handleSettleFnbFromFolio = async () => {
    if (!selectedFnbOrder) return;
    const baseTotal = Number(selectedFnbOrder.total) || 0;
    const mode = fnbPayMode;

    if ((mode === 'upi' || mode === 'online') && !fnbUtr.trim()) {
      showToast('UTR / Transaction Reference Number is mandatory for UPI payments.', 'red');
      return;
    }

    if (mode === 'split') {
      const splitCashNum = Number(fnbSplitCash) || 0;
      const splitOnlineNum = Number(fnbSplitOnline) || 0;
      const splitCardNum = Number(fnbSplitCard) || 0;
      const splitChequeNum = Number(fnbSplitCheque) || 0;
      const sum = splitCashNum + splitOnlineNum + splitCardNum + splitChequeNum;
      if (Math.abs(sum - baseTotal) > 0.5) {
        showToast(`Split total (₹${sum}) does not match order total (₹${baseTotal}).`, 'red');
        return;
      }
      if (splitOnlineNum > 0 && !fnbUtr.trim()) {
        showToast('UTR / Transaction Reference Number is mandatory for online split portion.', 'red');
        return;
      }
    }

    let cardFee = 0;
    if (mode === 'card') {
      cardFee = Math.round(baseTotal * 0.025);
    } else if (mode === 'split' && Number(fnbSplitCard) > 0) {
      cardFee = Math.round(Number(fnbSplitCard) * 0.025);
    }

    let upiFee = 0;
    const effectiveOnlineAmt = mode === 'split' ? (Number(fnbSplitOnline) || 0) : ((mode === 'upi' || mode === 'online') ? baseTotal : 0);
    if (effectiveOnlineAmt > 2000) {
      upiFee = Math.round(effectiveOnlineAmt * 0.004);
    }

    setIsSettlingFnb(true);
    try {
      const res = await api.settleFnbOrder({
        orderId: selectedFnbOrder.id,
        department: selectedFnbOrder.department,
        paymentMode: mode,
        splitCash: mode === 'split' ? Number(fnbSplitCash) || 0 : (mode === 'cash' ? baseTotal : 0),
        splitOnline: effectiveOnlineAmt,
        splitCard: mode === 'split' ? Number(fnbSplitCard) || 0 : (mode === 'card' ? baseTotal : 0),
        splitCheque: mode === 'split' ? Number(fnbSplitCheque) || 0 : 0,
        utrNumber: fnbUtr.trim(),
        cardSurcharge: cardFee,
        card_surcharge: cardFee,
        upiTax: upiFee,
        upi_tax: upiFee,
        staffName: 'Front Desk'
      });

      if (res && res.success) {
        showToast(`Bill #${selectedFnbOrder.order_number || selectedFnbOrder.id} settled successfully!`, 'green');

        printCashReceipt({
          receipt_no: res.receiptNo || `RCP-${Date.now().toString().slice(-6)}`,
          receipt_date: new Date().toISOString(),
          guest_name: folioData.guestName,
          amount: baseTotal,
          payment_mode: mode.toUpperCase(),
          split_cash: mode === 'split' ? Number(fnbSplitCash) || 0 : (mode === 'cash' ? baseTotal : 0),
          split_online: effectiveOnlineAmt,
          split_card: mode === 'split' ? Number(fnbSplitCard) || 0 : (mode === 'card' ? baseTotal : 0),
          split_cheque: mode === 'split' ? Number(fnbSplitCheque) || 0 : 0,
          utr_number: fnbUtr.trim(),
          card_surcharge: cardFee,
          upi_tax: upiFee,
          room_numbers: folioData.roomNumber,
          particulars: `Settled ${selectedFnbOrder.department === 'bar' ? 'Bar Lounge' : 'Restaurant'} Bill #${selectedFnbOrder.order_number || selectedFnbOrder.id}`,
          cashier_name: currentUser ? (currentUser.full_name || currentUser.username) : ''
        });

        setSelectedFnbOrder(null);
        await loadFolio();
      } else {
        showToast(res?.error || 'Failed to settle F&B order', 'red');
      }
    } catch (err) {
      showToast('Error settling order: ' + err.message, 'red');
    } finally {
      setIsSettlingFnb(false);
    }
  };

  const handleSendBillToMobile = async () => {
    if (!selectedFnbOrder) return;
    const phone = folioData.mobile || selectedFnbOrder.guest_phone;
    if (!phone) {
      showToast('No mobile number associated with this guest / order.', 'amber');
      return;
    }

    setIsSendingMobile(true);
    try {
      const res = await api.sendOrderBillToMobile({
        orderId: selectedFnbOrder.id,
        department: selectedFnbOrder.department,
        mobileNumber: phone
      });

      if (res && res.success) {
        showToast('Bill formatted for mobile delivery.', 'green');
        if (res.whatsapp_url) {
          window.open(res.whatsapp_url, '_blank');
        }
      } else {
        showToast(res?.error || 'Could not send bill to mobile', 'red');
      }
    } catch (err) {
      showToast('Error sending mobile bill: ' + err.message, 'red');
    } finally {
      setIsSendingMobile(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '2rem', marginBottom: '10px' }}>⏳</div>
        <div>Loading Room Folio Details...</div>
      </div>
    );
  }

  if (!folioData) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center' }}>
        <h3>Room Folio Not Found</h3>
        <button type="button" className="btn-secondary" onClick={onBack} style={{ marginTop: '12px' }}>
          Back to Rooms
        </button>
      </div>
    );
  }

  const room = {
    id: roomId,
    room_number: folioData.roomNumber,
    room_type: folioData.roomType
  };

  const groupRoomsList = (folioData.all_group_room_numbers || folioData.all_group_rooms || [])
    .map((r) => (typeof r === 'object' && r !== null ? (r.room_number || r.roomNumber || '') : String(r)))
    .filter(Boolean);
  const isMultiGroup = Boolean(folioData.is_combined || groupRoomsList.length > 1);
  const isOtaBooking = (folioData.bookingSource || folioData.room?.booking_source) === 'OTA';
  const isOtaPayAtHotel = isOtaBooking && (
    folioData.isOtaPayAtHotel === true ||
    folioData.summary?.isOtaPayAtHotel === true ||
    folioData.is_prepaid === 0 ||
    folioData.is_prepaid === '0' ||
    folioData.is_prepaid === false ||
    folioData.isPrepaid === false ||
    folioData.otaIsPrepaid === false ||
    String(folioData.rateType || folioData.rate_type || '').includes('hotel')
  );
  const isOtaPrepaid = isOtaBooking && !isOtaPayAtHotel && (
    folioData.isOtaPrepaid === true ||
    folioData.summary?.isOtaPrepaid === true ||
    folioData.is_prepaid === 1 ||
    folioData.is_prepaid === '1' ||
    folioData.is_prepaid === true ||
    folioData.isPrepaid === true ||
    folioData.otaIsPrepaid === true
  );
  const otaBookedAdults = isOtaBooking ? (folioData.ota_booked_adults ?? folioData.otaBookedAdults ?? 1) : null;
  const otaBookedChildren = isOtaBooking ? (folioData.ota_booked_children ?? folioData.otaBookedChildren ?? 0) : null;
  const otaBookedExtraBeds = isOtaBooking ? (folioData.ota_booked_extra_beds ?? folioData.otaBookedExtraBeds ?? 0) : 0;
  const extraAdults = Number(folioData.extra_adults ?? folioData.extraAdults ?? 0);
  const extraChildren = Number(folioData.extra_children ?? folioData.extraChildren ?? 0);
  const hotelChargedBeds = folioData.extraBedCharge > 0 
    ? Math.round(Number(folioData.extraBedCharge) / 500) 
    : (isOtaBooking ? extraAdults : 0);
  const voucherIncludedBeds = isOtaBooking 
    ? (otaBookedExtraBeds > 0 ? otaBookedExtraBeds : Math.max(0, (Number(folioData.extraBeds) || 0) - hotelChargedBeds)) 
    : 0;

  const buildFolioPrintPayload = () => {
    if (!folioData) return null;
    const r = folioData.room || {};
    const summary = folioData.summary || {};

    const checkinDateObj = folioData.checkinTime ? new Date(folioData.checkinTime) : new Date();
    const checkoutDateObj = folioData.approxCheckoutTime ? new Date(folioData.approxCheckoutTime) : new Date(checkinDateObj.getTime() + 86400000);
    const stayNights = Math.max(1, Math.ceil((checkoutDateObj - checkinDateObj) / (1000 * 60 * 60 * 24)));

    const pendingRestaurant = (folioData.restaurantOrders || [])
      .filter(o => o.status === 'pending' || o.payment_status === 'pending' || o.status === 'ordered')
      .reduce((sum, o) => sum + Number(o.total || 0), 0);
    const pendingBar = (folioData.barOrders || [])
      .filter(o => o.status === 'pending' || o.payment_status === 'pending' || o.status === 'ordered')
      .reduce((sum, o) => sum + Number(o.total || 0), 0);
    const fnbPendingTotal = pendingRestaurant + pendingBar;

    return {
      ...r,
      ...folioData,
      room: r,
      summary,
      isOccupiedStay: true,
      stayStatus: 'OCCUPIED',
      stayNights,
      guestName: folioData.guestName || r.guest_name,
      roomNumber: folioData.roomNumber || r.room_number,
      roomType: folioData.roomType || r.room_type,
      bookingSource: folioData.bookingSource || r.booking_source || 'Walk-in',
      otaPlatform: folioData.otaPlatform || r.ota_platform,
      otaBookingId: folioData.otaBookingId || folioData.otaVoucherNo || r.ota_booking_id || r.ota_voucher_no,
      ota_booking_id: folioData.otaBookingId || folioData.otaVoucherNo || r.ota_booking_id || r.ota_voucher_no,
      otaVoucherNo: folioData.otaBookingId || folioData.otaVoucherNo || r.ota_booking_id || r.ota_voucher_no,
      rateType: folioData.rateType || r.rate_type,
      rate_type: folioData.rateType || r.rate_type,
      mealPlan: folioData.mealPlan || r.meal_plan,
      btcCompanyName: folioData.btcCompanyName || r.btc_company_name,
      btcApprovalRef: folioData.btcApprovalRef || r.btc_approval_ref,
      btcCompanyAddress: folioData.btcCompanyAddress || r.btc_address,
      btcCompanyGst: folioData.btcCompanyGst || r.btc_gst_number || r.gst_number,
      btcCompanyPan: folioData.btcCompanyPan || r.btc_pan_number,
      btcCompanyContactPerson: folioData.btcCompanyContactPerson || r.btc_contact_person,
      btcCompanyPhone: folioData.btcCompanyPhone || r.btc_contact_phone,
      btcCompanyEmail: folioData.btcCompanyEmail || r.btc_contact_email,
      companyName: folioData.btcCompanyName || r.btc_company_name || r.company_name,
      gstNumber: folioData.btcCompanyGst || r.btc_gst_number || r.gst_number,
      adultsMale: folioData.adultsMale,
      adultsFemale: folioData.adultsFemale,
      children: folioData.children,
      extraBeds: folioData.extraBeds,
      extraBedCharge: folioData.extraBedCharge,
      hotelChargedBeds,
      voucherIncludedBeds,
      otaBookedAdults,
      ota_booked_adults: otaBookedAdults,
      otaBookedChildren,
      ota_booked_children: otaBookedChildren,
      otaBookedExtraBeds,
      ota_booked_extra_beds: otaBookedExtraBeds,
      extraAdults,
      extra_adults: extraAdults,
      extraChildren,
      extra_children: extraChildren,
      hasExtraPersons: Boolean(extraAdults > 0 || extraChildren > 0 || hotelChargedBeds > 0 || folioData.extraBedCharge > 0),
      extraRoomsCharge: Number(folioData.extra_rooms_charge || folioData.extraRoomsCharge || 0),
      extraBreakfastCharge: Number(folioData.extra_breakfast_charge || folioData.extraBreakfastCharge || 0),
      otaBillAmount: folioData.ota_bill_amount || folioData.otaBillAmount,
      isPrepaid: isOtaPrepaid,
      is_prepaid: isOtaPrepaid ? 1 : 0,
      otaIsPrepaid: isOtaPrepaid,
      rateType: isOtaPayAtHotel ? 'pay_at_hotel' : (isOtaPrepaid ? 'prepaid' : 'standard'),
      rate_type: isOtaPayAtHotel ? 'pay_at_hotel' : (isOtaPrepaid ? 'prepaid' : 'standard'),
      foodTotal: Number(summary.foodTotal ?? folioData.foodTotal ?? 0),
      barTotal: Number(summary.barTotal ?? folioData.barTotal ?? 0),
      foodPending: fnbPendingTotal,
      fnbPendingTotal,
      roomTariffNet: Number(summary.roomCharge ?? folioData.roomCharge ?? r.total_room_charge ?? 0),
      netCharge: Number(summary.roomCharge ?? folioData.roomCharge ?? r.total_room_charge ?? 0),
      discountPct: Number(summary.discountPct ?? folioData.discountPct ?? r.discount_pct ?? 0),
      discountAmount: Number(summary.discountAmount ?? folioData.discountAmount ?? r.discount_amount ?? 0),
      taxAmount: Number(summary.taxAmount ?? folioData.taxAmount ?? r.tax_amount ?? Math.round((summary.roomCharge ?? folioData.roomCharge ?? 0) * 0.05)),
      grandTotal: Number(summary.netTotalCharge ?? summary.grandTotal ?? folioData.netTotalCharge ?? folioData.grandTotal ?? 0),
      totalDue: Number(summary.netTotalCharge ?? summary.grandTotal ?? folioData.netTotalCharge ?? folioData.grandTotal ?? 0),
      advancePaid: Number(summary.advancePaid ?? folioData.advancePaid ?? r.initial_paid ?? 0),
      totalPaid: Number(summary.advancePaid ?? folioData.advancePaid ?? r.initial_paid ?? 0),
      balanceDue: Number(summary.balanceDue ?? folioData.balanceDue ?? 0),
      splitCash: Number(folioData.split_cash ?? folioData.splitCash ?? r.split_cash ?? 0),
      splitCard: Number(folioData.split_card ?? folioData.splitCard ?? r.split_card ?? 0),
      splitOnline: Number(folioData.split_online ?? folioData.splitOnline ?? r.split_online ?? 0),
      splitCheque: Number(folioData.split_cheque ?? folioData.splitCheque ?? r.split_cheque ?? 0),
      onlineUtr: (folioData.onlineUtr || folioData.advance_utr_number || r.advance_utr_number || '').trim(),
      cardSurcharge: Number(folioData.card_surcharge || r.advance_card_surcharge || r.card_surcharge || summary.cardSurcharge || (Number(folioData.split_card ?? folioData.splitCard ?? r.split_card ?? 0) > 0 ? Math.round(Number(folioData.split_card ?? folioData.splitCard ?? r.split_card ?? 0) * 0.025) : 0)),
      upiTax: (() => {
        const onlineAmt = Number(folioData.split_online ?? folioData.splitOnline ?? r.split_online ?? 0);
        if (onlineAmt <= 2000) return 0;
        return Number(folioData.upi_tax || r.advance_upi_tax || r.upi_tax || summary.upiTax || Math.round(onlineAmt * 0.004) || 0);
      })(),
      voucherNumber: folioData.voucherNumber || r.voucher_number || '',
      voucherNo: folioData.voucherNumber || r.voucher_number || '',
      aadharNumber: folioData.aadharNumber || folioData.aadhar_number || r.aadhar_number || r.aadharNumber || r.id_number || r.idNumber || '',
      aadhar_number: folioData.aadharNumber || folioData.aadhar_number || r.aadhar_number || r.aadharNumber || r.id_number || r.idNumber || '',
      email: folioData.email || r.email || r.guest_email || '',
      address: folioData.address || r.address || r.guest_address || '',
      mobile: folioData.mobile || r.mobile || r.guest_phone || '',
      dob: folioData.dob || r.dob || '',
      docType: folioData.docType || r.doc_type || r.docType || 'Aadhaar Card',
      doc_type: folioData.docType || r.doc_type || r.docType || 'Aadhaar Card',
      checkedInBy: folioData.checkedInBy || r.checked_in_by || 'Front Desk',
      all_group_rooms: folioData.all_group_rooms || r.all_group_rooms || [],
      checkin_time: folioData.checkinTime || r.checkin_time || folioData.check_in || folioData.checkin,
      checkinTime: folioData.checkinTime || r.checkin_time || folioData.check_in || folioData.checkin,
      actual_checkout_time: folioData.actualCheckoutTime || r.actual_checkout_time || folioData.actual_checkout,
      actualCheckoutTime: folioData.actualCheckoutTime || r.actual_checkout_time || folioData.actual_checkout,
      approx_checkout_time: folioData.approxCheckoutTime || r.approx_checkout_time || folioData.approx_checkout,
      approxCheckoutTime: folioData.approxCheckoutTime || r.approx_checkout_time || folioData.approx_checkout,
      checkoutTime: folioData.checkoutTime || r.checkout_time,
      checkoutDate: folioData.checkoutDate || r.checkout_date
    };
  };

  return (
    <section className="panel-view active" id="view-room-folio">
      {/* Top Action Toolbar with Universal Back & Close Buttons */}
      <div className="folio-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button type="button" className="universal-back-btn" id="btn-folio-page-back" onClick={onBack} title="Back to Rooms Grid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 id="folio-page-room-title" className="folio-room-heading">
              Room {folioData.roomNumber}
            </h2>
            {isMultiGroup && (
              <span className="folio-group-badge">
                🔗 Group Booking ({groupRoomsList.length} Rooms: #{groupRoomsList.join(', #')})
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="filter-chip btn-folio-action-chip btn-folio-visitors-chip btn-folio-visitors-action"
            onClick={() => onOpenVisitors && onOpenVisitors(folioData.room || folioData)}
            title="Log & Manage Room Visitors"
          >
            <span>👥</span> Visitors <span className="filter-chip-count" style={{
              marginLeft: '2px',
              background: (folioData.visitorsCount || 0) > 0 ? '#7c3aed' : undefined,
              color: (folioData.visitorsCount || 0) > 0 ? '#ffffff' : undefined
            }}>{folioData.visitorsCount || 0}</span>
          </button>

          <button
            type="button"
            className="filter-chip btn-folio-action-chip"
            onClick={() => {
              const printPayload = buildFolioPrintPayload();
              setDocActionModal({ isOpen: true, type: 'checkin', data: printPayload });
            }}
            title="Official Guest Check-In Form (Print to Paper, Save PDF, or Save & Print)"
          >
            📋 Check-In Form
          </button>

          <button
            type="button"
            className="filter-chip btn-folio-action-chip btn-folio-pdf-chip"
            onClick={() => {
              const printPayload = buildFolioPrintPayload();
              setDocActionModal({ isOpen: true, type: 'info', data: printPayload });
            }}
            title="Guest Info & Verification Vault with all Scans & Photos (Print to Paper, Save PDF, or Save & Print)"
          >
            💾 Info
          </button>

          <button
            type="button"
            className="filter-chip btn-folio-action-chip btn-folio-summary-chip"
            onClick={() => {
              const printPayload = buildFolioPrintPayload();
              setDocActionModal({ isOpen: true, type: 'summary', data: printPayload });
            }}
            title="Customer Payment Summary Statement (Save, Print, or Save & Print)"
          >
            📄 Payment Summary
          </button>

          <button
            type="button"
            className="filter-chip btn-folio-action-chip btn-folio-tax-chip"
            onClick={() => {
              const roomObj = folioData?.room || folioData;
              setDocActionModal({
                isOpen: true,
                type: 'invoice',
                data: {
                  room: roomObj,
                  calc: folioData,
                  settlement: {
                    settleAmt: 0,
                    refundAmt: 0,
                    settled_at: new Date(),
                    invoiceNo: roomObj?.invoice_no || (folioData?.bookingId ? `L${folioData.bookingId}` : undefined),
                    checked_out_by: 'Front Desk'
                  }
                }
              });
            }}
            title="Official Tax Invoice (Save, Print, or Save & Print)"
          >
            🧾 Tax Invoice
          </button>

          <button
            type="button"
            className="btn-scan-action btn-folio-checkout-action"
            onClick={() => setIsSettlementOpen(true)}
          >
            💳 Checkout
          </button>

          <button
            type="button"
            className="universal-close-btn"
            onClick={onBack}
            title="Close Folio & Return to Front Desk"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Main Folio Grid Layout */}
      <div className="folio-page-grid">
        {/* Column 1: Guest Profile */}
        <div className="folio-card">
          <div className="folio-card-header">
            <h3>Guest Profile</h3>
          </div>

          <div className="folio-guest-identity-layout">
            <div
              className="folio-guest-photo-container"
              onClick={() => folioData.guestPhoto && folioData.guestPhoto.trim() && openLightbox(folioData.guestPhoto, 'Guest Photo')}
              title="Click to view full size"
              style={{ cursor: folioData.guestPhoto && folioData.guestPhoto.trim() ? 'pointer' : 'default' }}
            >
              {folioData.guestPhoto && folioData.guestPhoto.trim() ? (
                <img src={folioData.guestPhoto} alt={folioData.guestName} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem', background: '#f1f5f9' }}>
                  👤
                </div>
              )}
            </div>

            <div className="folio-guest-info-block">
              <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                {folioData.guestName}
              </h4>
              <div className="folio-info-row">
                <span className="label">Mobile:</span>
                <strong>{folioData.mobile || '-'}</strong>
              </div>
              <div className="folio-info-row">
                <span className="label">Email:</span>
                <span>{folioData.email || '-'}</span>
              </div>
              <div className="folio-info-row">
                <span className="label">DOB:</span>
                <span>{folioData.dob || '-'}</span>
              </div>
              <div className="folio-info-row">
                <span className="label">Aadhar / ID:</span>
                <strong style={{ letterSpacing: '0.04em' }}>{folioData.aadharNumber || folioData.aadhar_number || '-'}</strong>
              </div>
              <div className="folio-info-row">
                <span className="label">Address:</span>
                <span>{folioData.address || '-'}</span>
              </div>
            </div>
          </div>

          {/* Scanned ID Documents Row */}
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Primary ID: <strong style={{ color: 'var(--apple-blue)' }}>{folioData.docType || 'ID Proof'}</strong>
              </span>
            </div>
            <div className="folio-doc-scans-row">
              {folioData.docFront && folioData.docFront.trim() && (
                <div
                  className="folio-doc-thumb-box"
                  onClick={() => openLightbox(folioData.docFront, 'ID Card - Front')}
                  title="Click for Full Size"
                >
                  <img src={folioData.docFront} alt="Front ID" />
                  <span>Front</span>
                </div>
              )}
              {folioData.docBack && folioData.docBack.trim() && (
                <div
                  className="folio-doc-thumb-box"
                  onClick={() => openLightbox(folioData.docBack, 'ID Card - Back')}
                  title="Click for Full Size"
                >
                  <img src={folioData.docBack} alt="Back ID" />
                  <span>Back</span>
                </div>
              )}
            </div>
          </div>

          {/* Companion Room Members Section */}
          {folioData.memberDocuments && folioData.memberDocuments.length > 0 && (
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>👥</span> Room Companions ({folioData.memberDocuments.length})
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Scanned IDs Attached</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {folioData.memberDocuments.map((m, idx) => (
                  <div key={idx} className="room-companion-box" style={{ padding: '8px 10px', background: 'var(--bg-surface-secondary, #1e232d)', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{m.name || `Member ${idx + 1}`}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {m.relation && <span style={{ marginRight: '8px' }}>Rel: <strong>{m.relation}</strong></span>}
                          {(m.dob || m.age) && <span style={{ marginRight: '8px' }}>Age: <strong>{m.age ? `${m.age} Yrs` : m.dob}</strong></span>}
                          {m.aadharNumber && <span>ID: <strong>{m.aadharNumber}</strong></span>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.72rem', background: 'rgba(56, 189, 248, 0.15)', color: 'var(--apple-blue)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                        {m.docType || 'ID Proof'}
                      </span>
                    </div>
                    {/* Companion Thumbnails */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      {m.docFront && (
                        <div
                          className="folio-doc-thumb-box"
                          style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px', overflow: 'hidden' }}
                          onClick={() => openLightbox(m.docFront, `${m.name} - Front ID`)}
                          title="Click to view full size"
                        >
                          <img src={m.docFront} alt="Front" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                      {m.docBack && (
                        <div
                          className="folio-doc-thumb-box"
                          style={{ width: '48px', height: '36px', cursor: 'pointer', borderRadius: '4px', overflow: 'hidden' }}
                          onClick={() => openLightbox(m.docBack, `${m.name} - Back ID`)}
                          title="Click to view full size"
                        >
                          <img src={m.docBack} alt="Back" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Stay Details Card */}
        <div className="folio-card" id="folio-stay-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="folio-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.25rem' }}>🏨</span>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Stay Details</h3>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="stay-metric-pill" style={{ fontSize: '0.76rem', padding: '4px 10px', background: '#e0f2fe', color: '#0369a1', fontWeight: 800, borderRadius: '6px', border: '1px solid #bae6fd' }}>
                  {folioData.bookingSource || 'Walk-in'}
                </span>
                {folioData.bookingSource === 'BTC' && folioData.btcCompanyName && (
                  <span className="stay-metric-pill" style={{ fontSize: '0.76rem', padding: '4px 10px', background: '#eff6ff', color: '#1e3a8a', fontWeight: 800, borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                    🏢 {folioData.btcCompanyName}{folioData.btcApprovalRef ? ` (Ref: ${folioData.btcApprovalRef})` : ''}
                  </span>
                )}
                {folioData.bookingSource === 'OTA' && folioData.otaPlatform && (
                  <span className="stay-metric-pill" style={{ fontSize: '0.76rem', padding: '4px 10px', background: '#f0fdf4', color: '#166534', fontWeight: 800, borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    🌐 {folioData.otaPlatform}{folioData.otaBookingId ? ` (#${folioData.otaBookingId})` : ''}
                  </span>
                )}
                {folioData.mealPlan === 'with_breakfast' && (
                  <span className="stay-metric-pill" style={{ fontSize: '0.76rem', padding: '4px 10px', background: '#fef3c7', color: '#92400e', fontWeight: 800, borderRadius: '6px', border: '1px solid #fde68a' }}>
                    🍽️ With Breakfast
                  </span>
                )}
              </div>
            </div>

            {/* Schedule Box */}
            <div className="folio-schedule-box" style={{ marginBottom: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', alignItems: 'flex-start' }}>
                <div className="schedule-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span className="sched-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 0 }}>
                      <span>📥</span> Check-In:
                    </span>
                    {folioData.isEarlyCheckin && (
                      <span style={{ fontSize: '0.70rem', background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '4px', border: '1px solid #fde68a', fontWeight: 800 }}>
                        🌅 Early Check-In
                      </span>
                    )}
                  </div>
                  <div className="sched-val" style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {folioData.checkinTime ? new Date(folioData.checkinTime).toLocaleDateString('en-IN') : '-'}
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>
                    {folioData.checkinTime ? new Date(folioData.checkinTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                  {folioData.isEarlyCheckin && (
                    <div style={{ marginTop: '5px', padding: '4px 6px', background: '#fffbeb', borderRadius: '4px', border: '1px solid #fef3c7', fontSize: '0.72rem', color: '#92400e', lineHeight: 1.3 }}>
                      <div>Actual Early C/I: <strong>{folioData.earlyCheckinTime || (folioData.checkinTime ? new Date(folioData.checkinTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Early')}</strong></div>
                      <div>Scheduled Time: <strong>{folioData.originalCheckinTime || '12:00 PM'}</strong></div>
                      <div style={{ color: '#16a34a', fontWeight: 800, marginTop: '2px' }}>Surcharge: ₹0 (Free for OTA)</div>
                    </div>
                  )}
                </div>

                <div className="schedule-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span className="sched-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 0 }}>
                      <span>📤</span> {folioData.bookingSource === 'OTA' ? 'Checkout Time (Fixed & Paid):' : 'Expected Checkout:'}
                    </span>
                    <button
                      type="button"
                      className="btn-change-checkout"
                      onClick={() => setIsExtendOpen(!isExtendOpen)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 7px', fontWeight: 700, cursor: 'pointer' }}
                      title="Extend guest checkout date & time"
                    >
                      ✏️ Extend
                    </button>
                  </div>
                  <div className="sched-val" style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--apple-blue)' }}>
                    {folioData.approxCheckoutTime ? new Date(folioData.approxCheckoutTime).toLocaleDateString('en-IN') : '-'}
                  </div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0284c7' }}>
                    {folioData.approxCheckoutTime ? new Date(folioData.approxCheckoutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
              </div>

              {/* Extend checkout collapsible form */}
              {isExtendOpen && (
                <div style={{ marginTop: '12px', padding: '12px', background: '#ffffff', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--apple-blue)' }}>
                  <label style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    {folioData.bookingSource === 'OTA' ? 'Extend Checkout Date & Time (OTA Fixed & Paid):' : 'Extend Expected Checkout Date & Time:'}
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={extendDatetime}
                      onChange={(e) => setExtendDatetime(e.target.value)}
                      style={{ flex: 1, minWidth: '180px', padding: '6px 10px', fontSize: '0.85rem' }}
                    />
                    <button type="button" className="btn-custom-ok" onClick={handleSaveExtendCheckout} style={{ padding: '6px 14px', fontSize: '0.82rem', fontWeight: 700 }}>
                      Extend Checkout
                    </button>
                    <button type="button" className="btn-custom-cancel" onClick={() => setIsExtendOpen(false)} style={{ padding: '6px 10px', fontSize: '0.82rem' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Occupancy details */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                <span>🔑 Room #{folioData.roomNumber}</span>
                {isMultiGroup && (
                  <span style={{ marginLeft: '6px', fontSize: '0.74rem', color: '#1d4ed8', fontWeight: 800 }}>
                    (Group: #{groupRoomsList.join(', #')})
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end', fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
                <div>
                  <span>👥 {folioData.adultsMale || 1} Male, {folioData.adultsFemale || 0} Female</span>
                  {folioData.children > 0 && <span>, {folioData.children} Child</span>}
                  {folioData.extraBeds > 0 && (
                    <span>
                      {' • '}🛏️ {folioData.extraBeds} Extra Bed{folioData.extraBeds > 1 ? 's' : ''}
                      {isOtaBooking && hotelChargedBeds > 0 && (
                        <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                          {' '}({voucherIncludedBeds > 0 ? `${voucherIncludedBeds} Voucher + ` : ''}{hotelChargedBeds} Hotel Extra)
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {isOtaBooking && (
                  <div style={{ fontSize: '0.72rem', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px', border: '1px solid #bae6fd', fontWeight: 800 }}>
                      📦 OTA Booked: {otaBookedAdults} Adult(s){otaBookedChildren > 0 ? `, ${otaBookedChildren} Child` : ''}{voucherIncludedBeds > 0 ? `, ${voucherIncludedBeds} Bed (Voucher ₹0)` : ''}
                    </span>
                    {(extraAdults > 0 || extraChildren > 0 || hotelChargedBeds > 0 || Number(folioData.extraBedCharge) > 0) && (
                      <span style={{ color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '4px', border: '1px solid #fde68a', fontWeight: 800 }}>
                        🏨 Hotel Extra: {extraAdults > 0 ? `+${extraAdults} Adult(s) ` : ''}{extraChildren > 0 ? `+${extraChildren} Child ` : ''}{hotelChargedBeds > 0 ? `+${hotelChargedBeds} Bed(s) ` : ''}(+₹{(Number(folioData.extraBedCharge) || (hotelChargedBeds * 500)).toLocaleString('en-IN')})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Checkout Extension Audit Logs (Below Room Number & Occupancy Details) */}
            {Array.isArray(folioData.extensionLogs) && folioData.extensionLogs.length > 0 && (
              <div
                id="folio-checkout-extension-logs"
                style={{
                  padding: '10px 14px',
                  background: '#fefce8',
                  borderRadius: '10px',
                  border: '1.5px solid #fde047',
                  marginBottom: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ fontSize: '0.74rem', fontWeight: 850, color: '#854d0e', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>⏳</span> Checkout Date Extension Audit Log ({folioData.extensionLogs.length})
                </div>
                {folioData.extensionLogs.map((log, idx) => {
                  const fromFormatted = log.from_time ? formatDateTime(log.from_time) : 'Original Scheduled';
                  const toFormatted = log.to_time ? formatDateTime(log.to_time) : '-';
                  const changeTimeFormatted = log.created_at ? formatDateTime(log.created_at) : '';
                  return (
                    <div
                      key={log.id || idx}
                      style={{
                        fontSize: '0.80rem',
                        color: '#713f12',
                        fontWeight: 650,
                        padding: '6px 10px',
                        background: '#ffffff',
                        borderRadius: '6px',
                        border: '1px solid #fef08a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap'
                      }}
                    >
                      <span>📝</span>
                      <span>
                        Extended by <strong style={{ color: '#854d0e' }}>{log.extended_by || 'Front Desk'}</strong>, from <strong>{fromFormatted}</strong> to <strong>{toFormatted}</strong>{changeTimeFormatted ? ` (${changeTimeFormatted})` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Restaurant & Bar Orders Section (Card Manner, Above Financial Summary) */}
        {(() => {
          // Calculate stay duration in nights
          let stayNights = 1;
          if (folioData.checkinTime && folioData.approxCheckoutTime) {
            try {
              const dIn = new Date(folioData.checkinTime);
              const dOut = new Date(folioData.approxCheckoutTime);
              const diffDays = Math.round((dOut - dIn) / (1000 * 60 * 60 * 24));
              stayNights = Math.max(1, diffDays);
            } catch (e) { console.warn('Failed to calculate stay nights:', e.message); }
          }

          const allRestaurantOrders = folioData.restaurantOrders || [];
          const allBarOrders = folioData.barOrders || [];
          const allFnbOrders = [
            ...allRestaurantOrders.map((o) => ({ ...o, department: 'restaurant', deptTitle: 'Restaurant 🍽️' })),
            ...allBarOrders.map((o) => ({ ...o, department: 'bar', deptTitle: 'Bar Lounge 🍸' }))
          ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

          // Restaurant calculations
          const fnbFoodGross = allRestaurantOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
          const fnbBarGross = allBarOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
          const fnbTotal = fnbFoodGross + fnbBarGross;
          const fnbTaxable = Math.round(fnbTotal / 1.05);
          const fnbGst = fnbTotal - fnbTaxable;
          const fnbPaidTotal = allFnbOrders.filter((o) => o.is_paid === 1).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
          const fnbPendingTotal = allFnbOrders.filter((o) => o.is_paid === 0).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
          const fnbPaidCash = allFnbOrders
            .filter((o) => o.is_paid === 1 && (o.payment_mode === 'cash' || o.split_cash > 0 || !o.payment_mode))
            .reduce((sum, o) => sum + (Number(o.split_cash) || (o.payment_mode === 'cash' || !o.payment_mode ? Number(o.total) : 0) || 0), 0);
          const fnbPaidOnline = allFnbOrders
            .filter((o) => o.is_paid === 1 && (o.payment_mode === 'online' || o.payment_mode === 'upi' || o.split_online > 0))
            .reduce((sum, o) => sum + (Number(o.split_online) || (o.payment_mode === 'online' || o.payment_mode === 'upi' ? Number(o.total) : 0) || 0), 0);
          const fnbPaidCard = allFnbOrders
            .filter((o) => o.is_paid === 1 && (o.payment_mode === 'card' || o.split_card > 0))
            .reduce((sum, o) => sum + (Number(o.split_card) || (o.payment_mode === 'card' ? Number(o.total) : 0) || 0), 0);

          // Hospitality calculations
          const isOtaPrepaidStay = isOtaPrepaid;
          const hotelExtrasCharge = Number(folioData.extraBedCharge || 0) + Number(folioData.extra_rooms_charge || 0) + Number(folioData.extra_breakfast_charge || 0);
          const advancePaidVal = Number(folioData.advancePaid || 0);
          const stayNetTotal = isOtaPrepaidStay
            ? (advancePaidVal > 0 ? Math.max(hotelExtrasCharge, advancePaidVal) : hotelExtrasCharge)
            : Number(folioData.roomCharge || 0);
          const otaVoucherVal = Number(folioData.otaBillAmount || folioData.ota_bill_amount || 0);
          const entireBookingVal = isOtaPrepaidStay ? (otaVoucherVal + stayNetTotal) : stayNetTotal;
          const entireCollectedVal = isOtaPrepaidStay ? (otaVoucherVal + advancePaidVal) : advancePaidVal;
          const stayTaxable = (isOtaPrepaidStay || isOtaPayAtHotel) ? stayNetTotal : Math.round(stayNetTotal / 1.05);
          const stayGst = (isOtaPrepaidStay || isOtaPayAtHotel) ? 0 : (stayNetTotal - stayTaxable);
          const stayPreTax = (isOtaPrepaidStay || isOtaPayAtHotel) ? stayNetTotal : (stayTaxable + Number(folioData.discountAmount || 0));
          const stayDueAmount = isOtaPrepaidStay
            ? Math.max(0, hotelExtrasCharge - advancePaidVal)
            : Math.max(0, stayNetTotal - advancePaidVal);

          return (
            <React.Fragment>
              {/* 1. Restaurant & Bar Orders Cards Section */}
              <div className="folio-card" style={{ gridColumn: '1/-1', marginTop: '18px' }}>
                <div className="folio-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.35rem' }}>🍽️</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 850 }}>Restaurant &amp; Bar Orders ({allFnbOrders.length})</h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                        Food &amp; beverage bills linked to this stay. Simple cards view with live payment status.
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, padding: '5px 12px', background: '#ecfdf5', color: '#047857', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
                      Food: {formatCurrency(folioData.foodTotal || 0)}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, padding: '5px 12px', background: '#fef3c7', color: '#92400e', borderRadius: '8px', border: '1px solid #fde68a' }}>
                      Bar: {formatCurrency(folioData.barTotal || 0)}
                    </span>
                  </div>
                </div>

                {allFnbOrders.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                      gap: '14px',
                      marginTop: '16px'
                    }}
                  >
                    {allFnbOrders.map((ord) => {
                      let itemsList = [];
                      try {
                        const parsed = typeof ord.items_json === 'string' ? JSON.parse(ord.items_json) : ord.items;
                        if (Array.isArray(parsed)) {
                          itemsList = parsed;
                        }
                      } catch (e) {
                        itemsList = [];
                      }

                      const isPaid = ord.is_paid === 1;
                      const isBar = ord.department === 'bar';
                      const orderCreatedAt = ord.created_at ? new Date(ord.created_at) : new Date();
                      const daysPending = Math.floor((new Date() - orderCreatedAt) / (1000 * 60 * 60 * 24));
                      const isOverdue = !isPaid && daysPending >= 3;
                      const payModeInfo = getFnbPaymentModeInfo(ord);

                      return (
                        <div
                          key={`${ord.department}-${ord.id}`}
                          onClick={() => setSelectedFnbOrder(ord)}
                          style={{
                            background: isPaid
                              ? 'linear-gradient(145deg, #f0fdf4 0%, #dcfce7 60%, #bbf7d0 100%)'
                              : 'linear-gradient(145deg, #fff1f2 0%, #fee2e2 60%, #fecdd3 100%)',
                            borderRadius: '16px',
                            border: isBar
                              ? (isPaid ? '2px solid #8b5cf6' : '2px solid #f43f5e')
                              : (isPaid ? '2px solid #4ade80' : '2px solid #f87171'),
                            boxShadow: isBar
                              ? (isPaid ? '0 4px 16px rgba(124, 58, 237, 0.18)' : '0 4px 16px rgba(244, 63, 94, 0.20)')
                              : (isPaid ? '0 4px 14px rgba(34, 197, 94, 0.14)' : '0 4px 14px rgba(239, 68, 68, 0.16)'),
                            padding: '16px 18px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.18s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = isBar
                              ? (isPaid ? '0 8px 24px rgba(124, 58, 237, 0.28)' : '0 8px 24px rgba(244, 63, 94, 0.30)')
                              : (isPaid ? '0 8px 24px rgba(34, 197, 94, 0.24)' : '0 8px 24px rgba(239, 68, 68, 0.26)');
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.boxShadow = isBar
                              ? (isPaid ? '0 4px 16px rgba(124, 58, 237, 0.18)' : '0 4px 16px rgba(244, 63, 94, 0.20)')
                              : (isPaid ? '0 4px 14px rgba(34, 197, 94, 0.14)' : '0 4px 14px rgba(239, 68, 68, 0.16)');
                          }}
                          title="Click to settle payment or view detailed itemized bill"
                        >
                          {/* Top Row: Department & Order Number */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {isBar ? (
                              <span
                                style={{
                                  fontSize: '0.86rem',
                                  fontWeight: 900,
                                  padding: '5px 14px',
                                  borderRadius: '8px',
                                  background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                                  color: '#ffffff',
                                  border: '1.5px solid #a855f7',
                                  boxShadow: '0 3px 10px rgba(124, 58, 237, 0.40)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  letterSpacing: '0.3px'
                                }}
                              >
                                🍸 Bar Lounge
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: '0.86rem',
                                  fontWeight: 850,
                                  padding: '5px 12px',
                                  borderRadius: '8px',
                                  background: isPaid ? '#dcfce7' : '#fee2e2',
                                  color: isPaid ? '#166534' : '#991b1b',
                                  border: isPaid ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}
                              >
                                🍽️ Restaurant
                              </span>
                            )}
                            <span style={{ fontSize: '0.9rem', fontWeight: 900, color: isPaid ? '#14532d' : '#7f1d1d' }}>
                              {ord.order_number || `#${ord.id}`}
                              {ord.token_number ? ` (Tk #${ord.token_number})` : ''}
                            </span>
                          </div>

                          {/* Middle Row: Date & Assigned Room */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                            <span style={{ color: isPaid ? '#166534' : '#991b1b', fontWeight: 750, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                              📅 {ord.created_at ? formatDateTime(ord.created_at) : '-'}
                            </span>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: '0.76rem',
                                background: isPaid ? '#e0f2fe' : '#fee2e2',
                                color: isPaid ? '#0369a1' : '#b91c1c',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                border: isPaid ? '1px solid #bae6fd' : '1px solid #fca5a5'
                              }}
                            >
                              🔑 Room #{ord.room_number || folioData.roomNumber}
                            </span>
                          </div>

                          {/* Room service attribution & Overdue badges */}
                          {(isOverdue || ord.room_service_for) && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '-4px' }}>
                              {isOverdue && (
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 900,
                                    background: '#991b1b',
                                    color: '#ffffff',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    boxShadow: '0 2px 6px rgba(153, 27, 27, 0.35)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  🚨 &gt;3d Overdue ({daysPending}d) • Pay in Hospitality
                                </span>
                              )}
                              {ord.room_service_for && (
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 800,
                                    background: ord.room_service_for === 'visitor' ? '#fef3c7' : '#e0e7ff',
                                    color: ord.room_service_for === 'visitor' ? '#92400e' : '#3730a3',
                                    padding: '2px 7px',
                                    borderRadius: '6px',
                                    border: ord.room_service_for === 'visitor' ? '1px solid #fde68a' : '1px solid #c7d2fe'
                                  }}
                                >
                                  {ord.room_service_for === 'visitor' ? '👤 For Visitor' : '👥 For Room Mates'}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Bottom Row: Pending Amount, Payment Mode & Status Badge */}
                          <div
                            style={{
                              paddingTop: '10px',
                              borderTop: isPaid ? '1px dashed #86efac' : '1px dashed #fca5a5',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-end',
                              gap: '10px',
                              flexWrap: 'wrap'
                            }}
                          >
                            <div>
                              <span style={{ fontSize: '0.72rem', color: isPaid ? '#166534' : '#991b1b', display: 'block', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {isPaid ? 'Paid Amount' : 'Pending Amount'}
                              </span>
                              <span
                                style={{
                                  fontSize: '1.45rem',
                                  fontWeight: 950,
                                  color: isPaid ? '#15803d' : '#b91c1c'
                                }}
                              >
                                {formatCurrency(ord.total)}
                              </span>
                            </div>

                            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {/* Payment Mode Badge */}
                                <span
                                  style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 850,
                                    background: payModeInfo.bg,
                                    color: payModeInfo.color,
                                    border: `1.5px solid ${payModeInfo.border}`,
                                    padding: '4px 10px',
                                    borderRadius: '7px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    letterSpacing: '0.2px',
                                    textTransform: 'uppercase'
                                  }}
                                  title={`Payment Mode: ${payModeInfo.label}${payModeInfo.utr ? ` (UTR: ${payModeInfo.utr})` : ''}`}
                                >
                                  <span>{payModeInfo.icon}</span>
                                  <span>{payModeInfo.shortLabel}</span>
                                </span>

                                {isPaid ? (
                                  <span
                                    style={{
                                      fontSize: '0.8rem',
                                      fontWeight: 900,
                                      background: '#16a34a',
                                      color: '#ffffff',
                                      padding: '5px 14px',
                                      borderRadius: '8px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)',
                                      letterSpacing: '0.5px'
                                    }}
                                  >
                                    ✅ PAID
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: '0.8rem',
                                      fontWeight: 900,
                                      background: '#dc2626',
                                      color: '#ffffff',
                                      padding: '5px 14px',
                                      borderRadius: '8px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      boxShadow: '0 2px 6px rgba(220, 38, 38, 0.3)',
                                      letterSpacing: '0.5px'
                                    }}
                                  >
                                    ⏳ PENDING
                                  </span>
                                )}
                              </div>
                              {payModeInfo.utr && (
                                <span style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 800 }}>
                                  UTR: {payModeInfo.utr}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '32px',
                      textAlign: 'center',
                      color: '#94a3b8',
                      background: '#f8fafc',
                      borderRadius: '12px',
                      border: '1px dashed #cbd5e1',
                      marginTop: '16px'
                    }}
                  >
                    <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>🍽️</div>
                    <div style={{ fontWeight: 700 }}>No restaurant or bar orders billed to this stay.</div>
                  </div>
                )}
              </div>

              {/* 2. Two Main Breakdown Cards: Hospitality Bill & Restaurant / Bar Orders */}
              <div
                style={{
                  gridColumn: '1/-1',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: '18px',
                  marginTop: '18px'
                }}
              >
                {/* Main Card 1: Entire Bill of Hospitality */}
                <div
                  className="folio-card"
                  style={{
                    margin: 0,
                    background: 'var(--bg-surface, #ffffff)',
                    borderRadius: '16px',
                    border: '1.5px solid var(--border-color, #cbd5e1)',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04)',
                    padding: '20px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1.5px solid var(--border-color, #f1f5f9)', paddingBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.35rem' }}>🏨</span>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
                            Entire Bill of Hospitality
                          </h4>
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #64748b)' }}>
                            Room Stay &amp; Accommodation Charges
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.76rem', fontWeight: 800, padding: '3px 8px', background: 'rgba(56, 189, 248, 0.15)', color: 'var(--apple-blue)', borderRadius: '6px' }}>
                        Room #{folioData.roomNumber}{isMultiGroup ? ` (+${groupRoomsList.length - 1} linked)` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {isOtaBooking ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                            <span style={{ color: 'var(--text-secondary, #64748b)' }}>
                              OTA Voucher Package ({folioData.otaPlatform || 'OTA'} - {groupRoomsList.length > 1 ? `${groupRoomsList.length} Rooms` : '1 Room'}, {stayNights} Night{stayNights > 1 ? 's' : ''}):
                            </span>
                            <div style={{ textAlign: 'right' }}>
                              <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(Number(folioData.otaBillAmount || folioData.ota_bill_amount || 0))}</strong>
                              {isOtaPrepaidStay ? (
                                <span style={{ display: 'block', fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>
                                  ✓ Pre-Paid by OTA (Voucher Covered)
                                </span>
                              ) : (
                                <span style={{ display: 'block', fontSize: '0.72rem', color: '#b45309', fontWeight: 800 }}>
                                  🏨 Pay at Hotel Desk (Collect full voucher package)
                                </span>
                              )}
                            </div>
                          </div>

                          {hotelChargedBeds > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                              <span style={{ color: 'var(--text-secondary, #64748b)' }}>
                                Hotel Extra Bed ({hotelChargedBeds} Bed{hotelChargedBeds > 1 ? 's' : ''} @ ₹500):
                              </span>
                              <strong style={{ color: 'var(--text-primary, #0f172a)' }}>+ {formatCurrency(folioData.extraBedCharge || 0)}</strong>
                            </div>
                          )}

                          {voucherIncludedBeds > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#166534' }}>
                              <span>Voucher Extra Bed ({voucherIncludedBeds} Bed{voucherIncludedBeds > 1 ? 's' : ''}):</span>
                              <span style={{ fontWeight: 750 }}>Included in OTA (₹0)</span>
                            </div>
                          )}

                          {isOtaPrepaidStay && advancePaidVal > hotelExtrasCharge && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                              <span style={{ color: 'var(--text-secondary, #64748b)' }}>Hotel Stay Incidentals &amp; Extras:</span>
                              <strong style={{ color: 'var(--text-primary, #0f172a)' }}>+ {formatCurrency(advancePaidVal - hotelExtrasCharge)}</strong>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                            <span style={{ color: 'var(--text-secondary, #64748b)' }}>Base Room Tariff ({stayNights} Night{stayNights > 1 ? 's' : ''}):</span>
                            <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency((folioData.room?.price || folioData.room?.room_rate || 0) * stayNights)}</strong>
                          </div>

                          {folioData.extraBeds > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                              <span style={{ color: 'var(--text-secondary, #64748b)' }}>Extra Bed ({folioData.extraBeds} Bed{folioData.extraBeds > 1 ? 's' : ''}):</span>
                              <strong style={{ color: 'var(--text-primary, #0f172a)' }}>+ {formatCurrency(folioData.extraBedCharge || 0)}</strong>
                            </div>
                          )}
                        </>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Meal Plan:</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
                          {folioData.mealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>{isOtaPrepaidStay ? 'Hotel Extras Subtotal:' : (isOtaPayAtHotel ? 'Package + Extras Subtotal:' : 'Stay Tariff Subtotal:')}</span>
                        <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(stayPreTax)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Discount ({folioData.discountPct || 0}%):</span>
                        <strong style={{ color: '#dc2626' }}>- {formatCurrency(folioData.discountAmount || 0)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Stay GST (5%):</span>
                        <strong style={{ color: '#d97706' }}>{isOtaPrepaidStay ? '₹0 (In Voucher)' : (isOtaPayAtHotel ? '₹0 (In OTA Rate)' : `+ ${formatCurrency(stayGst)}`)}</strong>
                      </div>

                      {folioData.isEarlyCheckout && (
                        <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid #86efac', borderRadius: '8px', fontSize: '0.8rem', color: '#166534' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>⚡ Early Checkout Active</strong>
                            <span style={{ fontWeight: 800 }}>{folioData.stayDurationStr || `${folioData.earlyStayDays}d ${folioData.earlyStayHours}h`} (Exp: {folioData.expectedNights}d)</span>
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#15803d', marginTop: '2px' }}>
                            Recalculated Room Rent: {formatCurrency(folioData.recalculatedRoomCharge || stayNetTotal)}
                            {folioData.refundAmount > 0 && <span style={{ color: '#b91c1c', fontWeight: 800, marginLeft: '8px' }}>• Excess Refund Due: {formatCurrency(folioData.refundAmount)}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 14px',
                      background: 'var(--bg-surface-secondary, #f8fafc)',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color, #e2e8f0)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text-primary, #334155)' }}>
                        {isOtaPrepaidStay ? 'Hotel Extras Bill (Payable @ Hotel):' : (isOtaPayAtHotel ? 'Total Payable @ Hotel (OTA Package + Extras):' : 'Total Hospitality Bill:')}
                      </span>
                      <strong style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--apple-blue, #0284c7)' }}>
                        {formatCurrency(stayNetTotal)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', marginTop: '4px' }}>
                      <span>Advance Paid at Check-in: {formatCurrency(advancePaidVal)}</span>
                      <span style={{ fontWeight: 700, color: stayDueAmount > 0 ? '#b91c1c' : '#15803d' }}>
                        Stay Due: {formatCurrency(stayDueAmount)}
                        {stayDueAmount === 0 && ' (Settled)'}
                      </span>
                    </div>
                    {fnbPendingTotal > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#b91c1c', marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--border-color, #e2e8f0)', fontWeight: 800 }}>
                        <span>Total Folio Due (Stay + F&amp;B):</span>
                        <span>{formatCurrency(stayDueAmount + fnbPendingTotal)}</span>
                      </div>
                    )}

                    {isOtaPrepaidStay && (
                      <div
                        style={{
                          marginTop: '10px',
                          paddingTop: '10px',
                          borderTop: '1.5px dashed var(--border-color, #cbd5e1)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary, #334155)' }}>
                            Entire Booking Value:
                          </span>
                          <strong style={{ fontSize: '1.1rem', fontWeight: 950, color: 'var(--text-primary, #0f172a)' }}>
                            {formatCurrency(entireBookingVal)}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.86rem', fontWeight: 900, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span>🌐</span> Entire Amount Collected:
                          </span>
                          <strong style={{ fontSize: '1.18rem', fontWeight: 950, color: '#166534' }}>
                            {formatCurrency(entireCollectedVal)}
                          </strong>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 750, textAlign: 'right' }}>
                          ✓ {formatCurrency(otaVoucherVal)} Pre-Paid via {folioData.otaPlatform || 'OTA'} + {formatCurrency(advancePaidVal)} Collected at Hotel Desk
                        </div>
                      </div>
                    )}

                    {isOtaPayAtHotel && (
                      <div
                        style={{
                          marginTop: '10px',
                          paddingTop: '10px',
                          borderTop: '1.5px dashed var(--border-color, #cbd5e1)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary, #334155)' }}>
                            Entire Stay Bill (Payable @ Hotel):
                          </span>
                          <strong style={{ fontSize: '1.1rem', fontWeight: 950, color: 'var(--text-primary, #0f172a)' }}>
                            {formatCurrency(stayNetTotal)}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--apple-blue, #0369a1)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span>🏨</span> Advance Collected at Desk:
                          </span>
                          <strong style={{ fontSize: '1.18rem', fontWeight: 950, color: 'var(--apple-blue, #0369a1)' }}>
                            {formatCurrency(advancePaidVal)}
                          </strong>
                        </div>
                        <div style={{ fontSize: '0.74rem', color: stayDueAmount > 0 ? '#b91c1c' : '#15803d', fontWeight: 750, textAlign: 'right' }}>
                          {stayDueAmount > 0
                            ? `⚠️ ${formatCurrency(stayDueAmount)} Pending to collect at Checkout (${formatCurrency(otaVoucherVal)} OTA Package + Extras)`
                            : '✓ Full Stay Amount Settled'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Main Card 2: Restaurant / Bar Orders */}
                <div
                  className="folio-card"
                  style={{
                    margin: 0,
                    background: 'var(--bg-surface, #ffffff)',
                    borderRadius: '16px',
                    border: '1.5px solid var(--border-color, #cbd5e1)',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04)',
                    padding: '20px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1.5px solid var(--border-color, #f1f5f9)', paddingBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.35rem' }}>🍽️</span>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
                            Restaurant &amp; Bar Orders Bill
                          </h4>
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #64748b)' }}>
                            F&amp;B Orders Summary &amp; Tax Breakdown
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.76rem', fontWeight: 800, padding: '3px 8px', background: 'rgba(217, 119, 6, 0.15)', color: '#d97706', borderRadius: '6px' }}>
                        {allFnbOrders.length} Order{allFnbOrders.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Food (Restaurant):</span>
                        <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(fnbFoodGross)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Bar (Lounge):</span>
                        <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(fnbBarGross)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>F&amp;B Orders Subtotal:</span>
                        <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(fnbTaxable)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>F&amp;B Tax (5% GST):</span>
                        <strong style={{ color: '#d97706' }}>+ {formatCurrency(fnbGst)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem' }}>
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>Total F&amp;B Orders:</span>
                        <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{formatCurrency(fnbTotal)}</strong>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', paddingTop: '4px', borderTop: '1px dashed var(--border-color, #e2e8f0)' }}>
                        <span style={{ color: '#16a34a', fontWeight: 750 }}>Paid at POS:</span>
                        <strong style={{ color: '#16a34a' }}>{formatCurrency(fnbPaidTotal)}</strong>
                      </div>
                      {fnbPaidTotal > 0 && (
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '2px', fontSize: '0.74rem' }}>
                          {fnbPaidCash > 0 && <span style={{ color: '#15803d', fontWeight: 750 }}>💵 Cash: {formatCurrency(fnbPaidCash)}</span>}
                          {fnbPaidOnline > 0 && <span style={{ color: '#0369a1', fontWeight: 750 }}>📱 UPI: {formatCurrency(fnbPaidOnline)}</span>}
                          {fnbPaidCard > 0 && <span style={{ color: '#92400e', fontWeight: 750 }}>💳 Card: {formatCurrency(fnbPaidCard)}</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 14px',
                      background: '#fffbeb',
                      borderRadius: '10px',
                      border: '1px solid #fde68a'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#92400e' }}>Pending Added to Room Folio:</span>
                      <strong style={{ fontSize: '1.3rem', fontWeight: 900, color: fnbPendingTotal > 0 ? '#b91c1c' : '#15803d' }}>
                        {formatCurrency(fnbPendingTotal)}
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#92400e', marginTop: '4px' }}>
                      {fnbPendingTotal > 0
                        ? `⏳ Added to room balance due (${formatCurrency(stayDueAmount)} Stay + ${formatCurrency(fnbPendingTotal)} F&B = ${formatCurrency(stayDueAmount + fnbPendingTotal)} Total Due).`
                        : '✓ All F&B orders settled.'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Financial Analytics: 5 KPI Tiles (Below the 2 Main Breakdown Cards) */}
              <div className="folio-financial-tiles-grid" style={{ gridColumn: '1/-1', marginTop: '18px' }}>
                <div className="financial-tile">
                  <span className="tile-label">{fnbTotal > 0 ? 'Room Stay Bill' : 'Tariff Subtotal'}</span>
                  <strong className="tile-val">
                    {formatCurrency(isOtaPrepaidStay ? stayNetTotal : (fnbTotal > 0 ? stayNetTotal : (folioData.grossTariff || stayNetTotal)))}
                  </strong>
                  <small>{isOtaPrepaidStay ? 'Hotel Extras' : (isOtaPayAtHotel ? 'OTA Package + Extras' : (fnbTotal > 0 ? `Incl. 5% GST${folioData.discountAmount > 0 ? ` (Disc -${formatCurrency(folioData.discountAmount)})` : ''}` : 'Stay Tariff'))}</small>
                </div>
                <div className="financial-tile">
                  <span className="tile-label">{fnbTotal > 0 ? 'Restaurant & Bar' : 'Discount'}</span>
                  <strong className="tile-val" style={{ color: fnbTotal > 0 ? '#d97706' : undefined }}>
                    {fnbTotal > 0 ? `+ ${formatCurrency(fnbTotal)}` : `- ${formatCurrency(folioData.discountAmount || 0)}`}
                  </strong>
                  <small>{fnbTotal > 0 ? `${allFnbOrders.length} Order${allFnbOrders.length === 1 ? '' : 's'}${fnbPendingTotal > 0 ? ` (${formatCurrency(fnbPendingTotal)} Unpaid)` : ' (Paid)'}` : `${folioData.discountPct || 0}%`}</small>
                </div>
                <div className="financial-tile">
                  <span className="tile-label">Total Amount</span>
                  <strong className="tile-val">
                    {formatCurrency(isOtaPrepaidStay ? (stayNetTotal + fnbPendingTotal) : (stayNetTotal + (isOtaPayAtHotel ? fnbTotal : fnbTotal)))}
                  </strong>
                  <small>{fnbTotal > 0 ? `Stay (${formatCurrency(stayNetTotal)}) + F&B (${formatCurrency(fnbTotal)})` : (isOtaPrepaidStay ? `Desk (Entire: ${formatCurrency(entireBookingVal)})` : (isOtaPayAtHotel ? 'Payable at Desk' : 'Incl. 5% GST'))}</small>
                </div>
                <div className="financial-tile">
                  <span className="tile-label">Advance Paid</span>
                  <strong className="tile-val paid">{formatCurrency(advancePaidVal + (fnbPaidTotal > 0 ? fnbPaidTotal : 0))}</strong>
                  <small>{fnbPaidTotal > 0 ? `Check-in: ${formatCurrency(advancePaidVal)} + POS: ${formatCurrency(fnbPaidTotal)}` : (isOtaPrepaidStay ? `Desk (Entire: ${formatCurrency(entireCollectedVal)})` : (isOtaPayAtHotel ? 'Advance @ Desk' : 'At check-in'))}</small>
                </div>
                <div className="financial-tile highlight-due">
                  <span className="tile-label">Remaining Due</span>
                  <strong className="tile-val due" style={{ color: (stayDueAmount + fnbPendingTotal) <= 0 ? '#15803d' : '#b91c1c' }}>
                    {formatCurrency(Math.max(0, stayDueAmount + fnbPendingTotal))}
                  </strong>
                  <small>{(stayDueAmount + fnbPendingTotal) <= 0 ? 'Fully Settled' : (fnbPendingTotal > 0 ? `${formatCurrency(stayDueAmount)} Stay + ${formatCurrency(fnbPendingTotal)} F&B` : 'Due at checkout')}</small>
                </div>
              </div>
            </React.Fragment>
          );
        })()}

        {/* Advance Payments & Billing Records Table (Point 6) */}
        <div className="folio-card" style={{ gridColumn: '1/-1', marginBottom: '22px' }}>
          <div className="folio-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.25rem' }}>💳</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Advance Payments &amp; Billing Records</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  Payments recorded for this booking. Click "Receipt" to print official cash receipt (Receipt 1, 2-on-A4).
                </span>
              </div>
            </div>
            <button
              type="button"
              className="filter-chip"
              onClick={() => {
                const printPayload = buildFolioPrintPayload();
                printGuestPaymentSummary(printPayload);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, background: '#eff6ff', color: '#1e40af', borderColor: '#93c5fd', padding: '6px 14px', fontSize: '0.84rem' }}
              title="Print Customer Payment Summary Statement (A4 Sheet)"
            >
              📄 Print Payment Summary
            </button>
          </div>

          <div id="folio-advance-payments-container">
            {Array.isArray(folioData.payments) && folioData.payments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                {folioData.payments.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      background: '#f8fafc',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                        Receipt #{p.receipt_no || p.receipt_number || p.id} • {p.payment_mode ? p.payment_mode.toUpperCase() : 'CASH'}
                        {p.utr_number ? <span style={{ color: '#0369a1', marginLeft: '6px', fontSize: '0.82rem' }}>• UTR: {p.utr_number}</span> : ''}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                        {formatDateTime(p.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <strong style={{ fontSize: '1.1rem', color: '#15803d' }}>
                          {formatCurrency(p.amount)}
                        </strong>
                        <div>
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '8px' }}>
                            PAID
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() =>
                          printCashReceipt({
                            receipt_no: p.receipt_no || p.receipt_number || `ADV-${p.id}`,
                            receipt_date: p.created_at,
                            guest_name: folioData.guestName,
                            amount: p.amount,
                            payment_mode: p.payment_mode,
                            split_cash: p.split_cash,
                            split_online: p.split_online,
                            split_card: p.split_card,
                            split_cheque: p.split_cheque,
                            utr_number: p.utr_number || p.online_utr,
                            cheque_no: p.cheque_no,
                            bank_name: p.bank_name,
                            room_numbers: folioData.roomNumber,
                            particulars: `Room ${folioData.roomNumber} - Advance Stay Payment`,
                            cashier_name: p.cashier_name || p.cashier || p.staff_name || folioData.room?.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                          })
                        }
                        style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                        title="Print Official Cash Receipt (2-on-A4)"
                      >
                        🖨️ Receipt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : folioData.initialPaid > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                      Check-in Advance Deposit • {folioData.room?.split_online > 0 ? 'ONLINE' : 'CASH'}
                      {(folioData.room?.advance_utr_number || folioData.advance_utr_number) ? (
                        <span style={{ color: '#0369a1', marginLeft: '6px', fontSize: '0.82rem' }}>
                          • UTR: {folioData.room?.advance_utr_number || folioData.advance_utr_number}
                        </span>
                      ) : ''}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                      {formatDateTime(folioData.checkinTime)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontSize: '1.1rem', color: '#15803d' }}>
                        {formatCurrency(folioData.initialPaid)}
                      </strong>
                      <div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '8px' }}>
                          PAID
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="filter-chip"
                      onClick={() =>
                        printCashReceipt({
                          receipt_no: `ADV-${folioData.bookingId}`,
                          receipt_date: folioData.checkinTime,
                          guest_name: folioData.guestName,
                          amount: folioData.initialPaid,
                          payment_mode: folioData.room?.split_online > 0 ? 'Online' : 'Cash',
                          split_cash: folioData.room?.split_cash,
                          split_online: folioData.room?.split_online,
                          split_card: folioData.room?.split_card,
                          split_cheque: folioData.room?.split_cheque,
                          card_surcharge: folioData.room?.advance_card_surcharge || folioData.room?.card_surcharge || 0,
                          upi_tax: folioData.room?.advance_upi_tax || folioData.room?.upi_tax || 0,
                          utr_number: folioData.room?.advance_utr_number || folioData.advance_utr_number || folioData.room?.utr_number,
                          cheque_no: folioData.room?.cheque_no,
                          bank_name: folioData.room?.bank_name,
                          room_numbers: folioData.roomNumber,
                          particulars: `Room ${folioData.roomNumber} - Initial Check-in Advance`,
                          cashier_name: folioData.room?.checked_in_by || folioData.checked_in_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                        })
                      }
                      style={{ fontSize: '0.74rem', padding: '4px 10px', fontWeight: 750, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                      title="Print Official Cash Receipt (2-on-A4)"
                    >
                      🖨️ Receipt
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                No advance payments recorded for this room.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom CTA Bar */}
      <div className="folio-checkout-cta-bar">
        <div>
          <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
            Ready to check out guest?
          </div>
          <div style={{ fontSize: '1.12rem', fontWeight: 900, color: 'var(--text-primary)' }}>
            Proceed to final billing settlement, payment collection &amp; invoice printing
          </div>
        </div>
        <button
          type="button"
          className="btn-scan-action"
          onClick={() => setIsSettlementOpen(true)}
          style={{ padding: '12px 28px', fontSize: '1rem', fontWeight: 800, borderRadius: 'var(--radius-md)' }}
        >
          💳 Checkout
        </button>
      </div>

      {/* Settlement Modal */}
      <FolioSettlementModal
        isOpen={isSettlementOpen}
        room={folioData?.room || folioData}
        folioData={folioData}
        onClose={() => setIsSettlementOpen(false)}
        onCheckoutSuccess={(res) => {
          setIsSettlementOpen(false);
          if (onCheckoutDone) onCheckoutDone(res);
        }}
      />

      {/* Lightbox Preview */}
      <ImageLightbox
        isOpen={Boolean(lightboxImage)}
        title={lightboxTitle}
        imageUrl={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />

      {/* Detailed Restaurant / Bar Order Modal */}
      {selectedFnbOrder && (() => {
        let modalItems = [];
        try {
          const parsed = typeof selectedFnbOrder.items_json === 'string'
            ? JSON.parse(selectedFnbOrder.items_json)
            : selectedFnbOrder.items;
          if (Array.isArray(parsed)) {
            modalItems = parsed;
          }
        } catch (e) {
          modalItems = [];
        }

        const isPaid = selectedFnbOrder.is_paid === 1;
        const selectedPayModeInfo = getFnbPaymentModeInfo(selectedFnbOrder);

        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(5px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
            onClick={() => setSelectedFnbOrder(null)}
          >
            <div
              style={{
                background: '#ffffff',
                borderRadius: '18px',
                maxWidth: '540px',
                width: '100%',
                boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)',
                overflow: 'hidden',
                border: '1px solid #e2e8f0',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: '16px 20px',
                  background: isPaid
                    ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'
                    : 'linear-gradient(135deg, #fff1f2 0%, #fee2e2 100%)',
                  borderBottom: isPaid ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {selectedFnbOrder.department === 'bar' ? (
                    <span
                      style={{
                        fontSize: '0.88rem',
                        fontWeight: 900,
                        padding: '6px 14px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                        color: '#ffffff',
                        border: '1.5px solid #a855f7',
                        boxShadow: '0 3px 10px rgba(124, 58, 237, 0.40)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        letterSpacing: '0.3px'
                      }}
                    >
                      🍸 Bar Lounge
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.88rem',
                        fontWeight: 850,
                        padding: '6px 12px',
                        borderRadius: '8px',
                        background: isPaid ? '#dcfce7' : '#fee2e2',
                        color: isPaid ? '#166534' : '#991b1b',
                        border: isPaid ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      🍽️ Restaurant
                    </span>
                  )}
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                      {selectedFnbOrder.order_number || `#${selectedFnbOrder.id}`}
                      {selectedFnbOrder.token_number ? ` (Token #${selectedFnbOrder.token_number})` : ''}
                    </h3>
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Full Order &amp; Itemized Bill Details
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedFnbOrder(null)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.9)',
                    border: '1px solid #cbd5e1',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    fontWeight: 800,
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.color = '#0f172a'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'; e.currentTarget.style.color = '#64748b'; }}
                >
                  ✕
                </button>
              </div>

              {/* Modal Body (Scrollable) */}
              <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Info Highlights Card */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                    background: '#f8fafc',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.82rem'
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontWeight: 600, fontSize: '0.74rem' }}>Assigned Room</span>
                    <strong style={{ color: '#0f172a', fontSize: '0.9rem' }}>🔑 Room #{selectedFnbOrder.room_number || folioData.roomNumber}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontWeight: 600, fontSize: '0.74rem' }}>Date &amp; Time</span>
                    <strong style={{ color: '#0f172a', fontSize: '0.84rem' }}>
                      📅 {selectedFnbOrder.created_at ? formatDateTime(selectedFnbOrder.created_at) : '-'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontWeight: 600, fontSize: '0.74rem' }}>Payment Mode</span>
                    <strong style={{ color: selectedPayModeInfo.color, display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 850 }}>
                      <span>{selectedPayModeInfo.icon}</span>
                      <span>{selectedPayModeInfo.label}</span>
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontWeight: 600, fontSize: '0.74rem' }}>Payment Status</span>
                    {isPaid ? (
                      <span style={{ fontWeight: 900, color: '#15803d', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        ✅ PAID
                      </span>
                    ) : (
                      <span style={{ fontWeight: 900, color: '#b91c1c', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        ⏳ PENDING (Folio Due)
                      </span>
                    )}
                  </div>
                  {selectedFnbOrder.utr_number && (
                    <div style={{ gridColumn: 'span 2' }}>
                      <span style={{ color: '#64748b', display: 'block', fontWeight: 600, fontSize: '0.74rem' }}>UTR / Online Reference ID</span>
                      <code style={{ background: '#e2e8f0', padding: '3px 8px', borderRadius: '4px', fontWeight: 800, color: '#0f172a' }}>
                        {selectedFnbOrder.utr_number}
                      </code>
                    </div>
                  )}
                </div>

                {/* Itemized Dishes Table */}
                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '0.84rem', fontWeight: 850, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    🍽️ Itemized Food / Beverage Items ({modalItems.length})
                  </h4>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'left', fontWeight: 800 }}>
                          <th style={{ padding: '8px 12px', width: '36px' }}>#</th>
                          <th style={{ padding: '8px 12px' }}>Item Name</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center', width: '55px' }}>Qty</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', width: '80px' }}>Rate</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', width: '90px' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalItems.length > 0 ? (
                          modalItems.map((it, idx) => {
                            const q = it.quantity || it.qty || 1;
                            const p = Number(it.price) || 0;
                            return (
                              <tr key={idx} style={{ borderTop: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{idx + 1}</td>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1e293b' }}>
                                  {it.name}
                                  {it.notes ? <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8' }}>Note: {it.notes}</span> : null}
                                </td>
                                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>{q}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{formatCurrency(p)}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{formatCurrency(q * p)}</td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#94a3b8' }}>
                              {selectedFnbOrder.items_summary || 'No itemized items recorded.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Bill Summary / Tax Breakdown */}
                <div
                  style={{
                    background: isPaid ? '#f0fdf4' : '#fff1f2',
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: isPaid ? '1.5px solid #86efac' : '1.5px solid #fca5a5',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  {selectedFnbOrder.subtotal !== undefined && selectedFnbOrder.subtotal !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#64748b' }}>
                      <span>Items Subtotal:</span>
                      <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(selectedFnbOrder.subtotal)}</span>
                    </div>
                  )}
                  {Number(selectedFnbOrder.tax || 0) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#64748b' }}>
                      <span>GST / Taxes:</span>
                      <span style={{ fontWeight: 700, color: '#1e293b' }}>{formatCurrency(selectedFnbOrder.tax)}</span>
                    </div>
                  )}
                  {Number(selectedFnbOrder.discount || selectedFnbOrder.discount_amount || 0) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#16a34a' }}>
                      <span>Discount Applied:</span>
                      <span style={{ fontWeight: 700 }}>- {formatCurrency(selectedFnbOrder.discount || selectedFnbOrder.discount_amount)}</span>
                    </div>
                  )}
                  <div
                    style={{
                      paddingTop: '8px',
                      marginTop: '4px',
                      borderTop: isPaid ? '1px dashed #86efac' : '1px dashed #fca5a5',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', color: isPaid ? '#166534' : '#991b1b', display: 'block' }}>
                        {isPaid ? 'Total Paid' : 'Total Pending Amount'}
                      </span>
                      <span style={{ fontSize: '1.45rem', fontWeight: 950, color: isPaid ? '#15803d' : '#b91c1c' }}>
                        {formatCurrency(selectedFnbOrder.total)}
                      </span>
                    </div>
                    {(() => {
                      const selectedPayModeInfo = getFnbPaymentModeInfo(selectedFnbOrder);
                      return (
                        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '0.80rem',
                              fontWeight: 850,
                              background: selectedPayModeInfo.bg,
                              color: selectedPayModeInfo.color,
                              border: `1.5px solid ${selectedPayModeInfo.border}`,
                              padding: '5px 12px',
                              borderRadius: '8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              textTransform: 'uppercase'
                            }}
                          >
                            <span>{selectedPayModeInfo.icon}</span>
                            <span>{selectedPayModeInfo.label}</span>
                          </span>

                          {isPaid ? (
                            <span style={{ background: '#16a34a', color: '#ffffff', padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 900 }}>
                              PAID
                            </span>
                          ) : (
                            <span style={{ background: '#dc2626', color: '#ffffff', padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 900 }}>
                              PENDING
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Mobile Bill Dispatch Bar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#ecfdf5',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1.5px solid #a7f3d0'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.86rem', color: '#065f46', display: 'block' }}>
                      📱 Instant Mobile Bill Dispatch (WhatsApp / PDF)
                    </strong>
                    <span style={{ fontSize: '0.75rem', color: '#047857' }}>
                      Guest Mobile: <strong>{folioData.mobile || selectedFnbOrder.guest_phone || 'None registered'}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isSendingMobile || !(folioData.mobile || selectedFnbOrder.guest_phone)}
                    onClick={handleSendBillToMobile}
                    style={{
                      padding: '8px 16px',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: (folioData.mobile || selectedFnbOrder.guest_phone) ? 'pointer' : 'not-allowed',
                      opacity: (folioData.mobile || selectedFnbOrder.guest_phone) ? 1 : 0.6,
                      boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {isSendingMobile ? '⏳ Sending...' : '💬 Send WhatsApp Bill'}
                  </button>
                </div>

                {/* Settle Pending Bill Section (Front Desk Hospitality) */}
                {!isPaid && (
                  <div
                    style={{
                      background: '#f8fafc',
                      padding: '16px',
                      borderRadius: '14px',
                      border: '1.5px solid #cbd5e1',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        💳 Settle &amp; Collect Payment Now (Hospitality Front Desk)
                      </h4>
                      {(() => {
                        const mDate = selectedFnbOrder.created_at ? new Date(selectedFnbOrder.created_at) : new Date();
                        const mDays = Math.floor((new Date() - mDate) / (1000 * 60 * 60 * 24));
                        return mDays >= 3 ? (
                          <span style={{ fontSize: '0.72rem', fontWeight: 900, background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fca5a5' }}>
                            ⚠️ &gt;3 Days Overdue ({mDays}d)
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {/* Payment Mode Selector */}
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', display: 'block', marginBottom: '6px' }}>
                        SELECT PAYMENT METHOD:
                      </span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        {[
                          { id: 'cash', label: '💵 Cash' },
                          { id: 'upi', label: selectedFnbOrder.total > 2000 ? '📱 UPI (+0.4%)' : '📱 UPI (0%)' },
                          { id: 'card', label: '💳 Card (+2.5%)' },
                          { id: 'split', label: '🔀 Split' }
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setFnbPayMode(m.id)}
                            style={{
                              padding: '8px 4px',
                              borderRadius: '8px',
                              border: fnbPayMode === m.id ? '2px solid #0284c7' : '1px solid #cbd5e1',
                              background: fnbPayMode === m.id ? '#e0f2fe' : '#ffffff',
                              color: fnbPayMode === m.id ? '#0369a1' : '#475569',
                              fontWeight: 850,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode Specific Inputs */}
                    {fnbPayMode === 'upi' && (
                      <div style={{ background: '#f0f9ff', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #bae6fd' }}>
                        {selectedFnbOrder.total > 2000 ? (
                          <div style={{ marginBottom: '8px', padding: '6px 10px', background: '#e0f2fe', borderRadius: '6px', fontSize: '0.78rem', color: '#0369a1', fontWeight: 750 }}>
                            + 0.4% UPI Convenience Tax: ₹{Math.round(selectedFnbOrder.total * 0.004)} (Total to collect: ₹{selectedFnbOrder.total + Math.round(selectedFnbOrder.total * 0.004)})
                          </div>
                        ) : (
                          <div style={{ marginBottom: '8px', padding: '4px 8px', background: '#dcfce7', borderRadius: '6px', fontSize: '0.74rem', color: '#166534', fontWeight: 700 }}>
                            ✓ 0% Tax (UPI ≤ ₹2,000)
                          </div>
                        )}
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#0369a1', marginBottom: '6px' }}>
                          UPI / QR Transaction UTR Number <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="Enter 12-digit UPI UTR / RRN (e.g. 428910294819)"
                          value={fnbUtr}
                          onChange={(e) => setFnbUtr(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '9px 12px',
                            borderRadius: '8px',
                            border: '1.5px solid #0284c7',
                            fontSize: '0.88rem',
                            fontWeight: 700
                          }}
                        />
                      </div>
                    )}

                    {fnbPayMode === 'card' && (
                      <div style={{ background: '#fefce8', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #fef08a' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 750, color: '#854d0e' }}>
                          <span>Base Bill Amount:</span>
                          <span>{formatCurrency(selectedFnbOrder.total)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 850, color: '#b45309', marginTop: '4px' }}>
                          <span>Card Machine Extra Charge (2.5%):</span>
                          <span>+ {formatCurrency(Math.round(selectedFnbOrder.total * 0.025))}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.94rem', fontWeight: 950, color: '#0f172a', borderTop: '1px dashed #fde047', paddingTop: '6px', marginTop: '6px' }}>
                          <span>Total Amount Charged to Guest Card:</span>
                          <span style={{ color: '#b45309' }}>{formatCurrency(Math.round(selectedFnbOrder.total * 1.025))}</span>
                        </div>
                        <div style={{ fontSize: '0.73rem', color: '#713f12', marginTop: '6px', lineHeight: 1.35 }}>
                          ℹ️ <em>2.5% card charge is itemized on the guest receipt. In hotel accounting, base {formatCurrency(selectedFnbOrder.total)} is realized as hotel revenue (surcharge excluded from hotel profits).</em>
                        </div>
                      </div>
                    )}

                    {fnbPayMode === 'split' && (
                      <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #cbd5e1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '0.74rem', fontWeight: 750, color: '#475569', display: 'block' }}>Cash (₹)</label>
                            <input
                              type="number"
                              value={fnbSplitCash}
                              onChange={(e) => setFnbSplitCash(e.target.value)}
                              style={{ width: '100%', padding: '7px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700 }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.74rem', fontWeight: 750, color: '#475569', display: 'block' }}>Online / UPI (₹)</label>
                            <input
                              type="number"
                              value={fnbSplitOnline}
                              onChange={(e) => setFnbSplitOnline(e.target.value)}
                              style={{ width: '100%', padding: '7px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700 }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.74rem', fontWeight: 750, color: '#475569', display: 'block' }}>Card (₹, +2.5%)</label>
                            <input
                              type="number"
                              value={fnbSplitCard}
                              onChange={(e) => setFnbSplitCard(e.target.value)}
                              style={{ width: '100%', padding: '7px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem', fontWeight: 700 }}
                            />
                          </div>
                        </div>
                        {Number(fnbSplitOnline) > 0 && (
                          <div style={{ marginTop: '4px' }}>
                            <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', display: 'block' }}>
                              UPI UTR Number <span style={{ color: '#dc2626' }}>* (Mandatory for UPI portion)</span>
                            </label>
                            <input
                              type="text"
                              placeholder="Enter UPI UTR Reference Number"
                              value={fnbUtr}
                              onChange={(e) => setFnbUtr(e.target.value)}
                              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1.5px solid #0284c7', fontSize: '0.84rem', fontWeight: 700 }}
                            />
                          </div>
                        )}
                        {Number(fnbSplitOnline) > 2000 && (
                          <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 750 }}>
                            + ₹{Math.round(Number(fnbSplitOnline) * 0.004)} (0.4% UPI tax on portion &gt; ₹2,000, printed on receipt).
                          </div>
                        )}
                        {Number(fnbSplitOnline) > 0 && Number(fnbSplitOnline) <= 2000 && (
                          <div style={{ fontSize: '0.74rem', color: '#166534', fontWeight: 700 }}>
                            ✓ 0% Tax (UPI portion ≤ ₹2,000)
                          </div>
                        )}
                        {Number(fnbSplitCard) > 0 && (
                          <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 750 }}>
                            + ₹{Math.round(Number(fnbSplitCard) * 0.025)} (2.5% card surcharge on card portion, printed on receipt).
                          </div>
                        )}
                      </div>
                    )}

                    {/* Settle Action Button */}
                    <button
                      type="button"
                      disabled={isSettlingFnb}
                      onClick={handleSettleFnbFromFolio}
                      style={{
                        padding: '12px 20px',
                        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: 900,
                        fontSize: '0.95rem',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                    >
                      {isSettlingFnb ? '⏳ Processing Settlement...' : '✅ Settle Payment & Print 2-on-A4 Receipt'}
                    </button>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: '12px 20px',
                  background: '#f8fafc',
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: isPaid ? 'space-between' : 'flex-end',
                  alignItems: 'center'
                }}
              >
                {isPaid && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() =>
                        printCashReceipt({
                          receipt_no: selectedFnbOrder.receipt_no || `RCP-${selectedFnbOrder.id}`,
                          receipt_date: selectedFnbOrder.settled_at || selectedFnbOrder.created_at,
                          guest_name: folioData.guestName,
                          amount: selectedFnbOrder.total,
                          payment_mode: (selectedFnbOrder.payment_mode || 'Cash').toUpperCase(),
                          utr_number: selectedFnbOrder.utr_number,
                          card_surcharge: selectedFnbOrder.card_surcharge,
                          upi_tax: selectedFnbOrder.upi_tax,
                          room_numbers: folioData.roomNumber,
                          particulars: `Paid ${selectedFnbOrder.department === 'bar' ? 'Bar Lounge' : 'Restaurant'} Bill #${selectedFnbOrder.order_number || selectedFnbOrder.id}`,
                          cashier_name: selectedFnbOrder.settled_by || (currentUser ? (currentUser.full_name || currentUser.username) : '')
                        })
                      }
                      style={{
                        padding: '8px 16px',
                        background: '#f0f9ff',
                        color: '#0369a1',
                        border: '1.5px solid #bae6fd',
                        borderRadius: '8px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      🖨️ Re-Print Receipt (2-on-A4)
                    </button>
                    <button
                      type="button"
                      onClick={handleSendBillToMobile}
                      style={{
                        padding: '8px 16px',
                        background: '#ecfdf5',
                        color: '#065f46',
                        border: '1.5px solid #a7f3d0',
                        borderRadius: '8px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      💬 WhatsApp Bill
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedFnbOrder(null)}
                  style={{
                    padding: '8px 24px',
                    borderRadius: '8px',
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    color: '#334155',
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontSize: '0.88rem'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <DocumentActionModal
        isOpen={docActionModal.isOpen}
        onClose={() => setDocActionModal(prev => ({ ...prev, isOpen: false }))}
        type={docActionModal.type}
        data={docActionModal.data}
        onReprintRegForm={onReprintRegForm}
      />
    </section>
  );
}
