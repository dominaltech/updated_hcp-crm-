import React, { useMemo, useState, useRef, useEffect } from 'react';

/**
 * UnifiedTimeInput
 * Combines Hour, Minute, and AM/PM in ONE unified input field container.
 * Features a modern, themed popover dropdown (no native OS select menus).
 * Supports empty value ("") so fields start completely empty.
 * Output format defaults to 24-hour "HH:MM" (e.g. "14:30"), or "12h" if specified.
 */
export default function UnifiedTimeInput({
  value = '',
  onChange,
  disabled = false,
  format = '24h', // '24h' | '12h'
  style = {},
  className = '',
  id,
  required = false
}) {
  const [openMenu, setOpenMenu] = useState(null); // 'hour' | 'minute' | null
  const containerRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Parse incoming value into 12-hour components
  const parsed = useMemo(() => {
    if (!value || typeof value !== 'string') {
      return { hour12: '', minute: '', period: 'AM', hasValue: false };
    }

    const val = value.trim();
    if (!val) return { hour12: '', minute: '', period: 'AM', hasValue: false };

    // Check if 12h format like "12:00 PM" or "02:30 AM" or 24h like "14:30"
    const match12 = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2];
      let p = (match12[3] || '').toUpperCase();

      if (!p) {
        // Assume 24h if no AM/PM
        if (h >= 12) {
          p = 'PM';
          if (h > 12) h -= 12;
        } else {
          p = 'AM';
          if (h === 0) h = 12;
        }
      } else {
        if (h === 0) h = 12;
        if (h > 12) h = 12;
      }

      return {
        hour12: String(h),
        minute: m,
        period: p || 'AM',
        hasValue: true
      };
    }

    return { hour12: '', minute: '', period: 'AM', hasValue: false };
  }, [value]);

  // Emit updated value
  const emitChange = (h12, min, per) => {
    if (!onChange) return;

    if (!h12 && !min) {
      onChange('');
      return;
    }

    const effectiveH12 = parseInt(h12 || '12', 10);
    const effectiveMin = (min !== undefined && min !== '') ? String(min).padStart(2, '0') : '00';
    const effectivePeriod = per || parsed.period || 'AM';

    if (format === '12h') {
      const formatted = `${String(effectiveH12).padStart(2, '0')}:${effectiveMin} ${effectivePeriod}`;
      onChange(formatted);
    } else {
      // 24h format
      let h24 = effectiveH12;
      if (effectivePeriod === 'PM' && effectiveH12 < 12) h24 = effectiveH12 + 12;
      if (effectivePeriod === 'AM' && effectiveH12 === 12) h24 = 0;
      const formatted = `${String(h24).padStart(2, '0')}:${effectiveMin}`;
      onChange(formatted);
    }
  };

  const handleSelectHour = (h) => {
    emitChange(String(h), parsed.minute || '00', parsed.period || 'AM');
    setOpenMenu('minute'); // Automatically advance to minute selection
  };

  const handleSelectMinute = (m) => {
    emitChange(parsed.hour12 || '12', m, parsed.period || 'AM');
    setOpenMenu(null); // Finish selection
  };

  const handlePeriodChange = (newPeriod) => {
    emitChange(parsed.hour12 || '12', parsed.minute || '00', newPeriod);
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenu(null);
    if (onChange) onChange('');
  };

  // 12-hour array
  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // 60 minutes in 5-min intervals
  const minutesList = useMemo(() => {
    const mins = [];
    for (let i = 0; i < 60; i += 5) {
      mins.push(String(i).padStart(2, '0'));
    }
    if (parsed.minute && !mins.includes(parsed.minute)) {
      mins.push(parsed.minute);
      mins.sort();
    }
    return mins;
  }, [parsed.minute]);

  return (
    <div
      ref={containerRef}
      id={id}
      className={`unified-time-input ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: disabled ? '#f1f5f9' : '#ffffff',
        border: '1.5px solid #cbd5e1',
        borderRadius: '8px',
        height: '38px',
        padding: '2px 8px',
        boxSizing: 'border-box',
        fontSize: '0.90rem',
        fontWeight: 700,
        color: '#0f172a',
        gap: '4px',
        position: 'relative',
        userSelect: 'none',
        ...style
      }}
    >
      {/* Clock icon */}
      <span style={{ fontSize: '0.88rem', color: '#64748b' }}>🕒</span>

      {/* Hour Button Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenMenu(prev => prev === 'hour' ? null : 'hour')}
        style={{
          border: 'none',
          background: openMenu === 'hour' ? 'var(--apple-blue-subtle, #e0f2fe)' : 'transparent',
          color: parsed.hour12 ? 'var(--text-primary, #0f172a)' : 'var(--text-tertiary, #94a3b8)',
          fontSize: '0.92rem',
          fontWeight: 850,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '2px 4px',
          borderRadius: '5px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          fontFamily: 'inherit',
          transition: 'background 0.15s ease'
        }}
        title="Select Hour"
      >
        <span>{parsed.hour12 ? String(parsed.hour12).padStart(2, '0') : '--'}</span>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary, #64748b)' }}>▼</span>
      </button>

      <span style={{ fontWeight: 900, color: 'var(--text-tertiary, #94a3b8)' }}>:</span>

      {/* Minute Button Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenMenu(prev => prev === 'minute' ? null : 'minute')}
        style={{
          border: 'none',
          background: openMenu === 'minute' ? 'var(--apple-blue-subtle, #e0f2fe)' : 'transparent',
          color: parsed.minute ? 'var(--text-primary, #0f172a)' : 'var(--text-tertiary, #94a3b8)',
          fontSize: '0.92rem',
          fontWeight: 850,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '2px 4px',
          borderRadius: '5px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '2px',
          fontFamily: 'inherit',
          transition: 'background 0.15s ease'
        }}
        title="Select Minute"
      >
        <span>{parsed.minute ? parsed.minute : '--'}</span>
        <span style={{ fontSize: '0.62rem', color: '#64748b' }}>▼</span>
      </button>

      {/* AM / PM Segmented Switch */}
      <div
        style={{
          display: 'inline-flex',
          background: '#f1f5f9',
          borderRadius: '6px',
          padding: '2px',
          marginLeft: '4px',
          border: '1px solid #e2e8f0',
          flexShrink: 0
        }}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePeriodChange('AM')}
          style={{
            border: 'none',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.74rem',
            fontWeight: 850,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: parsed.hasValue && parsed.period === 'AM' ? '#0071e3' : 'transparent',
            color: parsed.hasValue && parsed.period === 'AM' ? '#ffffff' : '#64748b',
            transition: 'all 0.15s ease'
          }}
        >
          AM
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePeriodChange('PM')}
          style={{
            border: 'none',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.74rem',
            fontWeight: 850,
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: parsed.hasValue && parsed.period === 'PM' ? '#0071e3' : 'transparent',
            color: parsed.hasValue && parsed.period === 'PM' ? '#ffffff' : '#64748b',
            transition: 'all 0.15s ease'
          }}
        >
          PM
        </button>
      </div>

      {/* Clear Button if value present */}
      {parsed.hasValue && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          title="Clear time"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: 800,
            cursor: 'pointer',
            padding: '0 2px',
            marginLeft: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          ✕
        </button>
      )}

      {/* THEMED CUSTOM DROPDOWN POPOVER FOR HOUR */}
      {openMenu === 'hour' && (
        <div
          className="time-dropdown-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '0',
            zIndex: 10050,
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.16)',
            padding: '10px',
            minWidth: '220px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Hour (1 - 12)
            </span>
            <button
              type="button"
              onClick={() => setOpenMenu(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {hoursList.map((h) => {
              const isSelected = parsed.hour12 && Number(parsed.hour12) === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleSelectHour(h)}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid #0071e3' : '1px solid #e2e8f0',
                    background: isSelected ? '#0071e3' : '#f8fafc',
                    color: isSelected ? '#ffffff' : '#1e293b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = '#e0f2fe';
                      e.currentTarget.style.borderColor = '#7dd3fc';
                      e.currentTarget.style.color = '#0369a1';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.color = '#1e293b';
                    }
                  }}
                >
                  {String(h).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* THEMED CUSTOM DROPDOWN POPOVER FOR MINUTE */}
      {openMenu === 'minute' && (
        <div
          className="time-dropdown-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '30px',
            zIndex: 10050,
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.16)',
            padding: '10px',
            minWidth: '220px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Minute (:00 - :55)
            </span>
            <button
              type="button"
              onClick={() => setOpenMenu(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {minutesList.map((m) => {
              const isSelected = parsed.minute === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSelectMinute(m)}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid #0071e3' : '1px solid #e2e8f0',
                    background: isSelected ? '#0071e3' : '#f8fafc',
                    color: isSelected ? '#ffffff' : '#1e293b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = '#e0f2fe';
                      e.currentTarget.style.borderColor = '#7dd3fc';
                      e.currentTarget.style.color = '#0369a1';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.color = '#1e293b';
                    }
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
