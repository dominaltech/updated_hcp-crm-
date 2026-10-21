import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

export default function GuestOrderPage() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [isExpired, setIsExpired] = useState(false);

  // Cart state: { [dishId]: { dish, quantity, notes } }
  const [cart, setCart] = useState({});
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');

  // Submitting state & Post-order confirmation modal
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSuccessData, setOrderSuccessData] = useState(null);
  const [showCartDrawer, setShowCartDrawer] = useState(false);

  // Extract token from URL search query on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
  }, []);

  // Fetch session details whenever token is available
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('No dining token provided in the link.');
      return;
    }

    const loadSession = async () => {
      setLoading(true);
      try {
        const res = await api.getGuestSession(token);
        if (!res || !res.success) {
          if (res?.expired) {
            setIsExpired(true);
            setSession(res);
          } else {
            setError(res?.error || res?.message || 'Invalid or expired dining link.');
          }
        } else {
          setSession(res);
          const rList = String(res.guest?.roomNumbers || '').split(',').map(s => s.trim()).filter(Boolean);
          if (rList.length > 0) {
            setSelectedRoom(rList[0]);
          }
        }
      } catch (err) {
        setError('Unable to load dining session: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [token]);

  // Filtered menu dishes
  const filteredDishes = useMemo(() => {
    if (!session?.menu) return [];
    return session.menu.filter((dish) => {
      // Category filter
      if (activeCategory !== 'ALL' && String(dish.category || '').toLowerCase() !== activeCategory.toLowerCase()) {
        return false;
      }
      // Veg filter
      if (vegOnly && dish.is_veg === 0) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(dish.name || '').toLowerCase().includes(q);
        const matchesCat = String(dish.category || '').toLowerCase().includes(q);
        const matchesCode = String(dish.shortcode || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesCode) return false;
      }
      return true;
    });
  }, [session?.menu, activeCategory, vegOnly, searchQuery]);

  // Cart operations
  const handleAddToCart = (dish) => {
    setCart((prev) => {
      const current = prev[dish.id] ? prev[dish.id].quantity : 0;
      return {
        ...prev,
        [dish.id]: {
          dish,
          quantity: current + 1,
          notes: prev[dish.id]?.notes || ''
        }
      };
    });
  };

  const handleUpdateQuantity = (dishId, delta) => {
    setCart((prev) => {
      const current = prev[dishId] ? prev[dishId].quantity : 0;
      const next = current + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[dishId];
        return copy;
      }
      return {
        ...prev,
        [dishId]: {
          ...prev[dishId],
          quantity: next
        }
      };
    });
  };

  // Cart calculations
  const cartItems = Object.values(cart);
  const totalItemsCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartSubtotal = cartItems.reduce((acc, it) => acc + (Number(it.dish.price || 0) * it.quantity), 0);
  const cartTax = Math.round(cartSubtotal * 0.05 * 100) / 100; // 5% GST
  const cartGrandTotal = Math.round((cartSubtotal + cartTax) * 100) / 100;

  // Submit Order to Kitchen
  const handleGiveOrder = async () => {
    if (cartItems.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const orderPayload = {
        token,
        selectedRoom,
        notes: orderNotes.trim(),
        items: cartItems.map((it) => ({
          id: it.dish.id,
          name: it.dish.name,
          category: it.dish.category,
          price: it.dish.price,
          quantity: it.quantity,
          is_veg: it.dish.is_veg,
          notes: it.notes || ''
        }))
      };

      const res = await api.submitGuestOrder(orderPayload);
      if (res && res.success) {
        setOrderSuccessData(res);
        setCart({});
        setShowCartDrawer(false);
        setOrderNotes('');
        // Refresh session to get updated order history
        try {
          const updated = await api.getGuestSession(token);
          if (updated && updated.success) setSession(updated);
        } catch (_) {}
      } else {
        alert(res?.error || 'Failed to submit order. Please try again or inform reception.');
      }
    } catch (err) {
      alert('Error submitting order: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. LOADING SCREEN
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ fontSize: '3rem', animation: 'bounce 1s infinite' }}>🛎️</div>
        <h3 style={{ color: '#0f172a', fontWeight: 800, marginTop: '14px', marginBottom: '4px' }}>Connecting to In-Room Dining...</h3>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Hotel City Park, Solapur</p>
      </div>
    );
  }

  // 2. EXPIRED STAY SCREEN (Shown if guest clicks link after checkout)
  if (isExpired) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ backgroundColor: '#ffffff', borderRadius: '20px', maxWidth: '440px', width: '100%', padding: '32px 24px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '3.2rem', marginBottom: '12px' }}>🏨</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: '0 0 6px 0' }}>HOTEL CITY PARK</h2>
          <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '20px' }}>
            Char Hutatma Chowk, Solapur
          </div>

          <div style={{ backgroundColor: '#f8fafc', borderRadius: '14px', padding: '18px 16px', border: '1px dashed #cbd5e1', marginBottom: '24px' }}>
            <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: '6px' }}>✨</span>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', fontWeight: 850, color: '#0f766e' }}>
              Thank You for Staying With Us!
            </h4>
            <p style={{ margin: '0 0 10px 0', fontSize: '0.86rem', color: '#475569', lineHeight: 1.45 }}>
              Dear <strong>{session?.guestName || 'Valued Guest'}</strong>, your stay in Room <strong>{session?.roomNumbers || ''}</strong> has concluded.
            </p>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic' }}>
              This in-room dining session is now closed.
            </div>
          </div>

          <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.6, marginBottom: '20px' }}>
            We hope you had a comfortable and memorable stay. For future reservations or queries, please get in touch:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
            <a href="tel:02172729791" style={{ color: '#0f766e', textDecoration: 'none', padding: '10px', backgroundColor: '#f0fdfa', borderRadius: '10px' }}>
              📞 0217-2729791 / 9960013388
            </a>
            <a href="https://hotelcityparksolapur.com" target="_blank" rel="noreferrer" style={{ color: '#0f172a', textDecoration: 'none', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '10px' }}>
              🌐 www.hotelcityparksolapur.com
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 3. ERROR SCREEN
  if (error || !session) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: '#fef2f2', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ maxWidth: '400px', textAlign: 'center', backgroundColor: '#ffffff', padding: '24px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>⚠️</div>
          <h3 style={{ color: '#991b1b', fontWeight: 800, margin: '0 0 8px 0' }}>Link Not Accessible</h3>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '16px' }}>{error || 'Unable to access dining session.'}</p>
          <div style={{ fontSize: '0.82rem', color: '#475569' }}>Please request Front Desk reception to resend your in-room dining link.</div>
        </div>
      </div>
    );
  }

  const { guest, categories = [] } = session;
  const roomList = String(guest?.roomNumbers || '').split(',').map(s => s.trim()).filter(Boolean);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', paddingBottom: totalItemsCount > 0 ? '110px' : '30px', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      
      {/* Top Header Card */}
      <header
        style={{
          background: 'linear-gradient(135deg, #042f2e 0%, #0f766e 60%, #115e59 100%)',
          color: '#ffffff',
          padding: '18px 16px 22px 16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          position: 'sticky',
          top: 0,
          zIndex: 40
        }}
      >
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.6rem' }}>🏨</span>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 950, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                  HOTEL CITY PARK
                </h1>
                <span style={{ fontSize: '0.68rem', opacity: 0.85, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  In-Room Dining • Solapur
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34d399', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#a7f3d0' }}>Live Stay</span>
            </div>
          </div>

          {/* Guest Identity Card */}
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              borderRadius: '14px',
              padding: '12px 14px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
              <div style={{ fontSize: '0.96rem', fontWeight: 900, color: '#ffffff' }}>
                👋 Welcome, {guest.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#ccfbf1', fontWeight: 600 }}>
                📱 +91 {guest.mobile}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
              {/* Rooms Badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700 }}>ROOM:</span>
                {roomList.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRoom(r)}
                    style={{
                      border: 'none',
                      backgroundColor: selectedRoom === r ? '#f59e0b' : 'rgba(255,255,255,0.22)',
                      color: selectedRoom === r ? '#78350f' : '#ffffff',
                      fontSize: '0.78rem',
                      fontWeight: 950,
                      padding: '2px 8px',
                      borderRadius: '8px',
                      cursor: roomList.length > 1 ? 'pointer' : 'default',
                      boxShadow: selectedRoom === r ? '0 2px 4px rgba(0,0,0,0.2)' : 'none'
                    }}
                    title={roomList.length > 1 ? 'Click to select this room for delivery' : ''}
                  >
                    #{r}
                  </button>
                ))}
                {roomList.length > 1 && (
                  <span style={{ fontSize: '0.65rem', color: '#fef08a', fontStyle: 'italic' }}>
                    (Group Booking)
                  </span>
                )}
              </div>

              {/* Stay Dates */}
              <div style={{ fontSize: '0.72rem', color: '#ccfbf1', fontWeight: 600 }}>
                📅 In: {guest.checkinTime ? new Date(guest.checkinTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Today'}
                {guest.approxCheckoutTime ? ` • Out: ${new Date(guest.approxCheckoutTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '14px 16px' }}>

        {/* Live Pending Kitchen Order Notice Banner if active */}
        {session?.hasPendingKitchen && (
          <div
            style={{
              backgroundColor: '#fef3c7',
              border: '1.5px solid #f59e0b',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 2px 6px rgba(245, 158, 11, 0.15)'
            }}
          >
            <span style={{ fontSize: '1.5rem', animation: 'pulse 1s infinite alternate' }}>🍳</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#92400e', fontSize: '0.88rem', display: 'block' }}>
                Order Sent to Kitchen!
              </strong>
              <span style={{ fontSize: '0.78rem', color: '#b45309' }}>
                Your order is currently awaiting kitchen staff acceptance. You can still add more items below anytime!
              </span>
            </div>
          </div>
        )}

        {/* Search Bar & Veg Filter Bar */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', color: '#94a3b8' }}>🔍</span>
            <input
              type="text"
              placeholder="Search paneer, roti, biryani, tea..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                borderRadius: '12px',
                border: '1.5px solid #cbd5e1',
                fontSize: '0.9rem',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Veg Only Toggle Pill */}
          <button
            onClick={() => setVegOnly(!vegOnly)}
            style={{
              padding: '8px 12px',
              borderRadius: '12px',
              border: vegOnly ? '1.5px solid #059669' : '1.5px solid #cbd5e1',
              backgroundColor: vegOnly ? '#ecfdf5' : '#ffffff',
              color: vegOnly ? '#065f46' : '#64748b',
              fontSize: '0.78rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexShrink: 0
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />
            <span>Veg Only</span>
          </button>
        </div>

        {/* Horizontal Category Scroll Pills */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '8px',
            marginBottom: '14px',
            scrollbarWidth: 'none'
          }}
        >
          <button
            onClick={() => setActiveCategory('ALL')}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: 'none',
              backgroundColor: activeCategory === 'ALL' ? '#0f766e' : '#e2e8f0',
              color: activeCategory === 'ALL' ? '#ffffff' : '#475569',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            ⭐ All Items ({session?.menu?.length || 0})
          </button>

          {categories.map((cat) => {
            const count = (session?.menu || []).filter((d) => String(d.category || '').toLowerCase() === String(cat.name).toLowerCase()).length;
            if (count === 0) return null;
            const isActive = activeCategory.toLowerCase() === String(cat.name).toLowerCase();
            return (
              <button
                key={cat.id || cat.name}
                onClick={() => setActiveCategory(cat.name)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  backgroundColor: isActive ? '#0f766e' : '#e2e8f0',
                  color: isActive ? '#ffffff' : '#475569',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                {cat.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Dishes Listing Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredDishes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🍽️</div>
              <div style={{ fontWeight: 800 }}>No dishes found</div>
              <div style={{ fontSize: '0.82rem', marginTop: '4px' }}>Try searching another dish or clearing filters</div>
            </div>
          ) : (
            filteredDishes.map((dish) => {
              const inCart = cart[dish.id];
              const qty = inCart ? inCart.quantity : 0;
              const isVeg = dish.is_veg !== 0;

              return (
                <div
                  key={dish.id}
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div style={{ flex: 1, paddingRight: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span
                        style={{
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          backgroundColor: isVeg ? '#10b981' : '#ef4444',
                          display: 'inline-block',
                          flexShrink: 0
                        }}
                        title={isVeg ? 'Pure Veg' : 'Non-Veg'}
                      />
                      <span style={{ fontSize: '0.96rem', fontWeight: 850, color: '#0f172a' }}>
                        {dish.name}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '6px', lineHeight: 1.35 }}>
                      {dish.description || dish.category}
                    </div>

                    <div style={{ fontSize: '1rem', fontWeight: 950, color: '#0f766e' }}>
                      ₹{Number(dish.price || 0).toLocaleString('en-IN')}
                    </div>
                  </div>

                  {/* Add to order / Quantity counter button */}
                  <div>
                    {qty === 0 ? (
                      <button
                        onClick={() => handleAddToCart(dish)}
                        style={{
                          backgroundColor: '#0f766e',
                          color: '#ffffff',
                          border: 'none',
                          padding: '8px 18px',
                          borderRadius: '10px',
                          fontWeight: 900,
                          fontSize: '0.84rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          boxShadow: '0 2px 4px rgba(15, 118, 110, 0.25)'
                        }}
                      >
                        <span>+</span>
                        <span>ADD</span>
                      </button>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          backgroundColor: '#f0fdfa',
                          border: '1.5px solid #0d9488',
                          borderRadius: '10px',
                          overflow: 'hidden'
                        }}
                      >
                        <button
                          onClick={() => handleUpdateQuantity(dish.id, -1)}
                          style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#0f766e',
                            fontWeight: 900,
                            fontSize: '1rem',
                            padding: '6px 12px',
                            cursor: 'pointer'
                          }}
                        >
                          –
                        </button>
                        <span style={{ fontWeight: 950, fontSize: '0.92rem', color: '#0f766e', minWidth: '20px', textAlign: 'center' }}>
                          {qty}
                        </span>
                        <button
                          onClick={() => handleUpdateQuantity(dish.id, 1)}
                          style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#0f766e',
                            fontWeight: 900,
                            fontSize: '1rem',
                            padding: '6px 12px',
                            cursor: 'pointer'
                          }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Order History Section if past batches exist */}
        {session?.orderHistory && session.orderHistory.length > 0 && (
          <div style={{ marginTop: '28px', backgroundColor: '#ffffff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 900, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📜</span> Your Orders During This Stay
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {session.orderHistory.map((oh) => (
                <div key={oh.id} style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '10px 12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '0.82rem', color: '#0f172a' }}>
                      Batch #{oh.batch_number} ({oh.order_number})
                    </strong>
                    <span
                      style={{
                        backgroundColor: oh.status === 'accepted' ? '#dcfce7' : '#fef3c7',
                        color: oh.status === 'accepted' ? '#166534' : '#854d0e',
                        fontSize: '0.68rem',
                        fontWeight: 900,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        textTransform: 'uppercase'
                      }}
                    >
                      {oh.status === 'accepted' ? '✓ Accepted by Kitchen' : '⏳ Waiting Acceptance'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                    {(oh.items || []).map((it) => `${it.quantity || 1}x ${it.name}`).join(', ')}
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f766e', marginTop: '4px' }}>
                    Total: ₹{Number(oh.grand_total || 0).toLocaleString('en-IN')} (incl. 5% GST)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Floating Sticky Bottom Cart & Give Order Bar */}
      {totalItemsCount > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#ffffff',
            boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.12)',
            padding: '12px 16px',
            borderTop: '1px solid #e2e8f0',
            zIndex: 50
          }}
        >
          <div style={{ maxWidth: '720px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>
                  {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} Selected
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 950, color: '#0f172a' }}>
                  ₹{cartGrandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  <small style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600, marginLeft: '4px' }}>
                    (incl. GST)
                  </small>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setShowCartDrawer(true)}
                  style={{
                    backgroundColor: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  View Cart
                </button>

                <button
                  onClick={handleGiveOrder}
                  disabled={isSubmitting}
                  style={{
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '12px',
                    fontWeight: 950,
                    fontSize: '0.98rem',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🛎️</span>
                  <span>{isSubmitting ? 'Sending...' : 'Give Order'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart Review Drawer Modal */}
      {showCartDrawer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center'
          }}
          onClick={() => setShowCartDrawer(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: '20px 18px',
              boxSizing: 'border-box'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#0f172a' }}>
                Review In-Room Order
              </h3>
              <button
                onClick={() => setShowCartDrawer(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            {/* Room delivery indicator */}
            <div style={{ backgroundColor: '#f0fdfa', padding: '10px 12px', borderRadius: '10px', marginBottom: '14px', fontSize: '0.84rem', color: '#0f766e', fontWeight: 700 }}>
              🚪 Deliver to: Room #{selectedRoom} ({guest.name})
            </div>

            {/* Items Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {cartItems.map((it) => (
                <div key={it.dish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed #e2e8f0', paddingBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{it.dish.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#0f766e' }}>₹{it.dish.price} x {it.quantity}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontWeight: 900, fontSize: '0.92rem', color: '#0f172a' }}>
                      ₹{it.dish.price * it.quantity}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                      <button onClick={() => handleUpdateQuantity(it.dish.id, -1)} style={{ border: 'none', background: 'none', padding: '2px 8px', cursor: 'pointer', fontWeight: 900 }}>–</button>
                      <span style={{ fontSize: '0.82rem', fontWeight: 800 }}>{it.quantity}</span>
                      <button onClick={() => handleUpdateQuantity(it.dish.id, 1)} style={{ border: 'none', background: 'none', padding: '2px 8px', cursor: 'pointer', fontWeight: 900 }}>+</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Special Instructions Input */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                Special Cooking Request / Notes (Optional):
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Less spicy, send extra spoons, extra green chutney..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                style={{
                  width: '100%',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  padding: '8px',
                  fontSize: '0.84rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Bill Summary */}
            <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '10px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                <span>Subtotal:</span>
                <span>₹{cartSubtotal.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                <span>GST (5%):</span>
                <span>₹{cartTax.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 950, fontSize: '1rem', color: '#0f172a', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
                <span>Grand Total:</span>
                <span style={{ color: '#0f766e' }}>₹{cartGrandTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={handleGiveOrder}
              disabled={isSubmitting}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '14px',
                borderRadius: '12px',
                fontWeight: 950,
                fontSize: '1rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer'
              }}
            >
              {isSubmitting ? 'Sending to Kitchen...' : `Confirm & Give Order (₹${cartGrandTotal})`}
            </button>
          </div>
        </div>
      )}

      {/* Order Placed Success Celebration Modal */}
      {orderSuccessData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              maxWidth: '440px',
              width: '100%',
              padding: '28px 22px',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)'
            }}
          >
            <div style={{ fontSize: '3.2rem', marginBottom: '8px' }}>👨‍🍳</div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 950, color: '#0f766e', margin: '0 0 6px 0' }}>
              Order Placed with Kitchen!
            </h3>
            <div style={{ fontSize: '0.84rem', color: '#64748b', marginBottom: '16px' }}>
              Order #{orderSuccessData.orderNumber} (Batch #{orderSuccessData.batchNumber})
            </div>

            <div style={{ backgroundColor: '#f0fdfa', borderRadius: '14px', padding: '14px', border: '1px solid #ccfbf1', marginBottom: '20px', textAlign: 'left', fontSize: '0.85rem' }}>
              <div style={{ color: '#134e4a', fontWeight: 800, marginBottom: '4px' }}>
                🚪 Delivering to Room #{orderSuccessData.roomNumber}
              </div>
              <div style={{ color: '#0f766e' }}>
                Amount: <strong>₹{Number(orderSuccessData.grandTotal || 0).toFixed(2)}</strong> (Added to Room Bill)
              </div>
              <div style={{ color: '#0f766e', marginTop: '6px', fontSize: '0.78rem' }}>
                Kitchen staff will review and prepare your food.
              </div>
            </div>

            <button
              onClick={() => setOrderSuccessData(null)}
              style={{
                width: '100%',
                backgroundColor: '#0f766e',
                color: '#ffffff',
                border: 'none',
                padding: '12px',
                borderRadius: '12px',
                fontWeight: 900,
                fontSize: '0.96rem',
                cursor: 'pointer'
              }}
            >
              ✓ Got It / Order More Items
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
