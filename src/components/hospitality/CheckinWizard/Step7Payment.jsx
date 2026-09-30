import React, { useRef, useState } from 'react';
import { formatCurrency } from '../../../utils/formatters';
import { useApp } from '../../../context/AppContext';
import ThemedDatePicker from '../../common/ThemedDatePicker';

export default function Step7Payment({
  draft,
  updateDraft,
  totalDue,
  onPreviewDoc,
  onSubmitCheckin,
  onPrev,
  isSubmitting = false
}) {
  const cashInputRef = useRef(null);
  const onlineInputRef = useRef(null);
  const cardInputRef = useRef(null);
  const chequeInputRef = useRef(null);
  const chequeFileInputRef = useRef(null);

  const splitCash = Number(draft.splitCash) || 0;
  const splitOnline = Number(draft.splitOnline) || 0;
  const splitCard = Number(draft.splitCard) || 0;
  const splitCheque = Number(draft.splitCheque) || 0;

  const totalPaid = splitCash + splitOnline + splitCard + splitCheque;
  const balanceDue = Math.max(0, totalDue - totalPaid);

  const bookingSource = String(draft?.bookingSource || draft?.booking_source || '').toUpperCase();
  const isBtc = bookingSource === 'BTC';
  const isOta = bookingSource === 'OTA';
  const isPrepaid = Boolean(
    draft?.isPrepaid === true ||
    draft?.isPrepaid === 1 ||
    draft?.isPrepaid === '1' ||
    draft?.rateType === 'prepaid' ||
    draft?.rate_type === 'prepaid' ||
    draft?.otaIsPrepaid === true
  );
  const isOtaPrepaid = isOta && isPrepaid;
  const isPrepaidZeroExtras = isOtaPrepaid && totalDue === 0;

  const [selectedMethod, setSelectedMethod] = useState(() => {
    if (splitOnline > 0) return 'splitOnline';
    if (splitCard > 0) return 'splitCard';
    if (splitCheque > 0 && isBtc) return 'splitCheque';
    return 'splitCash';
  });

  // Split payment enabled: allows concurrent amounts across Cash, Online, Card, and Cheque (BTC only)
  const handleAmountChange = (field, value) => {
    if (field === 'splitCheque' && !isBtc) return;
    setSelectedMethod(field);
    let val = Math.max(0, Number(value) || 0);

    const otherPayments =
      (field === 'splitCash' ? 0 : splitCash) +
      (field === 'splitOnline' ? 0 : splitOnline) +
      (field === 'splitCard' ? 0 : splitCard) +
      (field === 'splitCheque' ? 0 : splitCheque);

    if (totalDue > 0 && (otherPayments + val) > totalDue) {
      val = Math.max(0, totalDue - otherPayments);
    }

    updateDraft({
      [field]: val
    });
  };

  // Allows clicking anywhere on the div card to focus that payment method without zeroing out others
  const selectPaymentMethod = (field, inputRef) => {
    if (field === 'splitCheque' && !isBtc) return;
    setSelectedMethod(field);
    if (inputRef && inputRef.current) {
      inputRef.current.focus();
    }
  };

  const fillRemaining = (field, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (field === 'splitCheque' && !isBtc) return;
    setSelectedMethod(field);
    const otherPayments =
      (field === 'splitCash' ? 0 : splitCash) +
      (field === 'splitOnline' ? 0 : splitOnline) +
      (field === 'splitCard' ? 0 : splitCard) +
      (field === 'splitCheque' ? 0 : splitCheque);
    const rem = Math.max(0, totalDue - otherPayments);
    updateDraft({
      [field]: rem
    });
  };

  React.useEffect(() => {
    if (!isBtc && splitCheque > 0) {
      updateDraft({
        splitCheque: 0,
        chequeNo: '',
        chequeBank: '',
        chequeDate: '',
        chequeScan: null
      });
      if (selectedMethod === 'splitCheque') {
        setSelectedMethod('splitCash');
      }
    }
  }, [isBtc, splitCheque]);

  const isCashActive = splitCash > 0 || (totalPaid === 0 && selectedMethod === 'splitCash');
  const isOnlineActive = splitOnline > 0 || (totalPaid === 0 && selectedMethod === 'splitOnline');
  const isCardActive = splitCard > 0 || (totalPaid === 0 && selectedMethod === 'splitCard');
  const isChequeActive = isBtc && (splitCheque > 0 || (totalPaid === 0 && selectedMethod === 'splitCheque'));
  const activeMethodsCount = [splitCash > 0, splitOnline > 0, splitCard > 0, (isBtc && splitCheque > 0)].filter(Boolean).length;

  const handleChequeUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateDraft({ chequeScan: ev.target.result });
    };
    reader.readAsDataURL(file);
  };

  const { surchargeSettings, minCheckinAdvancePct } = useApp();
  const cardPct = surchargeSettings?.card_surcharge_pct !== undefined ? Number(surchargeSettings.card_surcharge_pct) : 2.5;
  const upiPct = surchargeSettings?.upi_tax_pct !== undefined ? Number(surchargeSettings.upi_tax_pct) : 0.4;
  const upiThresh = surchargeSettings?.upi_tax_threshold !== undefined ? Number(surchargeSettings.upi_tax_threshold) : 2000;

  const minAdvancePct = Number(minCheckinAdvancePct !== undefined ? minCheckinAdvancePct : 50);
  const isMinAdvanceEnforced = !isBtc && !isOtaPrepaid && minAdvancePct > 0 && totalDue > 0;
  const minRequiredAdvance = isMinAdvanceEnforced ? Math.ceil((totalDue * minAdvancePct) / 100) : 0;
  const isAdvanceSufficient = !isMinAdvanceEnforced || totalPaid >= minRequiredAdvance;

  // Dynamic card surcharge preview
  const cardSurcharge = (splitCard > 0 && cardPct > 0) ? Math.round((splitCard * cardPct) / 100) : 0;
  const cardTotalSwipe = splitCard + cardSurcharge;

  // Dynamic UPI tax preview (only for UPI > threshold)
  const upiTax = (splitOnline > upiThresh && upiPct > 0) ? Math.round((splitOnline * upiPct) / 100) : 0;
  const upiTotalPay = splitOnline + upiTax;

  const totalExtraFees = cardSurcharge + upiTax;
  const totalCollectFromGuest = totalPaid + totalExtraFees;

  const otaVoucherTotal = Number(draft.otaManualAmount || draft.otaBillAmount || 0);

  return (
    <div className="checkin-step-content" id="checkin-step-7">
      <h2 className="checkin-step-heading">Payment &amp; Advance Collection</h2>

      <div className="payment-step-container">
        {/* Dedicated Prepaid Booking Status Card when no extra person/mattress added */}
        {isPrepaidZeroExtras && (
          <div
            id="checkin-prepaid-status-card"
            style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(16, 185, 129, 0.14) 100%)',
              border: '2px solid #22c55e',
              borderRadius: '16px',
              padding: '22px 26px',
              marginBottom: '18px',
              boxShadow: '0 4px 16px rgba(34, 197, 94, 0.14)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', color: '#ffffff', boxShadow: '0 2px 8px rgba(22, 163, 74, 0.35)' }}>
                  ✓
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', letterSpacing: '-0.01em' }}>
                      PREPAID BOOKING
                    </span>
                    <span style={{ background: '#dcfce7', color: '#166534', border: '1.5px solid #86efac', padding: '2px 10px', borderRadius: '12px', fontSize: '0.80rem', fontWeight: 800 }}>
                      {draft.otaPlatform || 'OTA Channel'}
                    </span>
                    <span style={{ background: '#bbf7d0', color: '#14532d', padding: '2px 8px', borderRadius: '8px', fontSize: '0.74rem', fontWeight: 800 }}>
                      100% Voucher Covered
                    </span>
                  </div>
                  <div style={{ fontSize: '0.88rem', color: '#166534', fontWeight: 650, marginTop: '3px' }}>
                    Entire stay room tariff is fully pre-paid. No extra person or mattress added — <strong>₹0.00 advance required at front desk</strong>.
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Desk Collection</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#15803d' }}>₹0.00</div>
              </div>
            </div>

            {/* Itemized Snapshot */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={{ background: 'var(--bg-surface, #ffffff)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 750, textTransform: 'uppercase' }}>Voucher / Booking ID</div>
                <strong style={{ fontSize: '0.98rem', color: 'var(--text-primary)' }}>{draft.otaVoucherNo || draft.ota_booking_id || 'N/A'}</strong>
              </div>
              <div style={{ background: 'var(--bg-surface, #ffffff)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 750, textTransform: 'uppercase' }}>Pre-Paid Voucher Amount</div>
                <strong style={{ fontSize: '1.05rem', color: '#15803d' }}>{formatCurrency(otaVoucherTotal)}</strong>
              </div>
              <div style={{ background: 'var(--bg-surface, #ffffff)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 750, textTransform: 'uppercase' }}>Extra Person / Mattress</div>
                <strong style={{ fontSize: '0.95rem', color: '#16a34a' }}>None Added (₹0.00)</strong>
              </div>
              <div style={{ background: 'var(--bg-surface, #ffffff)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 750, textTransform: 'uppercase' }}>Payment Mode</div>
                <strong style={{ fontSize: '0.95rem', color: '#15803d' }}>PREPAID (Voucher)</strong>
              </div>
            </div>

            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed rgba(34, 197, 94, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '0.84rem', color: '#166534', fontWeight: 700 }}>
              <span>👉 Click <strong>"Complete Check-In (Pre-Paid) &amp; Print Reg Card"</strong> below to check in the guest directly.</span>
              <span style={{ background: 'rgba(34, 197, 94, 0.2)', padding: '3px 10px', borderRadius: '10px' }}>✓ Ready for Instant Check-In</span>
            </div>
          </div>
        )}

        {/* Prepaid Banner when extra person/mattress IS added */}
        {isOtaPrepaid && !isPrepaidZeroExtras && (
          <div
            id="checkin-prepaid-extras-banner"
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              border: '1.5px solid #eab308',
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>ℹ️</span>
                <strong style={{ fontSize: '0.95rem', color: '#854d0e' }}>
                  Pre-Paid OTA Stay ({draft.otaPlatform || 'OTA Channel'}) — Extras Added
                </strong>
                <span style={{ background: '#fef08a', color: '#713f12', padding: '2px 8px', borderRadius: '8px', fontSize: '0.72rem', fontWeight: 800 }}>
                  Voucher: {formatCurrency(otaVoucherTotal)}
                </span>
              </div>
              <div style={{ fontSize: '0.84rem', color: '#854d0e', marginTop: '2px' }}>
                Room tariff is pre-paid. Please collect <strong>{formatCurrency(totalDue)}</strong> at desk for extra person/mattress or early check-in.
              </div>
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 850, color: '#854d0e' }}>
              Desk Due: <strong>{formatCurrency(totalDue)}</strong>
            </div>
          </div>
        )}

        {/* Check-In Advance Payment Policy Status Banner */}
        {isMinAdvanceEnforced && (
          <div
            id="checkin-advance-policy-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 16px',
              borderRadius: '10px',
              marginBottom: '14px',
              background: isAdvanceSufficient ? 'rgba(34, 197, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              border: `1.5px solid ${isAdvanceSufficient ? 'rgba(34, 197, 94, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
              color: isAdvanceSufficient ? '#16a34a' : '#d97706',
              fontSize: '0.84rem',
              fontWeight: 750
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.1rem' }}>{isAdvanceSufficient ? '✓' : '⚠️'}</span>
              <span>
                <strong>Check-In Advance Policy ({minAdvancePct}%):</strong> Minimum required advance payment at check-in is{' '}
                <strong>₹{minRequiredAdvance.toLocaleString('en-IN')}</strong> of total ₹{totalDue.toLocaleString('en-IN')}.
              </span>
            </div>
            <div style={{ whiteSpace: 'nowrap' }}>
              {isAdvanceSufficient ? (
                <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#16a34a', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 800 }}>
                  ✓ Policy Satisfied
                </span>
              ) : (
                <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#dc2626', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 800 }}>
                  Needs ₹{(minRequiredAdvance - totalPaid).toLocaleString('en-IN')} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Quick Fill & Mode Selector Header (Hidden when prepaid and 0 extras) */}
        {!isPrepaidZeroExtras && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Payment Method:
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {isMinAdvanceEnforced && minAdvancePct < 100 && minRequiredAdvance > 0 && (
                <>
                  <button
                    type="button"
                    className="btn-quick-fill"
                    onClick={() => {
                      updateDraft({ splitCash: minRequiredAdvance, splitOnline: 0, splitCard: 0, splitCheque: 0 });
                      setSelectedMethod('splitCash');
                    }}
                    title={`Pay minimum required advance (${minAdvancePct}%) in Cash`}
                  >
                    {minAdvancePct}% Min (Cash)
                  </button>
                  <button
                    type="button"
                    className="btn-quick-fill"
                    onClick={() => {
                      updateDraft({ splitCash: 0, splitOnline: minRequiredAdvance, splitCard: 0, splitCheque: 0 });
                      setSelectedMethod('splitOnline');
                    }}
                    title={`Pay minimum required advance (${minAdvancePct}%) via UPI`}
                  >
                    {minAdvancePct}% Min (UPI)
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-quick-fill"
                onClick={() => {
                  updateDraft({ splitCash: totalDue, splitOnline: 0, splitCard: 0, splitCheque: 0 });
                  setSelectedMethod('splitCash');
                }}
              >
                100% Cash
              </button>
              <button
                type="button"
                className="btn-quick-fill"
                onClick={() => {
                  updateDraft({ splitCash: 0, splitOnline: totalDue, splitCard: 0, splitCheque: 0 });
                  setSelectedMethod('splitOnline');
                }}
              >
                100% UPI
              </button>
              <button
                type="button"
                className="btn-quick-fill"
                onClick={() => {
                  updateDraft({ splitCash: 0, splitOnline: 0, splitCard: totalDue, splitCheque: 0 });
                  setSelectedMethod('splitCard');
                }}
              >
                100% Card
              </button>
              {totalPaid > 0 && (
                <button
                  type="button"
                  className="btn-quick-fill"
                  onClick={() => {
                    updateDraft({ splitCash: 0, splitOnline: 0, splitCard: 0, splitCheque: 0, onlineUtr: '' });
                  }}
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Unified Multi-Mode Payment Grid (Only when totalDue > 0 or not prepaid zero extras) */}
        {!isPrepaidZeroExtras && (
        <div
          className="unified-pay-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '14px',
            marginBottom: '16px'
          }}
        >
          {/* Cash */}
          <div
            className={`pay-method-box ${isCashActive ? 'active' : ''}`}
            id="paybox-cash"
            onClick={() => selectPaymentMethod('splitCash', cashInputRef)}
            style={{ cursor: 'pointer' }}
          >
            <div className="paybox-header">
              <div className="paybox-icon">💵</div>
              <div className="paybox-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div>
                  <div className="paybox-name">Cash</div>
                  <div className="paybox-desc">Direct Cash Collection</div>
                </div>
                {balanceDue > 0 && splitCash < totalDue && (
                  <button
                    type="button"
                    onClick={(e) => fillRemaining('splitCash', e)}
                    style={{ fontSize: '0.72rem', padding: '2px 7px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 800, cursor: 'pointer' }}
                    title="Fill remaining balance into Cash"
                  >
                    + Fill ₹{balanceDue}
                  </button>
                )}
              </div>
            </div>
            <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
              <span className="paybox-symbol">₹</span>
              <input
                ref={cashInputRef}
                type="number"
                className="paybox-input"
                min={0}
                max={totalDue}
                value={splitCash || ''}
                placeholder="0"
                onFocus={() => selectPaymentMethod('splitCash', cashInputRef)}
                onChange={(e) => handleAmountChange('splitCash', e.target.value)}
              />
            </div>
          </div>

          {/* UPI */}
          <div
            className={`pay-method-box ${isOnlineActive ? 'active' : ''}`}
            id="paybox-online"
            onClick={() => selectPaymentMethod('splitOnline', onlineInputRef)}
            style={{ cursor: 'pointer' }}
          >
            <div className="paybox-header">
              <div className="paybox-icon">📱</div>
              <div className="paybox-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div>
                  <div className="paybox-name">UPI / Online</div>
                  <div className="paybox-desc">GPay, PhonePe, QR</div>
                </div>
                {balanceDue > 0 && splitOnline < totalDue && (
                  <button
                    type="button"
                    onClick={(e) => fillRemaining('splitOnline', e)}
                    style={{ fontSize: '0.72rem', padding: '2px 7px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 800, cursor: 'pointer' }}
                    title="Fill remaining balance into UPI"
                  >
                    + Fill ₹{balanceDue}
                  </button>
                )}
              </div>
            </div>
            <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
              <span className="paybox-symbol">₹</span>
              <input
                ref={onlineInputRef}
                type="number"
                className="paybox-input"
                min={0}
                max={totalDue}
                value={splitOnline || ''}
                placeholder="0"
                onFocus={() => selectPaymentMethod('splitOnline', onlineInputRef)}
                onChange={(e) => handleAmountChange('splitOnline', e.target.value)}
              />
            </div>
            {splitOnline > upiThresh && upiPct > 0 && (
              <div style={{ fontSize: '0.78rem', color: '#0369a1', fontWeight: 800, marginTop: '4px', textAlign: 'right' }}>
                Collect: <strong style={{ fontSize: '0.88rem', color: '#075985' }}>₹{upiTotalPay.toLocaleString('en-IN')}</strong> (₹{splitOnline.toLocaleString('en-IN')} + ₹{upiTax} Fee [{upiPct}%])
              </div>
            )}
            {splitOnline > 0 && (splitOnline <= upiThresh || upiPct === 0) && (
              <div style={{ fontSize: '0.70rem', color: '#15803d', fontWeight: 700, marginTop: '4px', textAlign: 'right' }}>
                ✓ 0% Tax (UPI ≤ ₹{upiThresh.toLocaleString('en-IN')})
              </div>
            )}
          </div>

          {/* Card */}
          <div
            className={`pay-method-box ${isCardActive ? 'active' : ''}`}
            id="paybox-card"
            onClick={() => selectPaymentMethod('splitCard', cardInputRef)}
            style={{ cursor: 'pointer' }}
          >
            <div className="paybox-header">
              <div className="paybox-icon">💳</div>
              <div className="paybox-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div>
                  <div className="paybox-name">Card</div>
                  <div className="paybox-desc">Debit / Credit POS</div>
                </div>
                {balanceDue > 0 && splitCard < totalDue && (
                  <button
                    type="button"
                    onClick={(e) => fillRemaining('splitCard', e)}
                    style={{ fontSize: '0.72rem', padding: '2px 7px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '6px', fontWeight: 800, cursor: 'pointer' }}
                    title="Fill remaining balance into Card"
                  >
                    + Fill ₹{balanceDue}
                  </button>
                )}
              </div>
            </div>
            <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
              <span className="paybox-symbol">₹</span>
              <input
                ref={cardInputRef}
                type="number"
                className="paybox-input"
                min={0}
                max={totalDue}
                value={splitCard || ''}
                placeholder="0"
                onFocus={() => selectPaymentMethod('splitCard', cardInputRef)}
                onChange={(e) => handleAmountChange('splitCard', e.target.value)}
              />
            </div>
            {splitCard > 0 && cardPct > 0 && (
              <div style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 800, marginTop: '4px', textAlign: 'right' }}>
                Swipe: <strong style={{ fontSize: '0.88rem', color: '#78350f' }}>₹{cardTotalSwipe.toLocaleString('en-IN')}</strong> (₹{splitCard.toLocaleString('en-IN')} + ₹{cardSurcharge} Fee [{cardPct}%])
              </div>
            )}
            {splitCard > 0 && cardPct === 0 && (
              <div style={{ fontSize: '0.70rem', color: '#15803d', fontWeight: 700, marginTop: '4px', textAlign: 'right' }}>
                ✓ 0% Card Surcharge
              </div>
            )}
          </div>

          {/* Cheque (ONLY FOR BTC BOOKINGS) */}
          {isBtc && (
            <div
              className={`pay-method-box ${isChequeActive ? 'active' : ''}`}
              id="paybox-cheque"
              onClick={() => selectPaymentMethod('splitCheque', chequeInputRef)}
              style={{ cursor: 'pointer' }}
            >
              <div className="paybox-header">
                <div className="paybox-icon">📑</div>
                <div className="paybox-info">
                  <div className="paybox-name">Cheque</div>
                  <div className="paybox-desc">Corporate BTC Only</div>
                </div>
              </div>
              <div className="paybox-input-group" onClick={(e) => e.stopPropagation()}>
                <span className="paybox-symbol">₹</span>
                <input
                  ref={chequeInputRef}
                  type="number"
                  className="paybox-input"
                  min={0}
                  max={totalDue}
                  value={splitCheque || ''}
                  placeholder="0"
                  onFocus={() => selectPaymentMethod('splitCheque', chequeInputRef)}
                  onChange={(e) => handleAmountChange('splitCheque', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
        )}

        {/* Mandatory Online Payment UTR / Ref ID Panel */}
        {splitOnline > 0 && (
          <div
            id="checkin-online-utr-panel"
            style={{
              background: 'var(--bg-surface-secondary)',
              border: '1.5px solid var(--apple-blue)',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '16px',
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
              value={draft.onlineUtr || draft.utrNumber || ''}
              onChange={(e) => updateDraft({ onlineUtr: e.target.value, utrNumber: e.target.value })}
              style={{
                height: '42px',
                background: 'var(--bg-app)',
                fontSize: '0.95rem',
                fontWeight: 700,
                border: !(draft.onlineUtr || draft.utrNumber)?.trim() ? '2px solid #ef4444' : '1.5px solid var(--apple-blue)',
                color: 'var(--text-primary)'
              }}
              required
            />
            {!(draft.onlineUtr || draft.utrNumber)?.trim() && (
              <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 700, marginTop: '5px' }}>
                ⚠️ UTR ID is mandatory to confirm online payment collection before check-in.
              </div>
            )}
          </div>
        )}

        {/* Cheque Details Sub-Form */}
        {splitCheque > 0 && (
          <div
            id="checkin-cheque-details-panel"
            style={{
              background: 'var(--bg-surface-secondary)',
              border: '1.5px solid var(--border-color)',
              borderRadius: '12px',
              padding: '14px 16px',
              marginTop: '14px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📑</span> Cheque Realization Details *
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 750, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                ⏳ Subject to Realization
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Cheque Number *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 000412"
                  value={draft.chequeNo || ''}
                  onChange={(e) => updateDraft({ chequeNo: e.target.value })}
                  style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Bank Name &amp; Branch *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. HDFC Bank, Solapur"
                  value={draft.chequeBank || ''}
                  onChange={(e) => updateDraft({ chequeBank: e.target.value })}
                  style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                  Cheque Date *
                </label>
                <ThemedDatePicker
                  value={draft.chequeDate || ''}
                  onChange={(e) => updateDraft({ chequeDate: e.target.value })}
                  style={{ height: '38px' }}
                />
              </div>
            </div>

            {/* Cheque Scan Upload */}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                📎 Cheque Scan / Photo Copy
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => chequeFileInputRef.current && chequeFileInputRef.current.click()}
                  style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 750, borderRadius: '8px', cursor: 'pointer' }}
                >
                  <span>📁</span> Choose Cheque Photo
                </button>
                <input
                  ref={chequeFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleChequeUpload}
                />
              </div>

              {draft.chequeScan && (
                <div style={{ marginTop: '8px', textAlign: 'center', background: 'var(--bg-surface)', padding: '10px', borderRadius: '8px', border: '1.5px dashed var(--border-color)' }}>
                  <img
                    src={draft.chequeScan}
                    alt="Cheque Scan"
                    style={{ maxHeight: '120px', maxWidth: '100%', borderRadius: '6px', margin: '0 auto 8px', display: 'block' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="filter-chip"
                      onClick={() => onPreviewDoc && onPreviewDoc(draft.chequeScan, 'Cheque Scan')}
                      style={{ fontSize: '0.72rem', padding: '4px 10px' }}
                    >
                      👁️ View Full
                    </button>
                    <button
                      type="button"
                      className="filter-chip"
                      onClick={() => updateDraft({ chequeScan: null })}
                      style={{ fontSize: '0.72rem', padding: '4px 10px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' }}
                    >
                      🗑️ Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live Summary Bar */}
        <div className="payment-live-summary-bar" style={{ marginTop: '14px' }}>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                {isPrepaidZeroExtras ? 'Voucher Covered: ' : 'Total Payable: '}
              </span>
              <strong style={{ fontSize: '1.25rem', color: isPrepaidZeroExtras ? '#15803d' : 'var(--apple-blue)' }}>
                {isPrepaidZeroExtras ? formatCurrency(otaVoucherTotal) : formatCurrency(totalDue)}
              </strong>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                {isPrepaidZeroExtras ? 'Desk Advance Due: ' : 'Advance Paid: '}
              </span>
              <strong style={{ fontSize: '1.25rem', color: isPrepaidZeroExtras ? '#15803d' : 'var(--text-primary)' }}>
                {isPrepaidZeroExtras ? '₹0.00' : formatCurrency(totalPaid)}
              </strong>
              {!isPrepaidZeroExtras && activeMethodsCount > 1 && (
                <span style={{ marginLeft: '8px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', padding: '2px 8px', borderRadius: '10px', fontSize: '0.74rem', fontWeight: 800 }}>
                  ✂️ Split ({activeMethodsCount} methods)
                </span>
              )}
            </div>
            {totalExtraFees > 0 && (
              <>
                <div style={{ width: '1px', height: '24px', background: 'var(--border-color)' }} />
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 800, textTransform: 'uppercase' }}>
                    Extra Fees:{' '}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 850, color: '#d97706' }}>
                    {cardSurcharge > 0 && `+₹${cardSurcharge} (Card ${cardPct}%) `}
                    {upiTax > 0 && `+₹${upiTax} (UPI ${upiPct}%)`}
                  </span>
                  <span style={{ marginLeft: '6px', fontSize: '0.92rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                    (Collect: {formatCurrency(totalCollectFromGuest)})
                  </span>
                </div>
              </>
            )}
          </div>
          <div
            className="balance-alert"
            style={{
              background: (balanceDue === 0 || isPrepaidZeroExtras) ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: (balanceDue === 0 || isPrepaidZeroExtras) ? '#16a34a' : '#ef4444',
              border: `1.5px solid ${(balanceDue === 0 || isPrepaidZeroExtras) ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
              fontSize: '0.96rem',
              fontWeight: 900,
              padding: '8px 18px',
              borderRadius: '10px'
            }}
          >
            {isPrepaidZeroExtras
              ? '✓ 100% Pre-Paid (₹0.00 Desk Due)'
              : (balanceDue === 0 ? '✓ Fully Paid (₹0.00)' : `Balance Due at Checkout: ${formatCurrency(balanceDue)}`)}
          </div>
        </div>

        {/* Bottom Direct Action Bar */}
        <div
          style={{
            marginTop: '28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border-light)'
          }}
        >
          {onPrev && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onPrev}
              style={{
                padding: '12px 24px',
                fontSize: '0.95rem',
                fontWeight: 750,
                borderRadius: '12px',
                cursor: 'pointer'
              }}
            >
              ← Back to Stay Details
            </button>
          )}

          {onSubmitCheckin && (
            <button
              type="button"
              id="btn-complete-checkin-direct"
              className="btn-primary"
              onClick={onSubmitCheckin}
              disabled={isSubmitting}
              style={{
                padding: '13px 32px',
                fontSize: '1.05rem',
                fontWeight: 850,
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                borderColor: '#15803d',
                boxShadow: '0 4px 16px rgba(22, 163, 74, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                marginLeft: 'auto'
              }}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" style={{ width: '18px', height: '18px', border: '2.5px solid #ffffff', borderTopColor: 'transparent' }} />
                  <span>Completing Check-In...</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.2rem' }}>✅</span>
                  <span>{isPrepaidZeroExtras ? 'Complete Check-In (Pre-Paid) & Print Reg Card' : 'Complete Check-In & Print Reg Card'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
