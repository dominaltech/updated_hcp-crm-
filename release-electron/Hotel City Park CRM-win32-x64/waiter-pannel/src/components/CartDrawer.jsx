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
  const getInitialName = () => {
    return destination?.customerName || destination?.guest_name || destination?.rawTable?.customer_name || destination?.rawOrder?.customer_name || '';
  };
  const getInitialPhone = () => {
    return destination?.customerPhone || destination?.guest_phone || destination?.rawTable?.customer_phone || destination?.rawOrder?.customer_phone || '';
  };

  const [selectedChips, setSelectedChips] = useState([]);
  const [customerName, setCustomerName] = useState(getInitialName);
  const [customerPhone, setCustomerPhone] = useState(getInitialPhone);
  const [isEditingGuest, setIsEditingGuest] = useState(false);

  useEffect(() => {
    const name = getInitialName();
    const phone = getInitialPhone();
    if (name) setCustomerName(name);
    if (phone) setCustomerPhone(phone);
    setIsEditingGuest(false);
  }, [destination]);

  const isRoomService = destination?.type === 'room' || String(destination?.label || '').startsWith('RS-') || destination?.rawTable?.table_type === 'room_service';
  const hasSavedDetails = Boolean(customerName?.trim() || customerPhone?.trim());

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
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--apple-red-subtle)',
                border: '1.5px solid var(--apple-red)',
                color: 'var(--apple-red)',
                fontSize: '0.74rem',
                fontWeight: 850,
                boxShadow: '0 1px 3px rgba(220, 38, 38, 0.15)',
                cursor: 'pointer'
              }}
            >
              Clear Cart
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'var(--bg-surface-secondary)',
                border: '1.5px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                cursor: 'pointer'
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
                  border: `1.5px solid var(--theme-highlight-dark)`,
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: '0 2px 5px rgba(0, 0, 0, 0.08)',
                  overflow: 'hidden'
                }}
              >
                <button
                  type="button"
                  onClick={() => onUpdateCartQty(item.id, item.quantity - 1)}
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'rgba(220, 38, 38, 0.08)',
                    color: 'var(--apple-red)',
                    fontSize: '1.15rem',
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: 'none',
                    borderRight: '1px solid var(--border-light)'
                  }}
                >
                  −
                </button>
                <span style={{ minWidth: '26px', textAlign: 'center', fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.90rem' }}>
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateCartQty(item.id, item.quantity + 1)}
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'rgba(22, 163, 74, 0.10)',
                    color: 'var(--apple-green)',
                    fontSize: '1.15rem',
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: 'none',
                    borderLeft: '1px solid var(--border-light)'
                  }}
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
          {isRoomService ? (
            /* Room Service: Automatically taken from occupied room, never asks */
            <div
              style={{
                marginTop: '10px',
                marginBottom: '10px',
                padding: '9px 12px',
                background: 'var(--apple-blue-subtle)',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--apple-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ fontSize: '0.66rem', fontWeight: 850, color: 'var(--apple-blue)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  🏨 Room Service Guest (Automatic)
                </div>
                <div style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {customerName || destination?.guest_name || destination?.customerName || 'In-House Guest'}
                  {(customerPhone || destination?.guest_phone || destination?.customerPhone) && (
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 650, fontSize: '0.78rem' }}>
                      {' '}• 📞 {customerPhone || destination?.guest_phone || destination?.customerPhone}
                    </span>
                  )}
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 850,
                  color: 'var(--apple-blue)',
                  background: 'rgba(59, 130, 246, 0.15)',
                  padding: '2px 8px',
                  borderRadius: '4px'
                }}
              >
                Auto Linked
              </span>
            </div>
          ) : hasSavedDetails && !isEditingGuest ? (
            /* Guest details already filled: do not ask again, show confirmed badge */
            <div
              style={{
                marginTop: '10px',
                marginBottom: '10px',
                padding: '9px 12px',
                background: 'var(--apple-green-subtle)',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--apple-green)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ fontSize: '0.66rem', fontWeight: 850, color: 'var(--apple-green)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  ✓ Guest Details (Saved)
                </div>
                <div style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {customerName || 'Guest'}
                  {customerPhone && (
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 650, fontSize: '0.78rem' }}>
                      {' '}• 📞 {customerPhone}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingGuest(true)}
                style={{
                  fontSize: '0.70rem',
                  fontWeight: 800,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                ✏️ Edit
              </button>
            </div>
          ) : (
            /* Unfilled or Editing: Show guest inputs */
            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', margin: 0 }}>
                  Guest Details (Optional):
                </label>
                {isEditingGuest && (
                  <button
                    type="button"
                    onClick={() => setIsEditingGuest(false)}
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--apple-blue)',
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
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
          )}

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
                      padding: '5px 11px',
                      borderRadius: 'var(--radius-sm)',
                      background: isSelected ? 'linear-gradient(135deg, var(--apple-orange), var(--theme-highlight-dark))' : 'var(--bg-surface)',
                      border: isSelected ? '1.5px solid var(--theme-highlight-dark)' : '1px solid var(--border-medium)',
                      color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      boxShadow: isSelected ? '0 2px 5px rgba(140, 93, 119, 0.35)' : '0 1px 3px rgba(0, 0, 0, 0.06)',
                      cursor: 'pointer'
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
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: 'var(--text-on-accent)',
              fontSize: '1rem',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(22, 163, 74, 0.35)',
              border: '1px solid rgba(0, 0, 0, 0.12)',
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
