import React from 'react';

export default function DepartmentSwitcher({ department, onDepartmentChange }) {
  const isResto = department === 'restaurant';
  const isBar = department === 'bar';

  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-light)'
      }}
    >
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: '4px',
          background: 'var(--bg-surface-secondary)',
          padding: '4px',
          borderRadius: 'var(--radius-sm, 12px)',
          border: '1px solid var(--border-light)'
        }}
      >
        {/* Restaurant Segment */}
        <button
          type="button"
          role="tab"
          aria-selected={isResto}
          id="btn-switch-to-restaurant"
          onClick={() => onDepartmentChange('restaurant')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-xs, 8px)',
            background: isResto ? 'var(--bg-surface)' : 'transparent',
            border: isResto ? '1px solid var(--border-medium)' : '1px solid transparent',
            color: isResto ? 'var(--apple-orange)' : 'var(--text-secondary)',
            fontSize: '0.84rem',
            fontWeight: isResto ? 900 : 650,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            boxShadow: isResto ? 'var(--shadow-card)' : 'none',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            cursor: 'pointer'
          }}
        >
          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>🍽️</span>
          <span style={{ letterSpacing: '0.02em' }}>RESTAURANT</span>
        </button>

        {/* Bar Segment */}
        <button
          type="button"
          role="tab"
          aria-selected={isBar}
          id="btn-switch-to-bar"
          onClick={() => onDepartmentChange('bar')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-xs, 8px)',
            background: isBar ? 'var(--bg-surface)' : 'transparent',
            border: isBar ? '1px solid var(--border-medium)' : '1px solid transparent',
            color: isBar ? 'var(--apple-purple)' : 'var(--text-secondary)',
            fontSize: '0.84rem',
            fontWeight: isBar ? 900 : 650,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            boxShadow: isBar ? 'var(--shadow-card)' : 'none',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            cursor: 'pointer'
          }}
        >
          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>🍸</span>
          <span style={{ letterSpacing: '0.02em' }}>BAR LOUNGE</span>
        </button>
      </div>
    </div>
  );
}
