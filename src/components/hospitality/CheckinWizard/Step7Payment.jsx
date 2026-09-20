import React, { useRef, useState } from 'react';
import { formatCurrency } from '../../../utils/formatters';
import { useApp } from '../../../context/AppContext';

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

  const [selectedMethod, setSelectedMethod] = useState(() => {
    if (splitOnline > 0) return 'splitOnline';
    if (splitCard > 0) return 'splitCard';
    if (splitCheque > 0) return 'splitCheque';
    return 'splitCash';
  });

  // Overpayment prevention and strict single-payment method enforcement (prevents split payment)
  const handleAmountChange = (field, value) => {
    setSelectedMethod(field);
    let val = Math.max(0, Number(value) || 0);
    if (val > totalDue) {
      val = totalDue;
    }

    // Only allow input in ONE payment method at a time; zero out all other methods
    updateDraft({
      splitCash: field === 'splitCash' ? val : 0,
      splitOnline: field === 'splitOnline' ? val : 0,
      splitCard: field === 'splitCard' ? val : 0,
      splitCheque: field === 'splitCheque' ? val : 0
    });
  };

  // Allows clicking anywhere on the div card to select and focus that payment method
  const selectPaymentMethod = (field, inputRef) => {
    setSelectedMethod(field);
    if (inputRef && inputRef.current) {
      inputRef.current.focus();
    }

    const currentActiveField =
      splitCash > 0 ? 'splitCash' :
      splitOnline > 0 ? 'splitOnline' :
      splitCard > 0 ? 'splitCard' :
      splitCheque > 0 ? 'splitCheque' : null;

    // If another payment method already held the amount, seamlessly transfer it to this chosen method
    if (currentActiveField && currentActiveField !== field) {
      const currentPaid = splitCash + splitOnline + splitCard + splitCheque;
      updateDraft({
        splitCash: field === 'splitCash' ? currentPaid : 0,
        splitOnline: field === 'splitOnline' ? currentPaid : 0,
        splitCard: field === 'splitCard' ? currentPaid : 0,
        splitCheque: field === 'splitCheque' ? currentPaid : 0
      });
      setTimeout(() => {
        try {
          inputRef?.current?.select?.();
        } catch (e) {}
      }, 50);
    }
  };

  const isCashActive = splitCash > 0 || (totalPaid === 0 && selectedMethod === 'splitCash');
  const isOnlineActive = splitOnline > 0 || (totalPaid === 0 && selectedMethod === 'splitOnline');
  const isCardActive = splitCard > 0 || (totalPaid === 0 && selectedMethod === 'splitCard');
  const isChequeActive = splitCheque > 0 || (totalPaid === 0 && selectedMethod === 'splitCheque');

  const bookingSource = String(draft?.bookingSource || draft?.booking_source || '').toUpperCase();
  const isBtc = bookingSource === 'BTC';

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
  const isOta = draft.bookingSource === 'OTA';
  const isMinAdvanceEnforced = !isOta && !isBtc && minAdvancePct > 0;
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

  return (
    <div className="checkin-step-content" id="checkin-step-7">
      <h2 className="checkin-step-heading">Payment &amp; Advance Collection</h2>

      <div className="payment-step-container">
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
              background: isAdvanceSufficient ? '#f0fdf4' : '#fffbeb',
              border: `1.5px solid ${isAdvanceSufficient ? '#86efac' : '#fde68a'}`,
              color: isAdvanceSufficient ? '#15803d' : '#92400e',
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
                <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 800 }}>
                  ✓ Policy Satisfied
                </span>
              ) : (
                <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 800 }}>
                  Needs ₹{(minRequiredAdvance - totalPaid).toLocaleString('en-IN')} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Quick Fill & Mode Selector Header */}
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
                  style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe', fontWeight: 800 }}
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
                  style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe', fontWeight: 800 }}
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

        {/* Unified Multi-Mode Payment Grid */}
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
              <div className="paybox-info">
                <div className="paybox-name">Cash</div>
                <div className="paybox-desc">Direct Cash Collection</div>
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
              <div className="paybox-info">
                <div className="paybox-name">Card</div>
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

        {/* Mandatory Online Payment UTR / Ref ID Panel */}
        {splitOnline > 0 && (
          <div
            id="checkin-online-utr-panel"
            style={{
              background: '#eff6ff',
              border: '1.5px solid #93c5fd',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '16px',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 850, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📱</span> Online / UPI Transaction UTR Reference ID <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
              </label>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '8px' }}>
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
                background: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 700,
                border: !(draft.onlineUtr || draft.utrNumber)?.trim() ? '2px solid #ef4444' : '1.5px solid #3b82f6',
                color: '#0f172a'
              }}
              required
            />
            {!(draft.onlineUtr || draft.utrNumber)?.trim() && (
              <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 700, marginTop: '5px' }}>
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
              background: '#fffbeb',
              border: '1.5px solid #fde68a',
              borderRadius: '12px',
              padding: '14px 16px',
              marginTop: '14px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>📑</span> Cheque Realization Details *
              </div>
              <span style={{ fontSize: '0.72rem', fontWeight: 750, background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '10px', border: '1px solid #fde68a' }}>
                ⏳ Subject to Realization
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: '#78350f', marginBottom: '4px', display: 'block' }}>
                  Cheque Number *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 000412"
                  value={draft.chequeNo || ''}
                  onChange={(e) => updateDraft({ chequeNo: e.target.value })}
                  style={{ height: '38px', background: '#ffffff' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: '#78350f', marginBottom: '4px', display: 'block' }}>
                  Bank Name &amp; Branch *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. HDFC Bank, Solapur"
                  value={draft.chequeBank || ''}
                  onChange={(e) => updateDraft({ chequeBank: e.target.value })}
                  style={{ height: '38px', background: '#ffffff' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 750, color: '#78350f', marginBottom: '4px', display: 'block' }}>
                  Cheque Date *
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={draft.chequeDate || ''}
                  onChange={(e) => updateDraft({ chequeDate: e.target.value })}
                  style={{ height: '38px', background: '#ffffff' }}
                />
              </div>
            </div>

            {/* Cheque Scan Upload */}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #fde68a' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#78350f', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
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
                <div style={{ marginTop: '8px', textAlign: 'center', background: '#ffffff', padding: '10px', borderRadius: '8px', border: '1.5px dashed #fde68a' }}>
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
                      style={{ fontSize: '0.72rem', padding: '4px 10px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
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
                Total Payable:{' '}
              </span>
              <strong style={{ fontSize: '1.25rem', color: 'var(--apple-blue)' }}>
                {formatCurrency(totalDue)}
              </strong>
            </div>
            <div style={{ width: '1px', height: '24px', background: '#cbd5e1' }} />
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>
                Advance Paid:{' '}
              </span>
              <strong style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                {formatCurrency(totalPaid)}
              </strong>
            </div>
            {totalExtraFees > 0 && (
              <>
                <div style={{ width: '1px', height: '24px', background: '#cbd5e1' }} />
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#b45309', fontWeight: 800, textTransform: 'uppercase' }}>
                    Extra Fees:{' '}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 850, color: '#92400e' }}>
                    {cardSurcharge > 0 && `+₹${cardSurcharge} (Card ${cardPct}%) `}
                    {upiTax > 0 && `+₹${upiTax} (UPI ${upiPct}%)`}
                  </span>
                  <span style={{ marginLeft: '6px', fontSize: '0.92rem', fontWeight: 900, color: '#1e3a8a' }}>
                    (Collect: {formatCurrency(totalCollectFromGuest)})
                  </span>
                </div>
              </>
            )}
          </div>
          <div
            className="balance-alert"
            style={{
              background: balanceDue === 0 ? '#dcfce7' : '#fef2f2',
              color: balanceDue === 0 ? '#166534' : '#dc2626',
              border: `1.5px solid ${balanceDue === 0 ? '#bbf7d0' : '#fca5a5'}`,
              fontSize: '0.96rem',
              fontWeight: 900,
              padding: '8px 18px',
              borderRadius: '10px'
            }}
          >
            {balanceDue === 0 ? '✓ Fully Paid (₹0.00)' : `Balance Due at Checkout: ${formatCurrency(balanceDue)}`}
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
                  <span>Complete Check-In &amp; Print Reg Card</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
