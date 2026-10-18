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
        style={{
          display: 'flex',
          gap: '6px',
          background: 'var(--bg-surface-secondary)',
          padding: '4px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-light)'
        }}
      >
        {/* Restaurant Segment */}
        <button
          type="button"
          id="btn-switch-to-restaurant"
          onClick={() => onDepartmentChange('restaurant')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-xs)',
            background: isResto ? 'var(--bg-surface)' : 'transparent',
            border: isResto ? '1.5px solid var(--apple-orange)' : '1.5px solid transparent',
            color: isResto ? 'var(--apple-orange)' : 'var(--text-secondary)',
            fontSize: '0.84rem',
            fontWeight: 850,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: isResto ? 'var(--shadow-subtle)' : 'none',
            transition: 'all var(--transition-fast)'
          }}
        >
          <span style={{ fontSize: '1.05rem' }}>🍽️</span>
          <span>RESTAURANT</span>
        </button>

        {/* Bar Segment */}
        <button
          type="button"
          id="btn-switch-to-bar"
          onClick={() => onDepartmentChange('bar')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-xs)',
            background: isBar ? 'var(--bg-surface)' : 'transparent',
            border: isBar ? '1.5px solid var(--apple-purple)' : '1.5px solid transparent',
            color: isBar ? 'var(--apple-purple)' : 'var(--text-secondary)',
            fontSize: '0.84rem',
            fontWeight: 850,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: isBar ? 'var(--shadow-subtle)' : 'none',
            transition: 'all var(--transition-fast)'
          }}
        >
          <span style={{ fontSize: '1.05rem' }}>🍸</span>
          <span>BAR LOUNGE</span>
        </button>
      </div>
    </div>
  );
}
