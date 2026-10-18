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
        height: '52px',
        padding: '0 12px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-light)',
        boxShadow: 'var(--shadow-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 100,
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Left: Clean Brand Logo & Department Badge (Fixed compact width to avoid overflow) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>
          {isBar ? '🍸' : '🍽️'}
        </span>
        <span style={{ fontSize: '0.94rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
          City Park
        </span>
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
            background: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
            color: 'var(--text-on-accent)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap'
          }}
        >
          {isBar ? 'Bar' : 'Resto'}
        </span>
      </div>

      {/* Right: Theme Switcher, Waiter Chip & Logout Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {/* Universal Theme Toggle Button */}
        <button
          type="button"
          id="btn-header-theme-toggle"
          onClick={onToggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label="Toggle Theme"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.95rem',
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
            gap: '5px',
            padding: '4px 8px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-light)',
            maxWidth: '100px',
            flexShrink: 0
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', flexShrink: 0 }} />
          <span
            style={{
              fontSize: '0.74rem',
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
            height: '32px',
            padding: '0 8px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--apple-red-subtle)',
            border: '1px solid var(--apple-red)',
            color: 'var(--apple-red)',
            fontSize: '0.72rem',
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
