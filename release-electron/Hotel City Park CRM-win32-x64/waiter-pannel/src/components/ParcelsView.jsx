import React, { useState } from 'react';

export default function ParcelsView({
  department,
  onStartParcel
}) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tokenNo, setTokenNo] = useState(() => Math.floor(100 + Math.random() * 900));
  const isBar = department === 'bar';
  const deptColor = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';

  const handleStart = (e) => {
    e.preventDefault();
    const label = customerName.trim()
      ? `Parcel: ${customerName.trim()} (#${tokenNo})`
      : `Parcel #${tokenNo}`;

    onStartParcel({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      tokenNo,
      label
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', overflowY: 'auto', background: 'var(--bg-app)' }}>
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '18px' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '4px' }}>
            📦
          </div>
          <h2 style={{ fontSize: '1.20rem', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            New {isBar ? 'Bar / Liquor' : 'Food'} Parcel Order
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
            Takeaway Packaging &amp; Counter Collection
          </p>
        </div>

        <form onSubmit={handleStart}>
          {/* Customer Name */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '5px' }}>
              👤 Customer Name (Optional)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Amit Kumar"
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.90rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Customer Phone */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '5px' }}>
              📞 Mobile Number (Optional)
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.90rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Token Number */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <label style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', margin: 0 }}>
                🏷️ Token / Slip Number
              </label>
              <button
                type="button"
                onClick={() => setTokenNo(Math.floor(100 + Math.random() * 900))}
                style={{ background: 'none', color: 'var(--apple-blue)', fontSize: '0.72rem', fontWeight: 700 }}
              >
                Regenerate
              </button>
            </div>
            <input
              type="number"
              value={tokenNo}
              onChange={(e) => setTokenNo(e.target.value)}
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--apple-orange)',
                fontSize: '1.05rem',
                fontWeight: 900,
                outline: 'none'
              }}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            style={{
              width: '100%',
              height: '46px',
              borderRadius: 'var(--radius-sm)',
              background: deptColor,
              color: 'var(--text-on-accent)',
              fontSize: '0.92rem',
              fontWeight: 850,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-subtle)'
            }}
          >
            <span>🍱</span>
            <span>Select Dishes &amp; Drinks →</span>
          </button>
        </form>
      </div>
    </div>
  );
}
