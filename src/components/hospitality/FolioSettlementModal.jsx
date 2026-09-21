import React, { useState, useEffect, useRef } from 'react';
import { formatCurrency } from '../../utils/formatters';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { printCashReceipt, printPettyCashVoucher, printFinalBillA4, printGuestRegistrationA4 } from '../../services/printService';

export default function FolioSettlementModal({
  isOpen,
  room,
  folioData,
  onClose,
  onCheckoutSuccess
}) {
  const { showToast, currentUser, surchargeSettings } = useApp();
  const cardPct = surchargeSettings?.card_surcharge_pct !== undefined ? Number(surchargeSettings.card_surcharge_pct) : 2.5;
  const upiPct = surchargeSettings?.upi_tax_pct !== undefined ? Number(surchargeSettings.upi_tax_pct) : 0.4;
  const upiThresh = surchargeSettings?.upi_tax_threshold !== undefined ? Number(surchargeSettings.upi_tax_threshold) : 2000;

  const cashInputRef = useRef(null);
  const onlineInputRef = useRef(null);
  const cardInputRef = useRef(null);
  const chequeInputRef = useRef(null);

  const [selectedMethod, setSelectedMethod] = useState('cash');
  const [splitCash, setSplitCash] = useState(0);
  const [splitOnline, setSplitOnline] = useState(0);
  const [splitCard, setSplitCard] = useState(0);
  const [splitCheque, setSplitCheque] = useState(0);
  const [onlineUtr, setOnlineUtr] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [btcCheckoutMode, setBtcCheckoutMode] = useState('company_later'); // 'company_later' | 'pay_now'

  // Return Type & Refund States
  const [returnType, setReturnType] = useState('cash'); // 'cash', 'online', 'card'
  const [returnUtr, setReturnUtr] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const isEarlyCheckout = Boolean(folioData?.isEarlyCheckout || folioData?.summary?.isEarlyCheckout);
  const earlyStayDays = folioData?.earlyStayDays ?? folioData?.summary?.earlyStayDays ?? 1;
  const earlyStayHours = folioData?.earlyStayHours ?? folioData?.summary?.earlyStayHours ?? 0;
  const earlyExtensionCharge = folioData?.earlyExtensionCharge ?? folioData?.summary?.earlyExtensionCharge ?? 0;
  const stayDurationStr = folioData?.stayDurationStr || folioData?.summary?.stayDurationStr || '';
  const expectedNights = folioData?.expectedNights ?? folioData?.summary?.expectedNights ?? 1;

  const summaryRefund = folioData?.summary?.refundAmount || folioData?.refundAmount || 0;
  const balanceDue = folioData ? Math.max(0, folioData.balanceDue || 0) : 0;
  const isRefund = (folioData && (folioData.balanceDue < 0 || summaryRefund > 0)) || false;
  const refundAmount = isRefund ? (summaryRefund > 0 ? summaryRefund : Math.abs(folioData.balanceDue)) : 0;

  useEffect(() => {
    if (isOpen && folioData) {
      setOnlineUtr('');
      setChequeNo('');
      setChequeBank('');
      setReturnUtr('');
      setReturnType('cash');
      setSplitCash(0);
      setSplitOnline(0);
      setSplitCard(0);
      setSplitCheque(0);
      setBtcCheckoutMode('company_later');

      const defaultReason = isEarlyCheckout
        ? `Early checkout refund: Stayed ${stayDurationStr || `${earlyStayDays}d ${earlyStayHours}h`} (Expected ${expectedNights}d)`
        : 'Guest refund of excess advance on checkout';
      setRefundReason(defaultReason);
    }
  }, [isOpen, folioData, balanceDue, isEarlyCheckout, stayDurationStr, earlyStayDays, earlyStayHours, expectedNights]);

  if (!isOpen || !folioData || !room) return null;

  const totalSettled = Number(splitCash) + Number(splitOnline) + Number(splitCard) + Number(splitCheque);
  const remainingSettle = Math.max(0, balanceDue - totalSettled);

  const bookingSource = String(folioData?.bookingSource || room?.booking_source || '').toUpperCase();
  const isBtc = bookingSource === 'BTC' || Boolean(folioData?.btcCompanyName) || Boolean(room?.btc_company_id) || Boolean(folioData?.isBtcBooking) || Boolean(room?.is_btc);
  const isCompanyPayingLater = isBtc && btcCheckoutMode === 'company_later';

  // Overpayment prevention and strict single payment method enforcement (prevents split payment)
  const handleAmountChange = (field, value) => {
    setSelectedMethod(field);
    let val = Math.max(0, Number(value) || 0);
    if (val > balanceDue) {
      val = balanceDue;
    }

    if (field === 'cash') {
      setSplitCash(val);
      setSplitOnline(0);
      setSplitCard(0);
      setSplitCheque(0);
    } else if (field === 'online') {
      setSplitCash(0);
      setSplitOnline(val);
      setSplitCard(0);
      setSplitCheque(0);
    } else if (field === 'card') {
      setSplitCash(0);
      setSplitOnline(0);
      setSplitCard(val);
      setSplitCheque(0);
    } else if (field === 'cheque') {
      if (isBtc) {
        setSplitCash(0);
        setSplitOnline(0);
        setSplitCard(0);
        setSplitCheque(val);
      }
    }
  };

  const selectPaymentMethod = (field, inputRef) => {
    setSelectedMethod(field);
    if (inputRef && inputRef.current) {
      inputRef.current.focus();
    }

    const currentActiveField =
      splitCash > 0 ? 'cash' :
      splitOnline > 0 ? 'online' :
      splitCard > 0 ? 'card' :
      splitCheque > 0 ? 'cheque' : null;

    if (currentActiveField && currentActiveField !== field) {
      const currentSettled = splitCash + splitOnline + splitCard + splitCheque;
      if (field === 'cash') {
        setSplitCash(currentSettled);
        setSplitOnline(0);
        setSplitCard(0);
        setSplitCheque(0);
      } else if (field === 'online') {
        setSplitCash(0);
        setSplitOnline(currentSettled);
        setSplitCard(0);
        setSplitCheque(0);
      } else if (field === 'card') {
        setSplitCash(0);
        setSplitOnline(0);
        setSplitCard(currentSettled);
        setSplitCheque(0);
      } else if (field === 'cheque') {
        if (isBtc) {
          setSplitCash(0);
          setSplitOnline(0);
          setSplitCard(0);
          setSplitCheque(currentSettled);
        }
      }
      setTimeout(() => {
        try {
          inputRef?.current?.select?.();
        } catch (e) {}
      }, 50);
    }
  };

  const quickFill = (mode) => {
    setSelectedMethod(mode);
    if (mode === 'cash') {
      setSplitCash(balanceDue);
      setSplitOnline(0);
      setSplitCard(0);
      setSplitCheque(0);
    } else if (mode === 'online') {
      setSplitCash(0);
      setSplitOnline(balanceDue);
      setSplitCard(0);
      setSplitCheque(0);
    } else if (mode === 'card') {
      setSplitCash(0);
      setSplitOnline(0);
      setSplitCard(balanceDue);
      setSplitCheque(0);
    } else if (mode === 'cheque') {
      if (!isBtc) return;
      setSplitCash(0);
      setSplitOnline(0);
      setSplitCard(0);
      setSplitCheque(balanceDue);
    }
  };

  const isCashActive = splitCash > 0 || (totalSettled === 0 && selectedMethod === 'cash');
  const isOnlineActive = splitOnline > 0 || (totalSettled === 0 && selectedMethod === 'online');
  const isCardActive = splitCard > 0 || (totalSettled === 0 && selectedMethod === 'card');
  const isChequeActive = splitCheque > 0 || (totalSettled === 0 && selectedMethod === 'cheque');

  const cardSurcharge = (splitCard > 0 && cardPct > 0) ? Math.round((splitCard * cardPct) / 100) : 0;
  const cardTotalSwipe = splitCard + cardSurcharge;
  const upiTax = (splitOnline > upiThresh && upiPct > 0) ? Math.round((splitOnline * upiPct) / 100) : 0;
  const upiTotalPay = splitOnline + upiTax;
  const totalSurcharges = cardSurcharge + upiTax;
  const totalPayingWithSurcharges = totalSettled + totalSurcharges;

  const handleExecuteCheckout = async () => {
    if (!isRefund && !isCompanyPayingLater && totalSettled < balanceDue) {
      showToast(`Please settle the full remaining balance of ${formatCurrency(balanceDue)}. Current split is ${formatCurrency(totalSettled)}.`, 'red');
      return;
    }

    if (!isRefund && !isCompanyPayingLater && totalSettled > balanceDue) {
      showToast(`Payment amount cannot exceed remaining balance of ${formatCurrency(balanceDue)}.`, 'red');
      return;
    }

    if (!isRefund && !isCompanyPayingLater && splitOnline > 0 && !onlineUtr.trim()) {
      showToast('Please enter the UTR / Transaction Reference ID for Online payment.', 'red');
      return;
    }

    if (isRefund && returnType === 'online' && !returnUtr.trim()) {
      showToast('Please enter the UPI / Online Transaction UTR Reference ID for the refund return.', 'red');
      return;
    }

    if (!isCompanyPayingLater && splitCheque > 0 && !chequeNo.trim()) {
      showToast('Please enter the Cheque Number.', 'red');
      return;
    }

    setIsSubmitting(true);
    try {
      const settleAmt = isRefund ? 0 : (isCompanyPayingLater ? 0 : totalSettled);
      const refundAmt = isRefund ? refundAmount : 0;
      const finalRecalcRoom = isEarlyCheckout
        ? (folioData.recalculatedRoomCharge || folioData.summary?.recalculatedRoomCharge || folioData.roomCharge)
        : (folioData.roomCharge || folioData.summary?.roomCharge || folioData.total_room_charge);
      const cleanReason = refundReason.trim() || (isEarlyCheckout ? `Early checkout refund: Stayed ${stayDurationStr || `${earlyStayDays}d ${earlyStayHours}h`}` : 'Early checkout excess refund');

      const payload = {
        bookingId: folioData.bookingId,
        booking_id: folioData.bookingId,
        recalculated_room_charge: isEarlyCheckout ? finalRecalcRoom : undefined,
        isEarlyCheckout,
        is_early_checkout: isEarlyCheckout,
        isRefund,
        is_refund: isRefund,
        is_btc_pending: isCompanyPayingLater,
        isBtcPending: isCompanyPayingLater,
        settle_amount: settleAmt,
        settleAmount: settleAmt,
        refund_amount: refundAmt,
        refundAmount: refundAmt,
        final_payment_mode: isRefund ? returnType : (isCompanyPayingLater ? 'btc' : 'split'),
        finalPaymentMode: isRefund ? returnType : (isCompanyPayingLater ? 'btc' : 'split'),
        return_mode: returnType,
        return_type: returnType,
        refund_mode: returnType,
        return_utr: returnUtr.trim(),
        refund_utr: returnUtr.trim(),
        refund_reason: cleanReason,
        stay_breakdown_notes: cleanReason,
        split_cash: isRefund || isCompanyPayingLater ? 0 : splitCash,
        splitCash: isRefund || isCompanyPayingLater ? 0 : splitCash,
        split_online: isRefund || isCompanyPayingLater ? 0 : splitOnline,
        splitOnline: isRefund || isCompanyPayingLater ? 0 : splitOnline,
        split_online_utr: isCompanyPayingLater ? '' : onlineUtr.trim(),
        online_utr: isRefund ? returnUtr.trim() : (isCompanyPayingLater ? '' : onlineUtr.trim()),
        utr_number: isRefund ? returnUtr.trim() : (isCompanyPayingLater ? '' : onlineUtr.trim()),
        splitCard: isRefund || isCompanyPayingLater ? 0 : splitCard,
        split_card: isRefund || isCompanyPayingLater ? 0 : splitCard,
        card_surcharge: isCompanyPayingLater ? 0 : cardSurcharge,
        final_card_surcharge: isCompanyPayingLater ? 0 : cardSurcharge,
        upi_tax: isCompanyPayingLater ? 0 : upiTax,
        final_upi_tax: isCompanyPayingLater ? 0 : upiTax,
        split_cheque: isCompanyPayingLater ? 0 : splitCheque,
        splitCheque: isCompanyPayingLater ? 0 : splitCheque,
        cheque_no: isCompanyPayingLater ? '' : chequeNo.trim(),
        bank_name: isCompanyPayingLater ? '' : chequeBank.trim(),
        checked_out_by: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk',
        checkedOutBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
      };

      const res = await api.checkout(room.id, payload);
      if (res && res.success) {
        if (isCompanyPayingLater) {
          showToast(`Room #${room.room_number} checked out under Bill to Company (Pending BTC)!`, 'green', 5000);
        } else {
          showToast(`Room #${room.room_number} checked out successfully!`, 'green', 4000);
        }

        try {
          if (isCompanyPayingLater) {
            // User requirement: if payment is pending from company then should print checkin form with all details & amount
            const regPrintData = {
              ...room,
              ...folioData,
              voucher_number: room.voucher_number || folioData.voucherNo,
              voucherNumber: room.voucher_number || folioData.voucherNo,
              guestName: folioData.guestName || room.guest_name,
              mobile: folioData.mobile || room.mobile,
              altMobile: room.alt_mobile || room.booking_alt_mobile,
              fatherName: room.father_name,
              dob: room.dob,
              address: room.address,
              email: room.email,
              aadharNumber: room.aadhar_number,
              docType: room.doc_type,
              checkinTime: folioData.checkinTime || room.checkin_time,
              approxCheckout: folioData.actualCheckout || folioData.checkoutTime || new Date(),
              stayNights: folioData.billableDays || folioData.stayNights || room.stay_nights || 1,
              bookingSource: 'BTC',
              btcCompanyName: room.btc_company_name || folioData.btcCompanyName,
              btcCompanyAddress: room.btc_address || folioData.btcCompanyAddress,
              btcCompanyGst: room.btc_gst_number || folioData.btcCompanyGst || room.gst_number,
              btcCompanyPan: room.btc_pan_number || folioData.btcCompanyPan,
              btcCompanyContactPerson: room.btc_contact_person || folioData.btcCompanyContactPerson,
              btcCompanyPhone: room.btc_contact_phone || folioData.btcCompanyPhone,
              btcCompanyEmail: room.btc_contact_email || folioData.btcCompanyEmail,
              btcApprovalRef: room.btc_approval_ref || folioData.btcApprovalRef,
              companyName: room.btc_company_name || folioData.btcCompanyName,
              gstNumber: room.btc_gst_number || folioData.gstNumber,
              roomTariffNet: folioData.roomChargesTotal || folioData.grandTariffNet || folioData.baseRoomCharge || 0,
              discountAmount: folioData.discountAmt || 0,
              discountPct: folioData.discountPct || 0,
              taxAmount: folioData.grandGstAmount || folioData.taxAmount || 0,
              foodTotal: folioData.foodTotal || 0,
              barTotal: folioData.barTotal || 0,
              extraBedCharge: folioData.extraBedsTotal || 0,
              grandTotal: folioData.finalGrandTotal || folioData.grandTotal || 0,
              totalPaid: folioData.advancePaid || 0,
              balanceDue: folioData.balanceDue || 0,
              isCompanyPayingLater: true,
              isBtcPending: true,
              checkedInBy: room.checked_in_by || 'Front Desk',
              checkedOutBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
            };
            printGuestRegistrationA4(regPrintData, { includePhotos: false });
          } else {
            // User requirement: while checking with at the spot paid 100% bill then only should print out tax invoice
            printFinalBillA4(room, folioData, {
              settleAmt: isRefund ? 0 : settleAmt,
              refundAmt: isRefund ? refundAmt : 0,
              settled_at: new Date(),
              cardSurcharge,
              upiTax,
              splitCash,
              splitOnline,
              splitCard,
              splitCheque,
              checked_out_by: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
            });
          }

          if (isRefund && refundAmt > 0) {
            const debNo = res.data?.refundVoucherNo || res.refundVoucherNo || `DEB-${Date.now().toString().slice(-4)}`;
            printPettyCashVoucher({
              voucher_no: debNo,
              created_at: new Date(),
              expense_date: new Date(),
              guest_name: folioData.guestName,
              paid_to: folioData.guestName,
              amount: refundAmt,
              payment_mode: returnType,
              category: 'refund',
              debit_account: 'Guest Refund A/c',
              description: cleanReason,
              room_number: room.room_number,
              cashier_name: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
            });
          }
        } catch (printErr) {
          console.warn('Print error during checkout settlement:', printErr);
        }

        onClose();
        if (typeof onCheckoutSuccess === 'function') {
          try {
            onCheckoutSuccess(res);
          } catch (cbErr) {
            console.warn('Error in onCheckoutSuccess callback:', cbErr);
          }
        }
      } else {
        showToast('Checkout failed: ' + (res?.message || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Checkout error: ' + err.message, 'red');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay active" id="folio-settlement-modal-overlay">
      <div className="modal-container" style={{ width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, margin: 0, border: 'none' }}>
        {/* Header with Universal Top-Left Back & Top-Right Close Buttons */}
        <div className="modal-header" style={{ padding: '16px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              type="button"
              className="universal-back-btn"
              id="btn-settle-top-back"
              onClick={onClose}
              title="Back to Room Folio"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '1.8rem' }}>💳</div>
              <div>
                <h3 id="folio-settlement-modal-title" style={{ margin: 0, fontSize: '1.45rem', fontWeight: 850, color: 'var(--text-primary)' }}>
                  Checkout &amp; Settlement — Room {room.room_number}
                </h3>
                <p id="folio-settlement-modal-subtitle" style={{ margin: '3px 0 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Guest: <strong>{folioData.guestName}</strong> • Review billing summary &amp; split payment modes
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="universal-close-btn modal-close-btn"
            onClick={onClose}
            title="Close Settlement"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '24px 36px', flex: 1, overflowY: 'auto' }}>
          {/* Status & Due Tag Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Financial Settlement Breakdown
            </span>
            <div>
              {isRefund ? (
                <span style={{ background: '#fef3c7', color: '#92400e', padding: '4px 12px', borderRadius: '12px', fontWeight: 800, fontSize: '0.8rem' }}>
                  ⚠️ Refund Due to Guest: {formatCurrency(refundAmount)}
                </span>
              ) : balanceDue === 0 ? (
                <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 12px', borderRadius: '12px', fontWeight: 800, fontSize: '0.8rem' }}>
                  ✓ Fully Paid (No Due)
                </span>
              ) : (
                <span style={{ background: '#eff6ff', color: '#1e40af', padding: '4px 12px', borderRadius: '12px', fontWeight: 800, fontSize: '0.8rem' }}>
                  Remaining Balance: {formatCurrency(balanceDue)}
                </span>
              )}
            </div>
          </div>

          {/* Grand Summary Breakdown Bar */}
          <div className="folio-settlement-summary-bar">
            <div>
              <span className="sub-label">Room Tariff:</span>
              <strong>{formatCurrency(folioData.grossTariff || 0)}</strong>
            </div>
            <div>
              <span className="sub-label">Tax (5%):</span>
              <strong>{formatCurrency(folioData.totalGst || folioData.taxAmount || folioData.summary?.taxAmount || Math.max(0, (folioData.roomCharge || 0) - (folioData.grossTariff || 0)))}</strong>
            </div>
            <div>
              <span className="sub-label">Food:</span>
              <strong>{formatCurrency(folioData.foodTotal || 0)}</strong>
            </div>
            <div>
              <span className="sub-label">Bar:</span>
              <strong>{formatCurrency(folioData.barTotal || 0)}</strong>
            </div>
            <div>
              <span className="sub-label">Advance Paid:</span>
              <strong style={{ color: 'var(--apple-green)' }}>- {formatCurrency(folioData.advancePaid || 0)}</strong>
            </div>
            <div className="final-due-col">
              <span className="sub-label">{isRefund ? 'Refund Due:' : 'Balance Due:'}</span>
              <strong style={{ fontSize: '1.45rem', color: isRefund ? '#dc2626' : 'var(--apple-blue)' }}>
                {formatCurrency(isRefund ? refundAmount : balanceDue)}
              </strong>
            </div>
          </div>

          {/* Early Checkout Dynamic Recalculation Breakdown */}
          {isEarlyCheckout && (
            <div style={{
              margin: '18px 0',
              padding: '16px 20px',
              background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
              border: '1.5px solid #86efac',
              borderRadius: '14px',
              boxShadow: '0 2px 10px rgba(22, 101, 52, 0.06)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.3rem' }}>⚡</span>
                  <strong style={{ fontSize: '1rem', color: '#166534' }}>
                    Dynamic Early Checkout Stay Recalculation
                  </strong>
                </div>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, background: '#bbf7d0', color: '#14532d', padding: '3px 10px', borderRadius: '12px' }}>
                  Stayed: {stayDurationStr || `${earlyStayDays} Days & ${earlyStayHours} Hours`} (Expected: {expectedNights} Days)
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '0.85rem' }}>
                <div style={{ background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase' }}>Completed Stay</div>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{earlyStayDays} Day(s)</strong> @ {formatCurrency(room.price || room.room_rate || 0)}/day
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase' }}>Extra Hours ({earlyStayHours}h)</div>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>+{formatCurrency(earlyExtensionCharge)}</strong>
                </div>
                <div style={{ background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase' }}>Recalculated Tariff</div>
                  <strong style={{ fontSize: '1rem', color: '#16a34a' }}>
                    {formatCurrency(folioData.recalculatedRoomCharge || folioData.summary?.recalculatedRoomCharge || folioData.roomCharge)}
                  </strong>
                  {(folioData.originalRoomCharge || folioData.summary?.originalRoomCharge) && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textDecoration: 'line-through', marginLeft: '6px' }}>
                      {formatCurrency(folioData.originalRoomCharge || folioData.summary?.originalRoomCharge)}
                    </span>
                  )}
                </div>
                {refundAmount > 0 && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '10px 14px', borderRadius: '10px', border: '1.5px solid rgba(239, 68, 68, 0.4)' }}>
                    <div style={{ fontSize: '0.74rem', color: '#ef4444', fontWeight: 800, textTransform: 'uppercase' }}>Excess Advance to Return</div>
                    <strong style={{ fontSize: '1.15rem', color: '#ef4444' }}>{formatCurrency(refundAmount)}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fully Paid Zero Balance Notice */}
          {!isRefund && balanceDue === 0 && (
            <div
              id="checkout-zero-balance-card"
              style={{
                marginTop: '22px',
                padding: '24px 28px',
                background: 'var(--bg-surface-secondary)',
                border: '1.5px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '16px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>✅</div>
              <h4 style={{ margin: '0 0 6px', fontSize: '1.22rem', fontWeight: 850, color: '#16a34a' }}>
                Room Bill Fully Paid &amp; Settled in Advance
              </h4>
              <p style={{ margin: '0 0 16px', fontSize: '0.90rem', color: 'var(--text-secondary)', fontWeight: 600, maxWidth: '580px', marginInline: 'auto' }}>
                All room tariff, food &amp; beverage orders, and applicable taxes for Room #{room.room_number} have been 100% covered by advance payments ({formatCurrency(folioData.advancePaid || 0)}). There is no outstanding balance due.
              </p>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'var(--bg-surface)',
                  padding: '10px 20px',
                  borderRadius: '12px',
                  border: '1.5px solid var(--border-color)',
                  fontSize: '0.88rem',
                  color: 'var(--text-primary)',
                  fontWeight: 750
                }}
              >
                <span>ℹ️</span> Click <strong>"Finalize Checkout &amp; Print Bill"</strong> below to complete checkout, release Room #{room.room_number}, and print the final invoice.
              </div>
            </div>
          )}

          {/* Payment Method Controls */}
          {!isRefund && balanceDue > 0 && (
            <div style={{ margin: '20px 0 14px' }}>
              {/* BTC Mode Switcher (Default: Bill to Company, with Pay Now @ Spot option) */}
              {isBtc && (
                <div style={{ marginBottom: '18px', background: 'var(--bg-surface)', border: '1.5px solid var(--border-color)', borderRadius: '12px', padding: '14px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
                    🏢 Bill To Company (BTC) Settlement Mode:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setBtcCheckoutMode('company_later');
                        setSplitCash(0);
                        setSplitOnline(0);
                        setSplitCard(0);
                        setSplitCheque(0);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: btcCheckoutMode === 'company_later' ? '2.5px solid #2563eb' : '1.5px solid var(--border-color)',
                        background: btcCheckoutMode === 'company_later' ? '#eff6ff' : 'var(--bg-card)',
                        color: btcCheckoutMode === 'company_later' ? '#1d4ed8' : 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <span style={{ fontSize: '1.5rem' }}>🏢</span>
                      <div>
                        <div style={{ fontWeight: 850, fontSize: '0.92rem' }}>
                          Company Pays Later <span style={{ fontSize: '0.72rem', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' }}>DEFAULT</span>
                        </div>
                        <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Guest pays ₹0 • Billed to company</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBtcCheckoutMode('pay_now');
                        quickFill('cash');
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: btcCheckoutMode === 'pay_now' ? '2.5px solid #16a34a' : '1.5px solid var(--border-color)',
                        background: btcCheckoutMode === 'pay_now' ? '#f0fdf4' : 'var(--bg-card)',
                        color: btcCheckoutMode === 'pay_now' ? '#15803d' : 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <span style={{ fontSize: '1.5rem' }}>💳</span>
                      <div>
                        <div style={{ fontWeight: 850, fontSize: '0.92rem' }}>Pay Now @ Spot</div>
                        <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Guest pays full balance now</div>
                      </div>
                    </button>
                  </div>

                  {btcCheckoutMode === 'company_later' ? (
                    <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#b91c1c', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.2rem' }}>📌</span>
                      <div>
                        <strong>Bill to Company (BTC):</strong> ₹0 will be collected from guest at checkout. The remaining balance of <strong>{formatCurrency(balanceDue)}</strong> will show in <strong style={{ color: '#dc2626' }}>RED as Pending BTC</strong> in Hospitality History and can be settled anytime from history when company releases payment.
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', fontSize: '0.82rem' }}>
                      ✓ Guest will pay the balance of <strong>{formatCurrency(balanceDue)}</strong> right now. Select payment method below.
                    </div>
                  )}
                </div>
              )}

              {/* Only show payment method inputs if NOT company_later */}
              {!isCompanyPayingLater && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Payment Method:
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button type="button" className="btn-quick-fill" onClick={() => quickFill('cash')}>
                        100% Cash
                      </button>
                      <button type="button" className="btn-quick-fill" onClick={() => quickFill('online')}>
                        100% UPI
                      </button>
                      <button type="button" className="btn-quick-fill" onClick={() => quickFill('card')}>
                        100% Card
                      </button>
                    </div>
                  </div>

                  <div className="unified-pay-grid">
                    {/* Cash */}
                    <div
                      className={`pay-method-box ${isCashActive ? 'active' : ''}`}
                      onClick={() => selectPaymentMethod('cash', cashInputRef)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="paybox-header">
                        <div className="paybox-icon">💵</div>
                        <div className="paybox-info">
                          <div className="paybox-name">Cash</div>
                          <div className="paybox-desc">Direct Cash</div>
                        </div>
                      </div>
                      <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
                        <span className="paybox-symbol">₹</span>
                        <input
                          ref={cashInputRef}
                          type="number"
                          className="paybox-input"
                          min={0}
                          max={balanceDue}
                          value={splitCash || ''}
                          placeholder="0"
                          onFocus={() => selectPaymentMethod('cash', cashInputRef)}
                          onChange={(e) => handleAmountChange('cash', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* UPI */}
                    <div
                      className={`pay-method-box ${isOnlineActive ? 'active' : ''}`}
                      onClick={() => selectPaymentMethod('online', onlineInputRef)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="paybox-header">
                        <div className="paybox-icon">📱</div>
                        <div className="paybox-info">
                          <div className="paybox-name">UPI / Online</div>
                          <div className="paybox-desc">GPay, PhonePe, QR</div>
                        </div>
                      </div>
                      <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
                        <span className="paybox-symbol">₹</span>
                        <input
                          ref={onlineInputRef}
                          type="number"
                          className="paybox-input"
                          min={0}
                          max={balanceDue}
                          value={splitOnline || ''}
                          placeholder="0"
                          onFocus={() => selectPaymentMethod('online', onlineInputRef)}
                          onChange={(e) => handleAmountChange('online', e.target.value)}
                        />
                      </div>
                      {splitOnline > upiThresh && upiPct > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#0369a1', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                          + {upiPct}% Tax: ₹{upiTax} (Pay: ₹{upiTotalPay})
                        </div>
                      )}
                      {splitOnline > 0 && (splitOnline <= upiThresh || upiPct === 0) && (
                        <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                          ✓ 0% Tax (UPI ≤ ₹{upiThresh.toLocaleString('en-IN')})
                        </div>
                      )}
                    </div>

                    {/* Card */}
                    <div
                      className={`pay-method-box ${isCardActive ? 'active' : ''}`}
                      onClick={() => selectPaymentMethod('card', cardInputRef)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="paybox-header">
                        <div className="paybox-icon">💳</div>
                        <div className="paybox-info">
                          <div className="paybox-name">Card POS</div>
                          <div className="paybox-desc">Debit / Credit POS</div>
                        </div>
                      </div>
                      <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
                        <span className="paybox-symbol">₹</span>
                        <input
                          ref={cardInputRef}
                          type="number"
                          className="paybox-input"
                          min={0}
                          max={balanceDue}
                          value={splitCard || ''}
                          placeholder="0"
                          onFocus={() => selectPaymentMethod('card', cardInputRef)}
                          onChange={(e) => handleAmountChange('card', e.target.value)}
                        />
                      </div>
                      {splitCard > 0 && cardPct > 0 && (
                        <div style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                          + {cardPct}% Fee: ₹{cardSurcharge} (Swipe: ₹{cardTotalSwipe})
                        </div>
                      )}
                      {splitCard > 0 && cardPct === 0 && (
                        <div style={{ fontSize: '0.70rem', color: '#16a34a', fontWeight: 750, marginTop: '4px', textAlign: 'right' }}>
                          ✓ 0% Card Surcharge
                        </div>
                      )}
                    </div>

                    {/* Cheque (ONLY FOR BTC BOOKINGS) */}
                    {isBtc && (
                      <div
                        className={`pay-method-box ${isChequeActive ? 'active' : ''}`}
                        onClick={() => selectPaymentMethod('cheque', chequeInputRef)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="paybox-header">
                          <div className="paybox-icon">🏛️</div>
                          <div className="paybox-info">
                            <div className="paybox-name">Cheque</div>
                            <div className="paybox-desc">Company / Bank Cheque</div>
                          </div>
                        </div>
                        <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
                          <span className="paybox-symbol">₹</span>
                          <input
                            ref={chequeInputRef}
                            type="number"
                            className="paybox-input"
                            min={0}
                            max={balanceDue}
                            value={splitCheque || ''}
                            placeholder="0"
                            onFocus={() => selectPaymentMethod('cheque', chequeInputRef)}
                            onChange={(e) => handleAmountChange('cheque', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mandatory Online Payment UTR / Ref ID Panel */}
                  {splitOnline > 0 && (
                    <div
                      id="checkout-online-utr-panel"
                      style={{
                        marginTop: '14px',
                        padding: '14px 18px',
                        background: 'var(--bg-surface-secondary)',
                        border: '1.5px solid var(--apple-blue)',
                        borderRadius: '12px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 850, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>📱</span> Online / UPI Transaction UTR Reference ID <span style={{ color: '#ef4444' }}>* (Mandatory)</span>
                        </label>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, background: 'rgba(56, 189, 248, 0.16)', color: 'var(--apple-blue)', padding: '2px 8px', borderRadius: '8px' }}>
                          Required for ₹{splitOnline.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter 12-digit UTR No. / Transaction Ref ID (e.g. 423589123456)"
                        value={onlineUtr}
                        onChange={(e) => setOnlineUtr(e.target.value)}
                        style={{
                          height: '42px',
                          background: 'var(--bg-app)',
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          border: !onlineUtr.trim() ? '2px solid #ef4444' : '1.5px solid var(--apple-blue)',
                          color: 'var(--text-primary)'
                        }}
                        required
                      />
                      {!onlineUtr.trim() && (
                        <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 700, marginTop: '5px' }}>
                          ⚠️ UTR ID is mandatory to confirm online payment settlement before checkout.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cheque Realization Panel */}
                  {splitCheque > 0 && (
                    <div
                      id="checkout-cheque-panel"
                      style={{
                        marginTop: '14px',
                        padding: '14px 18px',
                        background: 'var(--bg-surface-secondary)',
                        border: '1.5px solid var(--border-color)',
                        borderRadius: '12px'
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
                        <span>📑</span> Cheque Realization Details *
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.76rem', fontWeight: 750, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                            Cheque Number *
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. 000412"
                            value={chequeNo}
                            onChange={(e) => setChequeNo(e.target.value)}
                            style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                            required
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '0.76rem', fontWeight: 750, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                            Bank Name &amp; Branch *
                          </label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. SBI, Solapur"
                            value={chequeBank}
                            onChange={(e) => setChequeBank(e.target.value)}
                            style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Real-time Status */}
                  <div
                    className="balance-alert"
                    style={{
                      marginTop: '12px',
                      background: remainingSettle === 0 ? '#dcfce7' : '#fef2f2',
                      color: remainingSettle === 0 ? '#166534' : '#dc2626',
                      border: remainingSettle === 0 ? '1px solid #bbf7d0' : '1.5px solid #fca5a5',
                      fontWeight: 850
                    }}
                  >
                    {remainingSettle === 0
                      ? `✓ Settle Split Matches Balance: ${formatCurrency(totalSettled)}${totalSurcharges > 0 ? ` (Total Collect incl. Surcharges/Tax: ${formatCurrency(totalPayingWithSurcharges)})` : ''}`
                      : `Remaining to allocate: ${formatCurrency(remainingSettle)}`}
                  </div>
                </>
              )}
            </div>
          )}

          {isRefund && refundAmount > 0 && (
            <div style={{ marginTop: '20px', padding: '20px 24px', background: 'var(--bg-surface-secondary)', border: '2px solid rgba(239, 68, 68, 0.4)', borderRadius: '16px', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.95rem', fontWeight: 850, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    <span>💸</span> Select Return Type (Refund Payment Mode) *
                  </label>
                  <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    Choose how the excess advance of <strong>{formatCurrency(refundAmount)}</strong> will be returned to the guest:
                  </p>
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: 850, padding: '4px 12px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.35)' }}>
                  Total to Return: {formatCurrency(refundAmount)}
                </span>
              </div>

              {/* 3 Return Type options */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                {/* Cash */}
                <div
                  id="btn-return-type-cash"
                  onClick={() => setReturnType('cash')}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    border: returnType === 'cash' ? '2.5px solid #16a34a' : '1.5px solid var(--border-color)',
                    background: returnType === 'cash' ? 'rgba(34, 197, 94, 0.12)' : 'var(--bg-surface)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <span style={{ fontSize: '1.8rem' }}>💵</span>
                  <div>
                    <div style={{ fontWeight: 850, fontSize: '0.95rem', color: returnType === 'cash' ? '#16a34a' : 'var(--text-primary)' }}>Cash Return</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Front Desk Cash Payout</div>
                  </div>
                </div>

                {/* Online / UPI */}
                <div
                  id="btn-return-type-online"
                  onClick={() => setReturnType('online')}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    border: returnType === 'online' ? '2.5px solid var(--apple-blue)' : '1.5px solid var(--border-color)',
                    background: returnType === 'online' ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-surface)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <span style={{ fontSize: '1.8rem' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 850, fontSize: '0.95rem', color: returnType === 'online' ? 'var(--apple-blue)' : 'var(--text-primary)' }}>UPI / Online Return</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>GPay, PhonePe, NEFT</div>
                  </div>
                </div>

                {/* Card POS */}
                <div
                  id="btn-return-type-card"
                  onClick={() => setReturnType('card')}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    border: returnType === 'card' ? '2.5px solid #f59e0b' : '1.5px solid var(--border-color)',
                    background: returnType === 'card' ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-surface)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <span style={{ fontSize: '1.8rem' }}>💳</span>
                  <div>
                    <div style={{ fontWeight: 850, fontSize: '0.95rem', color: returnType === 'card' ? '#f59e0b' : 'var(--text-primary)' }}>Card POS Refund</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Debit / Credit Refund</div>
                  </div>
                </div>
              </div>

              {/* If Online / UPI Return: Mandatory UTR field */}
              {returnType === 'online' && (
                <div style={{ marginTop: '14px', padding: '14px 16px', background: 'var(--bg-surface)', border: '1.5px solid var(--apple-blue)', borderRadius: '12px' }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                    UPI / Bank Transfer UTR Reference ID * (Mandatory for Online Return)
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter 12-digit UPI / IMPS UTR Reference No."
                    value={returnUtr}
                    onChange={(e) => setReturnUtr(e.target.value)}
                    style={{ height: '40px', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 700, border: !returnUtr.trim() ? '2px solid #ef4444' : '1.5px solid var(--apple-blue)' }}
                    required
                  />
                  {!returnUtr.trim() && (
                    <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 700, marginTop: '4px' }}>
                      ⚠️ Please enter the transaction UTR number of the online refund transfer.
                    </div>
                  )}
                </div>
              )}

              {/* Refund Reason / Note */}
              <div style={{ marginTop: '14px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Refund Reason / Stay Adjustment Notes:
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Early checkout refund: Stayed 2 days, 3 hrs instead of 3 days"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Debit voucher info */}
              <div style={{ marginTop: '14px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', fontSize: '0.82rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>📜</span>
                <span>
                  An official debit voucher (<strong>DEB-xxx</strong>) will be recorded in <strong>Guest Refund A/c</strong> and displayed as a debit row in <strong>Hospitality Stay History &amp; Payments</strong>.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ padding: '16px 26px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {isCompanyPayingLater ? (
            <button
              type="button"
              className="filter-chip"
              onClick={() => {
                const regPrintData = {
                  ...room,
                  ...folioData,
                  voucher_number: room.voucher_number || folioData.voucherNo,
                  guestName: folioData.guestName || room.guest_name,
                  mobile: folioData.mobile || room.mobile,
                  altMobile: room.alt_mobile || room.booking_alt_mobile,
                  fatherName: room.father_name,
                  dob: room.dob,
                  address: room.address,
                  email: room.email,
                  aadharNumber: room.aadhar_number,
                  docType: room.doc_type,
                  checkinTime: folioData.checkinTime || room.checkin_time,
                  approxCheckout: folioData.actualCheckout || folioData.checkoutTime || new Date(),
                  stayNights: folioData.billableDays || folioData.stayNights || room.stay_nights || 1,
                  bookingSource: 'BTC',
                  btcCompanyName: room.btc_company_name || folioData.btcCompanyName,
                  btcCompanyAddress: room.btc_address || folioData.btcCompanyAddress,
                  btcCompanyGst: room.btc_gst_number || folioData.btcCompanyGst || room.gst_number,
                  btcCompanyPan: room.btc_pan_number || folioData.btcCompanyPan,
                  btcCompanyContactPerson: room.btc_contact_person || folioData.btcCompanyContactPerson,
                  btcCompanyPhone: room.btc_contact_phone || folioData.btcCompanyPhone,
                  btcCompanyEmail: room.btc_contact_email || folioData.btcCompanyEmail,
                  btcApprovalRef: room.btc_approval_ref || folioData.btcApprovalRef,
                  companyName: room.btc_company_name || folioData.btcCompanyName,
                  gstNumber: room.btc_gst_number || folioData.gstNumber,
                  roomTariffNet: folioData.roomChargesTotal || folioData.grandTariffNet || folioData.baseRoomCharge || 0,
                  discountAmount: folioData.discountAmt || 0,
                  discountPct: folioData.discountPct || 0,
                  taxAmount: folioData.grandGstAmount || folioData.taxAmount || 0,
                  foodTotal: folioData.foodTotal || 0,
                  barTotal: folioData.barTotal || 0,
                  extraBedCharge: folioData.extraBedsTotal || 0,
                  grandTotal: folioData.finalGrandTotal || folioData.grandTotal || 0,
                  totalPaid: folioData.advancePaid || 0,
                  balanceDue: folioData.balanceDue || 0,
                  isCompanyPayingLater: true,
                  isBtcPending: true,
                  checkedInBy: room.checked_in_by || 'Front Desk',
                  checkedOutBy: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
                };
                printGuestRegistrationA4(regPrintData, { includePhotos: false });
              }}
              style={{ fontWeight: 800, padding: '9px 16px', fontSize: '0.88rem', background: '#faf5ff', color: '#6b21a8', border: '1.5px solid #d8b4fe' }}
              title="Print Check-in / Registration Form with complete corporate BTC details and amount"
            >
              📄 Print Check-in Form (Details &amp; Amount)
            </button>
          ) : (
            <button
              type="button"
              className="filter-chip"
              onClick={() => {
                printFinalBillA4(room, folioData, {
                  settleAmt: isRefund ? 0 : (isCompanyPayingLater ? 0 : totalSettled),
                  refundAmt: isRefund ? refundAmount : 0,
                  settled_at: new Date(),
                  cardSurcharge,
                  upiTax,
                  splitCash,
                  splitOnline,
                  splitCard,
                  splitCheque,
                  checked_out_by: currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'
                });
              }}
              style={{ fontWeight: 800, padding: '9px 16px', fontSize: '0.88rem', background: 'var(--bg-surface)', color: 'var(--apple-blue)', border: '1.5px solid var(--apple-blue)' }}
              title="Preview or print official colorful A4 Tax Invoice with background logo"
            >
              🧾 Print Tax Invoice (A4)
            </button>
          )}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" className="btn-custom-cancel" onClick={onClose} style={{ padding: '10px 22px', fontSize: '0.92rem' }}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-scan-action"
              onClick={handleExecuteCheckout}
              disabled={isSubmitting}
              style={{
                padding: '10px 28px',
                fontSize: '1rem',
                fontWeight: 800,
                borderRadius: 'var(--radius-md)',
                background: isCompanyPayingLater ? '#2563eb' : undefined
              }}
            >
              🖨️ {isSubmitting
                ? 'Finalizing...'
                : (isCompanyPayingLater ? 'Checkout (Pending BTC — ₹0 Paid)' : 'Finalize Checkout & Print Bill')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
