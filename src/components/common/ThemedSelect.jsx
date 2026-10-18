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
  colorTheme = 'amber', // 'amber' | 'gold' | 'emerald' | 'blue' | 'purple'
  disabled = false,
  required = false,
  leadingIcon = null,
  emptyMessage = 'No options available',
  isSearchable = false,
  searchPlaceholder = 'Search...',
  isDark: isDarkProp,
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const searchInputRef = useRef(null);

  // Auto-detect dark mode if not explicitly provided
  const [isDark, setIsDark] = useState(() => {
    if (typeof isDarkProp === 'boolean') return isDarkProp;
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    if (typeof isDarkProp === 'boolean') {
      setIsDark(isDarkProp);
    } else {
      const checkTheme = () => {
        setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
      };
      checkTheme();
      const observer = new MutationObserver(checkTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    }
  }, [isDarkProp]);

  // Normalize options: allow strings or objects { value, label, subtitle, icon, tag, tagColor, tagBg, disabled }
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt, subtitle: null, icon: null, tag: null, tagColor: null, tagBg: null, disabled: false };
    }
    return {
      value: opt.value ?? opt.id ?? opt.name ?? '',
      label: opt.label ?? opt.name ?? String(opt.value ?? ''),
      subtitle: opt.subtitle ?? opt.phone ?? null,
      icon: opt.icon ?? null,
      tag: opt.tag ?? null,
      tagColor: opt.tagColor ?? null,
      tagBg: opt.tagBg ?? null,
      disabled: Boolean(opt.disabled)
    };
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  // Filtered options based on search query
  const filteredOptions = normalizedOptions.filter((opt) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (opt.label && opt.label.toLowerCase().includes(q)) ||
      (opt.subtitle && opt.subtitle.toLowerCase().includes(q)) ||
      (opt.tag && opt.tag.toLowerCase().includes(q)) ||
      String(opt.value).toLowerCase().includes(q)
    );
  });

  // Color tokens
  const themeColors = {
    amber: {
      primary: isDark ? '#E2B25E' : '#D97706',
      borderFocus: isDark ? '#E2B25E' : '#D97706',
      ringFocus: isDark ? 'rgba(226, 178, 94, 0.35)' : 'rgba(217, 119, 6, 0.25)',
      hoverBg: isDark ? '#1C3A40' : '#FEF3C7',
      hoverText: isDark ? '#FFFFFF' : '#92400E',
      selectedBg: isDark ? '#234E57' : '#FDE68A',
      selectedText: isDark ? '#E2B25E' : '#78350F',
      badgeBg: isDark ? 'rgba(226, 178, 94, 0.15)' : '#FEF3C7',
      badgeText: isDark ? '#E2B25E' : '#92400E',
      menuBorder: isDark ? '#24464D' : '#FCD34D'
    },
    gold: {
      primary: '#E2B25E',
      borderFocus: '#E2B25E',
      ringFocus: 'rgba(226, 178, 94, 0.35)',
      hoverBg: isDark ? '#1C3A40' : '#FEF3C7',
      hoverText: isDark ? '#FFFFFF' : '#B45309',
      selectedBg: isDark ? '#234E57' : '#FDE68A',
      selectedText: isDark ? '#E2B25E' : '#78350F',
      badgeBg: isDark ? 'rgba(226, 178, 94, 0.15)' : '#FEF3C7',
      badgeText: '#B45309',
      menuBorder: isDark ? '#24464D' : '#E2B25E'
    },
    emerald: {
      primary: '#059669',
      borderFocus: '#059669',
      ringFocus: 'rgba(5, 150, 105, 0.25)',
      hoverBg: isDark ? '#13352B' : '#ECFDF5',
      hoverText: isDark ? '#34D399' : '#047857',
      selectedBg: isDark ? '#164E3E' : '#D1FAE5',
      selectedText: isDark ? '#6EE7B7' : '#065F46',
      badgeBg: isDark ? '#13352B' : '#E6F4EA',
      badgeText: '#137333',
      menuBorder: isDark ? '#1E4639' : '#A7F3D0'
    },
    blue: {
      primary: '#0284c7',
      borderFocus: '#0284c7',
      ringFocus: 'rgba(2, 132, 199, 0.25)',
      hoverBg: isDark ? '#122E42' : '#F0F9FF',
      hoverText: isDark ? '#38BDF8' : '#0369A1',
      selectedBg: isDark ? '#194563' : '#E0F2FE',
      selectedText: isDark ? '#7DD3FC' : '#075985',
      badgeBg: isDark ? '#122E42' : '#E0F2FE',
      badgeText: '#0369A1',
      menuBorder: isDark ? '#1E4663' : '#BAE6FD'
    },
    purple: {
      primary: '#7c3aed',
      borderFocus: '#7c3aed',
      ringFocus: 'rgba(124, 58, 237, 0.25)',
      hoverBg: isDark ? '#2A1B4E' : '#F5F3FF',
      hoverText: isDark ? '#A78BFA' : '#6D28D9',
      selectedBg: isDark ? '#3B246B' : '#EDE9FE',
      selectedText: isDark ? '#C4B5FD' : '#5B21B6',
      badgeBg: isDark ? '#2A1B4E' : '#EDE9FE',
      badgeText: '#6D28D9',
      menuBorder: isDark ? '#3B246B' : '#DDD6FE'
    }
  };

  const theme = themeColors[colorTheme] || themeColors.amber;

  // Surface tokens
  const s = {
    triggerBg: isDark ? '#0F282D' : '#FFFFFF',
    triggerBorder: isDark ? '#24464D' : '#CBD5E1',
    textPrimary: isDark ? '#F8FAFC' : '#0F172A',
    textPlaceholder: isDark ? '#64748B' : '#94A3B8',
    menuBg: isDark ? '#0F282D' : '#FFFFFF',
    menuBorder: isDark ? '#24464D' : '#E2E8F0',
    searchBg: isDark ? '#132D33' : '#F8FAFC',
    searchBorder: isDark ? '#24464D' : '#CBD5E1'
  };

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchQuery('');
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

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep highlighted option in view
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.themed-select-item');
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setSearchQuery('');
      const initialIdx = filteredOptions.findIndex((opt) => opt.value === value);
      setHighlightedIndex(initialIdx >= 0 ? initialIdx : 0);
    }
  };

  const handleSelect = (opt) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleKeyDown = (e) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        const initialIdx = filteredOptions.findIndex((opt) => opt.value === value);
        setHighlightedIndex(initialIdx >= 0 ? initialIdx : 0);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelect(filteredOptions[highlightedIndex]);
      }
    }
  };

  const showSearch = isSearchable || normalizedOptions.length >= 8;

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
      {/* Hidden input for HTML5 form validation */}
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
          minHeight: '44px',
          height: '44px',
          boxSizing: 'border-box',
          padding: '0 14px',
          background: disabled ? (isDark ? '#0C2024' : '#F1F5F9') : s.triggerBg,
          border: isOpen ? `2px solid ${theme.borderFocus}` : `1.5px solid ${s.triggerBorder}`,
          borderRadius: '10px',
          boxShadow: isOpen ? `0 0 0 3px ${theme.ringFocus}` : '0 1px 3px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.16s ease-in-out',
          outline: 'none',
          color: s.textPrimary
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
              fontSize: '0.92rem',
              fontWeight: selectedOption ? 750 : 500,
              color: selectedOption ? s.textPrimary : s.textPlaceholder,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>

          {/* Subtitle / Room Type */}
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
              {selectedOption.subtitle}
            </span>
          )}

          {/* Tag / Pill (e.g. Ready / Occupied) */}
          {selectedOption && selectedOption.tag && (
            <span
              style={{
                fontSize: '0.70rem',
                fontWeight: 800,
                color: selectedOption.tagColor || theme.primary,
                background: selectedOption.tagBg || (isDark ? 'rgba(0,0,0,0.2)' : '#F1F5F9'),
                padding: '2px 7px',
                borderRadius: '6px',
                marginLeft: 'auto',
                marginRight: '6px',
                flexShrink: 0
              }}
            >
              {selectedOption.tag}
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
            color: isOpen ? theme.primary : (isDark ? '#E2B25E' : '#64748B')
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            background: s.menuBg,
            borderRadius: '12px',
            border: `1.5px solid ${theme.menuBorder}`,
            boxShadow: isDark
              ? '0 18px 45px -4px rgba(0, 0, 0, 0.75), 0 0 20px rgba(226, 178, 94, 0.15)'
              : '0 16px 38px -4px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08)',
            zIndex: 100000,
            maxHeight: '300px',
            overflowY: 'auto',
            padding: '6px',
            boxSizing: 'border-box',
            animation: 'themedSelectFadeIn 0.15s ease-out'
          }}
        >
          {/* Live Search Input */}
          {showSearch && (
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: s.menuBg,
                padding: '4px 4px 8px',
                borderBottom: `1px solid ${s.menuBorder}`,
                marginBottom: '4px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ position: 'relative' }}>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px 8px 30px',
                    borderRadius: '8px',
                    border: `1px solid ${s.searchBorder}`,
                    background: s.searchBg,
                    color: s.textPrimary,
                    fontSize: '0.84rem',
                    outline: 'none',
                    fontWeight: 600
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: '8px',
                    top: '8px',
                    fontSize: '13px',
                    color: s.textPlaceholder
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
                      right: '8px',
                      top: '7px',
                      background: 'none',
                      border: 'none',
                      color: s.textPlaceholder,
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options List */}
          {filteredOptions.length === 0 ? (
            <div
              style={{
                padding: '18px 12px',
                textAlign: 'center',
                color: s.textPlaceholder,
                fontSize: '0.86rem',
                fontWeight: 600
              }}
            >
              {searchQuery ? `No matching options for "${searchQuery}"` : emptyMessage}
            </div>
          ) : (
            filteredOptions.map((opt, idx) => {
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
                    padding: '8px 12px',
                    borderRadius: '8px',
                    marginBottom: '2px',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.45 : 1,
                    background: isSelected
                      ? theme.selectedBg
                      : isHighlighted
                      ? theme.hoverBg
                      : 'transparent',
                    color: isSelected
                      ? theme.selectedText
                      : isHighlighted
                      ? theme.hoverText
                      : s.textPrimary,
                    transition: 'background 0.10s ease, color 0.10s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    {opt.icon && (
                      <span style={{ fontSize: '1rem', flexShrink: 0 }}>
                        {opt.icon}
                      </span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span
                        style={{
                          fontSize: '0.90rem',
                          fontWeight: isSelected ? 850 : isHighlighted ? 750 : 650,
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
                            color: isSelected ? theme.selectedText : (isDark ? '#94A3B8' : '#64748B'),
                            opacity: 0.95,
                            marginTop: '1px'
                          }}
                        >
                          {opt.subtitle}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Tag & Checkmark */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '8px' }}>
                    {opt.tag && (
                      <span
                        style={{
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          color: opt.tagColor || (isDark ? '#10B981' : '#15803D'),
                          background: opt.tagBg || (isDark ? 'rgba(16,185,129,0.15)' : '#DCFCE7'),
                          padding: '2px 8px',
                          borderRadius: '6px'
                        }}
                      >
                        {opt.tag}
                      </span>
                    )}
                    {isSelected && (
                      <span
                        style={{
                          color: theme.primary,
                          fontWeight: 900,
                          fontSize: '0.95rem'
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
