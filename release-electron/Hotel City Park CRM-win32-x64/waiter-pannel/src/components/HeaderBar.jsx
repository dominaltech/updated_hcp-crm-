import React from 'react';

export default function HeaderBar({ user, department, onOpenSettings }) {
  const isBar = department === 'bar';

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
      {/* Left: Clean Brand Logo & Department Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 1 }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>
          {isBar ? '🍸' : '🍽️'}
        </span>
        <span
          style={{
            fontSize: '0.92rem',
            fontWeight: 900,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
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
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {isBar ? 'Bar' : 'Resto'}
        </span>
      </div>

      {/* Right: Waiter Profile Chip & Top-Right Settings Gear Icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
            maxWidth: '120px',
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

        {/* Top-Right Settings Gear Button */}
        <button
          type="button"
          id="btn-header-settings"
          onClick={onOpenSettings}
          title="Settings, Theme & Settled Bills"
          aria-label="Settings"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface-secondary)',
            border: '1.5px solid var(--border-medium)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.05rem',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: 'var(--shadow-subtle)',
            transition: 'transform var(--transition-fast)'
          }}
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
