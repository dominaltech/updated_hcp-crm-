import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import ThemedSelect from '../common/ThemedSelect';

export default function AdvanceBookingModal({
  isOpen,
  onClose,
  rooms = [],
  onStartCheckinFromBooking,
  initialBooking = null,
  initialTab = 'pending'
}) {
  const { showToast, showConfirm, showAlert, theme } = useApp();
  const isDark = theme === 'dark' || (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark');

  const [activeTab, setActiveTab] = useState(initialTab || 'pending'); // 'pending' | 'completed' | 'new'
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Form State for New / Edit Booking
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    customer_name: '',
    age: '',
    address: '',
    phone: '',
    room_number: '',
    adults: 1,
    children: 0,
    checkin_date: '',
    checkin_time: '12:00',
    checkout_date: '',
    checkout_time: '11:00',
    advance_amount: '',
    payment_mode: 'cash',
    notes: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set default dates for new booking
  const resetForm = () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

    const defaultRoom = rooms.find((r) => r.status === 'ready') || rooms[0] || {};

    setEditingId(null);
    setFormData({
      customer_name: '',
      age: '',
      address: '',
      phone: '',
      room_number: defaultRoom.room_number || '',
      adults: defaultRoom.max_adults || 2,
      children: 0,
      checkin_date: todayStr,
      checkin_time: '12:00',
      checkout_date: tomorrowStr,
      checkout_time: '11:00',
      advance_amount: '',
      payment_mode: 'cash',
      notes: ''
    });
  };

  // Keyboard shortcut: ESC to close fullscreen modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load Bookings from API
  const loadBookings = async () => {
    setLoading(true);
    try {
      const res = await api.getAdvanceBookings();
      if (res && res.success && Array.isArray(res.bookings)) {
        setBookings(res.bookings);
      } else if (Array.isArray(res)) {
        setBookings(res);
      }
    } catch (err) {
      console.error('Failed to load advance bookings:', err);
      showToast('Could not load advance bookings', 'error', 3000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadBookings();
      if (initialBooking) {
        handleEdit(initialBooking);
      } else if (initialTab) {
        setActiveTab(initialTab);
        if (initialTab === 'new') resetForm();
      }
    }
  }, [isOpen, initialBooking, initialTab]);

  // Submit Handler for New / Edit Booking
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.customer_name.trim()) {
      showToast('Please enter customer name', 'error', 3000);
      return;
    }
    if (!formData.room_number) {
      showToast('Please select a booking room number', 'error', 3000);
      return;
    }
    if (!formData.checkin_date || !formData.checkout_date) {
      showToast('Please specify check-in and check-out dates', 'error', 3000);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ...formData,
        age: formData.age ? parseInt(formData.age) : null,
        adults: parseInt(formData.adults) || 1,
        children: parseInt(formData.children) || 0,
        advance_amount: formData.advance_amount ? parseFloat(formData.advance_amount) : 0
      };

      if (editingId) {
        const res = await api.updateAdvanceBooking(editingId, payload);
        if (res && res.success) {
          showToast('Advance booking updated successfully! ✓', 'success', 3500);
          resetForm();
          setActiveTab('pending');
          await loadBookings();
        } else {
          showToast(res?.error || 'Failed to update advance booking', 'error', 4000);
        }
      } else {
        const res = await api.createAdvanceBooking(payload);
        if (res && res.success) {
          showToast(`Advance booking created for ${formData.customer_name}! ✓`, 'success', 3500);
          resetForm();
          setActiveTab('pending');
          await loadBookings();
        } else {
          showToast(res?.error || 'Failed to create advance booking', 'error', 4000);
        }
      }
    } catch (err) {
      console.error('Error saving advance booking:', err);
      showToast(`Error: ${err.message || 'Failed to save advance booking'}`, 'error', 4000);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status Toggle: Mark Completed / Pending
  const handleMarkStatus = async (id, status) => {
    try {
      const res = await api.updateAdvanceBookingStatus(id, status);
      if (res && res.success) {
        showToast(status === 'completed' ? 'Booking marked as Completed ✓' : 'Booking moved back to Pending ✓', 'success', 3000);
        await loadBookings();
      } else {
        showToast(res?.error || 'Failed to update status', 'error', 3000);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error', 3000);
    }
  };

  // Delete Booking
  const handleDelete = async (id, name) => {
    const confirmed = await showConfirm({
      title: 'Delete Advance Booking',
      message: `Are you sure you want to permanently delete the advance booking for "${name}"?`,
      confirmText: 'Yes, Delete',
      cancelText: 'Cancel',
      isDestructive: true,
      icon: '🗑️'
    });
    if (!confirmed) {
      return;
    }
    try {
      const res = await api.deleteAdvanceBooking(id);
      if (res && res.success) {
        showToast('Advance booking deleted ✓', 'info', 3000);
        await loadBookings();
      } else {
        showToast(res?.error || 'Failed to delete booking', 'error', 3000);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error', 3000);
    }
  };

  // Edit Booking Trigger
  const handleEdit = (b) => {
    setEditingId(b.id);
    setFormData({
      customer_name: b.customer_name || '',
      age: b.age || '',
      address: b.address || '',
      phone: b.phone || '',
      room_number: b.room_number || '',
      adults: b.adults || 1,
      children: b.children || 0,
      checkin_date: b.checkin_date || '',
      checkin_time: b.checkin_time || '12:00',
      checkout_date: b.checkout_date || '',
      checkout_time: b.checkout_time || '11:00',
      advance_amount: b.advance_amount || '',
      payment_mode: b.payment_mode || 'cash',
      notes: b.notes || ''
    });
    setActiveTab('new');
  };

  // Check-In Now: Bridges directly into Room Check-in Wizard
  const handleCheckinNow = (b) => {
    if (onStartCheckinFromBooking) {
      onStartCheckinFromBooking(b);
    } else {
      showToast(`Pre-filling Check-In Wizard for ${b.customer_name} (Room #${b.room_number})`, 'info', 3500);
    }
  };

  if (!isOpen) return null;

  // Filter Lists
  const pendings = bookings.filter((b) => b.status === 'pending');
  const completed = bookings.filter((b) => b.status === 'completed');

  const currentList = activeTab === 'completed' ? completed : pendings;
  const filteredList = currentList.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (b.customer_name && b.customer_name.toLowerCase().includes(q)) ||
      (b.room_number && String(b.room_number).includes(q)) ||
      (b.phone && b.phone.includes(q)) ||
      (b.booking_number && b.booking_number.toLowerCase().includes(q)) ||
      (b.address && b.address.toLowerCase().includes(q))
    );
  });

  // Dynamic Theme Palette
  const t = {
    isDark,
    bgModal: isDark ? '#0A191C' : '#F8FAFC',
    bgHeader: isDark ? 'linear-gradient(90deg, #132D33 0%, #0F2A2E 100%)' : '#FFFFFF',
    headerBorder: isDark ? '#1E3A3F' : '#E2E8F0',
    titleColor: isDark ? '#E2B25E' : '#B45309',
    subTextColor: isDark ? '#94A3B8' : '#64748B',
    tabBarBg: isDark ? '#0C2327' : '#FFFFFF',
    tabBarBorder: isDark ? '#1E3A3F' : '#E2E8F0',
    cardBg: isDark ? '#132D33' : '#FFFFFF',
    cardBorder: isDark ? '#1E3A3F' : '#E2E8F0',
    cardShadow: isDark ? '0 4px 14px rgba(0, 0, 0, 0.35)' : '0 2px 10px rgba(0, 0, 0, 0.05)',
    inputBg: isDark ? '#0F282D' : '#FFFFFF',
    inputBorder: isDark ? '#24464D' : '#CBD5E1',
    inputText: isDark ? '#FFFFFF' : '#0F172A',
    inputPlaceholder: isDark ? '#64748B' : '#94A3B8',
    labelPrimary: isDark ? '#E2B25E' : '#B45309',
    labelSecondary: isDark ? '#CBD5E1' : '#334155',
    textPrimary: isDark ? '#F8FAFC' : '#0F172A',
    textSecondary: isDark ? '#94A3B8' : '#64748B',
    innerBoxBg: isDark ? 'rgba(10, 25, 28, 0.55)' : '#F8FAFC',
    innerBoxBorder: isDark ? '#1E3A3F' : '#E2E8F0',
    closeBtnBg: isDark ? 'rgba(255, 255, 255, 0.08)' : '#F1F5F9',
    closeBtnHoverBg: isDark ? 'rgba(255, 255, 255, 0.16)' : '#E2E8F0',
    closeBtnColor: isDark ? '#94A3B8' : '#475569',
    actionBtnBg: isDark ? '#1E3A3F' : '#F1F5F9',
    actionBtnBorder: isDark ? '#24464D' : '#CBD5E1',
    actionBtnText: isDark ? '#94A3B8' : '#334155',
    dateBoxCnBg: isDark ? 'rgba(226, 178, 94, 0.08)' : '#FEF3C7',
    dateBoxCnBorder: isDark ? '#E2B25E' : '#F59E0B',
    dateBoxCnColor: isDark ? '#E2B25E' : '#B45309',
    dateBoxCoBg: isDark ? 'rgba(56, 189, 248, 0.08)' : '#E0F2FE',
    dateBoxCoBorder: isDark ? '#38BDF8' : '#38BDF8',
    dateBoxCoColor: isDark ? '#38BDF8' : '#0284C7',
    dateBoxPayBg: isDark ? 'rgba(16, 185, 129, 0.08)' : '#ECFDF5',
    dateBoxPayBorder: isDark ? '#10B981' : '#10B981',
    dateBoxPayColor: isDark ? '#10B981' : '#059669',
  };

  return (
    <div
      className="adv-fullscreen-overlay"
      id="adv-fullscreen-overlay"
      data-theme={isDark ? 'dark' : 'light'}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        backgroundColor: t.bgModal,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div
        className="adv-fullscreen-container"
        id="adv-fullscreen-container"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: t.bgModal,
          color: t.textPrimary
        }}
      >
        {/* ========================================================================= */}
        {/* FULLSCREEN HEADER BAR                                                      */}
        {/* ========================================================================= */}
        <div
          style={{
            padding: '12px 28px',
            borderBottom: `1.5px solid ${t.headerBorder}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: t.bgHeader,
            boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.05)',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #E2B25E 0%, #D4A045 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                boxShadow: '0 4px 12px rgba(226, 178, 94, 0.35)',
                color: '#0A191C'
              }}
            >
              📅
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: t.titleColor, margin: 0, letterSpacing: '0.2px' }}>
                  Advance Bookings & Pre-Reservations
                </h1>
                <span
                  style={{
                    fontSize: '0.70rem',
                    padding: '2px 8px',
                    borderRadius: '8px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    background: isDark ? '#1E3A3F' : '#E2E8F0',
                    color: isDark ? '#E2B25E' : '#475569',
                    letterSpacing: '0.5px'
                  }}
                >
                  Entire Screen Mode
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: t.subTextColor, margin: '2px 0 0' }}>
                Manage upcoming customer reservations, schedule 48-hour check-in alerts, and view booking history
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {activeTab !== 'new' && (
              <button
                type="button"
                id="btn-modal-new-advance-booking"
                onClick={() => {
                  resetForm();
                  setActiveTab('new');
                }}
                style={{
                  background: 'linear-gradient(135deg, #E2B25E 0%, #D4A045 100%)',
                  color: '#0A191C',
                  border: 'none',
                  padding: '9px 20px',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(226, 178, 94, 0.35)',
                  transition: 'transform 0.15s ease'
                }}
              >
                <span style={{ fontSize: '1rem' }}>➕</span>
                <span>New Advance Booking</span>
              </button>
            )}

            {/* Prominent Fullscreen Close Button */}
            <button
              type="button"
              id="btn-close-advance-booking-modal"
              onClick={onClose}
              title="Close Fullscreen (Esc)"
              style={{
                background: t.closeBtnBg,
                color: t.closeBtnColor,
                border: `1px solid ${t.headerBorder}`,
                padding: '6px 14px',
                height: '38px',
                borderRadius: '10px',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontSize: '1.1rem', fontWeight: 900 }}>✕</span>
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TABS NAVIGATION & SEARCH BAR                                              */}
        {/* ========================================================================= */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 28px',
            borderBottom: `1px solid ${t.tabBarBorder}`,
            backgroundColor: t.tabBarBg,
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Tab: Pendings */}
            <button
              type="button"
              id="tab-advance-pendings"
              onClick={() => setActiveTab('pending')}
              style={{
                padding: '8px 20px',
                borderRadius: '10px',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.90rem',
                cursor: 'pointer',
                background: activeTab === 'pending' ? (isDark ? '#E2B25E' : '#0F172A') : (isDark ? '#16363D' : '#E2E8F0'),
                color: activeTab === 'pending' ? (isDark ? '#0A191C' : '#FFFFFF') : (isDark ? '#94A3B8' : '#475569'),
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'pending' ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
              }}
            >
              <span>⏳ Pendings</span>
              <span
                style={{
                  background: activeTab === 'pending' ? (isDark ? '#0A191C' : '#38BDF8') : (isDark ? '#24464D' : '#CBD5E1'),
                  color: activeTab === 'pending' ? (isDark ? '#E2B25E' : '#0F172A') : (isDark ? '#F8FAFC' : '#1E293B'),
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.74rem',
                  fontWeight: 900
                }}
              >
                {pendings.length}
              </span>
            </button>

            {/* Tab: Completed */}
            <button
              type="button"
              id="tab-advance-completed"
              onClick={() => setActiveTab('completed')}
              style={{
                padding: '8px 20px',
                borderRadius: '10px',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.90rem',
                cursor: 'pointer',
                background: activeTab === 'completed' ? '#10B981' : (isDark ? '#16363D' : '#E2E8F0'),
                color: activeTab === 'completed' ? '#FFFFFF' : (isDark ? '#94A3B8' : '#475569'),
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: activeTab === 'completed' ? '0 2px 8px rgba(16,185,129,0.3)' : 'none'
              }}
            >
              <span>✅ Completed</span>
              <span
                style={{
                  background: activeTab === 'completed' ? '#064E3B' : (isDark ? '#24464D' : '#CBD5E1'),
                  color: activeTab === 'completed' ? '#A7F3D0' : (isDark ? '#F8FAFC' : '#1E293B'),
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.74rem',
                  fontWeight: 900
                }}
              >
                {completed.length}
              </span>
            </button>

            {/* New / Edit Active Indicator */}
            {activeTab === 'new' && (
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  background: '#0284C7',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)'
                }}
              >
                <span>{editingId ? '✏️ Editing Reservation' : '➕ Insert Customer Information'}</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('pending')}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    color: '#FFF',
                    borderRadius: '50%',
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title="Cancel & Back to list"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Search Box */}
          {activeTab !== 'new' && (
            <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
              <input
                type="text"
                placeholder="Search guest name, room, phone, advance..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: t.inputBg,
                  border: `1.5px solid ${t.inputBorder}`,
                  borderRadius: '10px',
                  padding: '8px 14px 8px 34px',
                  fontSize: '0.86rem',
                  color: t.inputText,
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: '11px',
                  top: '9px',
                  fontSize: '14px',
                  color: t.textSecondary
                }}
              >
                🔍
              </span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '7px',
                    background: 'none',
                    border: 'none',
                    color: t.textSecondary,
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* FULLSCREEN BODY: FORM OR LIST                                              */}
        {/* ========================================================================= */}
        <div
          style={{
            padding: '24px 32px',
            overflowY: 'auto',
            flex: 1,
            backgroundColor: t.bgModal
          }}
        >
          {activeTab === 'new' ? (
            /* ========================================================================= */
            /* INSERT / EDIT FORM VIEW - ENTIRE SCREEN RESPONSIVE GRID                   */
            /* ========================================================================= */
            <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
              <div
                style={{
                  background: t.cardBg,
                  border: `1.5px solid ${t.cardBorder}`,
                  borderRadius: '16px',
                  padding: '28px',
                  boxShadow: t.cardShadow
                }}
              >
                {/* Form Section Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', borderBottom: `1px solid ${t.headerBorder}`, paddingBottom: '14px' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: t.titleColor }}>
                      {editingId ? 'Edit Advance Reservation' : 'Insert Customer Information & Advance Booking'}
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: t.subTextColor }}>
                      Fill in guest credentials, room allocation, check-in & check-out schedule, and advance payment.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pending')}
                    style={{
                      background: t.actionBtnBg,
                      color: t.actionBtnText,
                      border: `1px solid ${t.actionBtnBorder}`,
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer'
                    }}
                  >
                    ← Back to List
                  </button>
                </div>

                <form onSubmit={handleSubmit}>
                  {/* Grid Layout taking advantage of wide screen */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                      gap: '18px',
                      marginBottom: '20px'
                    }}
                  >
                    {/* 1. Customer Name */}
                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelPrimary, textTransform: 'uppercase', marginBottom: '6px' }}>
                        Customer Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Rajesh Kumar Sharma"
                        value={formData.customer_name}
                        onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '11px 14px',
                          background: t.inputBg,
                          border: `1.5px solid ${t.inputBorder}`,
                          borderRadius: '10px',
                          color: t.inputText,
                          fontSize: '0.94rem',
                          outline: 'none',
                          fontWeight: 600
                        }}
                      />
                    </div>

                    {/* 2. Age */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                        Age
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        placeholder="e.g. 35"
                        value={formData.age}
                        onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '11px 14px',
                          background: t.inputBg,
                          border: `1.5px solid ${t.inputBorder}`,
                          borderRadius: '10px',
                          color: t.inputText,
                          fontSize: '0.94rem',
                          outline: 'none',
                          fontWeight: 600
                        }}
                      />
                    </div>

                    {/* 3. Phone / Mobile */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                        Mobile / Phone Number
                      </label>
                      <input
                        type="tel"
                        placeholder="e.g. 9829012345"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '11px 14px',
                          background: t.inputBg,
                          border: `1.5px solid ${t.inputBorder}`,
                          borderRadius: '10px',
                          color: t.inputText,
                          fontSize: '0.94rem',
                          outline: 'none',
                          fontWeight: 600
                        }}
                      />
                    </div>

                    {/* 4. Address */}
                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                        Address / City
                      </label>
                      <input
                        type="text"
                        placeholder="Residential address, City, or State"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '11px 14px',
                          background: t.inputBg,
                          border: `1.5px solid ${t.inputBorder}`,
                          borderRadius: '10px',
                          color: t.inputText,
                          fontSize: '0.94rem',
                          outline: 'none',
                          fontWeight: 600
                        }}
                      />
                    </div>

                    {/* 5. Booking Room Number */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelPrimary, textTransform: 'uppercase', marginBottom: '6px' }}>
                        Booking Room Number *
                      </label>
                      <ThemedSelect
                        id="adv-booking-room-select"
                        value={formData.room_number}
                        onChange={(val) => setFormData({ ...formData, room_number: val })}
                        placeholder="Select Room Number"
                        colorTheme="amber"
                        isDark={isDark}
                        required
                        leadingIcon="🏨"
                        isSearchable
                        searchPlaceholder="Search room # or type..."
                        options={rooms.map((r) => ({
                          value: r.room_number,
                          label: `Room #${r.room_number}`,
                          subtitle: r.room_type,
                          tag: r.status === 'occupied' ? 'Occupied' : 'Ready',
                          tagColor: r.status === 'occupied' ? '#B45309' : '#15803D',
                          tagBg: r.status === 'occupied'
                            ? (isDark ? 'rgba(217, 119, 6, 0.2)' : '#FEF3C7')
                            : (isDark ? 'rgba(16, 185, 129, 0.2)' : '#DCFCE7')
                        }))}
                        style={{ width: '100%' }}
                      />
                    </div>

                    {/* 6. Adults & Children (Combined Box) */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                          Adults
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={formData.adults}
                          onChange={(e) => setFormData({ ...formData, adults: parseInt(e.target.value) || 1 })}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '11px 14px',
                            background: t.inputBg,
                            border: `1.5px solid ${t.inputBorder}`,
                            borderRadius: '10px',
                            color: t.inputText,
                            fontSize: '0.94rem',
                            outline: 'none',
                            fontWeight: 700
                          }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                          Children
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={formData.children}
                          onChange={(e) => setFormData({ ...formData, children: parseInt(e.target.value) || 0 })}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '11px 14px',
                            background: t.inputBg,
                            border: `1.5px solid ${t.inputBorder}`,
                            borderRadius: '10px',
                            color: t.inputText,
                            fontSize: '0.94rem',
                            outline: 'none',
                            fontWeight: 700
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Date, Time & Payment Highlighted Strip */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                      gap: '16px',
                      marginBottom: '20px'
                    }}
                  >
                    {/* 7. Check-in Date & Time (c/n) */}
                    <div
                      style={{
                        background: t.dateBoxCnBg,
                        border: `1.5px solid ${t.dateBoxCnBorder}`,
                        borderRadius: '12px',
                        padding: '14px'
                      }}
                    >
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.dateBoxCnColor, textTransform: 'uppercase', marginBottom: '8px' }}>
                        Check-in Date & Time (c/n) *
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="date"
                          required
                          value={formData.checkin_date}
                          onChange={(e) => setFormData({ ...formData, checkin_date: e.target.value })}
                          style={{
                            flex: 2,
                            padding: '10px',
                            background: t.inputBg,
                            border: `1px solid ${t.inputBorder}`,
                            borderRadius: '8px',
                            color: t.inputText,
                            fontSize: '0.90rem',
                            fontWeight: 700
                          }}
                        />
                        <input
                          type="time"
                          required
                          value={formData.checkin_time}
                          onChange={(e) => setFormData({ ...formData, checkin_time: e.target.value })}
                          style={{
                            flex: 1,
                            padding: '10px',
                            background: t.inputBg,
                            border: `1px solid ${t.inputBorder}`,
                            borderRadius: '8px',
                            color: t.inputText,
                            fontSize: '0.90rem',
                            fontWeight: 700
                          }}
                        />
                      </div>
                    </div>

                    {/* 8. Check-out Date & Time (c/o) */}
                    <div
                      style={{
                        background: t.dateBoxCoBg,
                        border: `1.5px solid ${t.dateBoxCoBorder}`,
                        borderRadius: '12px',
                        padding: '14px'
                      }}
                    >
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.dateBoxCoColor, textTransform: 'uppercase', marginBottom: '8px' }}>
                        Check-out Date & Time (c/o) *
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="date"
                          required
                          value={formData.checkout_date}
                          onChange={(e) => setFormData({ ...formData, checkout_date: e.target.value })}
                          style={{
                            flex: 2,
                            padding: '10px',
                            background: t.inputBg,
                            border: `1px solid ${t.inputBorder}`,
                            borderRadius: '8px',
                            color: t.inputText,
                            fontSize: '0.90rem',
                            fontWeight: 700
                          }}
                        />
                        <input
                          type="time"
                          required
                          value={formData.checkout_time}
                          onChange={(e) => setFormData({ ...formData, checkout_time: e.target.value })}
                          style={{
                            flex: 1,
                            padding: '10px',
                            background: t.inputBg,
                            border: `1px solid ${t.inputBorder}`,
                            borderRadius: '8px',
                            color: t.inputText,
                            fontSize: '0.90rem',
                            fontWeight: 700
                          }}
                        />
                      </div>
                    </div>

                    {/* 9. Advance Payment & Mode */}
                    <div
                      style={{
                        background: t.dateBoxPayBg,
                        border: `1.5px solid ${t.dateBoxPayBorder}`,
                        borderRadius: '12px',
                        padding: '14px'
                      }}
                    >
                      <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.dateBoxPayColor, textTransform: 'uppercase', marginBottom: '8px' }}>
                        Advance Paid Amount (₹) & Mode
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="number"
                          min="0"
                          placeholder="₹ 0.00"
                          value={formData.advance_amount}
                          onChange={(e) => setFormData({ ...formData, advance_amount: e.target.value })}
                          style={{
                            flex: 1.2,
                            padding: '10px',
                            background: t.inputBg,
                            border: `1px solid ${t.inputBorder}`,
                            borderRadius: '8px',
                            color: t.inputText,
                            fontSize: '0.90rem',
                            fontWeight: 700
                          }}
                        />
                        <ThemedSelect
                          id="adv-booking-payment-select"
                          value={formData.payment_mode}
                          onChange={(val) => setFormData({ ...formData, payment_mode: val })}
                          placeholder="Payment Mode"
                          colorTheme="emerald"
                          isDark={isDark}
                          options={[
                            { value: 'cash', label: 'Cash', icon: '💵' },
                            { value: 'online', label: 'UPI / Online', icon: '📱' },
                            { value: 'card', label: 'Card', icon: '💳' },
                            { value: 'cheque', label: 'Cheque', icon: '📝' }
                          ]}
                          style={{ flex: 1, minWidth: '140px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 10. Notes / Special Instructions */}
                  <div style={{ marginBottom: '22px' }}>
                    <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: t.labelSecondary, textTransform: 'uppercase', marginBottom: '6px' }}>
                      Special Requests / Notes
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. VIP guest, late arrival around 4 PM, extra bed, early breakfast"
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '11px 14px',
                        background: t.inputBg,
                        border: `1.5px solid ${t.inputBorder}`,
                        borderRadius: '10px',
                        color: t.inputText,
                        fontSize: '0.92rem',
                        outline: 'none',
                        fontWeight: 500
                      }}
                    />
                  </div>

                  {/* Form Action Buttons */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: '12px',
                      paddingTop: '18px',
                      borderTop: `1px solid ${t.headerBorder}`
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setActiveTab('pending');
                      }}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '10px',
                        background: t.actionBtnBg,
                        border: `1px solid ${t.actionBtnBorder}`,
                        color: t.actionBtnText,
                        fontWeight: 700,
                        fontSize: '0.90rem',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        padding: '12px 32px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #E2B25E 0%, #D4A045 100%)',
                        border: 'none',
                        color: '#0A191C',
                        fontWeight: 900,
                        fontSize: '0.96rem',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(226, 178, 94, 0.35)',
                        transition: 'transform 0.15s ease'
                      }}
                    >
                      {isSubmitting ? 'Saving...' : editingId ? '💾 Update Advance Reservation' : '💾 Save Advance Reservation'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            /* ========================================================================= */
            /* FULLSCREEN LIST VIEW: PENDINGS OR COMPLETED                               */
            /* ========================================================================= */
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: t.textSecondary }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>⏳</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }}>Loading advance bookings...</div>
                </div>
              ) : filteredList.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '80px 20px',
                    background: t.cardBg,
                    border: `1.5px solid ${t.cardBorder}`,
                    borderRadius: '16px',
                    boxShadow: t.cardShadow
                  }}
                >
                  <div style={{ fontSize: '52px', marginBottom: '16px' }}>
                    {activeTab === 'pending' ? '📅' : '🎉'}
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: t.textPrimary, fontSize: '1.25rem', fontWeight: 800 }}>
                    {activeTab === 'pending' ? 'No Pending Advance Bookings Found' : 'No Completed Pre-Bookings Yet'}
                  </h3>
                  <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: t.subTextColor }}>
                    {activeTab === 'pending'
                      ? 'Click "+ New Advance Booking" at top right to insert customer credentials and reserve a room.'
                      : 'When a pending pre-booking checks in, it will show up here.'}
                  </p>
                  {activeTab === 'pending' && (
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setActiveTab('new');
                      }}
                      style={{
                        background: 'linear-gradient(135deg, #E2B25E 0%, #D4A045 100%)',
                        color: '#0A191C',
                        border: 'none',
                        padding: '10px 22px',
                        borderRadius: '10px',
                        fontWeight: 800,
                        fontSize: '0.90rem',
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(226, 178, 94, 0.35)'
                      }}
                    >
                      ➕ Create First Advance Booking
                    </button>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))',
                    gap: '16px'
                  }}
                >
                  {filteredList.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        background: t.cardBg,
                        border: b.is_within_48h && b.status === 'pending' ? '2px solid #EF4444' : `1.5px solid ${t.cardBorder}`,
                        borderRadius: '14px',
                        padding: '18px',
                        boxShadow:
                          b.is_within_48h && b.status === 'pending'
                            ? '0 0 18px rgba(239, 68, 68, 0.3)'
                            : t.cardShadow,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                      }}
                    >
                      {/* Top Header: Customer details & Room badge */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '1.15rem', fontWeight: 850, color: t.textPrimary }}>
                              {b.customer_name}
                            </span>
                            {b.age ? (
                              <span
                                style={{
                                  fontSize: '0.74rem',
                                  background: isDark ? '#1E3A3F' : '#E2E8F0',
                                  color: isDark ? '#94A3B8' : '#334155',
                                  padding: '1px 6px',
                                  borderRadius: '6px',
                                  fontWeight: 700
                                }}
                              >
                                {b.age} yrs
                              </span>
                            ) : null}
                            <span
                              style={{
                                fontSize: '0.72rem',
                                color: isDark ? '#E2B25E' : '#B45309',
                                background: isDark ? 'rgba(226, 178, 94, 0.12)' : '#FEF3C7',
                                padding: '2px 8px',
                                borderRadius: '8px',
                                fontWeight: 800
                              }}
                            >
                              {b.booking_number || `#ADV-${b.id}`}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.80rem', color: t.textSecondary, marginTop: '5px', flexWrap: 'wrap' }}>
                            {b.phone ? <span>📞 <strong>{b.phone}</strong></span> : null}
                            {b.address ? <span>📍 {b.address}</span> : null}
                          </div>
                        </div>

                        {/* Room Allocation Chip */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                              color: '#FFFFFF',
                              fontSize: '0.95rem',
                              fontWeight: 900,
                              padding: '5px 14px',
                              borderRadius: '10px',
                              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.35)'
                            }}
                          >
                            Room #{b.room_number}
                          </span>
                          <div style={{ fontSize: '0.74rem', color: t.textSecondary, marginTop: '3px', fontWeight: 600 }}>
                            {b.room_type || 'Standard Room'}
                          </div>
                        </div>
                      </div>

                      {/* Middle Info Strip: Check-in, Check-out, Guests, Advance */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: '10px',
                          background: t.innerBoxBg,
                          border: `1px solid ${t.innerBoxBorder}`,
                          padding: '12px 14px',
                          borderRadius: '10px',
                          fontSize: '0.82rem'
                        }}
                      >
                        {/* c/n (Check-In) */}
                        <div>
                          <span style={{ color: t.dateBoxCnColor, fontWeight: 800, display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                            c/n (Check-In)
                          </span>
                          <span style={{ color: t.textPrimary, fontWeight: 800 }}>
                            {b.checkin_date}
                          </span>
                          <span style={{ color: t.textSecondary, fontSize: '0.75rem', display: 'block' }}>
                            at {b.checkin_time || '12:00'}
                          </span>
                        </div>

                        {/* c/o (Check-Out) */}
                        <div>
                          <span style={{ color: t.dateBoxCoColor, fontWeight: 800, display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                            c/o (Check-Out)
                          </span>
                          <span style={{ color: t.textPrimary, fontWeight: 800 }}>
                            {b.checkout_date}
                          </span>
                          <span style={{ color: t.textSecondary, fontSize: '0.75rem', display: 'block' }}>
                            at {b.checkout_time || '11:00'}
                          </span>
                        </div>

                        {/* Guests */}
                        <div>
                          <span style={{ color: t.labelSecondary, fontWeight: 800, display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                            Guests
                          </span>
                          <span style={{ color: t.textPrimary, fontWeight: 700 }}>
                            👥 {b.adults} Adult{b.adults > 1 ? 's' : ''}
                          </span>
                          {b.children > 0 && (
                            <span style={{ color: t.textSecondary, fontSize: '0.75rem', display: 'block' }}>
                              + {b.children} Child{b.children > 1 ? 'ren' : ''}
                            </span>
                          )}
                        </div>

                        {/* Advance Paid */}
                        <div>
                          <span style={{ color: t.dateBoxPayColor, fontWeight: 800, display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                            Advance Paid
                          </span>
                          <span style={{ color: b.advance_amount > 0 ? t.dateBoxPayColor : t.textSecondary, fontWeight: 800, fontSize: '0.90rem' }}>
                            {b.advance_amount > 0
                              ? `₹ ${Number(b.advance_amount).toLocaleString('en-IN')}`
                              : 'Nil'}
                          </span>
                          {b.advance_amount > 0 && (
                            <span style={{ color: t.textSecondary, fontSize: '0.74rem', textTransform: 'capitalize', display: 'block' }}>
                              via {b.payment_mode || 'Cash'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Notes If Present */}
                      {b.notes ? (
                        <div
                          style={{
                            fontSize: '0.78rem',
                            color: t.subTextColor,
                            background: isDark ? 'rgba(0,0,0,0.2)' : '#F1F5F9',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            borderLeft: `3px solid ${t.labelPrimary}`
                          }}
                        >
                          <strong>Note:</strong> {b.notes}
                        </div>
                      ) : null}

                      {/* Footer Row: 48h Alert Badge & Action Buttons */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px',
                          borderTop: `1px solid ${t.innerBoxBorder}`,
                          paddingTop: '10px'
                        }}
                      >
                        <div>
                          {b.status === 'pending' && b.is_within_48h ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: '#EF4444',
                                color: '#FFFFFF',
                                padding: '4px 10px',
                                borderRadius: '8px',
                                fontSize: '0.76rem',
                                fontWeight: 850,
                                letterSpacing: '0.2px',
                                animation: 'redBlinkPulse 1.25s infinite ease-in-out'
                              }}
                            >
                              🔴 48h ALERT: {b.urgency_text || 'Check-in due soon'}
                            </span>
                          ) : b.status === 'completed' ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: isDark ? 'rgba(16, 185, 129, 0.15)' : '#DCFCE7',
                                color: '#10B981',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 800
                              }}
                            >
                              ✓ Checked-in / Fulfilled
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: t.textSecondary, fontWeight: 600 }}>
                              Status: Pending Stay
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {b.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCheckinNow(b)}
                                style={{
                                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  padding: '7px 16px',
                                  borderRadius: '8px',
                                  fontSize: '0.80rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.35)'
                                }}
                              >
                                🏨 Check-In Now
                              </button>

                              <button
                                type="button"
                                onClick={() => handleEdit(b)}
                                style={{
                                  background: isDark ? '#1E3A3F' : '#E0F2FE',
                                  color: isDark ? '#38BDF8' : '#0284C7',
                                  border: `1px solid ${isDark ? '#24464D' : '#BAE6FD'}`,
                                  padding: '7px 12px',
                                  borderRadius: '8px',
                                  fontSize: '0.80rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                ✏️ Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => handleMarkStatus(b.id, 'completed')}
                                style={{
                                  background: t.actionBtnBg,
                                  color: t.actionBtnText,
                                  border: `1px solid ${t.actionBtnBorder}`,
                                  padding: '7px 10px',
                                  borderRadius: '8px',
                                  fontSize: '0.80rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                                title="Mark as Completed without opening check-in wizard"
                              >
                                ✓ Complete
                              </button>
                            </>
                          )}

                          {b.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => handleMarkStatus(b.id, 'pending')}
                              style={{
                                background: t.actionBtnBg,
                                color: isDark ? '#E2B25E' : '#B45309',
                                border: `1px solid ${t.actionBtnBorder}`,
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              ↩ Move to Pending
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDelete(b.id, b.customer_name)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.1)',
                              color: '#EF4444',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              padding: '6px 10px',
                              borderRadius: '8px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                            title="Delete advance booking"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
