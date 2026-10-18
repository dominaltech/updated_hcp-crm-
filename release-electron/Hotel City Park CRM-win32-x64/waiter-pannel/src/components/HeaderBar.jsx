import React from 'react';

export default function HeaderBar({ user, department, theme, onToggleTheme, onLogout }) {
  const isBar = department === 'bar';
  const isDark = theme === 'dark';

  const handleLogoutClick = () => {
    onLogout();
  };

  return (
    <header
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        paddingBottom: '8px',
        paddingLeft: '12px',
        paddingRight: '12px',
        minHeight: 'calc(52px + env(safe-area-inset-top, 0px))',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-light)',
        boxShadow: 'var(--shadow-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 100,
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {/* Left: Clean Brand Logo & Department Badge (Fixed compact width to avoid overflow) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1 }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>
          {isBar ? '🍸' : '🍽️'}
        </span>
        <span style={{ fontSize: '0.90rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          City Park
        </span>
        <span
          style={{
            fontSize: '0.60rem',
            fontWeight: 800,
            padding: '2px 5px',
            borderRadius: 'var(--radius-xs)',
            background: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
            color: 'var(--text-on-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {isBar ? 'Bar' : 'Resto'}
        </span>
      </div>

      {/* Right: Theme Switcher, Waiter Chip & Logout Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {/* Universal Theme Toggle Button */}
        <button
          type="button"
          id="btn-header-theme-toggle"
          onClick={onToggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label="Toggle Theme"
          style={{
            width: '30px',
            height: '30px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.90rem',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'transform var(--transition-fast)'
          }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>

        {/* Waiter Profile Chip */}
        <div
          title={user?.full_name || user?.username || 'Waiter'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 7px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-light)',
            maxWidth: '90px',
            flexShrink: 0
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--apple-green)', flexShrink: 0 }} />
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {user?.full_name || user?.username || 'Staff'}
          </span>
        </div>

        {/* Logout Exit Button */}
        <button
          type="button"
          onClick={handleLogoutClick}
          title="Log out of this device"
          style={{
            height: '30px',
            padding: '0 7px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--apple-red-subtle)',
            border: '1px solid var(--apple-red)',
            color: 'var(--apple-red)',
            fontSize: '0.70rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            flexShrink: 0,
            cursor: 'pointer'
          }}
        >
          <span>🚪</span>
          <span>Exit</span>
        </button>
      </div>
    </header>
  );
}
