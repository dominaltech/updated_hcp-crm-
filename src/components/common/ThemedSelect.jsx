import React, { useState, useRef, useEffect } from 'react';

/**
 * ThemedSelect - Premium In-Theme Custom Dropdown Component
 * Replaces native OS combobox with fully-styled, accessible, themed popover dropdown.
 */
export default function ThemedSelect({
  id,
  value,
  onChange,
  options = [],
  placeholder = '-- Select an option --',
  colorTheme = 'emerald', // 'emerald' | 'blue' | 'purple'
  disabled = false,
  required = false,
  leadingIcon = null,
  emptyMessage = 'No options available',
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  // Normalize options: allow strings or objects { value, label, subtitle, icon, disabled }
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt, subtitle: null, icon: null, disabled: false };
    }
    return {
      value: opt.value ?? opt.id ?? opt.name ?? '',
      label: opt.label ?? opt.name ?? String(opt.value ?? ''),
      subtitle: opt.subtitle ?? opt.phone ?? null,
      icon: opt.icon ?? null,
      disabled: Boolean(opt.disabled)
    };
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  // Color tokens
  const themeColors = {
    emerald: {
      primary: '#059669',
      borderFocus: '#059669',
      ringFocus: 'rgba(5, 150, 105, 0.25)',
      hoverBg: '#ecfdf5',
      hoverText: '#047857',
      selectedBg: '#d1fae5',
      selectedText: '#065f46',
      badgeBg: '#e6f4ea',
      badgeText: '#137333',
      menuBorder: '#a7f3d0'
    },
    blue: {
      primary: '#0284c7',
      borderFocus: '#0284c7',
      ringFocus: 'rgba(2, 132, 199, 0.25)',
      hoverBg: '#f0f9ff',
      hoverText: '#0369a1',
      selectedBg: '#e0f2fe',
      selectedText: '#075985',
      badgeBg: '#e0f2fe',
      badgeText: '#0369a1',
      menuBorder: '#bae6fd'
    },
    purple: {
      primary: '#7c3aed',
      borderFocus: '#7c3aed',
      ringFocus: 'rgba(124, 58, 237, 0.25)',
      hoverBg: '#f5f3ff',
      hoverText: '#6d28d9',
      selectedBg: '#ede9fe',
      selectedText: '#5b21b6',
      badgeBg: '#ede9fe',
      badgeText: '#6d28d9',
      menuBorder: '#ddd6fe'
    }
  };

  const theme = themeColors[colorTheme] || themeColors.emerald;

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Keep highlighted option in view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('.themed-select-item');
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        const idx = normalizedOptions.findIndex((opt) => opt.value === value);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      }
      return next;
    });
  };

  const handleSelect = (opt) => {
    if (opt.disabled) return;
    onChange && onChange(opt.value);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
        const idx = normalizedOptions.findIndex((opt) => opt.value === value);
        setHighlightedIndex(idx >= 0 ? idx : 0);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < normalizedOptions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : normalizedOptions.length - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < normalizedOptions.length) {
        handleSelect(normalizedOptions[highlightedIndex]);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      id={id}
      className={`themed-select-container ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        userSelect: 'none',
        ...style
      }}
    >
      {/* Hidden input for form validation */}
      <input
        type="text"
        required={required}
        value={value || ''}
        onChange={() => {}}
        tabIndex={-1}
        style={{
          opacity: 0,
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 0,
          pointerEvents: 'none'
        }}
      />

      {/* Trigger Button */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className="themed-select-trigger"
        style={{
          width: '100%',
          minHeight: '46px',
          height: '46px',
          boxSizing: 'border-box',
          padding: '0 14px',
          background: disabled ? 'var(--bg-surface-secondary, #f8fafc)' : 'var(--bg-surface, #ffffff)',
          border: isOpen ? `2px solid ${theme.borderFocus}` : '1.5px solid var(--border-medium, #cbd5e1)',
          borderRadius: '12px',
          boxShadow: isOpen ? `0 0 0 3px ${theme.ringFocus}` : '0 1px 2px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.18s ease-in-out',
          outline: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
          {(selectedOption?.icon || leadingIcon) && (
            <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>
              {selectedOption?.icon || leadingIcon}
            </span>
          )}
          <span
            style={{
              fontSize: '0.96rem',
              fontWeight: selectedOption ? 750 : 600,
              color: selectedOption ? 'var(--text-primary, #0f172a)' : 'var(--text-secondary, #64748b)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption && selectedOption.subtitle && (
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: theme.badgeText,
                background: theme.badgeBg,
                padding: '2px 8px',
                borderRadius: '6px',
                marginLeft: '4px',
                flexShrink: 0
              }}
            >
              📞 {selectedOption.subtitle}
            </span>
          )}
        </div>

        {/* Custom Chevron Arrow */}
        <span
          style={{
            marginLeft: '10px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            color: isOpen ? theme.primary : '#64748b'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          className="themed-select-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '14px',
            border: `1.5px solid ${theme.menuBorder}`,
            boxShadow: '0 14px 34px -4px rgba(0, 0, 0, 0.28), 0 4px 10px -2px rgba(0, 0, 0, 0.15)',
            zIndex: 10100,
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '6px',
            boxSizing: 'border-box',
            animation: 'themedSelectFadeIn 0.15s ease-out'
          }}
        >
          {normalizedOptions.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                textAlign: 'center',
                color: 'var(--text-tertiary, #64748b)',
                fontSize: '0.86rem',
                fontWeight: 600
              }}
            >
              {emptyMessage}
            </div>
          ) : (
            normalizedOptions.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <div
                  key={opt.value || idx}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`themed-select-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: '10px',
                    marginBottom: '2px',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.5 : 1,
                    background: isSelected
                      ? theme.selectedBg
                      : isHighlighted
                      ? theme.hoverBg
                      : 'transparent',
                    color: isSelected
                      ? theme.selectedText
                      : isHighlighted
                      ? theme.hoverText
                      : 'var(--text-primary, #1e293b)',
                    transition: 'background 0.12s ease, color 0.12s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', overflow: 'hidden' }}>
                    {opt.icon && (
                      <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>
                        {opt.icon}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span
                        style={{
                          fontSize: '0.93rem',
                          fontWeight: isSelected ? 800 : isHighlighted ? 750 : 650,
                          color: 'inherit'
                        }}
                      >
                        {opt.label}
                      </span>
                      {opt.subtitle && (
                        <span
                          style={{
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            color: isSelected ? theme.selectedText : '#64748b',
                            opacity: 0.9,
                            marginTop: '1px'
                          }}
                        >
                          📞 {opt.subtitle}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Selected checkmark */}
                  {isSelected && (
                    <span
                      style={{
                        color: theme.primary,
                        fontWeight: 900,
                        fontSize: '1rem',
                        marginLeft: '8px'
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
