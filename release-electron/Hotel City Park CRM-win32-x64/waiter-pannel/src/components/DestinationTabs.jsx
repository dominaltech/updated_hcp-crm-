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
    <div
      style={{
        padding: '6px 12px 10px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex',
        gap: '6px',
        overflowX: 'auto',
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
              flex: '1 0 auto',
              padding: '7px 11px',
              borderRadius: 'var(--radius-sm)',
              background: isActive ? activeBg : 'var(--bg-surface-secondary)',
              border: isActive ? `1.5px solid ${activeAccent}` : '1px solid var(--border-light)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: '0.78rem',
              fontWeight: isActive ? 850 : 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
              boxShadow: isActive ? 'var(--shadow-subtle)' : 'none',
              transition: 'all var(--transition-fast)'
            }}
          >
            <span style={{ fontSize: '0.95rem' }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                style={{
                  background: activeAccent,
                  color: 'var(--text-on-accent)',
                  fontSize: '0.65rem',
                  fontWeight: 900,
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-xl)',
                  marginLeft: '2px'
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
