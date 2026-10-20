import React from 'react';

export default function DestinationTabs({
  activeTab,
  onTabChange,
  department,
  myOrdersCount = 0
}) {
  const isBar = department === 'bar';
  const activeAccent = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
  const activeBg = isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)';

  const tabs = [
    { id: 'orders', label: 'My Orders', icon: '📋', count: myOrdersCount },
    { id: 'tables', label: isBar ? 'Bar Tables' : 'Tables', icon: isBar ? '🍸' : '🍽️' },
    { id: 'rooms', label: 'Room Service', icon: '🛏️' },
    { id: 'parcels', label: 'Parcels', icon: '📦' }
  ];

  return (
    <nav
      aria-label="Navigation Tabs"
      style={{
        padding: '6px 12px 8px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
        flexShrink: 0
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            id={`tab-btn-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            style={{
              flexShrink: 0,
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm, 10px)',
              background: isActive ? activeBg : 'var(--bg-surface-secondary)',
              border: isActive ? `1.5px solid ${activeAccent}` : '1px solid var(--border-light)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: '0.80rem',
              fontWeight: isActive ? 800 : 650,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              boxShadow: isActive ? 'var(--shadow-subtle)' : 'none',
              transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: '0.95rem' }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                style={{
                  background: activeAccent,
                  color: 'var(--text-on-accent, #fff)',
                  fontSize: '0.66rem',
                  fontWeight: 900,
                  padding: '1px 7px',
                  borderRadius: '999px',
                  lineHeight: 1.2
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
