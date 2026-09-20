import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency } from '../../utils/formatters';
import { printPreBillSlip, printKOTSlip, printBOTSlip } from '../../services/printService';
import StaffLittleBadge from '../common/StaffLittleBadge';

export default function TableSessionView({
  table,
  menu = [],
  categories = [],
  occupiedRooms = [],
  department = 'restaurant',
  onBack,
  onSettleBill,
  onPrintKOT,
  onPrintPrebill
}) {
  const { showToast, showConfirm } = useApp();

  const isRoomService = table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-');
  const isParcel = table.table_type === 'parcel' || table.is_parcel || table.is_takeaway;

  const [cart, setCart] = useState(() => (table && table.cart ? [...table.cart] : []));
  const initialCartRef = useRef(table && table.cart ? [...table.cart] : []);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [waiterName, setWaiterName] = useState(table.waiter_name || '');
  
  // Pre-select chargeToRoomId if room service
  const initialRoomId = useMemo(() => {
    if (table.room_id) return String(table.room_id);
    if (isRoomService) {
      const rNum = String(table.table_number || '').replace(/^RS-/i, '').trim();
      const match = occupiedRooms.find((r) => String(r.room_number) === rNum);
      if (match) return String(match.id);
    }
    return '';
  }, [table, isRoomService, occupiedRooms]);

  const [chargeToRoomId, setChargeToRoomId] = useState(initialRoomId);
  const cartEndRef = useRef(null);

  // Auto-scroll cart down as new dishes are added
  useEffect(() => {
    if (cartEndRef.current) {
      cartEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [cart.length]);

  // Synchronize cart changes if table updates
  useEffect(() => {
    if (table && table.cart && Array.isArray(table.cart) && cart.length === 0) {
      setCart([...table.cart]);
    }
  }, [table]);

  // Calculate Cart Financials
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity || item.qty) || 1), 0);
  }, [cart]);

  const gst = Math.round(subtotal * 0.05);
  const grandTotal = subtotal + gst;

  // Filtered Menu Items
  const filteredMenu = useMemo(() => {
    return menu.filter((dish) => {
      if (selectedCategory !== 'all' && dish.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = dish.name.toLowerCase().includes(q);
        const matchesCode = dish.shortcode && String(dish.shortcode).toLowerCase().includes(q.replace('#', ''));
        return matchesName || matchesCode;
      }
      return true;
    });
  }, [menu, selectedCategory, searchQuery]);

  const handleAddToCart = (dish) => {
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.id === dish.id);
      if (idx >= 0) {
        const updated = [...prev];
        const currentQty = updated[idx].quantity || updated[idx].qty || 1;
        updated[idx] = { ...updated[idx], quantity: currentQty + 1, qty: currentQty + 1 };
        return updated;
      } else {
        return [...prev, { ...dish, quantity: 1, qty: 1, notes: '' }];
      }
    });
  };

  const handleUpdateQuantity = (dishId, delta) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.id === dishId) {
            const currentQty = item.quantity || item.qty || 1;
            const nextQty = currentQty + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty, qty: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean);
    });
  };

  const handleRemoveItem = (dishId) => {
    setCart((prev) => prev.filter((item) => item.id !== dishId));
  };

  const handleQuickAddSearch = (e) => {
    if (e.key === 'Enter' && filteredMenu.length > 0) {
      e.preventDefault();
      handleAddToCart(filteredMenu[0]);
      setSearchQuery('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const firstCard = document.querySelector('.menu-item-card');
      if (firstCard) firstCard.focus();
    }
  };


  const handleKOT = async () => {
    if (cart.length === 0) {
      showToast(`Cart is empty. Please add items before sending ${department === 'bar' ? 'BOT' : 'KOT'}.`, 'red');
      return;
    }
    try {
      const payload = {
        cart,
        waiterName,
        chargeToRoomId: chargeToRoomId || null,
        subtotal,
        gst,
        grandTotal
      };
      let res;
      if (department === 'bar') {
        res = await api.generateBOT(table.id, payload);
      } else {
        res = await api.generateKOT(table.id, payload);
      }
      showToast(`${department === 'bar' ? 'BOT' : 'KOT'} generated successfully!`, 'green', 3000);
      if (onPrintKOT) {
        onPrintKOT(res);
      } else {
        if (department === 'bar') {
          printBOTSlip(res?.bot || res, res?.tableNumber || table.table_number, waiterName);
        } else {
          printKOTSlip(res?.kot || res, res?.tableNumber || table.table_number, waiterName);
        }
      }
      onBack();
    } catch (err) {
      showToast(`Error generating ${department === 'bar' ? 'BOT' : 'KOT'}: ` + err.message, 'red');
    }
  };

  const handlePreBill = async () => {
    if (cart.length === 0) {
      showToast('Cart is empty. Add items before releasing pre-bill.', 'red');
      return;
    }
    try {
      const payload = {
        cart,
        items: cart,
        waiter_name: waiterName,
        special_notes: table.special_notes,
        chargeToRoomId: chargeToRoomId || null,
        subtotal,
        gst,
        grandTotal
      };
      let res;
      if (department === 'bar') {
        res = await api.generateBarPrebill(table.id, payload);
      } else {
        res = await api.generateRestaurantPrebill(table.id, payload);
      }
      showToast('Pre-bill printed.', 'info', 2500);
      const prebillInfo = {
        table: res?.table || table,
        cart,
        items: cart,
        waiterName,
        subtotal: res?.subtotal || subtotal,
        tax: res?.tax || gst,
        gst: res?.tax || gst,
        grandTotal: res?.grandTotal || grandTotal,
        ...res
      };
      if (onPrintPrebill) {
        onPrintPrebill(prebillInfo);
      } else {
        printPreBillSlip(res?.table || table, cart, waiterName);
      }
      onBack();
    } catch (err) {
      showToast('Error generating pre-bill: ' + err.message, 'red');
    }
  };

  const handleSettle = () => {
    if (cart.length === 0) {
      showToast('Cart is empty. Add items before billing.', 'red');
      return;
    }
    if (onSettleBill) {
      onSettleBill({ table, cart, subtotal, gst, grandTotal, chargeToRoomId });
    }
  };

  const handleCancelOrder = async () => {
    const label = isRoomService
      ? `Room Service Order for ${table.name || table.table_number}`
      : isParcel
      ? `Parcel Order ${table.table_number}`
      : `Order for Table ${table.table_number}`;

    const confirmed = await showConfirm({
      title: 'Cancel Order?',
      message: `Are you sure you want to cancel and delete this active ${label}?`,
      icon: '❌',
      confirmText: 'Yes, Cancel Order',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      if (department === 'bar') {
        await api.cancelBarTable(table.id);
      } else {
        await api.cancelRestaurantTable(table.id);
      }
      showToast('Order cancelled.', 'green');
      onBack();
    } catch (err) {
      showToast('Error cancelling order: ' + err.message, 'red');
    }
  };

  // Back click handler: Auto-saves order in background and returns without blocking popup
  const handleBackClick = async () => {
    if (cart.length > 0) {
      try {
        const payload = {
          cart,
          waiterName,
          chargeToRoomId: chargeToRoomId || null,
          subtotal,
          gst,
          grandTotal
        };
        if (department === 'bar') {
          await api.saveBarCart(table.id, payload);
        } else {
          await api.saveRestaurantCart(table.id, payload);
        }
        showToast(`Order for ${titleText} saved.`, 'info', 1800);
      } catch (e) {
        console.warn('Auto-saving cart on back:', e);
      }
    } else {
      if (isRoomService || isParcel) {
        try {
          if (department === 'bar') {
            await api.cancelBarTable(table.id);
          } else {
            await api.cancelRestaurantTable(table.id);
          }
        } catch (e) {
          console.warn('Error auto-cleaning empty session:', e);
        }
      }
    }
    onBack();
  };

  // Keyboard Shortcuts (Escape / Shift+Enter: Back with auto-save; blocked if any modal/popup is open)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // If any modal/popup is open, DO NOT process shortcuts here!
      if (
        document.querySelector(
          '.modal-overlay.active, .modal-overlay[style*="display: flex"], .modal-overlay[style*="display: block"], .modal-backdrop-fixed, .custom-confirm-overlay.active'
        )
      ) {
        return;
      }

      // Don't trigger back shortcut when user is typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'Escape' || (e.shiftKey && e.key === 'Enter')) {
        e.preventDefault();
        handleBackClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, waiterName, chargeToRoomId, subtotal, gst, grandTotal]);

  // Header Title & Icon
  let titleIcon = '🍽️';
  let titleText = table.name || `Table ${table.table_number}`;
  if (isRoomService) {
    titleIcon = '🛎️';
    titleText = `Room Service • Room #${String(table.table_number || '').replace(/^RS-/i, '')}`;
  } else if (isParcel) {
    titleIcon = '📦';
    titleText = `Takeaway • ${String(table.table_number || '').replace(/^P-/i, 'Parcel #')}`;
  }

  return (
    <div id="rest-table-session-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '100%', minHeight: 0, overflow: 'hidden', animation: 'fadeIn 0.2s ease-out' }}>
      {/* Modern Top Header */}
      <div
        className="table-session-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '6px 14px',
          marginBottom: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          border: '1px solid #e2e8f0',
          gap: '10px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="universal-back-btn"
            id="btn-session-back"
            onClick={handleBackClick}
            title="Back to Tables Floor"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#eff6ff',
              border: '1.5px solid #bfdbfe',
              borderRadius: '8px',
              padding: '4px 12px',
              fontSize: '0.90rem',
              fontWeight: 850,
              color: '#1d4ed8'
            }}
          >
            <span>{titleIcon}</span>
            <span>{titleText}</span>
          </div>

          <div
            style={{
              padding: '4px 10px',
              borderRadius: '8px',
              background: '#f1f5f9',
              fontSize: '0.78rem',
              fontWeight: 800,
              color: '#475569'
            }}
          >
            {isRoomService ? '🛎️ Room Service' : isParcel ? '📦 Parcel' : '🍽️ Dine-In'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StaffLittleBadge section={department} id="btn-session-staff-badge" />
          <button
            type="button"
            className="universal-close-btn"
            onClick={handleBackClick}
            title="Close Order Session & Return to Floor"
          >
            &times;
          </button>
        </div>
      </div>

      {/* 2-Column POS Layout */}
      <div
        className="table-pos-layout"
        id="table-pos-layout-container"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: '10px',
          flex: '1 1 0',
          minHeight: 0,
          height: '100%',
          maxHeight: '100%',
          overflow: 'hidden'
        }}
      >
        {/* Left Column: Menu Catalog */}
        <div
          className="table-pos-catalog-panel"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '12px 14px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100%',
            minHeight: 0,
            overflow: 'hidden'
          }}
        >
          {/* Search Bar */}
          <div style={{ flexShrink: 0, marginBottom: '8px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: '12px', color: '#94a3b8', fontSize: '0.95rem' }}>🔍</span>
              <input
                type="text"
                placeholder="Search dish name or #shortcode (e.g. Biryani, #101)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleQuickAddSearch}
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 36px',
                  borderRadius: '10px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.88rem',
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Categories Horizontal Tabs */}
          <div
            className="pos-categories-nav"
            style={{
              flexShrink: 0,
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '8px',
              marginBottom: '10px',
              borderBottom: '1px solid #f1f5f9'
            }}
          >
            <button
              type="button"
              className={`pos-cat-btn ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
              style={{
                padding: '5px 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 750,
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: selectedCategory === 'all' ? '#0071e3' : '#f1f5f9',
                color: selectedCategory === 'all' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease'
              }}
            >
              All Items ({menu.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id || cat.name}
                type="button"
                className={`pos-cat-btn ${selectedCategory === cat.name ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.name)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 750,
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  background: selectedCategory === cat.name ? '#0071e3' : '#f1f5f9',
                  color: selectedCategory === cat.name ? '#ffffff' : '#475569',
                  transition: 'all 0.15s ease'
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Dishes Grid - Only this container scrolls, Cards keep original compact height */}
          <div
            className="menu-items-grid"
            id="restaurant-session-menu-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              alignContent: 'start',
              alignItems: 'start',
              gridAutoRows: '128px',
              gap: '12px',
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              padding: '14px 8px 16px 4px',
              marginTop: '6px'
            }}
          >
            {filteredMenu.length === 0 ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 10px', color: '#94a3b8' }}>
                No dishes found matching &quot;{searchQuery}&quot;
              </div>
            ) : (
              filteredMenu.map((dish) => {
                const cartItem = cart.find((ci) => ci.id === dish.id);
                const qtyInCart = cartItem ? (cartItem.quantity || cartItem.qty || 0) : 0;
                const isSelected = qtyInCart > 0;

                return (
                  <div
                    key={dish.id}
                    className={`menu-item-card ${isSelected ? 'selected' : ''}`}
                    tabIndex={0}
                    role="button"
                    onClick={() => handleAddToCart(dish)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleAddToCart(dish);
                      }
                    }}
                    style={{
                      background: isSelected ? '#f0f7ff' : '#ffffff',
                      border: isSelected ? '2px solid #0071e3' : '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      height: '128px',
                      minHeight: '128px',
                      maxHeight: '128px',
                      boxShadow: isSelected ? '0 4px 12px rgba(0, 113, 227, 0.16)' : '0 1px 4px rgba(0,0,0,0.04)',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                      boxSizing: 'border-box'
                    }}
                    title={isSelected ? `${dish.name} (${qtyInCart} in cart)` : 'Click to add to order'}
                  >
                    {/* Selected Quantity Circle Badge on Top Right Border */}
                    {isSelected && (
                      <div
                        className="card-top-right-qty-badge"
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: '#0071e3',
                          color: '#ffffff',
                          fontWeight: 900,
                          fontSize: '0.78rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(0, 113, 227, 0.45)',
                          zIndex: 5,
                          border: '2px solid #ffffff',
                          pointerEvents: 'none',
                          lineHeight: 1
                        }}
                      >
                        {qtyInCart}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          color: dish.is_veg ? '#16a34a' : '#dc2626'
                        }}
                      >
                        {dish.is_veg ? '🟢 VEG' : '🔴 NON-VEG'}
                      </span>
                      {dish.shortcode && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            background: '#f1f5f9',
                            color: '#475569',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 750
                          }}
                        >
                          #{dish.shortcode}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontWeight: 800,
                        color: isSelected ? '#0071e3' : '#0f172a',
                        fontSize: '0.90rem',
                        margin: '4px 0',
                        lineHeight: 1.25,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}
                    >
                      {dish.name}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <strong style={{ color: '#0071e3', fontSize: '1.05rem', fontWeight: 850 }}>
                        {formatCurrency(dish.price)}
                      </strong>

                      {isSelected ? (
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="btn-card-qty-minus"
                            onClick={() => handleUpdateQuantity(dish.id, -1)}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              border: '1.5px solid #bfdbfe',
                              background: '#ffffff',
                              color: '#0071e3',
                              fontWeight: 900,
                              fontSize: '0.95rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Decrease quantity"
                          >
                            -
                          </button>
                          <span
                            style={{
                              fontWeight: 900,
                              fontSize: '0.88rem',
                              color: '#0071e3',
                              minWidth: '18px',
                              textAlign: 'center'
                            }}
                          >
                            {qtyInCart}
                          </span>
                          <button
                            type="button"
                            className="btn-card-qty-plus"
                            onClick={() => handleAddToCart(dish)}
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '6px',
                              border: 'none',
                              background: '#0071e3',
                              color: '#ffffff',
                              fontWeight: 900,
                              fontSize: '0.95rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="Add one more"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-add-dish"
                          style={{
                            background: '#eff6ff',
                            color: '#0071e3',
                            border: '1.5px solid #bfdbfe',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            fontWeight: 900,
                            fontSize: '1.1rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          +
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Sticky Order Cart */}
        <div
          className="table-pos-cart-panel"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '10px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100%',
            minHeight: 0,
            overflow: 'hidden'
          }}
        >
          <div
            className="cart-table-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              paddingBottom: '6px',
              borderBottom: '1.5px solid #f1f5f9',
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#94a3b8',
              letterSpacing: '0.04em'
            }}
          >
            <span style={{ flex: 1 }}>ITEMS</span>
            <span style={{ width: '80px', textAlign: 'center' }}>QTY</span>
            <span style={{ width: '65px', textAlign: 'right' }}>AMOUNT</span>
            <span style={{ width: '20px' }}></span>
          </div>

          <div
            className="cart-items-scroll"
            style={{
              flex: '1 1 0',
              overflowY: 'auto',
              minHeight: 0,
              padding: '4px 0'
            }}
          >
            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '4px' }}>🛒</div>
                <div style={{ fontWeight: 750, fontSize: '0.88rem', color: '#475569' }}>Order is empty</div>
                <small style={{ fontSize: '0.74rem' }}>Select dishes from the menu to add to this order</small>
              </div>
            ) : (
              cart.map((item) => {
                const itemQty = item.quantity || item.qty || 1;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 0',
                      borderBottom: '1px solid #f8fafc'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '6px' }}>
                      <div
                        style={{
                          fontWeight: 750,
                          fontSize: '0.82rem',
                          color: '#0f172a',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {item.is_veg ? '🟢' : '🔴'} {item.name}
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                        {formatCurrency(item.price)} each
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '80px', justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.id, -1)}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '0.85rem'
                        }}
                      >
                        -
                      </button>
                      <span style={{ fontWeight: 800, fontSize: '0.86rem', minWidth: '18px', textAlign: 'center' }}>
                        {itemQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.id, 1)}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '0.85rem'
                        }}
                      >
                        +
                      </button>
                    </div>

                    <div style={{ width: '65px', textAlign: 'right', fontWeight: 800, fontSize: '0.86rem', color: '#0f172a' }}>
                      {formatCurrency(item.price * itemQty)}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      style={{
                        width: '20px',
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        padding: 0,
                        marginLeft: '4px'
                      }}
                      title="Remove item"
                    >
                      &times;
                    </button>
                  </div>
                );
              })
            )}
            <div ref={cartEndRef} />
          </div>

          {/* Cart Financial Summary */}
          <div className="cart-financial-summary" style={{ borderTop: '2px solid #f1f5f9', paddingTop: '6px', marginTop: 'auto', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem', color: '#64748b', marginBottom: '2px' }}>
              <span>Subtotal:</span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{formatCurrency(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem', color: '#64748b', marginBottom: '3px' }}>
              <span>GST (5%):</span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{formatCurrency(gst)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '1.05rem',
                fontWeight: 900,
                color: '#0f172a',
                paddingTop: '3px',
                borderTop: '1px dashed #e2e8f0',
                marginBottom: '6px'
              }}
            >
              <span>Grand Total:</span>
              <span style={{ color: '#0071e3' }}>{formatCurrency(grandTotal)}</span>
            </div>

            {/* Action Buttons Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 1fr', gap: '5px' }}>
              <button
                type="button"
                className="pos-btn-kot"
                id="pos-btn-action-kot"
                onClick={handleKOT}
                style={{
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 4px',
                  fontWeight: 800,
                  fontSize: '0.80rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)'
                }}
              >
                <span>🖨️ {department === 'bar' ? 'BOT' : 'KOT'}</span>
              </button>

              <button
                type="button"
                className="pos-btn-prebill"
                id="pos-btn-action-prebill"
                onClick={handlePreBill}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 4px',
                  fontWeight: 800,
                  fontSize: '0.80rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                <span>🧾 Pre-Bill</span>
              </button>

              <button
                type="button"
                className="pos-btn-settle"
                id="pos-btn-action-settle"
                onClick={handleSettle}
                style={{
                  background: 'linear-gradient(135deg, #0071e3 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 4px',
                  fontWeight: 800,
                  fontSize: '0.80rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(0, 113, 227, 0.25)'
                }}
              >
                <span>💳 Settle</span>
              </button>
            </div>

            <button
              type="button"
              className="pos-btn-cancel"
              onClick={handleCancelOrder}
              style={{
                width: '100%',
                marginTop: '4px',
                background: '#fff1f2',
                color: '#e11d48',
                border: '1.5px solid #fecdd3',
                borderRadius: '8px',
                padding: '5px 8px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              ✕ Cancel Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
