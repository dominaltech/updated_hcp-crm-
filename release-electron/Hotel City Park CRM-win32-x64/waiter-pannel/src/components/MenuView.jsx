import React, { useState } from 'react';

export default function MenuView({
  destination,
  department,
  menuItems,
  categories,
  cart,
  onAddToCart,
  onUpdateCartQty,
  onOpenCart,
  onBackToDestinations,
  isLoading
}) {
  const [selectedCat, setSelectedCat] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [bouncingItemId, setBouncingItemId] = useState(null);

  const isBar = department === 'bar';
  const accentColor = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
  const accentBg = isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)';

  // Filter items
  const filtered = menuItems.filter((item) => {
    const matchesCat = selectedCat === 'all' || String(item.category_id) === String(selectedCat) || String(item.category) === String(selectedCat);
    const matchesSearch = (item.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const cartTotalItems = cart.reduce((sum, it) => sum + it.quantity, 0);
  const cartSubtotal = cart.reduce((sum, it) => sum + (parseFloat(it.price) * it.quantity), 0);
  const cartGst = Math.round((cartSubtotal * 5) / 100);
  const cartGrandTotal = Math.round(cartSubtotal + cartGst);

  const handleAddClick = (item) => {
    setBouncingItemId(item.id);
    onAddToCart(item);
    setTimeout(() => setBouncingItemId(null), 380);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: 'var(--bg-app)' }}>
      {/* Sticky Active Destination Banner on Top */}
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          boxShadow: 'var(--shadow-subtle)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={onBackToDestinations}
            style={{
              padding: '5px 10px',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
              fontWeight: 800
            }}
          >
            ← Back
          </button>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📍 {destination?.label || 'Destination'}
            </div>
            {destination?.guest_phone && (
              <div style={{ fontSize: '0.72rem', color: 'var(--apple-blue)', fontWeight: 700 }}>
                📞 {destination.guest_phone}
              </div>
            )}
          </div>
        </div>

        <span
          style={{
            fontSize: '0.66rem',
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: 'var(--radius-xs)',
            background: accentColor,
            color: 'var(--text-on-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}
        >
          {isBar ? 'Bar Menu' : 'Food Menu'}
        </span>
      </div>

      {/* Search Input */}
      <div style={{ padding: '8px 12px 4px' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${isBar ? 'cocktails, beers, whisky...' : 'dishes, rotis, biryani...'}`}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 12px 0 32px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.84rem',
              outline: 'none',
              boxShadow: 'var(--shadow-subtle)'
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.85rem' }}>
            🔍
          </span>
        </div>
      </div>

      {/* Category Pills Strip */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          padding: '6px 12px 8px',
          overflowX: 'auto',
          flexShrink: 0
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedCat('all')}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-xl)',
            background: selectedCat === 'all' ? accentBg : 'var(--bg-surface-secondary)',
            border: selectedCat === 'all' ? `1.5px solid ${accentColor}` : '1px solid var(--border-light)',
            color: selectedCat === 'all' ? accentColor : 'var(--text-secondary)',
            fontSize: '0.74rem',
            fontWeight: 850,
            whiteSpace: 'nowrap'
          }}
        >
          All Items ({menuItems.length})
        </button>

        {categories.map((cat) => {
          const catId = cat.id || cat.name;
          const isSelected = String(selectedCat) === String(catId);
          return (
            <button
              key={catId}
              type="button"
              onClick={() => setSelectedCat(catId)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-xl)',
                background: isSelected ? accentBg : 'var(--bg-surface-secondary)',
                border: isSelected ? `1.5px solid ${accentColor}` : '1px solid var(--border-light)',
                color: isSelected ? accentColor : 'var(--text-secondary)',
                fontSize: '0.74rem',
                fontWeight: 850,
                whiteSpace: 'nowrap'
              }}
            >
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* Menu Items List */}
      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          <span>⏳ Loading menu items...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <span>No dishes match filter</span>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 12px',
            paddingBottom: cartTotalItems > 0 ? '90px' : '30px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {filtered.map((item) => {
            const inCart = cart.find(it => it.id === item.id);
            const isBouncing = bouncingItemId === item.id;
            const isVeg = item.is_veg === 1 || item.type === 'veg';

            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: inCart ? `1.5px solid ${accentColor}` : '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  boxShadow: 'var(--shadow-subtle)',
                  transition: 'border-color var(--transition-fast)'
                }}
              >
                {/* Item Details */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    {isBar ? (
                      <span style={{ fontSize: '0.85rem' }}>🍸</span>
                    ) : (
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '3px',
                          border: `1.5px solid ${isVeg ? 'var(--apple-green)' : 'var(--apple-red)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isVeg ? 'var(--apple-green)' : 'var(--apple-red)' }} />
                      </span>
                    )}
                    <span style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {item.name}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.90rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                    ₹{Number(item.price || item.rate || 0).toLocaleString('en-IN')}
                  </div>
                </div>

                {/* Stepper if in Cart, otherwise + ADD button */}
                {inCart ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--bg-surface-secondary)',
                      border: `1.5px solid ${accentColor}`,
                      borderRadius: 'var(--radius-xs)',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onUpdateCartQty(item.id, inCart.quantity - 1)}
                      style={{
                        width: '32px',
                        height: '32px',
                        background: 'transparent',
                        color: 'var(--apple-red)',
                        fontSize: '1.1rem',
                        fontWeight: 900,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      −
                    </button>
                    <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.88rem' }}>
                      {inCart.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateCartQty(item.id, inCart.quantity + 1)}
                      style={{
                        width: '32px',
                        height: '32px',
                        background: 'transparent',
                        color: 'var(--apple-green)',
                        fontSize: '1.1rem',
                        fontWeight: 900,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddClick(item)}
                    className={isBouncing ? 'anim-bounce' : ''}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 'var(--radius-xs)',
                      background: accentColor,
                      color: 'var(--text-on-accent)',
                      fontSize: '0.80rem',
                      fontWeight: 850,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: 'var(--shadow-subtle)'
                    }}
                  >
                    <span>+</span>
                    <span>ADD</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Bottom Cart Bar */}
      {cartTotalItems > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '12px',
            right: '12px',
            padding: '10px 14px',
            background: 'var(--bg-surface)',
            border: `1.5px solid ${accentColor}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-floating)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100,
            animation: 'fadeInModal var(--transition-fast)'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  background: accentColor,
                  color: 'var(--text-on-accent)',
                  fontSize: '0.70rem',
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-xl)'
                }}
              >
                {cartTotalItems} {cartTotalItems === 1 ? 'Item' : 'Items'}
              </span>
              <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                ₹{cartGrandTotal.toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
              Includes ₹{cartGst} GST (5%)
            </div>
          </div>

          <button
            type="button"
            id="btn-open-cart-drawer"
            onClick={onOpenCart}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              background: accentColor,
              color: 'var(--text-on-accent)',
              fontSize: '0.84rem',
              fontWeight: 850,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              boxShadow: 'var(--shadow-subtle)'
            }}
          >
            <span>🛒</span>
            <span>View Cart →</span>
          </button>
        </div>
      )}
    </div>
  );
}
