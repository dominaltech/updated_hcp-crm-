import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useApp } from './AppContext';

const HospitalityContext = createContext(null);

export function HospitalityProvider({ children }) {
  const { showToast, showConfirm } = useApp();
  const [rooms, setRooms] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeSubTab, setActiveSubTab] = useState('rooms');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [dashboardSelectedRoomIds, setDashboardSelectedRoomIds] = useState(new Set());

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    room: null
  });

  const loadRooms = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const data = await api.getRooms();
      const list = Array.isArray(data) ? data : (data?.rooms || []);
      setRooms(list);
    } catch (err) {
      if (!isSilent) showToast('Failed to load rooms: ' + err.message, 'red');
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [showToast]);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      console.warn('Failed to load stats:', err);
    }
  }, []);

  // Polling every 3 seconds
  useEffect(() => {
    loadRooms();
    loadStats();

    const interval = setInterval(() => {
      loadRooms(true);
      loadStats();
    }, 15000);

    return () => clearInterval(interval);
  }, [loadRooms, loadStats]);

  const openContextMenu = (event, room) => {
    event.preventDefault();
    event.stopPropagation();

    if (!room || room.status === 'occupied') {
      return; // Right-click disabled for checked-in (occupied) rooms
    }

    const menuWidth = 260;
    const menuHeight = 240;
    let posX = event.clientX;
    let posY = event.clientY;

    if (posX + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 12;
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = window.innerHeight - menuHeight - 12;
    }

    setContextMenu({
      isOpen: true,
      x: posX,
      y: posY,
      room
    });
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false, room: null }));
  }, []);

  const updateRoomStatus = async (roomId, newStatus) => {
    closeContextMenu();
    const room = rooms.find((r) => r.id === roomId);
    const roomNum = room ? room.room_number : roomId;

    if (room && room.status === 'occupied' && newStatus !== 'occupied') {
      const confirmed = await showConfirm({
        title: 'Change Occupied Room Status?',
        message: `Room ${roomNum} is currently OCCUPIED by ${room.guest_name || 'Guest'}. Changing its status to ${newStatus.replace('_', ' ')} will release the active occupancy. Proceed?`,
        icon: '⚠️',
        confirmText: 'Yes, Change Status',
        isDestructive: true
      });
      if (!confirmed) return;
    }

    try {
      const res = await api.updateRoomStatus(roomId, newStatus);
      if (res && res.success) {
        showToast(`Room #${roomNum} status updated to "${newStatus.replace('_', ' ')}"`, 'green', 3000);
        loadRooms(true);
        loadStats();
      }
    } catch (err) {
      showToast('Error updating status: ' + err.message, 'red');
    }
  };

  const markRoomClean = async (roomId) => {
    const room = rooms.find((r) => r.id === roomId);
    const roomNum = room ? room.room_number : roomId;
    const confirmed = await showConfirm({
      title: 'Mark Room Ready?',
      message: `Has Room #${roomNum} been cleaned and inspected? It will become available for new guest check-ins.`,
      icon: '🧹',
      confirmText: 'Mark Clean & Ready',
      isDestructive: false
    });
    if (!confirmed) return;

    try {
      await api.markRoomClean(roomId);
      showToast(`Room #${roomNum} marked clean & ready!`, 'green', 3500);
      loadRooms(true);
      loadStats();
    } catch (err) {
      showToast('Error marking room clean: ' + err.message, 'red');
    }
  };

  const toggleRoomMaintenance = async (roomId, enabled) => {
    const room = rooms.find((r) => r.id === roomId);
    const roomNum = room ? room.room_number : roomId;
    const confirmed = await showConfirm({
      title: enabled ? 'Put Room in Maintenance?' : 'Take Room Out of Maintenance?',
      message: enabled
        ? `Room #${roomNum} will be blocked from check-ins for repairs/renovation.`
        : `Room #${roomNum} will be set to needs cleaning for inspection before check-in.`,
      icon: '🛠️',
      confirmText: enabled ? 'Put in Maintenance' : 'Release to Cleaning',
      isDestructive: enabled
    });
    if (!confirmed) return;

    try {
      await api.toggleRoomMaintenance(roomId, enabled);
      showToast(`Room #${roomNum} maintenance status updated.`, 'green', 3000);
      loadRooms(true);
      loadStats();
    } catch (err) {
      showToast('Error updating maintenance: ' + err.message, 'red');
    }
  };

  const value = {
    rooms,
    stats,
    activeFilter,
    setActiveFilter,
    activeSubTab,
    setActiveSubTab,
    isLoading,
    selectedRoom,
    setSelectedRoom,
    loadRooms,
    refreshRooms: loadRooms,
    loadStats,
    refreshStats: loadStats,
    contextMenu,
    openContextMenu,
    closeContextMenu,
    updateRoomStatus,
    markRoomClean,
    toggleRoomMaintenance,
    dashboardSelectedRoomIds,
    setDashboardSelectedRoomIds
  };

  return (
    <HospitalityContext.Provider value={value}>
      {children}
    </HospitalityContext.Provider>
  );
}

export function useHospitality() {
  const context = useContext(HospitalityContext);
  if (!context) {
    throw new Error('useHospitality must be used within a HospitalityProvider');
  }
  return context;
}
