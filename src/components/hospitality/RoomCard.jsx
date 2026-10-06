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
  onLongPress,
  // Room Transfer Drag & Drop props:
  isTransferMode = false,
  transferSourceRoom = null,
  isTransferSource = false,
  isDroppable = false,
  isDimmed = false,
  isDropTarget = false,
  onTransferDragStart,
  onTransferDragEnd,
  onTransferDragOver,
  onTransferDragLeave,
  onTransferDrop,
  onTransferSelect
}) {
  const longPressTimerRef = useRef(null);
  const isDraggable = Boolean(isTransferMode && room.status === 'occupied');

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
      } ${room.has_overdue_fnb ? 'has-overdue-fnb' : ''} ${isMultiSelected ? 'multi-selected' : ''} ${isGroupHovered ? 'group-linked-hover' : ''} ${
        isTransferSource ? 'transfer-source' : ''
      } ${isDroppable ? 'transfer-droppable-target' : ''} ${
        isDropTarget ? 'transfer-droppable-hover' : ''
      } ${isDimmed ? 'transfer-dimmed' : ''}`}
      tabIndex={0}
      data-room-id={room.id}
      data-room-num={room.room_number}
      data-linked-rooms={groupRoomsList}
      draggable={isDraggable}
      onDragStart={(e) => {
        if (isDraggable && onTransferDragStart) {
          onTransferDragStart(e, room);
        }
      }}
      onDragEnd={(e) => {
        if (onTransferDragEnd) {
          onTransferDragEnd(e, room);
        }
      }}
      onDragOver={(e) => {
        if (isDroppable) {
          e.preventDefault();
          if (onTransferDragOver) onTransferDragOver(e, room);
        }
      }}
      onDragEnter={(e) => {
        if (isDroppable) {
          e.preventDefault();
          if (onTransferDragOver) onTransferDragOver(e, room);
        }
      }}
      onDragLeave={(e) => {
        if (isDroppable && onTransferDragLeave) {
          onTransferDragLeave(e, room);
        }
      }}
      onDrop={(e) => {
        if (isDroppable && onTransferDrop) {
          e.preventDefault();
          onTransferDrop(e, room);
        }
      }}
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
        if (isTransferMode && onTransferSelect) {
          onTransferSelect(room);
          return;
        }
        if (room.status === 'maintenance') {
          return; // Under Construction rooms are non-clickable on left click
        }
        if (onClick) onClick(room);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isTransferMode && onTransferSelect) {
            onTransferSelect(room);
            return;
          }
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
      title={
        isTransferMode
          ? room.status === 'occupied'
            ? `Drag or click Room #${room.room_number} to transfer guest`
            : isDroppable
            ? `Drop here to transfer to Room #${room.room_number} (${room.room_type})`
            : `Room #${room.room_number}`
          : `Room ${room.room_number}${
              room.status === 'maintenance'
                ? ' - Under Construction (Non-clickable)'
                : isCombined
                ? ` (Combined Booking with #${linkedStr})`
                : ''
            }`
      }
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

      {/* Transfer Mode Occupied Cue Badge */}
      {isTransferMode && room.status === 'occupied' && (
        <div
          style={{
            position: 'absolute',
            top: '3px',
            right: '4px',
            background: isTransferSource ? '#7c3aed' : '#ede9fe',
            color: isTransferSource ? '#ffffff' : '#6d28d9',
            fontSize: '0.62rem',
            fontWeight: 900,
            padding: '1px 6px',
            borderRadius: '6px',
            border: isTransferSource ? '1px solid #6d28d9' : '1px solid #c4b5fd',
            zIndex: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}
          title="Drag this room or click to select as transfer source"
        >
          {isTransferSource ? '✓ Source' : '🔄 Shift'}
        </div>
      )}

      {/* Top-Right Corner: Linked / Combined Group Booking indicator */}
      {isCombined && (!isTransferMode || room.status !== 'occupied') && (
        <div
          className="room-group-indicator"
          title={`Combined Group Booking linked with Room(s) #${linkedStr}`}
        >
          {room.linked_rooms.length === 1 ? `🔗 #${room.linked_rooms[0]}` : `🔗 #${room.linked_rooms[0]} +${room.linked_rooms.length - 1}`}
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
            gap: '3px',
            margin: 0,
            padding: 0
          }}
        >
          <div
            className="room-number-badge ready-big-number"
            style={{
              fontSize: '2.1rem',
              fontWeight: 950,
              letterSpacing: '-0.04em',
              lineHeight: 1,
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
              margin: 0,
              fontSize: '0.64rem',
              padding: '2px 9px',
              borderRadius: '6px',
              fontWeight: 800
            }}
          >
            Ready
          </div>
          {isDroppable && (
            <div
              style={{
                fontSize: '0.62rem',
                fontWeight: 900,
                color: isDropTarget ? '#047857' : '#059669',
                background: isDropTarget ? '#bbf7d0' : '#dcfce7',
                padding: '1px 6px',
                borderRadius: '6px',
                border: isDropTarget ? '1.5px solid #059669' : '1px solid #86efac',
                marginTop: '1px',
                whiteSpace: 'nowrap'
              }}
            >
              {isDropTarget ? '✨ Release' : '🎯 Drop'}
            </div>
          )}
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
            gap: '3px',
            margin: 0,
            padding: isCombined ? '6px 4px 2px 4px' : '3px 4px'
          }}
        >
          {/* Header Row: Room Number & Status Badge side by side for occupied cards to prevent clipping */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              lineHeight: 1
            }}
          >
            <span
              className="room-number-badge"
              style={{
                margin: 0,
                lineHeight: 1,
                fontSize: '1.24rem',
                fontWeight: 950,
                letterSpacing: '-0.02em'
              }}
            >
              {room.room_number}
            </span>
            <span
              className={`status-pill ${room.status}`}
              style={{
                fontSize: '0.62rem',
                padding: '2px 8px',
                margin: 0,
                lineHeight: 1,
                fontWeight: 800,
                borderRadius: '6px'
              }}
            >
              {statusText}
            </span>
          </div>

          {room.status === 'occupied' && (
            <div className="room-card-body occupied-body" style={{ margin: '1px 0 0 0', gap: '2px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {room.guest_name && (
                <div
                  className="room-guest-pill"
                  title={`Guest: ${room.guest_name}`}
                  style={{
                    fontSize: '0.70rem',
                    fontWeight: 750,
                    color: '#1e293b',
                    maxWidth: '96%',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.2,
                    margin: '0 0 1px 0'
                  }}
                >
                  {isCombined ? '👥 ' : '👤 '}
                  {room.guest_name}
                </div>
              )}

              {/* Badges Row for Overdue F&B, Mobile & Check-Out Time */}
              {(room.has_overdue_fnb || mobileNum || (formattedTime && isImminentCheckout)) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px',
                    width: '100%',
                    flexWrap: 'wrap',
                    marginTop: '1px'
                  }}
                >
                  {/* Overdue F&B (>3 Days) Blinking Pill */}
                  {room.has_overdue_fnb && (
                    <div
                      className="room-fnb-blinking-pill"
                      title={`Pending F&B orders older than 3 days: ₹${room.overdue_fnb_total}. Click room to settle.`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontSize: '0.60rem',
                        padding: '1px 5px',
                        margin: 0,
                        lineHeight: 1.15,
                        borderRadius: '5px'
                      }}
                    >
                      <span className="fnb-pulse-dot-red" style={{ width: '6px', height: '6px' }} />
                      <span>🚨 F&B: <strong>₹{room.overdue_fnb_total}</strong></span>
                    </div>
                  )}

                  {mobileNum && (
                    <div
                      className="room-mobile-pill"
                      title={`Mobile: ${mobileNum}`}
                      style={{
                        margin: 0,
                        padding: '1px 5px',
                        fontSize: '0.60rem',
                        fontWeight: 700,
                        lineHeight: 1.15,
                        borderRadius: '5px'
                      }}
                    >
                      📞 {mobileNum}
                    </div>
                  )}

                  {/* Check-Out Time: Visible ONLY within 4 hours (imminent / overdue) with red or amber pulse */}
                  {formattedTime && isImminentCheckout && (
                    <div
                      className="room-checkout-pill imminent"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '1px 5px',
                        fontSize: '0.60rem',
                        fontWeight: 800,
                        borderRadius: '5px',
                        background: '#ffffff',
                        border: isOverdue ? '1.5px solid #ef4444' : '1.5px solid #f59e0b',
                        color: isOverdue ? '#b91c1c' : '#b45309',
                        boxShadow: isOverdue ? '0 1px 3px rgba(220, 38, 38, 0.12)' : '0 1px 3px rgba(245, 158, 11, 0.12)',
                        animation: 'redishBlinkPulse 1.5s infinite ease-in-out',
                        margin: 0,
                        lineHeight: 1.15
                      }}
                      title={
                        isOverdue
                          ? `Checkout Overdue: ${formattedTime}`
                          : `Checkout scheduled for ${formattedTime} (Due in < 4 hours)`
                      }
                    >
                      <span className="pulse-dot" style={{ background: '#ef4444' }} />
                      <span>
                        {isOverdue ? 'Overdue: ' : 'C/O: '}
                        {formattedTime}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {room.status === 'needs_cleaning' && (
            <div className="room-card-body cleaning-body" style={{ margin: '2px 0 0 0', gap: '2px' }}>
              <div className="room-cleaning-prompt" style={{ fontSize: '0.66rem', padding: '2px 8px', marginTop: '2px', borderRadius: '6px' }}>
                🧹 Mark Clean
              </div>
            </div>
          )}

          {room.status === 'maintenance' && (
            <div className="room-card-body maintenance-body" style={{ margin: '2px 0 0 0', gap: '2px' }}>
              <div className="room-maint-sub" style={{ fontSize: '0.64rem' }}>🛠️ Maintenance</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
