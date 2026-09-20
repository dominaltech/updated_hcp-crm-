import React, { useRef } from 'react';
import { formatCheckoutTimeDisplay } from '../../utils/formatters';

export default function RoomCard({
  room,
  onClick,
  onContextMenu,
  isGroupHovered,
  onGroupHover,
  onGroupLeave,
  isMultiSelected,
  onLongPress
}) {
  const longPressTimerRef = useRef(null);

  const statusTextMap = {
    ready: 'Ready',
    occupied: 'Occupied',
    needs_cleaning: 'Needs Cleaning',
    maintenance: 'Under Construction'
  };
  const statusText = statusTextMap[room.status] || room.status;

  const maxAdults = Number(room.max_adults || 2);
  const maxExtra = Number(room.max_extra_beds || 1);
  const totalCap = maxAdults + maxExtra;

  const isCombined = Boolean(room.is_combined && Array.isArray(room.linked_rooms) && room.linked_rooms.length > 0);
  const linkedStr = isCombined ? room.linked_rooms.join(', #') : '';

  // Scheduled Checkout Time & 4-Hour Reddish Blinking Indicator
  let isImminentCheckout = false;
  let formattedTime = '';
  let isOverdue = false;

  if (room.status === 'occupied') {
    let checkoutDate = null;
    if (room.approx_checkout_time) {
      checkoutDate = new Date(room.approx_checkout_time);
    } else if (room.checkin_time) {
      checkoutDate = new Date(new Date(room.checkin_time).getTime() + 24 * 60 * 60 * 1000);
    }

    if (checkoutDate && !isNaN(checkoutDate.getTime())) {
      formattedTime = formatCheckoutTimeDisplay(checkoutDate);
      const now = new Date();
      const diffHours = (checkoutDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (diffHours <= 4) {
        isImminentCheckout = true;
        isOverdue = diffHours < 0;
      }
    }
  }

  const groupRoomsList = (room.all_group_rooms || [room.room_number])
    .map((r) => (typeof r === 'object' && r !== null ? (r.room_number || r.roomNumber || '') : String(r)))
    .filter(Boolean)
    .join(',');

  const handleTouchStart = (e) => {
    longPressTimerRef.current = setTimeout(() => {
      if (onLongPress) onLongPress(room);
    }, 1500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const mobileNum = (room.guest_mobile || room.mobile || '').trim();

  return (
    <div
      className={`room-card status-${room.status} ${isCombined ? 'is-combined' : ''} ${
        isImminentCheckout ? 'checkout-imminent' : ''
      } ${room.has_overdue_fnb ? 'has-overdue-fnb' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${isGroupHovered ? 'group-linked-hover' : ''}`}
      tabIndex={0}
      data-room-id={room.id}
      data-room-num={room.room_number}
      data-linked-rooms={groupRoomsList}
      onMouseEnter={() => onGroupHover && onGroupHover(groupRoomsList)}
      onMouseLeave={() => {
        onGroupLeave && onGroupLeave();
        handleTouchEnd();
      }}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onClick={() => {
        if (room.status === 'maintenance') {
          return; // Under Construction rooms are non-clickable on left click
        }
        if (onClick) onClick(room);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (room.status !== 'maintenance' && onClick) {
            onClick(room);
          }
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (room.status === 'occupied') {
          return; // Right-click disabled for checked-in (occupied) rooms
        }
        if (onContextMenu) onContextMenu(e, room);
      }}
      title={`Room ${room.room_number}${
        room.status === 'maintenance'
          ? ' - Under Construction (Non-clickable)'
          : isCombined
          ? ` (Combined Booking with #${linkedStr})`
          : ''
      }`}
    >
      {/* Top-Left Corner: Active Visitors micro-badge */}
      {room.status === 'occupied' && Boolean(room.active_visitors_count) && (
        <div
          className="room-corner-badge visitor-badge"
          title={`${room.active_visitors_count} active visitor(s) currently in room`}
        >
          👥 {room.active_visitors_count}
        </div>
      )}

      {/* Top-Right Corner: Linked / Combined Group Booking indicator */}
      {isCombined && (
        <div
          className="room-group-indicator"
          title={`Combined Group Booking linked with Room(s) #${linkedStr}`}
        >
          {room.linked_rooms.length === 1 ? `🔗 #${room.linked_rooms[0]}` : `🔗 #${room.linked_rooms[0]} +${room.linked_rooms.length - 1}`}
        </div>
      )}

      {/* Top-Right Corner Red Blinking Indicator for 3+ Days Overdue F&B Bill */}
      {room.status === 'occupied' && room.has_overdue_fnb && (
        <div
          className="room-fnb-overdue-indicator"
          title={`🚨 3+ Days Overdue F&B: Unpaid restaurant/bar bill (₹${room.overdue_fnb_total}). Click to settle in Hospitality.`}
        >
          <span className="fnb-pulse-dot" />
          <span>🚨 {room.max_overdue_days ? `${room.max_overdue_days}d` : '3d+'} Overdue: ₹{room.overdue_fnb_total}</span>
        </div>
      )}

      {/* Status-Specific Display */}
      {room.status === 'ready' ? (
        <div
          className="room-ready-centered-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            gap: '8px',
            margin: 0,
            padding: 0
          }}
        >
          <div
            className="room-number-badge ready-big-number"
            style={{
              fontSize: '3.1rem',
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              color: 'var(--text-primary)',
              margin: 0,
              padding: 0,
              textAlign: 'center'
            }}
          >
            {room.room_number}
          </div>
          <div
            className="status-pill ready"
            style={{
              margin: 0
            }}
          >
            Ready
          </div>
        </div>
      ) : (
        <div
          className="room-card-centered-content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            gap: '2px',
            margin: 0,
            padding: isCombined ? '12px 4px 2px 4px' : 0
          }}
        >
          {/* Center Main: Room Number & Status Badge */}
          <div className="room-number-badge" style={{ margin: 0, lineHeight: 1 }}>{room.room_number}</div>
          <div className={`status-pill ${room.status}`}>{statusText}</div>

          {room.status === 'occupied' && (
            <div className="room-card-body occupied-body" style={{ margin: '3px 0 0 0' }}>
              {room.guest_name && (
                <div className="room-guest-pill" title={`Guest: ${room.guest_name}`}>
                  {isCombined ? '👥 ' : '👤 '}
                  {room.guest_name}
                </div>
              )}

              {mobileNum && (
                <div className="room-mobile-pill" title={`Mobile: ${mobileNum}`}>
                  📞 {mobileNum}
                </div>
              )}

              {/* Overdue F&B (>3 Days) Blinking Pill */}
              {room.has_overdue_fnb && (
                <div
                  className="room-fnb-blinking-pill"
                  title={`Pending F&B orders older than 3 days: ₹${room.overdue_fnb_total}. Click room to settle.`}
                >
                  <span className="fnb-pulse-dot-red" />
                  <span>🚨 F&B Overdue: <strong>₹{room.overdue_fnb_total}</strong></span>
                </div>
              )}

              {/* Check-Out Time: For OTA, always show fixed checkout time. For standard rooms, visible when imminent (<4h) */}
              {formattedTime && (room.booking_source === 'OTA' || isImminentCheckout) && (
                <div
                  className={`room-checkout-pill ${isImminentCheckout ? 'imminent' : ''}`}
                  style={room.booking_source === 'OTA' && !isImminentCheckout ? {
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    color: '#0369a1',
                    fontWeight: 750,
                    padding: '2px 6px',
                    fontSize: '0.68rem',
                    borderRadius: '5px'
                  } : undefined}
                  title={
                    room.booking_source === 'OTA'
                      ? `Checkout Time (Fixed & Paid): ${formattedTime}${isOverdue ? ' (Overdue)' : ''}`
                      : `Checkout scheduled for ${formattedTime}${isOverdue ? ' (Overdue)' : ' (Due in < 4 hours)'}`
                  }
                >
                  {isImminentCheckout && <span className="pulse-dot" />}
                  <span>
                    {isOverdue ? 'Overdue: ' : (room.booking_source === 'OTA' ? 'Checkout: ' : 'C/O: ')}
                    {formattedTime}
                  </span>
                </div>
              )}
            </div>
          )}

          {room.status === 'needs_cleaning' && (
            <div className="room-card-body cleaning-body" style={{ margin: '2px 0 0 0' }}>
              <div className="room-cleaning-icon">🧹</div>
              <div className="room-cleaning-label">Housekeeping Needed</div>
              <div className="room-cleaning-prompt">Click to Mark Ready</div>
            </div>
          )}

          {room.status === 'maintenance' && (
            <div className="room-card-body maintenance-body" style={{ margin: '2px 0 0 0' }}>
              <div className="room-maint-icon">🛠️</div>
              <div className="room-maint-label">Under Maintenance</div>
              <div className="room-maint-sub">Right-click for options</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
