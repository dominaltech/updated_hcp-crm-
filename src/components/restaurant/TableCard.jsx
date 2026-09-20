import React, { useState, useEffect, useRef } from 'react';
import { formatCurrency } from '../../utils/formatters';

export default function TableCard({
  table,
  onClick,
  onStatusChange,
  onSettle,
  department = 'restaurant'
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const cardRef = useRef(null);

  const isRoomService = table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-');
  const isParcel = table.table_type === 'parcel' || table.is_parcel || table.is_takeaway;

  // Status mapping
  const rawStatus = (table.status || 'available').toLowerCase();
  const hasCart = Array.isArray(table.cart) && table.cart.length > 0;
  
  let currentStatus = rawStatus;
  if (rawStatus === 'available' && hasCart) {
    currentStatus = isRoomService || isParcel ? 'in_process' : 'occupied';
  } else if ((isRoomService || isParcel) && hasCart) {
    currentStatus = rawStatus === 'billed' ? 'billed' : 'in_process';
  }

  const isFree = currentStatus === 'available' || currentStatus === 'free';
  const isOccupied = currentStatus === 'occupied';
  const isInProcess = currentStatus === 'in_process';
  const isReady = currentStatus === 'ready';
  const isBilled = currentStatus === 'billed';

  const cartTotal = table.cart_total || (table.cart ? table.cart.reduce((sum, item) => sum + (item.price * (item.quantity || item.qty || 1)), 0) : 0);

  // Big table number display
  let bigNumber = table.table_number || 'T-1';
  let subTitle = '';

  if (isRoomService) {
    const roomNum = bigNumber.replace(/^RS-/i, '');
    bigNumber = roomNum;
    subTitle = table.special_notes || table.name || `Room #${roomNum}`;
  } else if (isParcel) {
    const pNum = bigNumber.replace(/^(B?P-)/i, 'Parcel #');
    bigNumber = pNum;
  }

  // Right-click context menu handler
  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      x: e.clientX,
      y: e.clientY
    });
  };

  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('scroll', handleOutsideClick);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('scroll', handleOutsideClick);
    };
  }, [contextMenu]);

  const handleSetStatus = (nextStatus, andSettle = false) => {
    setContextMenu(null);
    if (onStatusChange) {
      onStatusChange(table, nextStatus);
    }
    if (andSettle && onSettle) {
      setTimeout(() => {
        onSettle({ ...table, status: nextStatus });
      }, 120);
    }
  };

  // Determine border & background styles (dotted / dashed)
  let statusBorderColor = '#cbd5e1';
  let statusBg = '#ffffff';
  let badgeBg = '#f1f5f9';
  let badgeColor = '#475569';
  let badgeText = 'FREE';

  if (isReady) {
    statusBorderColor = '#10b981';
    statusBg = '#f0fdf4';
    badgeBg = '#dcfce7';
    badgeColor = '#15803d';
    badgeText = 'READY';
  } else if (isInProcess) {
    statusBorderColor = '#f59e0b';
    statusBg = '#fffbeb';
    badgeBg = '#fef3c7';
    badgeColor = '#b45309';
    badgeText = 'IN PROCESS';
  } else if (isBilled) {
    statusBorderColor = '#f43f5e';
    statusBg = '#fff1f2';
    badgeBg = '#ffe4e6';
    badgeColor = '#be123c';
    badgeText = 'BILLED';
  } else if (isOccupied) {
    statusBorderColor = '#3b82f6';
    statusBg = '#f0f7ff';
    badgeBg = '#dbeafe';
    badgeColor = '#1d4ed8';
    badgeText = 'OCCUPIED';
  }

  return (
    <>
      <div
        ref={cardRef}
        className={`table-card-dotted status-${currentStatus} ${isRoomService ? 'is-room-service' : ''}`}
        tabIndex={0}
        role="button"
        onClick={() => onClick && onClick(table)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick && onClick(table);
          }
        }}
        onContextMenu={handleContextMenu}
        style={{
          borderRadius: '16px',
          padding: '16px 14px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          minHeight: '136px',
          position: 'relative',
          transition: 'all 0.18s ease-in-out',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          userSelect: 'none'
        }}
        title={`Click to open order • Right-click to change status / settle`}
      >
        {/* Status Pill on Top */}
        <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
          <span
            className={`table-status-pill status-${currentStatus}`}
            style={{
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.03em',
              background: badgeBg,
              color: badgeColor,
              border: `1px solid ${statusBorderColor}`
            }}
          >
            {badgeText}
          </span>
        </div>

        {/* Room Service / Parcel Tag if applicable */}
        {isRoomService && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', fontSize: '0.72rem', fontWeight: 800, color: '#0369a1' }}>
            🛎️ Room
          </div>
        )}
        {isParcel && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', fontSize: '0.72rem', fontWeight: 800, color: '#b45309' }}>
            📦 Parcel
          </div>
        )}

        {/* ONLY Table / Room Number in BIG */}
        <div
          className="table-number-big"
          style={{
            fontSize: '2.5rem',
            fontWeight: 900,
            lineHeight: 1,
            color: 'var(--text-primary)',
            letterSpacing: '-0.04em',
            marginTop: (isRoomService || isParcel) ? '12px' : '6px'
          }}
        >
          {bigNumber}
        </div>

        {/* Subtitle if Room Service guest name */}
        {subTitle && (
          <div
            className="table-card-subtitle"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              marginTop: '4px',
              maxWidth: '90%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {subTitle}
          </div>
        )}

        {/* IF OCCUPIED / ACTIVE: SEE AMOUNT & TIME ON CARD */}
        {!isFree && (
          <div
            style={{
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              paddingTop: '6px',
              borderTop: '1px dashed rgba(0,0,0,0.08)'
            }}
          >
            <span style={{ fontSize: '1.05rem', fontWeight: 850, color: isReady ? '#10b981' : '#0071e3' }}>
              {formatCurrency(cartTotal)}
            </span>
            {table.elapsed_minutes !== undefined && table.elapsed_minutes > 0 && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', background: 'rgba(0,0,0,0.05)', padding: '1px 6px', borderRadius: '8px' }}>
                ⏱️ {table.elapsed_minutes}m
              </span>
            )}
          </div>
        )}
      </div>

      {/* Modern Context Menu on Right Click */}
      {contextMenu && (
        <div
          className="context-menu-popover"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.2), 0 0 0 1px var(--border-medium, rgba(0,0,0,0.06))',
            padding: '6px',
            zIndex: 9999,
            minWidth: '200px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '6px 10px', fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {table.table_number || 'Table'} Actions
          </div>

          {(isRoomService || isParcel) && (
            <>
              <button
                type="button"
                className="context-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isInProcess ? '#fef3c7' : 'transparent',
                  color: isInProcess ? '#92400e' : '#0f172a',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onClick={() => handleSetStatus('in_process')}
              >
                <span>🟡</span>
                <span>Set: In Process</span>
                {isInProcess && <span style={{ marginLeft: 'auto' }}>✓</span>}
              </button>

              <button
                type="button"
                className="context-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isReady ? '#dcfce7' : '#ecfdf5',
                  color: '#065f46',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
                onClick={() => handleSetStatus('ready', true)}
              >
                <span>🟢</span>
                <span>Mark Ready &amp; Settle Bill →</span>
              </button>
            </>
          )}

          {!isFree && (
            <button
              type="button"
              className="context-menu-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'transparent',
                color: '#0071e3',
                fontWeight: 750,
                fontSize: '0.84rem',
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onClick={() => {
                setContextMenu(null);
                if (onSettle) onSettle(table);
              }}
            >
              <span>💳</span>
              <span>Direct Settle / Bill</span>
            </button>
          )}

          <button
            type="button"
            className="context-menu-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: '#0f172a',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: 'pointer',
              textAlign: 'left'
            }}
            onClick={() => {
              setContextMenu(null);
              if (onClick) onClick(table);
            }}
          >
            <span>📝</span>
            <span>Open Order Taking</span>
          </button>
        </div>
      )}
    </>
  );
}
