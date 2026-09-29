import React, { useState, useRef, useEffect, useMemo } from 'react';

/**
 * ThemedDatePicker - Apple Aesthetic Custom Calendar Component
 * Replaces generic browser native <input type="date"> with a fully-themed,
 * interactive, accessible calendar dropdown matching Hotel City Park CRM.
 * 
 * Accepts & returns standard 'YYYY-MM-DD' format.
 */
export default function ThemedDatePicker({
  value = '',
  onChange,
  min = '',
  max = '',
  placeholder = 'DD-MM-YYYY',
  disabled = false,
  required = false,
  className = '',
  style = {},
  id,
  name,
  error = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Normalize incoming value to Date object or null
  const parsedValueDate = useMemo(() => {
    if (!value) return null;
    const parts = String(value).split('T')[0].split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dt = new Date(y, m, d);
      return isNaN(dt.getTime()) ? null : dt;
    }
    return null;
  }, [value]);

  // View state for the calendar (currently displayed month and year)
  const [viewYear, setViewYear] = useState(() => {
    return parsedValueDate ? parsedValueDate.getFullYear() : new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    return parsedValueDate ? parsedValueDate.getMonth() : new Date().getMonth();
  });
  const [isMonthYearPickerOpen, setIsMonthYearPickerOpen] = useState(false);

  // Sync view when value changes externally
  useEffect(() => {
    if (parsedValueDate) {
      setViewYear(parsedValueDate.getFullYear());
      setViewMonth(parsedValueDate.getMonth());
    }
  }, [value]);

  // Close calendar popover on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setIsMonthYearPickerOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Helpers
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Format date to YYYY-MM-DD
  const formatIsoDate = (year, month, day) => {
    const yStr = String(year);
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}`;
  };

  // Format date to DD-MM-YYYY for display
  const displayFormattedDate = useMemo(() => {
    if (!parsedValueDate) return '';
    const d = String(parsedValueDate.getDate()).padStart(2, '0');
    const m = String(parsedValueDate.getMonth() + 1).padStart(2, '0');
    const y = parsedValueDate.getFullYear();
    return `${d}-${m}-${y}`;
  }, [parsedValueDate]);

  // Handle date click
  const handleSelectDay = (year, month, day, isDisabled) => {
    if (isDisabled || disabled) return;
    const iso = formatIsoDate(year, month, day);
    if (onChange) {
      // Support both direct value or synthetic event pattern
      onChange({ target: { value: iso, name } });
    }
    setIsOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (onChange) {
      onChange({ target: { value: '', name } });
    }
    setIsOpen(false);
  };

  const handlePickToday = (e) => {
    e.stopPropagation();
    const today = new Date();
    const iso = formatIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
    if (min && iso < min) return;
    if (max && iso > max) return;
    if (onChange) {
      onChange({ target: { value: iso, name } });
    }
    setIsOpen(false);
  };

  // Navigation
  const prevMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = (e) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Days matrix generation for calendar
  const calendarGrid = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const totalDaysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const totalDaysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const minDateObj = min ? new Date(min + 'T00:00:00') : null;
    const maxDateObj = max ? new Date(max + 'T23:59:59') : null;
    const today = new Date();
    const todayIso = formatIsoDate(today.getFullYear(), today.getMonth(), today.getDate());

    const cells = [];

    // Prev month days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = totalDaysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      const iso = formatIsoDate(y, m, d);
      const dt = new Date(y, m, d);
      const isPastMin = minDateObj ? dt < minDateObj : false;
      const isPastMax = maxDateObj ? dt > maxDateObj : false;
      const isDayDisabled = isPastMin || isPastMax;

      cells.push({
        day: d,
        month: m,
        year: y,
        iso,
        isCurrentMonth: false,
        isSelected: value === iso,
        isToday: todayIso === iso,
        isDisabled: isDayDisabled
      });
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const iso = formatIsoDate(viewYear, viewMonth, d);
      const dt = new Date(viewYear, viewMonth, d);
      const isPastMin = minDateObj ? dt < minDateObj : false;
      const isPastMax = maxDateObj ? dt > maxDateObj : false;
      const isDayDisabled = isPastMin || isPastMax;

      cells.push({
        day: d,
        month: viewMonth,
        year: viewYear,
        iso,
        isCurrentMonth: true,
        isSelected: value === iso,
        isToday: todayIso === iso,
        isDisabled: isDayDisabled
      });
    }

    // Next month days to fill 35 or 42 grid cells
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      const iso = formatIsoDate(y, m, d);
      const dt = new Date(y, m, d);
      const isPastMin = minDateObj ? dt < minDateObj : false;
      const isPastMax = maxDateObj ? dt > maxDateObj : false;
      const isDayDisabled = isPastMin || isPastMax;

      cells.push({
        day: d,
        month: m,
        year: y,
        iso,
        isCurrentMonth: false,
        isSelected: value === iso,
        isToday: todayIso === iso,
        isDisabled: isDayDisabled
      });
    }

    return cells;
  }, [viewYear, viewMonth, min, max, value]);



  return (
    <div
      ref={containerRef}
      id={id}
      className={`themed-date-picker-container ${className}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '100%',
        boxSizing: 'border-box',
        ...style
      }}
    >
      {/* Trigger Input Display */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            setIsMonthYearPickerOpen(false);
          }
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: '38px',
          padding: '6px 10px',
          boxSizing: 'border-box',
          background: disabled
            ? 'var(--bg-surface-secondary, #f1f5f9)'
            : (error ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-app, #ffffff)'),
          border: error
            ? '2px solid #ef4444'
            : (isOpen ? '1.5px solid var(--apple-blue, #0071e3)' : '1.5px solid var(--border-color, #cbd5e1)'),
          borderRadius: '8px',
          color: displayFormattedDate ? 'var(--text-primary, #0f172a)' : 'var(--text-tertiary, #94a3b8)',
          fontSize: '0.85rem',
          fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          boxShadow: isOpen ? '0 0 0 3px rgba(0, 113, 227, 0.15)' : 'none',
          transition: 'all 0.15s ease',
          userSelect: 'none'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.90rem', color: 'var(--apple-blue, #0071e3)' }}>📅</span>
          <span>{displayFormattedDate || placeholder}</span>
        </span>

        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Quick Clear Button */}
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear date"
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: '0.80rem',
                fontWeight: 800,
                cursor: 'pointer',
                padding: '0 4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              ✕
            </button>
          )}
          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary, #64748b)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
            ▼
          </span>
        </span>
      </div>

      {/* THEMED CALENDAR DROPDOWN POPOVER */}
      {isOpen && (
        <div
          className="themed-calendar-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 10050,
            width: '280px',
            background: 'var(--bg-surface, #ffffff)',
            border: '1.5px solid var(--border-color, #cbd5e1)',
            borderRadius: '14px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.22)',
            padding: '12px',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            userSelect: 'none',
            animation: 'fadeIn 0.15s ease'
          }}
        >
          {/* Header: Month / Year Title & Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={prevMonth}
              title="Previous Month"
              style={{
                border: '1px solid var(--border-color, #e2e8f0)',
                background: 'var(--bg-surface-secondary, #f8fafc)',
                borderRadius: '8px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '1rem',
                color: 'var(--text-primary, #0f172a)',
                fontWeight: 700
              }}
            >
              ‹
            </button>

            {/* Quick Month/Year Jump Trigger */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMonthYearPickerOpen((prev) => !prev);
              }}
              style={{
                border: 'none',
                background: isMonthYearPickerOpen ? 'rgba(0, 113, 227, 0.1)' : 'transparent',
                color: 'var(--text-primary, #0f172a)',
                fontWeight: 850,
                fontSize: '0.88rem',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>{monthNames[viewMonth]} {viewYear}</span>
              <span style={{ fontSize: '0.60rem', color: 'var(--apple-blue, #0071e3)' }}>
                {isMonthYearPickerOpen ? '▲' : '▼'}
              </span>
            </button>

            <button
              type="button"
              onClick={nextMonth}
              title="Next Month"
              style={{
                border: '1px solid var(--border-color, #e2e8f0)',
                background: 'var(--bg-surface-secondary, #f8fafc)',
                borderRadius: '8px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '1rem',
                color: 'var(--text-primary, #0f172a)',
                fontWeight: 700
              }}
            >
              ›
            </button>
          </div>

          {/* Quick Month/Year Selector Overlay */}
          {isMonthYearPickerOpen ? (
            <div
              style={{
                padding: '8px',
                background: 'var(--bg-surface-secondary, #f8fafc)',
                borderRadius: '10px',
                marginBottom: '10px',
                border: '1px solid var(--border-color, #e2e8f0)'
              }}
            >
              {/* Year Navigation Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', padding: '0 4px' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewYear((y) => y - 1);
                  }}
                  title="Previous Year"
                  style={{
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: '#ffffff',
                    borderRadius: '6px',
                    width: '26px',
                    height: '26px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    color: '#334155'
                  }}
                >
                  ‹
                </button>
                <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary, #0f172a)' }}>
                  {viewYear}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewYear((y) => y + 1);
                  }}
                  title="Next Year"
                  style={{
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: '#ffffff',
                    borderRadius: '6px',
                    width: '26px',
                    height: '26px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    color: '#334155'
                  }}
                >
                  ›
                </button>
              </div>

              {/* 3x4 Month Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {monthNames.map((m, idx) => {
                  const isSelected = viewMonth === idx;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewMonth(idx);
                        setIsMonthYearPickerOpen(false);
                      }}
                      style={{
                        padding: '6px 4px',
                        borderRadius: '8px',
                        border: isSelected ? 'none' : '1px solid var(--border-color, #e2e8f0)',
                        background: isSelected ? 'var(--apple-blue, #0071e3)' : '#ffffff',
                        color: isSelected ? '#ffffff' : 'var(--text-primary, #1e293b)',
                        fontWeight: isSelected ? 800 : 650,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {m.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {/* Days of Week Header */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  textAlign: 'center',
                  marginBottom: '6px',
                  borderBottom: '1px solid var(--border-color, #f1f5f9)',
                  paddingBottom: '4px'
                }}
              >
                {dayNames.map((day, idx) => (
                  <span
                    key={day}
                    style={{
                      fontSize: '0.70rem',
                      fontWeight: 800,
                      color: idx === 0 || idx === 6 ? '#ef4444' : 'var(--text-secondary, #64748b)',
                      textTransform: 'uppercase'
                    }}
                  >
                    {day}
                  </span>
                ))}
              </div>

              {/* Days Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)',
                  gap: '3px'
                }}
              >
                {calendarGrid.map((cell, idx) => {
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={cell.isDisabled}
                      onClick={() => handleSelectDay(cell.year, cell.month, cell.day, cell.isDisabled)}
                      style={{
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.80rem',
                        fontWeight: cell.isSelected ? 900 : (cell.isToday ? 850 : 650),
                        borderRadius: '8px',
                        border: cell.isSelected
                          ? '1.5px solid var(--apple-blue, #0071e3)'
                          : (cell.isToday ? '1.5px solid #38bdf8' : 'none'),
                        background: cell.isSelected
                          ? 'var(--apple-blue, #0071e3)'
                          : (cell.isToday ? 'rgba(56, 189, 248, 0.12)' : 'transparent'),
                        color: cell.isDisabled
                          ? '#cbd5e1'
                          : (cell.isSelected
                            ? '#ffffff'
                            : (cell.isCurrentMonth
                              ? 'var(--text-primary, #0f172a)'
                              : 'var(--text-tertiary, #94a3b8)')),
                        cursor: cell.isDisabled ? 'not-allowed' : 'pointer',
                        transition: 'all 0.12s ease',
                        position: 'relative'
                      }}
                      onMouseEnter={(e) => {
                        if (!cell.isDisabled && !cell.isSelected) {
                          e.currentTarget.style.background = 'rgba(0, 113, 227, 0.10)';
                          e.currentTarget.style.color = 'var(--apple-blue, #0071e3)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!cell.isDisabled && !cell.isSelected) {
                          e.currentTarget.style.background = cell.isToday ? 'rgba(56, 189, 248, 0.12)' : 'transparent';
                          e.currentTarget.style.color = cell.isCurrentMonth ? 'var(--text-primary, #0f172a)' : 'var(--text-tertiary, #94a3b8)';
                        }
                      }}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Quick Footer Action Buttons: Today | Clear | Close */}
          {(() => {
            const today = new Date();
            const todayIso = formatIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
            const isTodayDisabled = Boolean((min && todayIso < min) || (max && todayIso > max));
            return (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '10px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-color, #f1f5f9)',
                  fontSize: '0.74rem'
                }}
              >
                <button
                  type="button"
                  disabled={isTodayDisabled}
                  onClick={handlePickToday}
                  title={isTodayDisabled ? 'Today is before minimum allowed date' : 'Select today'}
                  style={{
                    border: 'none',
                    background: isTodayDisabled ? '#f1f5f9' : 'rgba(0, 113, 227, 0.08)',
                    color: isTodayDisabled ? '#94a3b8' : 'var(--apple-blue, #0071e3)',
                    fontWeight: 800,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    cursor: isTodayDisabled ? 'not-allowed' : 'pointer',
                    opacity: isTodayDisabled ? 0.4 : 1
                  }}
                >
                  Today
                </button>

                {value && (
                  <button
                    type="button"
                    onClick={handleClear}
                    style={{
                      border: 'none',
                      background: '#fef2f2',
                      color: '#dc2626',
                      fontWeight: 800,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    Clear
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(false);
                  }}
                  style={{
                    border: '1px solid var(--border-color, #cbd5e1)',
                    background: 'transparent',
                    color: 'var(--text-secondary, #64748b)',
                    fontWeight: 700,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
