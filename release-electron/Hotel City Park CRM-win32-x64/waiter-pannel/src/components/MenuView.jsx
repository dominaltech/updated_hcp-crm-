import React, { useState, useMemo } from 'react';

// Helper to extract initials/acronym from dish name (e.g., "Chicken Dum Biryani" -> "cdb")
export const getDishAcronym = (name) => {
  if (!name) return '';
  // Clean parenthetical text e.g. (Full), (Half), (4 Pcs)
  const clean = name.replace(/\([^)]*\)/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  return words.map((w) => w[0].toLowerCase()).join('');
};

// Returns a match score from 0 to 100 for smart sorting
export const getDishSearchScore = (item, query) => {
  if (!query || !query.trim()) return 1;
  const q = query.trim().toLowerCase();
  const name = (item.name || '').trim().toLowerCase();
  const acronym = getDishAcronym(item.name || '');
  const shortcode = (item.shortcode || item.code || '').trim().toLowerCase();

  // 1. Exact acronym match (e.g. "cdb" === "cdb") -> 100 (Highest Priority)
  if (acronym && acronym === q) return 100;

  // 2. Exact shortcode match -> 98
  if (shortcode && shortcode === q) return 98;

  // 3. Name starts with query (e.g. "Chicken...") -> 95
  if (name.startsWith(q)) return 95;

  // 4. Acronym starts with query (e.g. query "cd" starts acronym "cdb") -> 92
  if (acronym && acronym.startsWith(q)) return 92;

  // 5. Shortcode starts with query -> 88
  if (shortcode && shortcode.startsWith(q)) return 88;

  // 6. Any individual word starts with query (e.g. query "bir" matches "Biryani") -> 85
  const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 85;

  // 7. Acronym contains query substring (e.g. query "db" in "cdb") -> 80
  if (acronym && acronym.includes(q)) return 80;

  // 8. Initials subsequence match (e.g. query "cb" appears in order in "cdb") -> 75
  if (acronym && q.length >= 2 && q.length < acronym.length) {
    let qIdx = 0;
    for (let i = 0; i < acronym.length; i++) {
      if (acronym[i] === q[qIdx]) {
        qIdx++;
        if (qIdx === q.length) break;
      }
    }
    if (qIdx === q.length) return 75;
  }

  // 9. Full name contains query substring -> 65
  if (name.includes(q)) return 65;

  // 10. Category name matches -> 45
  const cat = (item.category || item.category_name || '').toLowerCase();
  if (cat.includes(q)) return 45;

  return 0; // No match
};

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

  // Filter and sort items with smart shortcode & acronym support (e.g. cdb -> Chicken Dum Biryani)
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    const matched = [];
    for (const item of menuItems) {
      const matchesCat = selectedCat === 'all' || String(item.category_id) === String(selectedCat) || String(item.category) === String(selectedCat);
      if (!matchesCat && !q) continue;

      const score = getDishSearchScore(item, q);
      if (score > 0) {
        // If searching with a query, match high scores across menu or within the selected category
        if (matchesCat || score >= 85) {
          matched.push({
            ...item,
            _score: score,
            _acronym: getDishAcronym(item.name || '')
          });
        }
      }
    }

    // Sort by search relevance score descending
    if (q) {
      matched.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return (a.name || '').localeCompare(b.name || '');
      });
    }

    return matched;
  }, [menuItems, selectedCat, searchTerm]);

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
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          paddingBottom: '10px',
          paddingLeft: '14px',
          paddingRight: '14px',
          minHeight: 'calc(52px + env(safe-area-inset-top, 0px))',
          background: 'var(--bg-surface)',
          borderBottom: '1.5px solid var(--border-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          boxShadow: 'var(--shadow-subtle)',
          boxSizing: 'border-box',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
          <button
            type="button"
            id="btn-back-to-destinations"
            onClick={onBackToDestinations}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1.5px solid var(--theme-highlight-border)',
              color: 'var(--text-primary)',
              fontSize: '0.86rem',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.10)',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--theme-highlight-dark)' }}>←</span>
            <span>Back</span>
          </button>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.96rem', fontWeight: 900, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📍 {destination?.label || 'Destination'}
            </div>
            {destination?.guest_phone && (
              <div style={{ fontSize: '0.74rem', color: 'var(--theme-highlight-dark)', fontWeight: 750 }}>
                📞 {destination.guest_phone}
              </div>
            )}
          </div>
        </div>

        <span
          style={{
            fontSize: '0.68rem',
            fontWeight: 850,
            padding: '4px 9px',
            borderRadius: 'var(--radius-xl)',
            background: 'var(--theme-blush)',
            color: 'var(--theme-highlight-dark)',
            border: '1px solid var(--theme-highlight-border)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {isBar ? '🍸 Bar' : '🍽️ Resto'}
        </span>
      </div>

      {/* Smart Search Input with Acronym & Shortcode Support */}
      <div style={{ padding: '8px 12px 4px' }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search dishes or initials (e.g. cdb, dk, pbm)...`}
            style={{
              width: '100%',
              height: '38px',
              padding: '0 32px 0 32px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '0.84rem',
              outline: 'none',
              boxShadow: 'var(--shadow-subtle)',
              boxSizing: 'border-box'
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.85rem' }}>
            🔍
          </span>

          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: '0.90rem',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category Pills Strip */}
      <div
        style={{
          display: 'flex',
          gap: '7px',
          padding: '6px 12px 10px',
          overflowX: 'auto',
          flexShrink: 0
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedCat('all')}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-xl)',
            border: selectedCat === 'all' ? '1.5px solid var(--theme-highlight-dark)' : '1px solid var(--border-medium)',
            background: selectedCat === 'all' ? 'linear-gradient(135deg, var(--apple-orange), var(--theme-highlight-dark))' : 'var(--bg-surface)',
            color: selectedCat === 'all' ? '#ffffff' : 'var(--text-secondary)',
            fontSize: '0.76rem',
            fontWeight: 850,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            boxShadow: selectedCat === 'all' ? '0 2px 6px rgba(140, 93, 119, 0.35)' : '0 1px 3px rgba(0, 0, 0, 0.08)'
          }}
        >
          All Items ({menuItems.length})
        </button>
        {categories.map((cat) => {
          const isSelected = String(selectedCat) === String(cat.id);
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCat(cat.id)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-xl)',
                border: isSelected ? '1.5px solid var(--theme-highlight-dark)' : '1px solid var(--border-medium)',
                background: isSelected ? 'linear-gradient(135deg, var(--apple-orange), var(--theme-highlight-dark))' : 'var(--bg-surface)',
                color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                fontSize: '0.76rem',
                fontWeight: 850,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                boxShadow: isSelected ? '0 2px 6px rgba(140, 93, 119, 0.35)' : '0 1px 3px rgba(0, 0, 0, 0.08)'
              }}
            >
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* Dish Items List */}
      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
          ⏳ Loading menu items...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', padding: '24px' }}>
          <span style={{ fontSize: '2rem', marginBottom: '8px' }}>🍽️</span>
          <div style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--text-primary)' }}>No Matching Dishes Found</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {searchTerm ? `No dishes match "${searchTerm}". Try another acronym or name.` : 'This category currently has no items.'}
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 12px',
            paddingBottom: cartTotalItems > 0 ? '115px' : '30px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {filtered.map((item) => {
            const inCart = cart.find((it) => it.id === item.id);
            const isBouncing = bouncingItemId === item.id;
            const isVeg = item.is_veg === 1 || item.type === 'veg';
            const q = searchTerm.trim().toLowerCase();
            const isAcronymMatch = q && item._acronym && (item._acronym === q || item._acronym.startsWith(q));

            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: inCart ? `1.5px solid ${accentColor}` : (isAcronymMatch ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)'),
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
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
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isVeg ? 'var(--apple-green)' : 'var(--apple-red)' }} />
                      </span>
                    )}
                    <span style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {item.name}
                    </span>

                    {/* Acronym / Shortcode Badge (shows waiter the initials shortcut!) */}
                    {item._acronym && (
                      <span
                        style={{
                          fontSize: '0.62rem',
                          fontWeight: 850,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: isAcronymMatch ? 'var(--apple-blue-subtle)' : 'var(--bg-surface-secondary)',
                          color: isAcronymMatch ? 'var(--apple-blue)' : 'var(--text-tertiary)',
                          border: isAcronymMatch ? '1px solid var(--apple-blue)' : '1px solid var(--border-light)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}
                        title={`Quick search initial code: ${item._acronym.toUpperCase()}`}
                      >
                        {item._acronym}
                      </span>
                    )}
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
                      background: 'var(--bg-surface)',
                      border: '1.5px solid var(--theme-highlight-dark)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: '0 2px 5px rgba(0, 0, 0, 0.08)',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onUpdateCartQty(item.id, inCart.quantity - 1)}
                      style={{
                        width: '34px',
                        height: '34px',
                        background: 'rgba(220, 38, 38, 0.08)',
                        color: 'var(--apple-red)',
                        fontSize: '1.2rem',
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
                    <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.92rem' }}>
                      {inCart.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateCartQty(item.id, inCart.quantity + 1)}
                      style={{
                        width: '34px',
                        height: '34px',
                        background: 'rgba(22, 163, 74, 0.10)',
                        color: 'var(--apple-green)',
                        fontSize: '1.2rem',
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
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddClick(item)}
                    className={isBouncing ? 'anim-bounce' : ''}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'linear-gradient(135deg, var(--apple-orange), var(--theme-highlight-dark))',
                      color: '#ffffff',
                      fontSize: '0.82rem',
                      fontWeight: 900,
                      letterSpacing: '0.03em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 6px rgba(140, 93, 119, 0.35)',
                      border: '1px solid rgba(0, 0, 0, 0.12)',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ fontSize: '1rem', fontWeight: 900 }}>+</span>
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
            bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
            left: '12px',
            right: '12px',
            minHeight: '54px',
            padding: '8px 16px',
            background: 'var(--bg-surface)',
            border: `1.5px solid ${accentColor}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 100,
            animation: 'fadeInModal var(--transition-fast)'
          }}
        >
          {/* Left: View Cart button */}
          <button
            type="button"
            id="btn-open-cart-drawer"
            onClick={onOpenCart}
            style={{
              padding: '9px 18px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, var(--apple-orange), var(--theme-highlight-dark))',
              color: '#ffffff',
              fontSize: '0.86rem',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 3px 8px rgba(140, 93, 119, 0.40)',
              border: '1px solid rgba(0, 0, 0, 0.12)',
              cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: '1rem' }}>🛒</span>
            <span>View Cart →</span>
          </button>

          {/* Right: Items count & Grand Total */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
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
        </div>
      )}
    </div>
  );
}
