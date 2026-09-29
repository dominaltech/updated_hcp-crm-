import React, { useMemo, useState, useRef, useEffect } from 'react';
import { timeToMinutes } from '../../utils/formatters';

/**
 * UnifiedTimeInput
 * Combines Hour, Minute, and AM/PM in ONE unified input field container.
 * Supports:
 * - Direct typing for both Hour (1-12) and ANY Minute (00-59, e.g. 22).
 * - ArrowUp/ArrowDown stepping for Hour and Minute.
 * - Modern themed popover dropdown with 5-min intervals plus custom minute input.
 * - 12h and 24h format support.
 * - minTime support: strictly validates that time > minTime when specified.
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
  const [customMinute, setCustomMinute] = useState('');
  const containerRef = useRef(null);
  const hourInputRef = useRef(null);
  const minuteInputRef = useRef(null);

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
      return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false, hasPeriod: false };
    }

    const val = value.trim();
    if (!val) return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false, hasPeriod: false };

    // Check if 12h format like "12:00 PM" or "02:30 AM" or 24h like "14:30"
    const match12 = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = match12[2];
      let p = (match12[3] || '').toUpperCase();
      const hasP = Boolean(p);

      if (!p) {
        // Assume 24h if no AM/PM
        if (h >= 12) {
          p = 'PM';
          if (h > 12) h -= 12;
        } else {
          p = (minMinutes !== null && minMinutes >= 720) ? 'PM' : 'AM';
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
        hasValue: true,
        hasPeriod: hasP
      };
    }

    return { hour12: '', minute: '', period: fallbackPeriod, hasValue: false, hasPeriod: false };
  }, [value, minMinutes]);

  const currentPeriod = periodOverride || (parsed.hasPeriod ? parsed.period : ((minMinutes !== null && minMinutes >= 720) ? 'PM' : parsed.period || 'AM'));

  // 12-hour array
  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // 60 minutes in 5-min intervals plus any current custom minute
  const minutesList = useMemo(() => {
    const mins = [];
    for (let i = 0; i < 60; i += 5) {
      mins.push(String(i).padStart(2, '0'));
    }
    if (parsed.minute && !mins.includes(parsed.minute)) {
      mins.push(parsed.minute);
      mins.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
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
    const effectivePeriod = per || currentPeriod || 'PM';

    let h24 = effectiveH12;
    if (effectivePeriod === 'PM' && effectiveH12 < 12) h24 = effectiveH12 + 12;
    if (effectivePeriod === 'AM' && effectiveH12 === 12) h24 = 0;

    if (format === '12h') {
      const formatted = `${String(effectiveH12).padStart(2, '0')}:${effectiveMin} ${effectivePeriod}`;
      onChange(formatted);
    } else {
      const formatted = `${String(h24).padStart(2, '0')}:${effectiveMin}`;
      onChange(formatted);
    }
  };

  const handleSelectHour = (h) => {
    const targetPeriod = currentPeriod;
    const h24 = targetPeriod === 'PM' ? (h < 12 ? h + 12 : 12) : (h === 12 ? 0 : h);

    // If current minute would be invalid with this hour and minMinutes, advance to valid minute
    let targetMin = parsed.minute || '00';
    if (minMinutes !== null && (h24 * 60 + parseInt(targetMin, 10) <= minMinutes)) {
      const minRemainder = minMinutes - h24 * 60;
      if (minRemainder >= 0 && minRemainder < 59) {
        targetMin = String(minRemainder + 1).padStart(2, '0');
      } else {
        targetMin = '00';
      }
    }

    emitChange(String(h), targetMin, targetPeriod);
    setOpenMenu('minute'); // Automatically advance to minute selection
  };

  const handleSelectMinute = (m) => {
    emitChange(parsed.hour12 || '12', m, currentPeriod);
    setOpenMenu(null); // Finish selection
  };

  const handlePeriodChange = (newPeriod) => {
    setPeriodOverride(newPeriod);
    const h12 = parsed.hour12 || '12';
    const m = parsed.minute || '00';
    emitChange(h12, m, newPeriod);
  };

  const handleHourInputChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      emitChange('', parsed.minute, currentPeriod);
      return;
    }
    let num = parseInt(raw, 10);
    if (num > 12) num = 12;
    if (num === 0) num = 1;
    emitChange(String(num), parsed.minute || '00', currentPeriod);
    if (raw.length >= 2) {
      if (minuteInputRef.current) minuteInputRef.current.focus();
    }
  };

  const handleHourKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = parseInt(parsed.hour12 || '12', 10);
      const next = cur >= 12 ? 1 : cur + 1;
      emitChange(String(next), parsed.minute || '00', currentPeriod);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseInt(parsed.hour12 || '12', 10);
      const next = cur <= 1 ? 12 : cur - 1;
      emitChange(String(next), parsed.minute || '00', currentPeriod);
    } else if (e.key === 'ArrowRight' || e.key === ':') {
      e.preventDefault();
      if (minuteInputRef.current) minuteInputRef.current.focus();
    }
  };

  const handleMinuteInputChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      emitChange(parsed.hour12 || '12', '', currentPeriod);
      return;
    }
    let num = parseInt(raw, 10);
    if (num > 59) num = 59;
    const formatted = raw.length >= 2 ? String(num).padStart(2, '0') : String(num);
    emitChange(parsed.hour12 || '12', formatted, currentPeriod);
  };

  const handleMinuteKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = parseInt(parsed.minute || '00', 10);
      const next = cur >= 59 ? 0 : cur + 1;
      emitChange(parsed.hour12 || '12', String(next).padStart(2, '0'), currentPeriod);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseInt(parsed.minute || '00', 10);
      const next = cur <= 0 ? 59 : cur - 1;
      emitChange(parsed.hour12 || '12', String(next).padStart(2, '0'), currentPeriod);
    } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) {
      e.preventDefault();
      if (hourInputRef.current) hourInputRef.current.focus();
    }
  };

  const handleMinuteBlur = () => {
    if (parsed.minute && parsed.minute.length === 1) {
      emitChange(parsed.hour12 || '12', parsed.minute.padStart(2, '0'), currentPeriod);
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
        gap: '2px',
        position: 'relative',
        boxShadow: effectiveError ? '0 0 0 3px rgba(239, 68, 68, 0.2)' : 'none',
        ...style
      }}
    >
      {/* Clock icon */}
      <span style={{ fontSize: '0.88rem', color: effectiveError ? '#ef4444' : 'var(--text-secondary, #64748b)', marginRight: '2px' }}>🕒</span>

      {/* Hour Editable Input & Popover Trigger */}
      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
        <input
          ref={hourInputRef}
          type="text"
          inputMode="numeric"
          maxLength={2}
          disabled={disabled}
          placeholder="HH"
          value={parsed.hour12 ? String(parsed.hour12).padStart(2, '0') : ''}
          onChange={handleHourInputChange}
          onKeyDown={handleHourKeyDown}
          style={{
            width: '28px',
            textAlign: 'center',
            border: 'none',
            background: 'transparent',
            fontSize: '0.92rem',
            fontWeight: 850,
            color: parsed.hour12 ? (effectiveError ? '#b91c1c' : 'var(--text-primary, #0f172a)') : 'var(--text-tertiary, #94a3b8)',
            padding: 0,
            outline: 'none',
            fontFamily: 'inherit',
            cursor: disabled ? 'not-allowed' : 'text'
          }}
          title="Type Hour or Click Arrow for Dropdown"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpenMenu(prev => prev === 'hour' ? null : 'hour')}
          style={{
            border: 'none',
            background: openMenu === 'hour' ? 'var(--apple-blue-subtle, #e0f2fe)' : 'transparent',
            color: 'var(--text-secondary, #64748b)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '2px 2px',
            borderRadius: '4px',
            fontSize: '0.60rem'
          }}
          title="Open Hour Menu"
        >
          ▼
        </button>
      </div>

      <span style={{ fontWeight: 900, color: 'var(--text-tertiary, #94a3b8)', margin: '0 1px' }}>:</span>

      {/* Minute Editable Input & Popover Trigger */}
      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
        <input
          ref={minuteInputRef}
          type="text"
          inputMode="numeric"
          maxLength={2}
          disabled={disabled}
          placeholder="MM"
          value={parsed.minute || ''}
          onChange={handleMinuteInputChange}
          onKeyDown={handleMinuteKeyDown}
          onBlur={handleMinuteBlur}
          style={{
            width: '28px',
            textAlign: 'center',
            border: 'none',
            background: 'transparent',
            fontSize: '0.92rem',
            fontWeight: 850,
            color: parsed.minute ? (effectiveError ? '#b91c1c' : 'var(--text-primary, #0f172a)') : 'var(--text-tertiary, #94a3b8)',
            padding: 0,
            outline: 'none',
            fontFamily: 'inherit',
            cursor: disabled ? 'not-allowed' : 'text'
          }}
          title="Type Any Minute (00 - 59) or Click Arrow for Dropdown"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpenMenu(prev => prev === 'minute' ? null : 'minute')}
          style={{
            border: 'none',
            background: openMenu === 'minute' ? 'var(--apple-blue-subtle, #e0f2fe)' : 'transparent',
            color: 'var(--text-secondary, #64748b)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            padding: '2px 2px',
            borderRadius: '4px',
            fontSize: '0.60rem'
          }}
          title="Open Minute Menu"
        >
          ▼
        </button>
      </div>

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
          disabled={disabled}
          onClick={() => handlePeriodChange('AM')}
          title="AM"
          style={{
            border: 'none',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '0.74rem',
            fontWeight: 850,
            cursor: disabled ? 'not-allowed' : 'pointer',
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
          title="PM"
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
                  onClick={() => handleSelectHour(h)}
                  title={isDisabled ? 'Hour is earlier than early check-in time' : `Select hour ${h}`}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-color, #e2e8f0)',
                    background: isDisabled ? '#fff1f2' : (isSelected ? 'var(--apple-blue)' : 'var(--bg-surface-secondary, #f8fafc)'),
                    color: isDisabled ? '#e11d48' : (isSelected ? '#ffffff' : 'var(--text-primary, #1e293b)'),
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                      e.currentTarget.style.borderColor = 'var(--apple-blue)';
                      e.currentTarget.style.color = 'var(--apple-blue)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = isDisabled ? '#fff1f2' : 'var(--bg-surface-secondary, #f8fafc)';
                      e.currentTarget.style.borderColor = 'var(--border-color, #e2e8f0)';
                      e.currentTarget.style.color = isDisabled ? '#e11d48' : 'var(--text-primary, #1e293b)';
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
            minWidth: '240px',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 850, color: 'var(--apple-blue, #0369a1)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Minute (00 - 59)
            </span>
            <button
              type="button"
              onClick={() => setOpenMenu(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: 'var(--text-secondary, #94a3b8)', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>

          {/* Custom exact minute entry */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', padding: '6px 8px', background: 'var(--bg-surface-secondary, #f8fafc)', borderRadius: '8px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary, #64748b)' }}>Exact Min:</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="00-59"
              value={customMinute}
              onChange={(e) => setCustomMinute(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const num = parseInt(customMinute, 10);
                  if (!isNaN(num) && num >= 0 && num <= 59) {
                    handleSelectMinute(String(num).padStart(2, '0'));
                    setCustomMinute('');
                  }
                }
              }}
              style={{
                width: '54px',
                height: '28px',
                padding: '0 6px',
                borderRadius: '6px',
                border: '1.5px solid var(--apple-blue, #0284c7)',
                fontSize: '0.85rem',
                fontWeight: 800,
                textAlign: 'center'
              }}
            />
            <button
              type="button"
              onClick={() => {
                const num = parseInt(customMinute, 10);
                if (!isNaN(num) && num >= 0 && num <= 59) {
                  handleSelectMinute(String(num).padStart(2, '0'));
                  setCustomMinute('');
                }
              }}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'var(--apple-blue, #0071e3)',
                color: '#fff',
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              Set
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
                  onClick={() => handleSelectMinute(m)}
                  title={isDisabled ? 'Minute is earlier than early check-in time' : `Select minute ${m}`}
                  style={{
                    padding: '8px 0',
                    fontSize: '0.88rem',
                    fontWeight: 850,
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-color, #e2e8f0)',
                    background: isDisabled ? '#fff1f2' : (isSelected ? 'var(--apple-blue)' : 'var(--bg-surface-secondary, #f8fafc)'),
                    color: isDisabled ? '#e11d48' : (isSelected ? '#ffffff' : 'var(--text-primary, #1e293b)'),
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                      e.currentTarget.style.borderColor = 'var(--apple-blue)';
                      e.currentTarget.style.color = 'var(--apple-blue)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = isDisabled ? '#fff1f2' : 'var(--bg-surface-secondary, #f8fafc)';
                      e.currentTarget.style.borderColor = 'var(--border-color, #e2e8f0)';
                      e.currentTarget.style.color = isDisabled ? '#e11d48' : 'var(--text-primary, #1e293b)';
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
