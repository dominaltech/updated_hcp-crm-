const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'src', 'components', 'hospitality', 'CheckinWizard', 'Step6Stay.jsx');
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Update handleCheckoutChange to auto-set time when date is chosen, and add handleApplyCheckoutPreset
const oldCheckoutChange = `  const handleCheckoutChange = (newDateStr, newTimeStr) => {
    let dStr = newDateStr !== undefined ? newDateStr : checkoutDateStr;
    const minOut = isOta ? getMinCheckoutDate(draft.checkinTime) : '';
    if (isOta && dStr && minOut && dStr < minOut) {
      dStr = minOut;
    }
    const isOtaEarly = isOta && draft.isEarlyCheckin === true;
    const tStr = isOtaEarly ? '10:00' : (isOta ? '10:00' : (newTimeStr !== undefined ? newTimeStr : checkoutTimeStr));

    if (!dStr && !tStr) {`;

const newCheckoutChange = `  const handleCheckoutChange = (newDateStr, newTimeStr) => {
    let dStr = newDateStr !== undefined ? newDateStr : checkoutDateStr;
    const minOut = isOta ? getMinCheckoutDate(draft.checkinTime) : '';
    if (isOta && dStr && minOut && dStr < minOut) {
      dStr = minOut;
    }
    const isOtaEarly = isOta && draft.isEarlyCheckin === true;
    let tStr = isOtaEarly ? '10:00' : (isOta ? '10:00' : (newTimeStr !== undefined ? newTimeStr : checkoutTimeStr));

    // EASY UI: If checkout date is set but time is blank, automatically default time to check-in time (24-hr stay cycle)
    if (dStr && (!tStr || !tStr.trim())) {
      const inTime = (draft.checkinTime && draft.checkinTime.includes('T'))
        ? draft.checkinTime.split('T')[1].slice(0, 5)
        : '11:00';
      tStr = inTime;
    }

    if (!dStr && !tStr) {`;

const presetHelper = `  const handleApplyCheckoutPreset = (presetType) => {
    const inDateStr = draft.checkinTime ? draft.checkinTime.split('T')[0] : getLocalIsoDateTime().split('T')[0];
    const inTimeStr = draft.checkinTime && draft.checkinTime.includes('T') ? draft.checkinTime.split('T')[1].slice(0, 5) : '11:00';
    const baseDate = new Date(inDateStr);

    let targetDate = new Date(baseDate);
    let targetTime = inTimeStr;

    if (presetType === '24h') {
      targetDate.setDate(targetDate.getDate() + 1);
      targetTime = inTimeStr;
    } else if (presetType === 'tomorrow_11am') {
      targetDate.setDate(targetDate.getDate() + 1);
      targetTime = '11:00';
    } else if (presetType === '2days') {
      targetDate.setDate(targetDate.getDate() + 2);
      targetTime = inTimeStr;
    } else if (presetType === '3days') {
      targetDate.setDate(targetDate.getDate() + 3);
      targetTime = inTimeStr;
    }

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    const newDateStr = \`\${y}-\${m}-\${d}\`;

    handleCheckoutChange(newDateStr, targetTime);
  };
`;

// 2. Expected Checkout UI target
const oldExpectedCheckoutUI = `<label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      📅 Expected Checkout <span style={{ color: '#dc2626', fontWeight: 900 }}>* (Mandatory)</span>
                    </label>
                    {checkoutTimeStr ? (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: checkoutTimeStr.split(':')[0] < 12 ? '#0369a1' : '#b45309',
                          background: checkoutTimeStr.split(':')[0] < 12 ? '#e0f2fe' : '#fef3c7',
                          padding: '1px 8px',
                          borderRadius: '8px',
                          border: checkoutTimeStr.split(':')[0] < 12 ? '1px solid #bae6fd' : '1px solid #fde68a'
                        }}
                      >
                        ✓ {formatTime12(checkoutTimeStr)}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#b91c1c',
                          background: '#fef2f2',
                          padding: '1px 8px',
                          borderRadius: '8px',
                          border: '1px solid #fecaca'
                        }}
                      >
                        ⚠️ Select Checkout Time
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '6px' }}>
                    <ThemedDatePicker
                      value={checkoutDateStr}
                      min={isOta ? getMinCheckoutDate(draft.checkinTime) : (draft.checkinTime ? draft.checkinTime.split('T')[0] : '')}
                      onChange={(e) => handleCheckoutChange(e.target.value, checkoutTimeStr)}
                      error={!checkoutDateStr}
                      style={{ height: '38px', fontSize: '0.82rem' }}
                    />
                    <UnifiedTimeInput
                      value={checkoutTimeStr || ''}
                      onChange={(val) => handleCheckoutChange(checkoutDateStr, val)}
                      style={{
                        height: '38px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: !checkoutTimeStr ? '2px solid #ef4444' : '1.5px solid var(--border-color, #cbd5e1)',
                        background: !checkoutTimeStr ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-app, #ffffff)'
                      }}
                    />
                  </div>`;

const newExpectedCheckoutUI = `<label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      📅 Expected Checkout <span style={{ color: '#dc2626', fontWeight: 900 }}>* (Mandatory)</span>
                    </label>
                    {checkoutDateStr && checkoutTimeStr ? (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#15803d',
                          background: '#ecfdf5',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          border: '1px solid #bbf7d0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        ✓ {checkoutDateStr} @ {formatTime12(checkoutTimeStr)}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#d97706',
                          background: '#fffbeb',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          border: '1px solid #fde68a'
                        }}
                      >
                        ⚡ 1-Click: Click "24 Hours" Below
                      </span>
                    )}
                  </div>

                  {/* 1-Click Easy Stay Preset Chips */}
                  <div style={{ display: 'flex', gap: '5px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handleApplyCheckoutPreset('24h')}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: '6px',
                        border: '1.5px solid #0284c7',
                        background: '#f0f9ff',
                        color: '#0369a1',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                      title="1 Night (24-hour cycle matching check-in time)"
                    >
                      ⚡ 24 Hours
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCheckoutPreset('tomorrow_11am')}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#334155',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                      title="Tomorrow 11:00 AM standard hotel checkout"
                    >
                      ☀️ Tomorrow 11 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCheckoutPreset('2days')}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#334155',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                      title="2 Nights stay"
                    >
                      📅 2 Nights
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyCheckoutPreset('3days')}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#334155',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                      title="3 Nights stay"
                    >
                      📅 3 Nights
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '6px' }}>
                    <ThemedDatePicker
                      value={checkoutDateStr}
                      min={isOta ? getMinCheckoutDate(draft.checkinTime) : (draft.checkinTime ? draft.checkinTime.split('T')[0] : '')}
                      onChange={(e) => handleCheckoutChange(e.target.value, checkoutTimeStr)}
                      error={!checkoutDateStr}
                      style={{ height: '38px', fontSize: '0.82rem' }}
                    />
                    <UnifiedTimeInput
                      value={checkoutTimeStr || ''}
                      onChange={(val) => handleCheckoutChange(checkoutDateStr, val)}
                      style={{
                        height: '38px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: !checkoutTimeStr ? '1.5px solid #f59e0b' : '1.5px solid var(--border-color, #cbd5e1)',
                        background: 'var(--bg-app, #ffffff)'
                      }}
                    />
                  </div>`;

// 3. Discount UI target
const oldDiscountUI = `              <input
                type="number"
                className="form-input"
                min={0}
                max={100}
                value={discountPct}
                onChange={(e) => {
                  const maxAllowed = room.max_discount_pct !== undefined && room.max_discount_pct !== null && room.max_discount_pct !== '' ? Number(room.max_discount_pct) : 25;
                  const val = Number(e.target.value) || 0;
                  if (val > maxAllowed) {
                    handleCappedDiscountClick(val);
                  } else {
                    const updates = { discountPct: val };
                    if (val >= 20) {
                      updates.mealPlan = 'without_breakfast';
                    }
                    updateDraft(updates);
                  }
                }}
                style={{ background: 'var(--bg-app, #ffffff)', fontWeight: 700, color: 'var(--text-primary)', border: '1.5px solid var(--border-color, #cbd5e1)', height: '38px' }}
              />`;

const newDiscountUI = `              {/* Custom percentage row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', padding: '0 2px' }}>
                <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>
                  Custom Discount (%):
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    className="form-input"
                    min={0}
                    max={100}
                    value={discountPct || ''}
                    placeholder="0"
                    onChange={(e) => {
                      const maxAllowed = room.max_discount_pct !== undefined && room.max_discount_pct !== null && room.max_discount_pct !== '' ? Number(room.max_discount_pct) : 25;
                      const val = Number(e.target.value) || 0;
                      if (val > maxAllowed) {
                        handleCappedDiscountClick(val);
                      } else {
                        const updates = { discountPct: val };
                        if (val >= 20) {
                          updates.mealPlan = 'without_breakfast';
                        }
                        updateDraft(updates);
                      }
                    }}
                    style={{ width: '64px', height: '30px', textAlign: 'center', fontWeight: 800, fontSize: '0.82rem', borderRadius: '6px', border: '1.5px solid #cbd5e1', padding: '2px 4px' }}
                  />
                  <span style={{ fontSize: '0.80rem', fontWeight: 800, color: '#64748b' }}>%</span>
                </div>
              </div>

              {/* 3-Column Breakdown: Without Discount, Discount Amount, With Discount Amount */}
              {discountPct > 0 ? (
                <div
                  style={{
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    padding: '10px',
                    marginTop: '4px'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '8px' }}>
                    {/* Without Discount */}
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                      }}
                    >
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                        Without Discount
                      </span>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#475569', textDecoration: 'line-through', textDecorationColor: '#ef4444', marginTop: '2px' }}>
                        ₹{totalBaseRate.toLocaleString('en-IN')}
                      </div>
                      <span style={{ fontSize: '0.66rem', color: '#64748b', fontWeight: 700, marginTop: '2px' }}>
                        ₹{Math.round(totalBaseRate * (1 + effectiveGstPct / 100)).toLocaleString('en-IN')} incl. GST
                      </span>
                    </div>

                    {/* Discount Amount */}
                    <div
                      style={{
                        background: '#fef2f2',
                        border: '1.5px solid #fecaca',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                          Discount Amount
                        </span>
                        <span style={{ fontSize: '0.62rem', fontWeight: 900, background: '#ef4444', color: '#ffffff', padding: '1px 5px', borderRadius: '4px' }}>
                          {discountPct}% OFF
                        </span>
                      </div>
                      <div style={{ fontSize: '1.08rem', fontWeight: 900, color: '#dc2626', marginTop: '2px' }}>
                        -₹{discountAmount.toLocaleString('en-IN')}
                      </div>
                      <span style={{ fontSize: '0.66rem', color: '#991b1b', fontWeight: 700, marginTop: '2px' }}>
                        Savings: ₹{discountAmount.toLocaleString('en-IN')}
                      </span>
                    </div>

                    {/* With Discount Amount */}
                    <div
                      style={{
                        background: '#ecfdf5',
                        border: '1.5px solid #86efac',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                          With Discount Amount
                        </span>
                        <span style={{ fontSize: '0.62rem', fontWeight: 900, background: '#16a34a', color: '#ffffff', padding: '1px 5px', borderRadius: '4px' }}>
                          NET
                        </span>
                      </div>
                      <div style={{ fontSize: '1.18rem', fontWeight: 900, color: '#15803d', marginTop: '2px' }}>
                        ₹{netChargeBeforeTax.toLocaleString('en-IN')}
                      </div>
                      <span style={{ fontSize: '0.68rem', color: '#166534', fontWeight: 800, marginTop: '2px' }}>
                        ₹{totalNetDue.toLocaleString('en-IN')} incl. {effectiveGstPct}% GST
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px dashed #cbd5e1',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.74rem',
                    color: '#64748b',
                    fontWeight: 700
                  }}
                >
                  <span>Standard Tariff (No Discount):</span>
                  <strong style={{ color: '#0f172a', fontSize: '0.88rem' }}>
                    ₹{totalBaseRate.toLocaleString('en-IN')} (₹{totalNetDue.toLocaleString('en-IN')} incl. GST)
                  </strong>
                </div>
              )}`;

// Normalize CRLF to LF for matching, and restore
const isCRLF = content.includes('\r\n');
let normContent = content.replace(/\r\n/g, '\n');

let normOldCheckout = oldCheckoutChange.replace(/\r\n/g, '\n');
let normNewCheckout = newCheckoutChange.replace(/\r\n/g, '\n');
let normOldExpected = oldExpectedCheckoutUI.replace(/\r\n/g, '\n');
let normNewExpected = newExpectedCheckoutUI.replace(/\r\n/g, '\n');
let normOldDiscount = oldDiscountUI.replace(/\r\n/g, '\n');
let normNewDiscount = newDiscountUI.replace(/\r\n/g, '\n');

if (!normContent.includes(normOldCheckout)) {
  console.error('Could not find normOldCheckout');
  process.exit(1);
}
normContent = normContent.replace(normOldCheckout, normNewCheckout);

// Insert handleApplyCheckoutPreset after handleCheckoutChange closing
const checkoutEndStr = `    updateDraft({
      approxCheckout: isoString,
      checkoutDate: dStr,
      checkoutTime: tStr,
      extensionCharge: extCharge,
      stayNights: calculatedNights
    });
  };`;
if (!normContent.includes(checkoutEndStr)) {
  console.error('Could not find checkoutEndStr');
  process.exit(1);
}
normContent = normContent.replace(checkoutEndStr, `${checkoutEndStr}\n\n${presetHelper}`);

if (!normContent.includes(normOldExpected)) {
  console.error('Could not find normOldExpected');
  process.exit(1);
}
normContent = normContent.replace(normOldExpected, normNewExpected);

if (!normContent.includes(normOldDiscount)) {
  console.error('Could not find normOldDiscount');
  process.exit(1);
}
normContent = normContent.replace(normOldDiscount, normNewDiscount);

const finalContent = isCRLF ? normContent.replace(/\n/g, '\r\n') : normContent;
fs.writeFileSync(targetFile, finalContent, 'utf8');
console.log('Step6Stay.jsx updated successfully!');
