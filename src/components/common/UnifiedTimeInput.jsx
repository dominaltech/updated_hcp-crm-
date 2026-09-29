import React, { useMemo, useState, useRef, useEffect } from 'react';
import { timeToMinutes } from '../../utils/formatters';

/**
 * UnifiedTimeInput
 * Combines Hour, Minute, and AM/PM in ONE unified input field container.
 * Features a modern, themed popover dropdown (no native OS select menus).
 * Supports empty value ("") so fields start completely empty.
 * Output format defaults to 24-hour "HH:MM" (e.g. "14:30"), or "12h" if specified.
 * Supports minTime (e.g. "15:41") to prevent picking any time earlier than or equal to minTime.
 */
export default function UnifiedTimeInput({
  value = '',
  onChange,
  disabled = false,
  format = '24h', // '24h' | '12h'
  style = {},
  className = '',
  id,
  required = false,
  minTime = null,
  hasError = false
}) {
  const [openMenu, setOpenMenu] = useState(null); // 'hour' | 'minute' | null
  const [periodOverride, setPeriodOverride] = useState(null);
  const containerRef = useRef(null);

  const minMinutes = useMemo(() => timeToMinutes(minTime), [minTime]);
  const currentMinutes = useMemo(() => timeToMinutes(value), [value]);
  const isBeforeMin = Boolean(minMinutes !== null && currentMinutes !== null && currentMinutes <= minMinutes);
  const effectiveError = Boolean(hasError || isBeforeMin);

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
    const fallbackPeriod = (minMinutes !== null && minMinutes >= 720) ? 'PM' : 'AM';
    if (!value || typeof value !== 'string') {
      return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false };
    }

    const val = value.trim();
    if (!val) return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false };

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
        period: p || fallbackPeriod,
        hasValue: true
      };
    }

    return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false };
  }, [value, minMinutes]);

  const currentPeriod = periodOverride || parsed.period || ((minMinutes !== null && minMinutes >= 720) ? 'PM' : 'AM');

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

  const isHourDisabled = (h) => {
    if (minMinutes === null) return false;
    const h24 = currentPeriod === 'PM' ? (h < 12 ? h + 12 : 12) : (h === 12 ? 0 : h);
    // The maximum possible time in this hour is h24:59
    const maxMinsInHour = h24 * 60 + 59;
    return maxMinsInHour <= minMinutes;
  };

  const isMinuteDisabled = (mStr) => {
    if (minMinutes === null) return false;
    const h12 = parseInt(parsed.hour12 || '12', 10);
    const h24 = currentPeriod === 'PM' ? (h12 < 12 ? h12 + 12 : 12) : (h12 === 12 ? 0 : h12);
    const mNum = parseInt(mStr, 10);
    const totalM = h24 * 60 + mNum;
    return totalM <= minMinutes;
  };

  // Emit updated value
  const emitChange = (h12, min, per) => {
    if (!onChange) return;

    if (!h12 && !min) {
      onChange('');
      return;
    }

    const effectiveH12 = parseInt(h12 || '12', 10);
    const effectiveMin = (min !== undefined && min !== '') ? String(min).padStart(2, '0') : '00';
    const effectivePeriod = per || parsed.period || currentPeriod;

    let h24 = effectiveH12;
    if (effectivePeriod === 'PM' && effectiveH12 < 12) h24 = effectiveH12 + 12;
    if (effectivePeriod === 'AM' && effectiveH12 === 12) h24 = 0;
    const totalM = h24 * 60 + parseInt(effectiveMin, 10);

    // Prevent emitting time earlier than minTime
    if (minMinutes !== null && totalM <= minMinutes) {
      return;
    }

    if (format === '12h') {
      const formatted = `${String(effectiveH12).padStart(2, '0')}:${effectiveMin} ${effectivePeriod}`;
      onChange(formatted);
    } else {
      const formatted = `${String(h24).padStart(2, '0')}:${effectiveMin}`;
      onChange(formatted);
    }
  };

  const handleSelectHour = (h) => {
    if (isHourDisabled(h)) return;
    const targetPeriod = currentPeriod;
    const h24 = targetPeriod === 'PM' ? (h < 12 ? h + 12 : 12) : (h === 12 ? 0 : h);

    // Choose minute: if parsed.minute is already valid with this hour, keep it.
    // Otherwise, find the lowest valid minute from minutesList.
    let targetMin = parsed.minute || '00';
    if (minMinutes !== null && (h24 * 60 + parseInt(targetMin, 10) <= minMinutes)) {
      const validMin = minutesList.find(m => (h24 * 60 + parseInt(m, 10)) > minMinutes);
      if (validMin) {
        targetMin = validMin;
      }
    }

    emitChange(String(h), targetMin, targetPeriod);
    setOpenMenu('minute'); // Automatically advance to minute selection
  };

  const handleSelectMinute = (m) => {
    if (isMinuteDisabled(m)) return;
    emitChange(parsed.hour12 || '12', m, currentPeriod);
    setOpenMenu(null); // Finish selection
  };

  const handlePeriodChange = (newPeriod) => {
    if (newPeriod === 'AM' && minMinutes !== null && minMinutes >= 720) return;
    setPeriodOverride(newPeriod);
    if (parsed.hasValue) {
      emitChange(parsed.hour12 || '12', parsed.minute || '00', newPeriod);
    }
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenu(null);
    setPeriodOverride(null);
    if (onChange) onChange('');
  };

  return (
    <div
      ref={containerRef}
      id={id}
      className={`unified-time-input ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: disabled ? 'var(--bg-surface-secondary, #f1f5f9)' : (effectiveError ? '#fef2f2' : 'var(--bg-app, #ffffff)'),
        border: effectiveError ? '2px solid #ef4444' : '1.5px solid var(--border-color, #cbd5e1)',
        borderRadius: '8px',
        height: '38px',
        padding: '2px 8px',
        boxSizing: 'border-box',
        fontSize: '0.90rem',
        fontWeight: 700,
        color: 'var(--text-primary, #0f172a)',
        gap: '4px',
        position: 'relative',
        userSelect: 'none',
        boxShadow: effectiveError ? '0 0 0 3px rgba(239, 68, 68, 0.2)' : 'none',
        ...style
      }}
    >
      {/* Clock icon */}
      <span style={{ fontSize: '0.88rem', color: effectiveError ? '#ef4444' : 'var(--text-secondary, #64748b)' }}>🕒</span>

      {/* Hour Button Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpenMenu(prev => prev === 'hour' ? null : 'hour')}
        style={{
          border: 'none',
          background: openMenu === 'hour' ? 'var(--apple-blue-subtle, #e0f2fe)' : 'transparent',
          color: parsed.hour12 ? (effectiveError ? '#b91c1c' : 'var(--text-primary, #0f172a)') : 'var(--text-tertiary, #94a3b8)',
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
          color: parsed.minute ? (effectiveError ? '#b91c1c' : 'var(--text-primary, #0f172a)') : 'var(--text-tertiary, #94a3b8)',
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
          background: 'var(--bg-surface-secondary, #f1f5f9)',
          borderRadius: '6px',
          padding: '2px',
          marginLeft: '4px',
          border: '1px solid var(--border-color, #e2e8f0)',
          flexShrink: 0
        }}
      >
        <button
          type="button"
          disabled={disabled || (minMinutes !== null && minMinutes >= 720)}
          onClick={() => handlePeriodChange('AM')}
          title={(minMinutes !== null && minMinutes >= 720) ? 'AM cannot be selected (must be later than early check-in time)' : 'AM'}
          style={{
            border: 'none',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.74rem',
            fontWeight: 850,
            cursor: (disabled || (minMinutes !== null && minMinutes >= 720)) ? 'not-allowed' : 'pointer',
            opacity: (minMinutes !== null && minMinutes >= 720) ? 0.35 : 1,
            background: currentPeriod === 'AM' ? 'var(--apple-blue, #0071e3)' : 'transparent',
            color: currentPeriod === 'AM' ? '#ffffff' : 'var(--text-secondary, #64748b)',
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
            background: currentPeriod === 'PM' ? 'var(--apple-blue, #0071e3)' : 'transparent',
            color: currentPeriod === 'PM' ? '#ffffff' : 'var(--text-secondary, #64748b)',
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
            background: 'var(--bg-surface, #ffffff)',
            border: '1.5px solid var(--border-color, #cbd5e1)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
            padding: '10px',
            minWidth: '220px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 850, color: 'var(--apple-blue, #0369a1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Hour (1 - 12)
            </span>
            <button
              type="button"
              onClick={() => setOpenMenu(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {hoursList.map((h) => {
              const isSelected = parsed.hour12 && Number(parsed.hour12) === h;
              const isDisabled = isHourDisabled(h);
              return (
                <button
                  key={h}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && handleSelectHour(h)}
                  title={isDisabled ? 'Hour is earlier than early check-in time' : `Select hour ${h}`}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-color, #e2e8f0)',
                    background: isDisabled ? '#f1f5f9' : (isSelected ? 'var(--apple-blue)' : 'var(--bg-surface-secondary, #f8fafc)'),
                    color: isDisabled ? '#94a3b8' : (isSelected ? '#ffffff' : 'var(--text-primary, #1e293b)'),
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.35 : 1,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                      e.currentTarget.style.borderColor = 'var(--apple-blue)';
                      e.currentTarget.style.color = 'var(--apple-blue)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = 'var(--bg-surface-secondary, #f8fafc)';
                      e.currentTarget.style.borderColor = 'var(--border-color, #e2e8f0)';
                      e.currentTarget.style.color = 'var(--text-primary, #1e293b)';
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
            background: 'var(--bg-surface, #ffffff)',
            border: '1.5px solid var(--border-color, #cbd5e1)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
            padding: '10px',
            minWidth: '220px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 850, color: 'var(--apple-blue, #0369a1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Minute (:00 - :55)
            </span>
            <button
              type="button"
              onClick={() => setOpenMenu(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {minutesList.map((m) => {
              const isSelected = parsed.minute === m;
              const isDisabled = isMinuteDisabled(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => !isDisabled && handleSelectMinute(m)}
                  title={isDisabled ? 'Minute is earlier than early check-in time' : `Select minute ${m}`}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-color, #e2e8f0)',
                    background: isDisabled ? '#f1f5f9' : (isSelected ? 'var(--apple-blue)' : 'var(--bg-surface-secondary, #f8fafc)'),
                    color: isDisabled ? '#94a3b8' : (isSelected ? '#ffffff' : 'var(--text-primary, #1e293b)'),
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.35 : 1,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                      e.currentTarget.style.borderColor = 'var(--apple-blue)';
                      e.currentTarget.style.color = 'var(--apple-blue)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = 'var(--bg-surface-secondary, #f8fafc)';
                      e.currentTarget.style.borderColor = 'var(--border-color, #e2e8f0)';
                      e.currentTarget.style.color = 'var(--text-primary, #1e293b)';
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
