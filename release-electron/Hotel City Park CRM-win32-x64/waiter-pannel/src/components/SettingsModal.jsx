import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function SettingsModal({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  department,
  currentUser,
  onLogout
}) {
  const [activeTab, setActiveTab] = useState('general'); // 'general' | 'settled'
  const [settledBills, setSettledBills] = useState([]);
  const [isLoadingSettled, setIsLoadingSettled] = useState(false);
  const [settledSearch, setSettledSearch] = useState('');
  const [selectedBillDetail, setSelectedBillDetail] = useState(null);

  const isDark = theme === 'dark';
  const myName = currentUser?.full_name || currentUser?.username || 'Staff';

  // Load settled bills when switching to the 'settled' tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'settled') return;

    let isMounted = true;
    setIsLoadingSettled(true);

    api.getSettledBills(department)
      .then((res) => {
        if (!isMounted) return;
        const list = (res && res.orders) || (res && res.bills) || (Array.isArray(res) ? res : []);
        setSettledBills(list);
      })
      .catch((err) => {
        console.warn('Error fetching settled bills:', err.message);
      })
      .finally(() => {
        if (isMounted) setIsLoadingSettled(false);
      });

    return () => { isMounted = false; };
  }, [isOpen, activeTab, department]);

  if (!isOpen) return null;

  // Filter settled bills by search query
  const filteredSettled = settledBills.filter((b) => {
    if (!settledSearch.trim()) return true;
    const q = settledSearch.toLowerCase().trim();
    const matchNum = String(b.order_number || b.id || '').toLowerCase().includes(q);
    const matchTable = String(b.table_number || b.table_name || b.customer_name || '').toLowerCase().includes(q);
    const matchWaiter = String(b.waiter_name || '').toLowerCase().includes(q);
    const matchMode = String(b.payment_mode || b.payment_method || '').toLowerCase().includes(q);
    return matchNum || matchTable || matchWaiter || matchMode;
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          maxHeight: '90dvh',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg, 18px)',
          border: '1.5px solid var(--border-medium)',
          boxShadow: 'var(--shadow-modal, 0 20px 40px rgba(0,0,0,0.4))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
          animation: 'fadeInModal 0.2s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-surface-secondary)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.25rem' }}>⚙️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                Settings &amp; Tools
              </h3>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Hotel City Park • {department === 'bar' ? 'Bar Lounge' : 'Restaurant'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              cursor: 'pointer'
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher: General Settings vs Settled Bills */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            borderBottom: '1px solid var(--border-light)',
            background: 'var(--bg-surface)'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            style={{
              padding: '11px',
              border: 'none',
              borderBottom: activeTab === 'general' ? '2.5px solid var(--apple-blue)' : '2.5px solid transparent',
              background: activeTab === 'general' ? 'var(--bg-surface-secondary)' : 'transparent',
              color: activeTab === 'general' ? 'var(--apple-blue)' : 'var(--text-secondary)',
              fontSize: '0.82rem',
              fontWeight: 850,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>⚙️</span>
            <span>General</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settled')}
            style={{
              padding: '11px',
              border: 'none',
              borderBottom: activeTab === 'settled' ? '2.5px solid var(--apple-blue)' : '2.5px solid transparent',
              background: activeTab === 'settled' ? 'var(--bg-surface-secondary)' : 'transparent',
              color: activeTab === 'settled' ? 'var(--apple-blue)' : 'var(--text-secondary)',
              fontSize: '0.82rem',
              fontWeight: 850,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>🧾</span>
            <span>Settled Bills</span>
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {activeTab === 'general' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* User Profile Card */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: 'var(--apple-blue-subtle)',
                    border: '1.5px solid var(--apple-blue)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    flexShrink: 0
                  }}
                >
                  👤
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.94rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {myName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)' }} />
                    <span>Role: <strong>{currentUser?.role || 'Staff'}</strong></span>
                    <span>•</span>
                    <span>Active Shift</span>
                  </div>
                </div>
              </div>

              {/* Theme Settings Block */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Display Theme
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      Current: <strong>{isDark ? 'Dark Theme (Night)' : 'Light Theme (Day)'}</strong>
                    </div>
                  </div>

                  <span style={{ fontSize: '1.3rem' }}>{isDark ? '🌙' : '☀️'}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => { if (!isDark) onToggleTheme(); }}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: isDark ? 'var(--apple-blue)' : 'var(--bg-surface)',
                      color: isDark ? '#fff' : 'var(--text-primary)',
                      border: isDark ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                      fontSize: '0.80rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>🌙</span>
                    <span>Dark Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { if (isDark) onToggleTheme(); }}
                    style={{
                      padding: '10px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: !isDark ? 'var(--apple-blue)' : 'var(--bg-surface)',
                      color: !isDark ? '#fff' : 'var(--text-primary)',
                      border: !isDark ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                      fontSize: '0.80rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>☀️</span>
                    <span>Light Mode</span>
                  </button>
                </div>
              </div>

              {/* End Shift / Logout Button */}
              <div style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  style={{
                    width: '100%',
                    height: '46px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--apple-red-subtle)',
                    border: '1.5px solid var(--apple-red)',
                    color: 'var(--apple-red)',
                    fontSize: '0.90rem',
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-subtle)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>🚪</span>
                  <span>End Shift &amp; Log Out</span>
                </button>
                <div style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                  Securely signs out your waiter credentials from this device
                </div>
              </div>
            </div>
          ) : (
            /* Settled Bills Tab */
            <div>
              {/* Search Settled Bills */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  value={settledSearch}
                  onChange={(e) => setSettledSearch(e.target.value)}
                  placeholder="🔍 Search bill #, table, waiter, mode..."
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    background: 'var(--bg-surface-secondary)',
                    border: '1.5px solid var(--border-medium)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.82rem',
                    fontWeight: 650,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {isLoadingSettled ? (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                  ⏳ Loading settled bills...
                </div>
              ) : filteredSettled.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-secondary)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '6px' }}>🧾</div>
                  <div style={{ fontSize: '0.90rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    No Settled Bills Found
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    {settledSearch ? 'Try a different search term.' : 'Settled bills will appear here once orders are paid.'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filteredSettled.slice(0, 30).map((b) => {
                    let items = [];
                    try {
                      items = typeof b.items_json === 'string' ? JSON.parse(b.items_json) : (b.items || []);
                    } catch {
                      items = b.items || [];
                    }

                    const isExpanded = selectedBillDetail?.id === b.id;

                    return (
                      <div
                        key={b.id}
                        style={{
                          background: 'var(--bg-surface-secondary)',
                          border: isExpanded ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onClick={() => setSelectedBillDetail(isExpanded ? null : b)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                #{b.order_number || b.id}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.64rem',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: 'var(--apple-green-subtle)',
                                  color: 'var(--apple-green)',
                                  border: '1px solid var(--apple-green)',
                                  textTransform: 'uppercase'
                                }}
                              >
                                {b.payment_mode || 'PAID'}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              <strong>{b.table_name || (b.table_number ? `Table ${b.table_number}` : (b.customer_name || 'Walk-in'))}</strong>
                              {b.waiter_name && ` • 👤 ${b.waiter_name}`}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.98rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                              ₹{Number(b.total || b.grand_total || 0).toLocaleString('en-IN')}
                            </div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>
                              {b.created_at ? new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </div>
                          </div>
                        </div>

                        {/* Expanded Itemized Breakdown */}
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: '10px',
                              paddingTop: '8px',
                              borderTop: '1px dashed var(--border-medium)',
                              fontSize: '0.74rem'
                            }}
                          >
                            <div style={{ fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', fontSize: '0.66rem' }}>
                              Dishes / Items ({items.length}):
                            </div>
                            {items.map((it, idx) => (
                              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: 'var(--text-primary)' }}>
                                <span>{it.qty || it.quantity || 1}x {it.name}</span>
                                <span style={{ fontWeight: 700 }}>₹{((it.price || 0) * (it.qty || it.quantity || 1)).toLocaleString('en-IN')}</span>
                              </div>
                            ))}

                            <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', fontWeight: 900, color: 'var(--text-primary)' }}>
                              <span>Grand Total:</span>
                              <span style={{ color: 'var(--apple-blue)' }}>₹{Number(b.total || b.grand_total || 0).toLocaleString('en-IN')}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
