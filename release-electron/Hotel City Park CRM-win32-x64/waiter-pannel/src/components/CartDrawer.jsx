import React, { useState, useEffect } from 'react';

export default function CartDrawer({
  isOpen,
  onClose,
  destination,
  department,
  cart,
  onUpdateCartQty,
  onClearCart,
  onPunchOrder,
  isPunching
}) {
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedChips, setSelectedChips] = useState([]);
  const [customerName, setCustomerName] = useState(() => destination?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(() => destination?.customerPhone || '');

  useEffect(() => {
    if (destination?.customerName) setCustomerName(destination.customerName);
    if (destination?.customerPhone) setCustomerPhone(destination.customerPhone);
  }, [destination]);

  if (!isOpen) return null;

  const isBar = department === 'bar';
  const accentColor = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
  const accentBg = isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)';

  const subtotal = cart.reduce((sum, it) => sum + (parseFloat(it.price) * it.quantity), 0);
  const gstRate = 5;
  const gstAmount = Math.round((subtotal * gstRate) / 100);
  const grandTotal = Math.round(subtotal + gstAmount);

  const cookingChips = isBar
    ? ['Extra Ice', 'On the Rocks', 'With Soda', 'With Water', 'Separate Glasses', 'Chilled']
    : ['Less Spicy', 'Extra Spicy', 'No Onion / Garlic', 'Crispy', 'Fast Service', 'Served Together'];

  const handleChipToggle = (chip) => {
    let updated;
    if (selectedChips.includes(chip)) {
      updated = selectedChips.filter(c => c !== chip);
    } else {
      updated = [...selectedChips, chip];
    }
    setSelectedChips(updated);
  };

  const handlePunch = () => {
    const combinedNotes = [
      ...selectedChips,
      orderNotes.trim()
    ].filter(Boolean).join(' • ');

    onPunchOrder({
      notes: combinedNotes,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim()
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        animation: 'fadeInModal var(--transition-fast)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          height: '84dvh',
          maxHeight: '88dvh',
          background: 'var(--bg-surface)',
          borderTopLeftRadius: 'var(--radius-xl)',
          borderTopRightRadius: 'var(--radius-xl)',
          border: '1.5px solid var(--border-medium)',
          borderBottom: 'none',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUpDrawer var(--transition-smooth)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Pull Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '10px', paddingBottom: '4px', flexShrink: 0 }}>
          <div style={{ width: '44px', height: '5px', borderRadius: '4px', background: 'var(--border-medium)' }} />
        </div>

        {/* Drawer Header */}
        <div
          style={{
            padding: '10px 18px 12px',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}
        >
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              Review Order
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--apple-blue)', fontWeight: 750, marginTop: '2px' }}>
              📍 {destination?.label || 'Destination'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={onClearCart}
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--apple-red-subtle)',
                border: '1px solid var(--apple-red)',
                color: 'var(--apple-red)',
                fontSize: '0.72rem',
                fontWeight: 750
              }}
            >
              Clear Cart
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Items List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {cart.map((item) => (
            <div
              key={item.id}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px'
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  ₹{Number(item.price).toLocaleString('en-IN')} each
                </div>
              </div>

              {/* Quantity Stepper */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'var(--bg-surface)',
                  border: `1.5px solid ${accentColor}`,
                  borderRadius: 'var(--radius-xs)',
                  overflow: 'hidden'
                }}
              >
                <button
                  type="button"
                  onClick={() => onUpdateCartQty(item.id, item.quantity - 1)}
                  style={{ width: '30px', height: '30px', background: 'transparent', color: 'var(--apple-red)', fontSize: '1.1rem', fontWeight: 900 }}
                >
                  −
                </button>
                <span style={{ minWidth: '22px', textAlign: 'center', fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.88rem' }}>
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateCartQty(item.id, item.quantity + 1)}
                  style={{ width: '30px', height: '30px', background: 'transparent', color: 'var(--apple-green)', fontSize: '1.1rem', fontWeight: 900 }}
                >
                  +
                </button>
              </div>

              {/* Item Total */}
              <div style={{ minWidth: '56px', textAlign: 'right', fontSize: '0.92rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </div>
            </div>
          ))}

          {/* Customer Name & Phone Number */}
          <div style={{ marginTop: '10px', marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Guest Details (Optional):
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Guest Name..."
                style={{
                  width: '100%',
                  height: '36px',
                  padding: '0 10px',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Mobile (10 digits)..."
                maxLength={10}
                style={{
                  width: '100%',
                  height: '36px',
                  padding: '0 10px',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--text-primary)',
                  fontSize: '0.82rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Quick Cooking Notes Chips */}
          <div style={{ marginTop: '8px' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Special Instructions:
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
              {cookingChips.map((chip) => {
                const isSelected = selectedChips.includes(chip);
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChipToggle(chip)}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 'var(--radius-xs)',
                      background: isSelected ? accentBg : 'var(--bg-surface-secondary)',
                      border: isSelected ? `1.5px solid ${accentColor}` : '1px solid var(--border-medium)',
                      color: isSelected ? accentColor : 'var(--text-secondary)',
                      fontSize: '0.72rem',
                      fontWeight: 750
                    }}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Custom instructions (e.g. deliver in 15 mins)..."
              style={{
                width: '100%',
                height: '38px',
                padding: '0 10px',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Bill Summary & Punch Action Bar */}
        <div
          style={{
            padding: '12px 18px calc(16px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-light)',
            flexShrink: 0
          }}
        >
          {/* Subtotal, GST, Total Breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '12px', fontSize: '0.80rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Items Subtotal:</span>
              <span>₹{subtotal.toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>GST (5%):</span>
              <span>₹{gstAmount.toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 900, paddingTop: '4px', borderTop: '1px dashed var(--border-medium)' }}>
              <span>Grand Total:</span>
              <span style={{ color: 'var(--apple-blue)' }}>₹{grandTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>

          {/* Punch KOT Button */}
          <button
            type="button"
            id="btn-confirm-punch-kot"
            disabled={isPunching || cart.length === 0}
            onClick={handlePunch}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--apple-green)',
              color: 'var(--text-on-accent)',
              fontSize: '1rem',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: 'var(--shadow-subtle)',
              cursor: (isPunching || cart.length === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            <span>{isPunching ? '⏳' : '🚀'}</span>
            <span>{isPunching ? 'Sending to Kitchen / Bar...' : 'Take Order & Release KOT'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
