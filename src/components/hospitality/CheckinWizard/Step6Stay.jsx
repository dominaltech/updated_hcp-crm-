import React, { useState, useEffect, useRef } from 'react';
import { formatCurrency } from '../../../utils/formatters';
import { compressImageFile, compressBase64Image } from '../../../utils/imageCompressor';
import { api } from '../../../services/api';
import UnifiedTimeInput from '../../common/UnifiedTimeInput';
import { useApp } from '../../../context/AppContext';

export default function Step6Stay({
  room,
  additionalRooms = [],
  setAdditionalRooms,
  availableRooms = [],
  draft,
  updateDraft,
  roomGstPct = 5
}) {
  const { showToast } = useApp();
  const [capacityPrompt, setCapacityPrompt] = useState({
    isOpen: false,
    pendingType: null, // 'male' | 'female'
    mode: null // 'options' (bed or room) | 'only_room'
  });
  const [isRoomPickerOpen, setIsRoomPickerOpen] = useState(false);
  const [extraBedModal, setExtraBedModal] = useState({
    isOpen: false,
    roomId: null,
    qty: 1,
    rate: 500,
    pendingType: null, // 'male' | 'female' | null
    mode: 'add' // 'add' | 'edit'
  });

  // Companion Document Scans State (Scan-only, no tedious text fields required)
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [isMemberScanning, setIsMemberScanning] = useState(false); // 'docFront' | 'docBack' | false
  const [memberScans, setMemberScans] = useState({
    docFront: null,
    docBack: null
  });
  const [memberLightboxImg, setMemberLightboxImg] = useState(null);
  const [memberLightboxTitle, setMemberLightboxTitle] = useState('');
  const memberFrontInputRef = useRef(null);
  const memberBackInputRef = useRef(null);

  const handleMemberDocUpload = async (field, file) => {
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      if (compressed) {
        setMemberScans(prev => ({ ...prev, [field]: compressed }));
      }
    } catch (err) {
      console.warn('Error compressing member document:', err);
    }
  };

  const handleMemberHardwareScan = async (field) => {
    setIsMemberScanning(field);
    try {
      const res = await api.scanHardwareDocument();
      if (res && res.success && res.image) {
        const compressed = await compressBase64Image(res.image);
        setMemberScans(prev => ({ ...prev, [field]: compressed || res.image }));
      } else {
        showToast(res?.error || 'No image returned from scanner.', 'red');
      }
    } catch (err) {
      showToast('Scanner error: ' + (err?.message || 'Could not communicate with hardware scanner. Ensure USB is connected.'), 'red');
    } finally {
      setIsMemberScanning(false);
    }
  };

  const handleSaveMember = () => {
    if (!memberScans.docFront && !memberScans.docBack) {
      showToast('Please scan or upload at least one document copy (Front or Back).', 'red');
      return;
    }
    const currentList = Array.isArray(draft.memberDocuments) ? draft.memberDocuments : [];
    const docIndex = currentList.length + 1;
    const newMember = {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: `Companion ID #${docIndex}`,
      docType: 'ID Scan',
      docFront: memberScans.docFront || null,
      docBack: memberScans.docBack || null
    };
    updateDraft({ memberDocuments: [...currentList, newMember] });
    setMemberScans({
      docFront: null,
      docBack: null
    });
    setIsMemberModalOpen(false);
  };

  const handleDeleteMember = (memId) => {
    const currentList = Array.isArray(draft.memberDocuments) ? draft.memberDocuments : [];
    updateDraft({ memberDocuments: currentList.filter(m => m.id !== memId) });
  };

  // All currently allocated rooms
  const allRooms = [room, ...(additionalRooms || [])];

  // Room Capacities: (Base + Extra Bed)
  // Format requested: (3+1) where 3 is base capacity, 1 is extra bed
  const totalBaseAdults = allRooms.reduce((sum, r) => {
    const base = Number(r.max_adults);
    return sum + (base && base >= 2 ? base : (r.room_type?.toLowerCase().includes('deluxe') ? 2 : (base || 2)));
  }, 0);
  const totalMaxExtraBeds = allRooms.reduce((sum, r) => sum + (Number(r.max_extra_beds) || 1), 0);
  const totalMaxCapacity = totalBaseAdults + totalMaxExtraBeds;
  const maxChildren = allRooms.reduce((sum, r) => sum + (Number(r.max_children) || 2), 0);

  // Per-room extra bed mapping:
  // Each room tracks its OWN extra bed count independently so adding to one room does not affect others!
  const currentExtraBeds = draft.roomExtraBeds !== undefined && Object.keys(draft.roomExtraBeds).length > 0
    ? allRooms.reduce((sum, r) => sum + (Number(draft.roomExtraBeds[r.id]) || 0), 0)
    : (Number(draft.extraBeds) || 0);

  const isOta = draft.bookingSource === 'OTA';
  const otaBookedAdults = Number.isFinite(Number(draft.otaBookedAdults))
    ? Math.max(1, Number(draft.otaBookedAdults))
    : Math.max(1, (Number(draft.adultsMale) || 0) + (Number(draft.adultsFemale) || 0));
  const otaBookedChildren = Number.isFinite(Number(draft.otaBookedChildren))
    ? Math.max(0, Number(draft.otaBookedChildren))
    : (Number(draft.children) || 0);
  const otaBookedExtraBeds = Number(draft.otaBookedExtraBeds) || 0;

  // Safe Male & Female counts (guarantees NO NaN ever)
  const rawMale = Number(draft.adultsMale);
  const rawFemale = Number(draft.adultsFemale);
  const femaleCount = Number.isFinite(rawFemale) ? Math.max(0, rawFemale) : 0;
  const maleCount = Number.isFinite(rawMale)
    ? Math.max(0, rawMale)
    : (Number.isFinite(rawFemale) && rawFemale >= otaBookedAdults ? 0 : (isOta ? Math.max(0, otaBookedAdults - femaleCount) : 1));

  const totalSteppedAdults = maleCount + femaleCount;
  const currentAdults = isOta
    ? (otaBookedAdults + (Number(draft.extraAdults) || 0))
    : Math.max(1, totalSteppedAdults);

  // In OTA mode, occupancy boxes strictly track hotel additions starting at 0:
  // Pre-booked counts are already locked and displayed in the voucher card above.
  const rawOtaExtraMale = Number(draft.otaExtraMale);
  const rawOtaExtraFemale = Number(draft.otaExtraFemale);
  const otaExtraFemale = isOta && Number.isFinite(rawOtaExtraFemale) ? Math.max(0, rawOtaExtraFemale) : 0;
  const otaExtraMale = isOta
    ? (Number.isFinite(rawOtaExtraMale)
        ? Math.max(0, rawOtaExtraMale)
        : Math.max(0, (Number(draft.extraAdults) || 0) - otaExtraFemale))
    : 0;
  const otaExtraAdults = isOta ? (otaExtraMale + otaExtraFemale) : 0;
  const otaExtraChildren = isOta ? Math.max(0, Number(draft.extraChildren) || 0) : 0;
  const availableExtraBedsForExtras = Math.max(0, totalMaxExtraBeds - otaBookedExtraBeds);
  const totalAvailableExtraCapacity = Math.max(0, totalMaxCapacity - otaBookedAdults);
  const maxExtraAdultsForRooms = Math.max(totalAvailableExtraCapacity, availableExtraBedsForExtras);
  const otaExtraRooms = (additionalRooms || []).filter(r => r._isHotelExtra || draft.otaExtraRoomIds?.includes(r.id));
  const otaPrebookedAdditionalRooms = (additionalRooms || []).filter(r => !r._isHotelExtra && !draft.otaExtraRoomIds?.includes(r.id));
  const otaPrebookedTotalRooms = 1 + otaPrebookedAdditionalRooms.length;

  const currentAllowedAdults = totalBaseAdults + currentExtraBeds;
  const childrenCount = Number(draft.children) || 0;

  // Capacity fill calculations for tracking (always safe numbers between 0 and 100)
  const adultFillPct = Math.min(100, Math.round((currentAdults / Math.max(1, currentAllowedAdults)) * 100));
  const childrenFillPct = Math.min(100, Math.round((childrenCount / Math.max(1, maxChildren)) * 100));

  // OTA specific fill percentages (0% when 0 extra members added, rises as room capacity is used)
  const otaAdultFillPct = maxExtraAdultsForRooms > 0
    ? Math.min(100, Math.round((otaExtraAdults / maxExtraAdultsForRooms) * 100))
    : (otaExtraAdults > 0 ? 100 : 0);
  const otaChildrenFillPct = maxChildren > 0
    ? Math.min(100, Math.round((otaExtraChildren / maxChildren) * 100))
    : 0;

  // Filter ready rooms from inventory not already in this booking
  const readyRoomsList = (availableRooms || []).filter(
    (r) => r.status === 'ready' && !allRooms.some((selected) => selected.id === r.id)
  );

  const basePrice = allRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0);
  const discountPct = Number(draft.discountPct) || 0;
  const extraBedRate = Number(room.extra_bed_price || 500);
  const breakfastRate = Number(room.breakfast_price || 250);

  // Nights calculation
  let nights = 1;
  if (draft.checkinTime && draft.approxCheckout) {
    const diffMs = new Date(draft.approxCheckout).getTime() - new Date(draft.checkinTime).getTime();
    nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const getRoomExtraBedRate = (targetRoom) => {
    if (!targetRoom) return Number(draft.extraBedRate || extraBedRate || 500);
    if (draft.roomExtraBedRates?.[targetRoom.id] !== undefined) {
      return Number(draft.roomExtraBedRates[targetRoom.id]);
    }
    return Number(targetRoom.extra_bed_price || draft.extraBedRate || extraBedRate || 500);
  };

  const extensionCharge = isOta ? 0 : (Number(draft.extensionCharge) || 0);
  const extraBedCharge = isOta
    ? (() => {
        let freeVoucherBedsRemaining = otaBookedExtraBeds;
        let totalCharge = 0;
        allRooms.forEach((r) => {
          const bedsInRoom = Number(draft.roomExtraBeds?.[r.id]) || 0;
          const roomRate = getRoomExtraBedRate(r);
          const freeFromThisRoom = Math.min(freeVoucherBedsRemaining, bedsInRoom);
          freeVoucherBedsRemaining -= freeFromThisRoom;
          const chargeableBeds = bedsInRoom - freeFromThisRoom;
          if (chargeableBeds > 0) {
            totalCharge += chargeableBeds * roomRate * nights;
          }
        });
        if (totalCharge === 0 && otaExtraAdults > 0) {
          totalCharge = draft.extraBedRate !== undefined
            ? (otaExtraAdults * Number(draft.extraBedRate) * nights)
            : (otaExtraAdults * extraBedRate * nights);
        }
        return totalCharge;
      })()
    : (allRooms.reduce((sum, r) => {
        const beds = Number(draft.roomExtraBeds?.[r.id]) || 0;
        const rate = getRoomExtraBedRate(r);
        return sum + (beds * rate);
      }, 0) * nights);

  const extraRoomsCharge = isOta
    ? (otaExtraRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0) * nights)
    : 0;

  const extraBreakfastCharge = isOta
    ? (draft.extraMealPlan === 'with_breakfast' ? (otaExtraAdults * breakfastRate * nights) : 0)
    : 0;

  const totalGuests = Math.max(1, currentAdults);
  const mealTotalCharge = isOta
    ? extraBreakfastCharge
    : (draft.mealPlan === 'with_breakfast' ? totalGuests * breakfastRate * nights : 0);
  const breakfastCharge = mealTotalCharge;

  const effectiveDiscountPct = isOta ? 0 : discountPct;

  const otaPackageAmount = Number(draft.otaManualAmount) || (basePrice * nights);
  const tariffSubtotal = isOta
    ? (otaPackageAmount + extraBedCharge + extraRoomsCharge)
    : ((basePrice * nights) + extraBedCharge);
  let totalBaseRate = tariffSubtotal + extensionCharge + mealTotalCharge;

  const discountAmount = isOta ? 0 : Math.round((totalBaseRate * effectiveDiscountPct) / 100);
  const netChargeBeforeTax = Math.round(totalBaseRate - discountAmount);
  const isOtaPrepaid = isOta && draft.isPrepaid === true;
  const gstAmount = isOta ? 0 : Math.round(netChargeBeforeTax * (Number(roomGstPct) / 100));
  const totalNetDue = netChargeBeforeTax + gstAmount;
  const totalHotelExtras = isOta ? (extraBedCharge + extraRoomsCharge + extraBreakfastCharge + extensionCharge) : 0;

  // Helper to reduce adults down to target capacity by decreasing the most recently added member first
  // "if deleting extra bed automatically in decreasing recent added member but if increase extra bed should not add automatic extra member"
  const reduceAdultsToCapacity = (targetCapacity, initialMale, initialFemale, initialHistory, fallbackType) => {
    let curMale = Math.max(0, Number(initialMale) || 0);
    let curFemale = Math.max(0, Number(initialFemale) || 0);
    const currentTotal = curMale + curFemale;
    if (currentTotal <= targetCapacity) {
      return {
        adultsMale: curMale,
        adultsFemale: curFemale,
        adultHistory: Array.isArray(initialHistory) ? initialHistory : []
      };
    }

    let excess = currentTotal - targetCapacity;
    let history = Array.isArray(initialHistory) && initialHistory.length > 0
      ? [...initialHistory]
      : [
          ...Array(curMale).fill('male'),
          ...Array(curFemale).fill('female')
        ];

    while (excess > 0 && (curMale + curFemale) > Math.max(1, targetCapacity)) {
      let candidateType = history.pop();
      if (!candidateType) {
        candidateType = fallbackType || (curFemale > 0 ? 'female' : 'male');
      }

      if (candidateType === 'female' && curFemale > 0) {
        curFemale -= 1;
        excess -= 1;
      } else if (candidateType === 'male' && (curMale > 1 || curFemale > 0)) {
        curMale -= 1;
        excess -= 1;
      } else if (curFemale > 0) {
        curFemale -= 1;
        excess -= 1;
      } else if (curMale > 1) {
        curMale -= 1;
        excess -= 1;
      } else {
        break;
      }
    }

    if (targetCapacity >= 1 && curMale === 0 && curFemale === 0) {
      curMale = 1;
    }

    return {
      adultsMale: curMale,
      adultsFemale: curFemale,
      adultHistory: history
    };
  };

  // Auto-sync and clamp capacity when rooms change or on initial load
  // "now o cut added room but still showing , same count of adults , should be reset , (max of current room)"
  // "if added one rooms extra bed should add only that rooms , not all selected room"
  useEffect(() => {
    const validRoomIds = new Set(allRooms.map((r) => String(r.id)));
    const currentMap = draft.roomExtraBeds || {};
    let hasChanges = false;
    const cleanMap = {};

    // 1. Keep only extra beds belonging to currently allocated rooms
    Object.entries(currentMap).forEach(([id, count]) => {
      if (validRoomIds.has(String(id))) {
        cleanMap[id] = Number(count) || 0;
      } else {
        hasChanges = true;
      }
    });

    // 2. If roomExtraBeds was not yet initialized for primary room:
    if (cleanMap[room.id] === undefined) {
      cleanMap[room.id] = 0;
      hasChanges = true;
    }

    // 3. If only 1 room is allocated (added room was cut) and adult count exceeds room's base capacity:
    // Reset extra beds to 0 unless user explicitly clicked + on room 105 card
    if (
      allRooms.length === 1 &&
      (additionalRooms || []).length === 0 &&
      !draft._explicitExtraBed &&
      cleanMap[room.id] > 0
    ) {
      cleanMap[room.id] = 0;
      hasChanges = true;
    }

    const totalExtraFromMap = allRooms.reduce((sum, r) => {
      return sum + (Number(cleanMap[r.id]) || 0);
    }, 0);

    if (Number(draft.extraBeds) !== totalExtraFromMap) {
      hasChanges = true;
    }

    const effectiveAllowed = totalBaseAdults + totalExtraFromMap;
    const updates = {};

    if (hasChanges || draft.roomExtraBeds === undefined) {
      updates.roomExtraBeds = cleanMap;
      updates.extraBeds = totalExtraFromMap;
    }

    // 4. Reset adult count to max of remaining room(s) by decreasing recently added member (Walk-in / BTC only):
    if (!isOta && currentAdults > effectiveAllowed) {
      const reduced = reduceAdultsToCapacity(
        effectiveAllowed,
        draft.adultsMale,
        draft.adultsFemale,
        draft.adultHistory,
        draft.lastAddedAdultType
      );
      updates.adultsMale = reduced.adultsMale;
      updates.adultsFemale = reduced.adultsFemale;
      updates.adultHistory = reduced.adultHistory;
      updates.lastAddedAdultType = reduced.adultHistory[reduced.adultHistory.length - 1] || 'male';
    }

    // 5. Clamp children count to current rooms' combined capacity (Walk-in / BTC only):
    // "after delete room , children count should be less , as was before adding room"
    const currentMaxChildren = allRooms.reduce((sum, r) => sum + (Number(r.max_children) || 2), 0);
    if (!isOta && (Number(draft.children) || 0) > currentMaxChildren) {
      updates.children = currentMaxChildren;
      hasChanges = true;
    }

    if (Object.keys(updates).length > 0) {
      updateDraft(updates);
    }
  }, [allRooms.length, room.id, (additionalRooms || []).length, draft.children]);

  // --- Capacity-Aware Steppers Logic ---
  const handleAdultIncrement = (type) => {
    const nextTotal = currentAdults + 1;
    const history = [...(draft.adultHistory || []), type];

    // 1. If within currently permitted bed capacity, increment directly
    if (nextTotal <= currentAllowedAdults) {
      const updates = {
        adultHistory: history,
        lastAddedAdultType: type
      };
      if (isOta) {
        const nextExtra = Math.max(0, nextTotal - otaBookedAdults);
        updates.extraAdults = nextExtra;
        updates.hasExtraPersons = nextExtra > 0;
      }
      if (type === 'male') {
        updates.adultsMale = maleCount + 1;
        updates.adultsFemale = femaleCount;
      } else {
        updates.adultsMale = maleCount;
        updates.adultsFemale = femaleCount + 1;
      }
      updateDraft(updates);
      return;
    }

    // 2. Exceeds current capacity! Check if extra beds are still available to add in ANY room
    if (currentExtraBeds < totalMaxExtraBeds) {
      // Must prompt user: Add Extra Bed OR Add Room!
      setCapacityPrompt({
        isOpen: true,
        pendingType: type,
        mode: 'options',
        targetTotal: nextTotal
      });
    } else {
      // Extra beds are already maxed out!
      if (isOta) {
        // For OTA: directly open available ready room picker modal (purple popup, available rooms in green)
        setIsRoomPickerOpen(true);
      } else {
        setCapacityPrompt({
          isOpen: true,
          pendingType: type,
          mode: 'only_room',
          targetTotal: nextTotal
        });
      }
    }
  };

  const handleAdultDecrement = (type) => {
    let history = [...(draft.adultHistory || [])];
    const lastIdx = history.lastIndexOf(type);
    if (lastIdx !== -1) {
      history.splice(lastIdx, 1);
    }
    if (type === 'male') {
      if (maleCount <= 0) return;
      const nextMale = maleCount - 1;
      const nextTotal = nextMale + femaleCount;
      const updates = {
        adultsMale: nextMale,
        adultsFemale: femaleCount,
        adultHistory: history,
        lastAddedAdultType: history[history.length - 1] || 'male'
      };
      if (isOta) {
        const nextExtra = Math.max(0, nextTotal - otaBookedAdults);
        updates.extraAdults = nextExtra;
        updates.hasExtraPersons = nextExtra > 0;
      }
      updateDraft(updates);
    } else {
      if (femaleCount <= 0) return;
      const nextFemale = femaleCount - 1;
      const nextTotal = maleCount + nextFemale;
      const updates = {
        adultsMale: maleCount,
        adultsFemale: nextFemale,
        adultHistory: history,
        lastAddedAdultType: history[history.length - 1] || 'female'
      };
      if (isOta) {
        const nextExtra = Math.max(0, nextTotal - otaBookedAdults);
        updates.extraAdults = nextExtra;
        updates.hasExtraPersons = nextExtra > 0;
      }
      updateDraft(updates);
    }
  };

  // --- Extra Bed Modal Open / Close / Confirm Handlers ---
  const handleOpenExtraBedModal = (targetRoomId, mode = 'add', pendingType = null) => {
    let target = targetRoomId ? allRooms.find((r) => r.id === targetRoomId) : null;
    if (!target) {
      target = allRooms.find((r) => {
        const cur = Number(draft.roomExtraBeds?.[r.id]) || 0;
        const maxB = Number(r.max_extra_beds) || 1;
        return cur < maxB;
      }) || allRooms[0];
    }
    const currentRate = target ? getRoomExtraBedRate(target) : Number(draft.extraBedRate || extraBedRate || 500);

    setExtraBedModal({
      isOpen: true,
      roomId: target ? target.id : allRooms[0]?.id,
      qty: 1,
      rate: currentRate,
      pendingType: pendingType || capacityPrompt.pendingType || null,
      mode: mode // 'add' or 'edit'
    });
  };

  const handleCloseExtraBedModal = () => {
    setExtraBedModal({
      isOpen: false,
      roomId: null,
      qty: 1,
      rate: 500,
      pendingType: null,
      mode: 'add'
    });
  };

  const handleConfirmExtraBedModal = () => {
    const targetRoom = allRooms.find((r) => r.id === extraBedModal.roomId) || allRooms[0];
    if (!targetRoom) return;

    const roomId = targetRoom.id;
    const maxB = Number(targetRoom.max_extra_beds) || 1;
    const currentForRoom = Number(draft.roomExtraBeds?.[roomId]) || 0;
    const customRate = Math.max(0, Number(extraBedModal.rate) || 0);

    const updatedRoomExtraBedRates = {
      ...(draft.roomExtraBedRates || {}),
      [roomId]: customRate
    };

    let nextForRoom = currentForRoom;
    if (extraBedModal.mode === 'add') {
      const addQty = Math.max(1, Number(extraBedModal.qty) || 1);
      nextForRoom = Math.min(maxB, currentForRoom + addQty);
    }

    const updatedRoomExtraBeds = {
      ...(draft.roomExtraBeds || {}),
      [roomId]: nextForRoom
    };

    const totalExtra = allRooms.reduce((sum, r) => {
      return sum + (Number(updatedRoomExtraBeds[r.id]) || 0);
    }, 0);

    const updates = {
      roomExtraBeds: updatedRoomExtraBeds,
      roomExtraBedRates: updatedRoomExtraBedRates,
      extraBedRate: customRate,
      extraBeds: totalExtra,
      _explicitExtraBed: true
    };

    // If there was a pending adult to add (from capacity modal or OTA stepper):
    const pending = extraBedModal.pendingType;
    if (pending) {
      const history = [...(draft.adultHistory || []), pending];
      updates.adultHistory = history;
      updates.lastAddedAdultType = pending;

      if (pending === 'female') {
        updates.adultsMale = maleCount;
        updates.adultsFemale = femaleCount + 1;
      } else {
        updates.adultsMale = maleCount + 1;
        updates.adultsFemale = femaleCount;
      }

      if (isOta) {
        const nextExtra = otaExtraAdults + 1;
        updates.extraAdults = nextExtra;
        updates.hasExtraPersons = true;
        if (pending === 'female') {
          updates.otaExtraFemale = otaExtraFemale + 1;
        } else {
          updates.otaExtraMale = otaExtraMale + 1;
        }
      }
    }

    updateDraft(updates);
    handleCloseExtraBedModal();
    setCapacityPrompt({ isOpen: false, pendingType: null, mode: null });

    const msg = extraBedModal.mode === 'edit'
      ? `Extra bed rate updated to ₹${customRate}/nt for Room #${targetRoom.room_number}`
      : `Extra bed added to Room #${targetRoom.room_number} at ₹${customRate}/nt`;
    showToast(msg, 'success');
  };

  // Direct Add Extra Bed (with room's declared extra_bed_price)
  const handleDirectAddExtraBed = (targetRoomId) => {
    const targetRoom = allRooms.find((r) => r.id === targetRoomId) || allRooms[0];
    if (!targetRoom) return;

    const roomId = targetRoom.id;
    const maxB = Number(targetRoom.max_extra_beds) || 1;
    const currentForRoom = Number(draft.roomExtraBeds?.[roomId]) || 0;
    if (currentForRoom >= maxB) {
      showToast(`Room #${targetRoom.room_number} has reached its maximum extra bed capacity (${maxB}).`, 'warning');
      return;
    }

    const declaredRate = getRoomExtraBedRate(targetRoom);
    const nextForRoom = currentForRoom + 1;

    const updatedRoomExtraBeds = {
      ...(draft.roomExtraBeds || {}),
      [roomId]: nextForRoom
    };

    const updatedRoomExtraBedRates = {
      ...(draft.roomExtraBedRates || {}),
      [roomId]: declaredRate
    };

    const totalExtra = allRooms.reduce((sum, r) => {
      return sum + (Number(updatedRoomExtraBeds[r.id]) || 0);
    }, 0);

    updateDraft({
      roomExtraBeds: updatedRoomExtraBeds,
      roomExtraBedRates: updatedRoomExtraBedRates,
      extraBedRate: declaredRate,
      extraBeds: totalExtra,
      _explicitExtraBed: true
    });

    showToast(`Extra bed added to Room #${targetRoom.room_number} (+₹${declaredRate}/nt)`, 'success');
  };

  // Option 1: Add Extra Bed & Increment Adult (Directly adds with declared charges without secondary popup)
  const handleAddExtraBedAndGuest = (targetRoomId) => {
    const targetRoom = allRooms.find((r) => r.id === targetRoomId) || allRooms[0];
    if (!targetRoom) return;

    const roomId = targetRoom.id;
    const maxB = Number(targetRoom.max_extra_beds) || 1;
    const currentForRoom = Number(draft.roomExtraBeds?.[roomId]) || 0;
    if (currentForRoom >= maxB) {
      showToast(`Room #${targetRoom.room_number} has reached its maximum extra bed capacity (${maxB}).`, 'warning');
      return;
    }

    const declaredRate = getRoomExtraBedRate(targetRoom);
    const nextForRoom = currentForRoom + 1;

    const updatedRoomExtraBeds = {
      ...(draft.roomExtraBeds || {}),
      [roomId]: nextForRoom
    };

    const updatedRoomExtraBedRates = {
      ...(draft.roomExtraBedRates || {}),
      [roomId]: declaredRate
    };

    const totalExtra = allRooms.reduce((sum, r) => {
      return sum + (Number(updatedRoomExtraBeds[r.id]) || 0);
    }, 0);

    const updates = {
      roomExtraBeds: updatedRoomExtraBeds,
      roomExtraBedRates: updatedRoomExtraBedRates,
      extraBedRate: declaredRate,
      extraBeds: totalExtra,
      _explicitExtraBed: true
    };

    // Increment pending adult (if triggered from capacity modal)
    const pending = capacityPrompt.pendingType;
    if (pending) {
      const history = [...(draft.adultHistory || []), pending];
      updates.adultHistory = history;
      updates.lastAddedAdultType = pending;

      if (pending === 'female') {
        updates.adultsMale = maleCount;
        updates.adultsFemale = femaleCount + 1;
      } else {
        updates.adultsMale = maleCount + 1;
        updates.adultsFemale = femaleCount;
      }

      if (isOta) {
        const nextExtra = otaExtraAdults + 1;
        updates.extraAdults = nextExtra;
        updates.hasExtraPersons = true;
        if (pending === 'female') {
          updates.otaExtraFemale = otaExtraFemale + 1;
        } else {
          updates.otaExtraMale = otaExtraMale + 1;
        }
      }
    }

    updateDraft(updates);
    setCapacityPrompt({ isOpen: false, pendingType: null, mode: null });
    showToast(`Extra bed added to Room #${targetRoom.room_number} (+₹${declaredRate}/nt)`, 'success');
  };

  // --- OTA Extra Person Increment / Decrement Handlers ---
  const handleOtaExtraAdultIncrement = (type = 'male') => {
    const nextExtraAdults = otaExtraAdults + 1;
    const nextTotalAdults = otaBookedAdults + nextExtraAdults;

    if (nextTotalAdults <= totalMaxCapacity || nextExtraAdults <= availableExtraBedsForExtras || nextExtraAdults <= maxExtraAdultsForRooms) {
      const neededExtraBeds = Math.max(otaBookedExtraBeds, Math.max(0, nextTotalAdults - totalBaseAdults));

      // If adding this adult requires an extra bed that is NOT yet added:
      if (neededExtraBeds > currentExtraBeds) {
        if (currentExtraBeds < totalMaxExtraBeds) {
          // Open capacityPrompt (same UI!)
          setCapacityPrompt({
            isOpen: true,
            pendingType: type,
            mode: 'options',
            targetTotal: nextTotalAdults
          });
        } else {
          setCapacityPrompt({
            isOpen: true,
            pendingType: type,
            mode: 'only_room',
            targetTotal: nextTotalAdults
          });
        }
        return;
      }

      const totalExtraNeeded = Math.min(totalMaxExtraBeds, neededExtraBeds);

      let remaining = totalExtraNeeded;
      const nextRoomExtraBeds = {};
      allRooms.forEach((r) => {
        const maxB = Number(r.max_extra_beds) || 1;
        const b = Math.min(maxB, remaining);
        nextRoomExtraBeds[r.id] = b;
        remaining -= b;
      });

      const nextMale = type === 'male' ? otaExtraMale + 1 : otaExtraMale;
      const nextFemale = type === 'female' ? otaExtraFemale + 1 : otaExtraFemale;

      updateDraft({
        otaExtraMale: nextMale,
        otaExtraFemale: nextFemale,
        extraAdults: nextExtraAdults,
        roomExtraBeds: nextRoomExtraBeds,
        extraBeds: totalExtraNeeded,
        hasExtraPersons: true,
        _explicitExtraBed: true
      });
    } else {
      // Room capacity is over! Open capacityPrompt with only_room option
      setCapacityPrompt({
        isOpen: true,
        pendingType: type,
        mode: 'only_room',
        targetTotal: nextTotalAdults
      });
    }
  };

  const handleOtaExtraAdultDecrement = (type = 'male') => {
    if (otaExtraAdults <= 0) return;
    if (type === 'male' && otaExtraMale <= 0) return;
    if (type === 'female' && otaExtraFemale <= 0) return;

    const nextMale = type === 'male' ? Math.max(0, otaExtraMale - 1) : otaExtraMale;
    const nextFemale = type === 'female' ? Math.max(0, otaExtraFemale - 1) : otaExtraFemale;
    const nextExtraAdults = nextMale + nextFemale;
    const nextTotalAdults = otaBookedAdults + nextExtraAdults;

    const neededExtraBeds = Math.max(otaBookedExtraBeds, Math.max(0, nextTotalAdults - totalBaseAdults));
    const totalExtraNeeded = Math.min(totalMaxExtraBeds, neededExtraBeds);

    let remaining = totalExtraNeeded;
    const nextRoomExtraBeds = {};
    allRooms.forEach((r) => {
      const maxB = Number(r.max_extra_beds) || 1;
      const b = Math.min(maxB, remaining);
      nextRoomExtraBeds[r.id] = b;
      remaining -= b;
    });

    updateDraft({
      otaExtraMale: nextMale,
      otaExtraFemale: nextFemale,
      extraAdults: nextExtraAdults,
      roomExtraBeds: nextRoomExtraBeds,
      extraBeds: totalExtraNeeded,
      hasExtraPersons: nextExtraAdults > 0,
      _explicitExtraBed: true
    });
  };

  const handleOtaExtraChildIncrement = () => {
    const nextExtraChildren = otaExtraChildren + 1;
    if (nextExtraChildren <= maxChildren) {
      updateDraft({
        extraChildren: nextExtraChildren
      });
    } else {
      setIsRoomPickerOpen(true);
      showToast('Maximum child capacity for this room reached. Please select an additional room.', 'info');
    }
  };

  const handleOtaExtraChildDecrement = () => {
    if (otaExtraChildren <= 0) return;
    const nextExtraChildren = otaExtraChildren - 1;
    updateDraft({
      extraChildren: nextExtraChildren
    });
  };

  // Option 2: Add Room
  const handleOpenRoomPicker = () => {
    setCapacityPrompt({ isOpen: false, pendingType: capacityPrompt.pendingType, mode: null });
    setIsRoomPickerOpen(true);
  };

  const handleSelectAdditionalRoom = (selectedRoom) => {
    if (allRooms.some((r) => r.id === selectedRoom.id)) return;
    const roomWithFlag = { ...selectedRoom, _isHotelExtra: true };
    const newAdditional = [...(additionalRooms || []), roomWithFlag];
    if (setAdditionalRooms) {
      setAdditionalRooms(newAdditional);
    }

    // Increment adult count to satisfy the requested guest addition
    const updates = {
      baseRate: basePrice + (selectedRoom.price || 2000),
      otaExtraRoomIds: [...(draft.otaExtraRoomIds || []), selectedRoom.id]
    };
    if ((additionalRooms || []).length === 0 && draft._childrenBeforeRoomAdd === undefined) {
      updates._childrenBeforeRoomAdd = Number(draft.children) || 0;
    }
    if (isOta) {
      updates.extraAdults = (Number(draft.extraAdults) || 0) + 1;
    } else if (capacityPrompt.pendingType === 'female') {
      updates.adultsFemale = (Number(draft.adultsFemale) || 0) + 1;
      updates.adultHistory = [...(draft.adultHistory || []), 'female'];
      updates.lastAddedAdultType = 'female';
    } else if (capacityPrompt.pendingType === 'male') {
      updates.adultsMale = (Number(draft.adultsMale) || 0) + 1;
      updates.adultHistory = [...(draft.adultHistory || []), 'male'];
      updates.lastAddedAdultType = 'male';
    }
    updateDraft(updates);

    setIsRoomPickerOpen(false);
    setCapacityPrompt({ isOpen: false, pendingType: null, mode: null });
  };

  // When an added room is removed/cut:
  // "now o cut added room but still showing , same count of adults , should be reset , (max of current room)"
  // "if added one rooms extra bed should add only that rooms , not all selected room"
  // "after delete room , children count should be less , as was before adding room"
  const handleRemoveAdditionalRoom = (roomIdToRemove) => {
    const updatedAdditional = (additionalRooms || []).filter((r) => r.id !== roomIdToRemove);
    if (setAdditionalRooms) {
      setAdditionalRooms(updatedAdditional);
    }

    // 1. Remove the cut room's extra beds completely!
    const updatedRoomExtraBeds = { ...(draft.roomExtraBeds || {}) };
    delete updatedRoomExtraBeds[roomIdToRemove];

    // If back to single primary room, reset primary room extra bed to 0 as well,
    // ensuring Room 105 resets strictly to its base capacity without lingering extra beds!
    if (updatedAdditional.length === 0) {
      updatedRoomExtraBeds[room.id] = 0;
    }

    // 2. Remaining rooms list
    const remainingRooms = [room, ...updatedAdditional];

    // 3. Recalculate remaining capacity from only remaining rooms
    const remBase = remainingRooms.reduce((sum, r) => sum + (Number(r.max_adults) || 2), 0);
    const remExtraBeds = remainingRooms.reduce((sum, r) => sum + (Number(updatedRoomExtraBeds[r.id]) || 0), 0);
    const remMaxAllowed = remBase + remExtraBeds;
    const remBaseRate = remainingRooms.reduce((sum, r) => sum + (Number(r.price) || 2000), 0);

    const updates = {
      roomExtraBeds: updatedRoomExtraBeds,
      extraBeds: remExtraBeds,
      baseRate: remBaseRate
    };

    // 4. Reset adults count to max allowed of remaining room(s) by decreasing recently added member first:
    // "now o cut added room but still showing , same count of adults , should be reset , (max of current room)"
    // "if deleting extra bed automatically in decreasing recent added member but if increase extra bed should not add automatic extra member"
    if (!isOta && currentAdults > remMaxAllowed) {
      const reduced = reduceAdultsToCapacity(
        remMaxAllowed,
        draft.adultsMale,
        draft.adultsFemale,
        draft.adultHistory,
        draft.lastAddedAdultType
      );
      updates.adultsMale = reduced.adultsMale;
      updates.adultsFemale = reduced.adultsFemale;
      updates.adultHistory = reduced.adultHistory;
      updates.lastAddedAdultType = reduced.adultHistory[reduced.adultHistory.length - 1] || 'male';
    } else if (isOta) {
      const remTotalMax = remainingRooms.reduce((sum, r) => sum + (Number(r.max_adults) || 2) + (Number(r.max_extra_beds) || 1), 0);
      const remMaxExtraAdults = Math.max(0, remTotalMax - otaBookedAdults);
      if (otaExtraAdults > remMaxExtraAdults) {
        const excess = otaExtraAdults - remMaxExtraAdults;
        let newFemale = otaExtraFemale;
        let newMale = otaExtraMale;
        if (newFemale >= excess) {
          newFemale -= excess;
        } else {
          const remExcess = excess - newFemale;
          newFemale = 0;
          newMale = Math.max(0, newMale - remExcess);
        }
        updates.otaExtraMale = newMale;
        updates.otaExtraFemale = newFemale;
        updates.extraAdults = remMaxExtraAdults;

        const remBaseAdults = remainingRooms.reduce((sum, r) => sum + (Number(r.max_adults) || 2), 0);
        const remMaxExtraBeds = remainingRooms.reduce((sum, r) => sum + (Number(r.max_extra_beds) || 1), 0);
        const neededExtraBeds = Math.min(
          remMaxExtraBeds,
          Math.max(otaBookedExtraBeds, Math.max(0, (otaBookedAdults + remMaxExtraAdults) - remBaseAdults))
        );
        updates.extraBeds = neededExtraBeds;
      }
    }

    // 5. Clamp children count to remaining room max children / restore pre-room count:
    // "after delete room , children count should be less , as was before adding room"
    const remMaxChildren = remainingRooms.reduce((sum, r) => sum + (Number(r.max_children) || 2), 0);
    if (!isOta && updatedAdditional.length === 0 && draft._childrenBeforeRoomAdd !== undefined) {
      updates.children = Math.min(Number(draft._childrenBeforeRoomAdd) || 0, remMaxChildren);
      updates._childrenBeforeRoomAdd = undefined;
    } else if (!isOta && (Number(draft.children) || 0) > remMaxChildren) {
      updates.children = remMaxChildren;
    }

    updateDraft(updates);
  };

  const handleChildrenChange = (delta) => {
    const maxCh = allRooms.reduce((sum, r) => sum + (r.max_children || 2), 0);
    const next = Math.max(0, Math.min(maxCh, (Number(draft.children) || 0) + delta));
    updateDraft({ children: next });
  };

  // Dedicated Per-Room Extra Bed Handler:
  // "if extra bed want to add sohuld oppup , then add extrabed with specific charges of extra bed"
  // "if deleting extra bed automatically in decreasing recent added member"
  const handleRoomExtraBedChange = (roomId, delta) => {
    if (delta > 0) {
      handleDirectAddExtraBed(roomId);
      return;
    }

    const targetRoom = allRooms.find((r) => r.id === roomId);
    if (!targetRoom) return;

    const currentForRoom = Number(draft.roomExtraBeds?.[roomId]) || 0;
    if (currentForRoom <= 0) return;
    const nextForRoom = currentForRoom - 1;

    const updatedRoomExtraBeds = {
      ...(draft.roomExtraBeds || {}),
      [roomId]: nextForRoom
    };

    const totalExtra = allRooms.reduce((sum, r) => {
      return sum + (Number(updatedRoomExtraBeds[r.id]) || 0);
    }, 0);

    const updates = {
      roomExtraBeds: updatedRoomExtraBeds,
      extraBeds: totalExtra,
      _explicitExtraBed: true
    };

    // "if deleting extra bed automatically in decreasing recent added member"
    const nextAllowedAdults = totalBaseAdults + totalExtra;
    if (delta < 0 && currentAdults > nextAllowedAdults) {
      if (isOta) {
        const excess = currentAdults - nextAllowedAdults;
        let newFemale = otaExtraFemale;
        let newMale = otaExtraMale;
        if (newFemale >= excess) {
          newFemale -= excess;
        } else {
          const remExcess = excess - newFemale;
          newFemale = 0;
          newMale = Math.max(0, newMale - remExcess);
        }
        updates.otaExtraMale = newMale;
        updates.otaExtraFemale = newFemale;
        updates.extraAdults = Math.max(0, otaExtraAdults - excess);
        updates.hasExtraPersons = updates.extraAdults > 0;
      } else {
        const reduced = reduceAdultsToCapacity(
          nextAllowedAdults,
          draft.adultsMale,
          draft.adultsFemale,
          draft.adultHistory,
          draft.lastAddedAdultType
        );
        updates.adultsMale = reduced.adultsMale;
        updates.adultsFemale = reduced.adultsFemale;
        updates.adultHistory = reduced.adultHistory;
        updates.lastAddedAdultType = reduced.adultHistory[reduced.adultHistory.length - 1] || 'male';
      }
    }

    updateDraft(updates);
  };


  // Parse Expected Checkout into Date and Time (starts empty by default until staff sets it)
  let checkoutDateStr = '';
  let checkoutTimeStr = draft.checkoutTime || '';

  const formatTime12 = (t24) => {
    if (!t24) return '';
    const parts = String(t24).split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] ? parts[1].slice(0, 2) : '00';
    if (isNaN(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${String(h12).padStart(2, '0')}:${m} ${ampm}`;
  };

  if (draft.approxCheckout) {
    try {
      const dt = new Date(draft.approxCheckout);
      if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        checkoutDateStr = `${y}-${m}-${d}`;

        if (!checkoutTimeStr && draft.approxCheckout.includes('T')) {
          const rawH = dt.getHours();
          const rawM = String(dt.getMinutes()).padStart(2, '0');
          checkoutTimeStr = `${String(rawH).padStart(2, '0')}:${rawM}`;
        }
      }
    } catch (e) {
      console.warn('Error parsing checkout date:', e);
    }
  }

  if (!checkoutDateStr && draft.checkoutDate) {
    checkoutDateStr = draft.checkoutDate;
  }

  const handleCheckoutChange = (newDateStr, newTimeStr) => {
    const isOtaEarly = isOta && draft.isEarlyCheckin === true;
    const dStr = newDateStr !== undefined ? newDateStr : checkoutDateStr;
    const tStr = isOtaEarly ? '10:00' : (newTimeStr !== undefined ? newTimeStr : checkoutTimeStr);

    if (!dStr && !tStr) {
      updateDraft({
        approxCheckout: '',
        checkoutDate: '',
        checkoutTime: '',
        extensionCharge: 0
      });
      return;
    }

    const isoString = dStr ? (tStr ? `${dStr}T${tStr}` : dStr) : '';

    // Calculate extension charge if extended checkout past 11:00 AM (Skip if OTA customer, as checkout is fixed & paid with ₹0 surcharge)
    let extCharge = 0;
    if (!isOta && tStr) {
      const [h24, min] = tStr.split(':').map(Number);
      const totalMinutes = (h24 || 0) * 60 + (min || 0);
      if (totalMinutes > 11 * 60) {
        if (totalMinutes <= 13 * 60) extCharge = 500;
        else if (totalMinutes <= 16 * 60) extCharge = 1000;
        else if (totalMinutes <= 19 * 60) extCharge = 1500;
        else extCharge = Number(room.price || 2000);
      }
    }

    updateDraft({
      approxCheckout: isoString,
      checkoutDate: dStr,
      checkoutTime: tStr,
      extensionCharge: extCharge
    });
  };

  return (
    <div className="checkin-step-content" id="checkin-step-6">
      {isOta ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
          {/* Main Top Card: Guests & Room Allocation, Gray Voucher, Room Badge, Green Capacity, Dates, Breakfast */}
          <div className="simple-form-card" style={{ width: '100%', boxSizing: 'border-box' }}>
            {/* Header with Total Max Capacity Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Guests &amp; Room Allocation
              </h4>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: '#0369a1',
                  background: '#e0f2fe',
                  padding: '4px 12px',
                  borderRadius: '8px',
                  border: '1px solid #bae6fd'
                }}
              >
                👥 Total Max: {totalMaxCapacity} Persons (Base: {totalBaseAdults} + Extra Bed: {totalMaxExtraBeds})
              </span>
            </div>

            {/* Gray Locked OTA Voucher Card (Read-only, in gray, unable to click, all lock emojis removed) */}
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid #cbd5e1',
                borderRadius: '16px',
                padding: '14px 18px',
                marginBottom: '14px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.15rem' }}>🌐</span>
                  <span style={{ fontWeight: 900, fontSize: '0.92rem', color: '#334155', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    Booked via {draft.otaPlatform || 'Agoda'}
                  </span>
                  <span style={{ background: '#e2e8f0', color: '#475569', fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                    Locked Voucher
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: draft.isPrepaid ? '#16a34a' : '#b45309',
                    background: draft.isPrepaid ? '#dcfce7' : '#fef3c7',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    border: draft.isPrepaid ? '1px solid #86efac' : '1px solid #fde68a'
                  }}
                >
                  {draft.isPrepaid ? '✓ Pre-Paid via OTA' : '🏨 Pay at Hotel'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                {/* Booked Adults */}
                <div style={{ background: '#ffffff', borderRadius: '10px', padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>👥</span>
                  <div>
                    <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#64748b' }}>Booked Adults</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>
                      {otaBookedAdults} {otaBookedAdults === 1 ? 'Adult' : 'Adults'}
                    </div>
                  </div>
                </div>

                {/* Booked Children */}
                <div style={{ background: '#ffffff', borderRadius: '10px', padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🧒</span>
                  <div>
                    <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#64748b' }}>Booked Children</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>
                      {otaBookedChildren} {otaBookedChildren === 1 ? 'Child' : 'Children'}
                    </div>
                  </div>
                </div>

                {/* Voucher Extra Bed */}
                <div style={{ background: '#ffffff', borderRadius: '10px', padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🛏️</span>
                  <div>
                    <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#64748b' }}>Voucher Extra Bed</div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 900, color: '#334155' }}>
                      {otaBookedExtraBeds > 0 ? `${otaBookedExtraBeds} Bed (Included)` : '0 Bed (None)'}
                    </div>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#16a34a' }}>Inclusive in OTA Bill (₹0)</div>
                  </div>
                </div>

                {/* OTA Bill Amount */}
                <div style={{ background: '#ffffff', borderRadius: '10px', padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🧾</span>
                  <div>
                    <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#64748b' }}>OTA Bill Amount</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
                      {draft.otaManualAmount ? formatCurrency(draft.otaManualAmount) : '₹5,000'}
                    </div>
                  </div>
                </div>

                {/* Voucher Breakfast */}
                <div
                  style={{ background: '#ffffff', borderRadius: '10px', padding: '8px 12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}
                  title="Selected at Step 1 • ₹0 extra"
                >
                  <span style={{ fontSize: '1.2rem' }}>{draft.mealPlan === 'with_breakfast' ? '🍳' : '🥣'}</span>
                  <div>
                    <div style={{ fontSize: '0.70rem', fontWeight: 700, color: '#64748b' }}>Voucher Breakfast</div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#334155' }}>
                      {draft.mealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Room Primary Booking Badge (no crown, no #, no Add Room button) */}
            <div
              style={{
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: '16px',
                padding: '12px 16px',
                marginBottom: '16px',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                alignItems: 'center'
              }}
            >
              {allRooms.map((r, idx) => {
                const isPrimary = idx === 0;
                const rBase = Number(r.max_adults) && Number(r.max_adults) >= 2 ? Number(r.max_adults) : (r.room_type?.toLowerCase().includes('deluxe') ? 2 : (Number(r.max_adults) || 2));
                const rExtra = Number(r.max_extra_beds) || 1;
                const rMax = rBase + rExtra;
                const rExtraCount = Number(draft.roomExtraBeds?.[r.id]) || 0;
                const isHotelExtraRoom = isOta && !isPrimary && (r._isHotelExtra || draft.otaExtraRoomIds?.includes(r.id));
                return (
                  <div
                    key={r.id}
                    style={{
                      background: isPrimary ? 'linear-gradient(135deg, #ffffff 0%, #faf5ff 100%)' : '#ffffff',
                      border: isPrimary ? '2px solid #a855f7' : '1.5px solid #cbd5e1',
                      borderRadius: '14px',
                      padding: '12px 18px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '14px',
                      boxShadow: isPrimary ? '0 4px 16px rgba(168, 85, 247, 0.12)' : '0 2px 8px rgba(0,0,0,0.03)'
                    }}
                  >
                    {/* Room Badge: Room #{r.room_number} */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.25rem' }}>🔑</span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '1.14rem', fontWeight: 900, color: isPrimary ? '#581c87' : '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                          Room {r.room_number}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: isPrimary ? '#7e22ce' : '#64748b', fontWeight: 700 }}>
                          {isPrimary ? 'Primary Booking' : 'Additional Room'}
                        </span>
                      </div>
                    </div>

                    {/* Room Type */}
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: isPrimary ? '#6b21a8' : '#334155',
                        background: isPrimary ? '#f3e8ff' : '#f1f5f9',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        border: isPrimary ? '1px solid #d8b4fe' : '1px solid #cbd5e1'
                      }}
                    >
                      {r.room_type || 'Deluxe AC'}
                    </span>

                    {/* Capacity Pill: Max: 3 (2+1) */}
                    <div
                      style={{
                        background: '#f0f9ff',
                        padding: '5px 12px',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: '#0369a1',
                        border: '1.5px solid #bae6fd',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                      title={`Base Capacity: ${rBase} Adults, Max Extra Bed: ${rExtra}`}
                    >
                      <span>👥</span>
                      <span>Max: <strong>{rMax}</strong> <span style={{ opacity: 0.85, fontWeight: 700 }}>({rBase}+{rExtra})</span></span>
                    </div>

                    {/* Tariff: OTA Included / Hotel Extra */}
                    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '3px' }}>
                      <span style={{ fontSize: '1.08rem', fontWeight: 900, color: isHotelExtraRoom ? '#d97706' : '#0284c7', letterSpacing: '-0.01em' }}>
                        {isHotelExtraRoom ? `+₹${Number(r.price || 2000).toLocaleString('en-IN')}` : 'OTA Included'}
                      </span>
                      {isHotelExtraRoom && <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>/nt</span>}
                      {isHotelExtraRoom && <span style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 800 }}>(Hotel Extra)</span>}
                    </div>

                    {/* Modern Extra Bed Stepper for OTA Room */}
                    {rExtra > 0 && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: rExtraCount > 0 ? '#f5f3ff' : '#f8fafc',
                          border: rExtraCount > 0 ? '1.5px solid #8b5cf6' : '1.5px solid #cbd5e1',
                          borderRadius: '12px',
                          padding: '5px 12px',
                          boxShadow: rExtraCount > 0 ? '0 2px 10px rgba(139, 92, 246, 0.18)' : 'none',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: rExtraCount > 0 ? '#6b21a8' : '#334155' }}>
                          🛏️ Extra Bed:
                        </span>

                        <button
                          type="button"
                          onClick={() => handleRoomExtraBedChange(r.id, -1)}
                          disabled={rExtraCount <= 0}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            cursor: rExtraCount > 0 ? 'pointer' : 'not-allowed',
                            fontWeight: 900,
                            fontSize: '1.1rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: rExtraCount > 0 ? '#0f172a' : '#cbd5e1',
                            opacity: rExtraCount > 0 ? 1 : 0.45,
                            transition: 'all 0.15s ease',
                            boxShadow: rExtraCount > 0 ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                          }}
                        >
                          −
                        </button>

                        <span
                          style={{
                            minWidth: '22px',
                            textAlign: 'center',
                            fontSize: '1rem',
                            fontWeight: 900,
                            color: rExtraCount > 0 ? '#6b21a8' : '#0f172a'
                          }}
                        >
                          {rExtraCount}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleDirectAddExtraBed(r.id)}
                          disabled={rExtraCount >= rExtra}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: 'none',
                            background: rExtraCount < rExtra ? 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' : '#e2e8f0',
                            cursor: rExtraCount < rExtra ? 'pointer' : 'not-allowed',
                            fontWeight: 900,
                            fontSize: '1.1rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: rExtraCount < rExtra ? '#ffffff' : '#94a3b8',
                            boxShadow: rExtraCount < rExtra ? '0 2px 8px rgba(139, 92, 246, 0.35)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          +
                        </button>

                        <span
                          onClick={() => rExtraCount > 0 && handleOpenExtraBedModal(r.id, 'edit')}
                          style={{
                            fontSize: '0.74rem',
                            color: '#7c3aed',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            cursor: rExtraCount > 0 ? 'pointer' : 'default',
                            textDecoration: rExtraCount > 0 ? 'underline dotted' : 'none'
                          }}
                          title={rExtraCount > 0 ? "Click to edit specific extra bed charge" : undefined}
                        >
                          (+₹{getRoomExtraBedRate(r)}/nt)
                        </span>
                      </div>
                    )}

                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAdditionalRoom(r.id)}
                        style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          borderRadius: '10px',
                          padding: '6px 12px',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Green Number of Adults & Children Tracking UI (OTA Hotel Extras starting at 0) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.75fr 1fr',
                gap: '14px',
                marginBottom: '14px'
              }}
            >
              {/* BOX 1: ADULTS (MALE & FEMALE) WITH DYNAMIC GREEN FILL RISING FROM BOTTOM */}
              <div
                className="guest-card"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  border: otaExtraAdults > maxExtraAdultsForRooms
                    ? '2px solid #ef4444'
                    : otaAdultFillPct >= 100
                    ? '2px solid #16a34a'
                    : otaAdultFillPct > 0
                    ? '1.5px solid #86efac'
                    : '1.5px solid #e2e8f0',
                  borderRadius: '18px',
                  padding: '16px 18px',
                  background: otaExtraAdults > maxExtraAdultsForRooms
                    ? '#fef2f2'
                    : otaAdultFillPct > 0
                    ? '#fafffd'
                    : '#ffffff',
                  transition: 'all 0.3s ease',
                  boxShadow: otaAdultFillPct >= 100
                    ? '0 4px 18px rgba(22, 163, 74, 0.16)'
                    : otaAdultFillPct > 0
                    ? '0 4px 14px rgba(34, 197, 94, 0.10)'
                    : '0 2px 6px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                {/* Dynamic Green Fill Rising from Bottom */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${otaAdultFillPct}%`,
                    background: otaExtraAdults > maxExtraAdultsForRooms
                      ? 'linear-gradient(180deg, rgba(239, 68, 68, 0.22) 0%, rgba(220, 38, 38, 0.12) 100%)'
                      : otaAdultFillPct >= 100
                      ? 'linear-gradient(180deg, rgba(74, 222, 128, 0.32) 0%, rgba(34, 197, 94, 0.18) 100%)'
                      : 'linear-gradient(180deg, rgba(134, 239, 172, 0.28) 0%, rgba(74, 222, 128, 0.14) 100%)',
                    borderTop: otaAdultFillPct > 0
                      ? (otaExtraAdults > maxExtraAdultsForRooms ? '2px solid #ef4444' : '2px solid #22c55e')
                      : 'none',
                    transition: 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />

                <div style={{ position: 'relative', zIndex: 1, marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1.2rem' }}>👥</span>
                      <span style={{ fontWeight: 900, fontSize: '0.96rem', color: '#0f172a' }}>Adults</span>
                      <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700 }}>(Male &amp; Female)</span>
                    </div>

                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        color: otaExtraAdults > maxExtraAdultsForRooms ? '#b91c1c' : otaAdultFillPct >= 100 ? '#065f46' : '#15803d',
                        background: otaExtraAdults > maxExtraAdultsForRooms ? '#fee2e2' : otaAdultFillPct >= 100 ? '#ecfdf5' : '#dcfce7',
                        padding: '3px 12px',
                        borderRadius: '14px',
                        border: otaExtraAdults > maxExtraAdultsForRooms ? '1px solid #fca5a5' : otaAdultFillPct >= 100 ? '1px solid #a7f3d0' : '1px solid #bbf7d0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                      }}
                    >
                      Manage: <strong>{otaExtraAdults} / {maxExtraAdultsForRooms} Extra Guests Available for Room</strong>
                    </span>
                  </div>
                </div>

                {/* Male & Female Steppers inside ONE Box */}
                <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '14px', margin: '6px 0' }}>
                  {/* Adults (Male) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div
                      className="guest-avatar-badge"
                      style={{
                        margin: '0 auto 6px',
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: '#eff6ff',
                        border: '1.5px solid #bfdbfe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(59, 130, 246, 0.12)'
                      }}
                    >
                      <img src="/man.png" className="guest-img-avatar" alt="Adult Male" style={{ width: '30px', height: '30px' }} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#1e293b', marginBottom: '8px' }}>
                      Adults (Male)
                    </div>
                    <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleOtaExtraAdultDecrement('male')}
                        disabled={otaExtraMale <= 0}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: otaExtraMale > 0 ? 'pointer' : 'not-allowed' }}
                      >
                        −
                      </button>
                      <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                        {otaExtraMale}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleOtaExtraAdultIncrement('male')}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: 'pointer' }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Vertical Divider */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '1px', height: '28px', background: '#cbd5e1' }} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 900, color: '#94a3b8', background: '#f1f5f9', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #cbd5e1' }}>
                      &amp;
                    </span>
                    <div style={{ width: '1px', height: '28px', background: '#cbd5e1' }} />
                  </div>

                  {/* Adults (Female) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div
                      className="guest-avatar-badge"
                      style={{
                        margin: '0 auto 6px',
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: '#fdf2f8',
                        border: '1.5px solid #fbcfe8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(236, 72, 153, 0.12)'
                      }}
                    >
                      <img src="/woman.png" className="guest-img-avatar" alt="Adult Female" style={{ width: '30px', height: '30px' }} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#1e293b', marginBottom: '8px' }}>
                      Adults (Female)
                    </div>
                    <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleOtaExtraAdultDecrement('female')}
                        disabled={otaExtraFemale <= 0}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: otaExtraFemale > 0 ? 'pointer' : 'not-allowed' }}
                      >
                        −
                      </button>
                      <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                        {otaExtraFemale}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleOtaExtraAdultIncrement('female')}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: 'pointer' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Capacity Tracker Status */}
                <div style={{ position: 'relative', zIndex: 1, marginTop: '8px', textAlign: 'center', fontSize: '0.76rem', fontWeight: 750, color: otaExtraAdults > maxExtraAdultsForRooms ? '#dc2626' : otaAdultFillPct >= 100 ? '#15803d' : '#166534' }}>
                  {otaExtraAdults === 0 && (
                    maxExtraAdultsForRooms > 0
                      ? `✓ ${maxExtraAdultsForRooms} extra guest spot${maxExtraAdultsForRooms > 1 ? 's' : ''} available in room (+₹${extraBedRate}/nt)`
                      : `⚠️ Room at full capacity (${totalMaxCapacity}/${totalMaxCapacity}) (Select room for extra guests)`
                  )}
                  {otaExtraAdults > 0 && (otaBookedAdults + otaExtraAdults) < totalMaxCapacity && (
                    `✓ ${otaBookedAdults + otaExtraAdults}/${totalMaxCapacity} Guests in Room (${Math.max(0, totalMaxCapacity - (otaBookedAdults + otaExtraAdults))} spot remaining)`
                  )}
                  {otaExtraAdults > 0 && (otaBookedAdults + otaExtraAdults) >= totalMaxCapacity && otaExtraAdults <= maxExtraAdultsForRooms && (
                    `✓ 100% Full Bed Capacity (${otaBookedAdults + otaExtraAdults}/${totalMaxCapacity} Guests Allocated in Room)`
                  )}
                  {otaExtraAdults > maxExtraAdultsForRooms && (
                    `⚠️ Exceeds room capacity by +${otaExtraAdults - maxExtraAdultsForRooms} guest${otaExtraAdults - maxExtraAdultsForRooms > 1 ? 's' : ''}`
                  )}
                </div>
              </div>

              {/* BOX 2: CHILDREN (<6) WITH DYNAMIC GREEN FILL */}
              <div
                className="guest-card"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  border: otaExtraChildren > maxChildren
                    ? '2px solid #ef4444'
                    : otaChildrenFillPct >= 100
                    ? '2px solid #16a34a'
                    : otaChildrenFillPct > 0
                    ? '1.5px solid #86efac'
                    : '1.5px solid #e2e8f0',
                  borderRadius: '18px',
                  padding: '16px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'center',
                  background: otaExtraChildren > maxChildren
                    ? '#fef2f2'
                    : otaChildrenFillPct > 0
                    ? '#fafffd'
                    : '#ffffff',
                  transition: 'all 0.3s ease',
                  boxShadow: otaChildrenFillPct >= 100
                    ? '0 4px 18px rgba(22, 163, 74, 0.16)'
                    : otaChildrenFillPct > 0
                    ? '0 4px 14px rgba(34, 197, 94, 0.10)'
                    : '0 2px 6px rgba(0,0,0,0.02)'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${otaChildrenFillPct}%`,
                    background: otaExtraChildren > maxChildren
                      ? 'linear-gradient(180deg, rgba(239, 68, 68, 0.22) 0%, rgba(220, 38, 38, 0.12) 100%)'
                      : otaChildrenFillPct >= 100
                      ? 'linear-gradient(180deg, rgba(74, 222, 128, 0.32) 0%, rgba(34, 197, 94, 0.18) 100%)'
                      : 'linear-gradient(180deg, rgba(134, 239, 172, 0.28) 0%, rgba(74, 222, 128, 0.14) 100%)',
                    borderTop: otaChildrenFillPct > 0
                      ? (otaExtraChildren > maxChildren ? '2px solid #ef4444' : '2px solid #22c55e')
                      : 'none',
                    transition: 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />

                <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 900, fontSize: '0.88rem', color: '#0f172a' }}>
                      Children (&lt;6)
                    </span>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: otaExtraChildren > 0 ? '#15803d' : '#64748b',
                        background: otaExtraChildren > 0 ? '#dcfce7' : '#f1f5f9',
                        padding: '2px 9px',
                        borderRadius: '12px',
                        border: otaExtraChildren > 0 ? '1px solid #bbf7d0' : '1px solid #e2e8f0'
                      }}
                    >
                      Manage: {otaExtraChildren} / {maxChildren}
                    </span>
                  </div>

                  <div
                    className="guest-avatar-badge"
                    style={{
                      margin: '0 auto 8px',
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: '#fefce8',
                      border: '1.5px solid #fef08a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(234, 179, 8, 0.12)'
                    }}
                  >
                    <img src="/children.png" className="guest-img-avatar" alt="Children" style={{ width: '30px', height: '30px' }} />
                  </div>

                  <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={handleOtaExtraChildDecrement}
                      disabled={otaExtraChildren <= 0}
                      style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: otaExtraChildren > 0 ? 'pointer' : 'not-allowed' }}
                    >
                      −
                    </button>
                    <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                      {otaExtraChildren}
                    </span>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={handleOtaExtraChildIncrement}
                      style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: 'pointer' }}
                    >
                      +
                    </button>
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '0.74rem', color: otaExtraChildren > 0 ? '#15803d' : '#64748b', fontWeight: 700 }}>
                    {otaExtraChildren === 0 ? 'Complimentary (<6 yrs)' : `✓ ${otaExtraChildren} extra child stay free (<6 yrs)`}
                  </div>
                </div>
              </div>
            </div>

            {/* Stay Dates & Times */}
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="form-grid-2" style={{ marginBottom: 0, gap: '12px' }}>
                {/* Checkout Box */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      📅 Check-Out Date &amp; Time (Fixed &amp; Paid) <span style={{ color: '#dc2626', fontWeight: 900 }}>* (Mandatory)</span>
                    </label>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#0369a1',
                        background: '#e0f2fe',
                        padding: '1px 8px',
                        borderRadius: '8px',
                        border: '1px solid #bae6fd'
                      }}
                    >
                      ✓ {formatTime12(checkoutTimeStr) || (draft.isEarlyCheckin ? '10:00 AM' : '11:00 AM')}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '6px' }}>
                    <input
                      type="date"
                      className="form-input"
                      value={checkoutDateStr}
                      min={draft.checkinTime ? draft.checkinTime.split('T')[0] : ''}
                      onChange={(e) => handleCheckoutChange(e.target.value, checkoutTimeStr)}
                      style={{
                        padding: '6px 8px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        borderRadius: '8px',
                        border: !checkoutDateStr ? '2px solid #ef4444' : '1.5px solid #cbd5e1',
                        background: !checkoutDateStr ? '#fff5f5' : '#ffffff'
                      }}
                    />

                    {isOta && draft.isEarlyCheckin === true ? (
                      <input
                        type="text"
                        readOnly
                        disabled
                        value="10:00 AM (Fixed)"
                        style={{
                          height: '38px',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          color: '#0369a1',
                          background: '#f0f9ff',
                          border: '1.5px solid #0284c7',
                          borderRadius: '8px',
                          padding: '0 8px',
                          width: '100%',
                          boxSizing: 'border-box',
                          cursor: 'not-allowed'
                        }}
                      />
                    ) : (
                      <UnifiedTimeInput
                        value={checkoutTimeStr || '11:00'}
                        onChange={(val) => handleCheckoutChange(checkoutDateStr, val)}
                        style={{
                          height: '38px',
                          fontSize: '0.82rem',
                          borderRadius: '8px',
                          border: '1.5px solid #cbd5e1',
                          background: '#ffffff'
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Check-In Box */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      🕒 Check-In Time
                    </label>
                    {draft.isEarlyCheckin && (
                      <span style={{ fontSize: '0.70rem', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fde68a', fontWeight: 800 }}>
                        🌅 Early Check-In (₹0 Extra)
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    readOnly
                    value={
                      draft.checkinTime
                        ? `${new Date(draft.checkinTime).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}, ${new Date(draft.checkinTime).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}`
                        : 'Now'
                    }
                    style={{ background: '#f8fafc', color: '#334155', fontWeight: 600, padding: '7px 10px', fontSize: '0.84rem', borderRadius: '8px' }}
                  />

                  <div
                    style={{
                      marginTop: '8px',
                      padding: '6px 10px',
                      background: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.72rem',
                      color: '#475569'
                    }}
                  >
                    <span>Duration:</span>
                    <strong style={{ color: '#0071e3' }}>
                      {nights} {nights === 1 ? 'Night' : 'Nights'} Stay
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Breakfast Option Selector */}
            <div style={{ marginTop: '14px', background: '#ffffff', borderRadius: '12px', border: '1.5px solid #e2e8f0', padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '1.1rem' }}>🍳</span>
                  <span style={{ fontWeight: 800, fontSize: '0.86rem', color: '#0f172a' }}>
                    Breakfast Option
                  </span>
                </div>
                <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                  {draft.extraMealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => updateDraft({ extraMealPlan: 'without_breakfast' })}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    transition: 'all 0.2s ease',
                    background: draft.extraMealPlan !== 'with_breakfast' ? '#eff6ff' : '#ffffff',
                    color: draft.extraMealPlan !== 'with_breakfast' ? '#0284c7' : '#64748b',
                    border: draft.extraMealPlan !== 'with_breakfast' ? '2px solid #0284c7' : '1.5px solid #cbd5e1'
                  }}
                >
                  <span>🥣</span>
                  <span>Without Breakfast (₹0)</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateDraft({ extraMealPlan: 'with_breakfast' })}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    transition: 'all 0.2s ease',
                    background: draft.extraMealPlan === 'with_breakfast' ? '#fffbeb' : '#ffffff',
                    color: draft.extraMealPlan === 'with_breakfast' ? '#d97706' : '#64748b',
                    border: draft.extraMealPlan === 'with_breakfast' ? '2px solid #d97706' : '1.5px solid #cbd5e1'
                  }}
                >
                  <span>🍳</span>
                  <span>With Breakfast (+₹{breakfastRate}/nt)</span>
                </button>
              </div>
            </div>
          </div>

          {/* TWO BIG DIVS SIDE-BY-SIDE: LEFT = OTA BOOKING, RIGHT = EXTRA BOOKINGS AT HOTEL */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* LEFT BIG DIV: OTA BOOKING */}
            <div
              style={{
                background: '#ffffff',
                border: '2px solid #7dd3fc',
                borderRadius: '16px',
                padding: '20px 22px',
                boxShadow: '0 4px 16px rgba(2, 132, 199, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1.5px solid #e0f2fe', paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🌐</span>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                        OTA Booking
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        Channel: {draft.otaPlatform || 'Agoda'}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: draft.isPrepaid ? '#16a34a' : '#b45309',
                      background: draft.isPrepaid ? '#dcfce7' : '#fef3c7',
                      padding: '4px 12px',
                      borderRadius: '12px',
                      border: draft.isPrepaid ? '1px solid #86efac' : '1px solid #fde68a'
                    }}
                  >
                    {draft.isPrepaid ? '✓ Pre-Paid via OTA' : '🏨 Pay at Hotel'}
                  </span>
                </div>

                <div style={{ background: '#f0f9ff', borderRadius: '12px', padding: '14px 16px', border: '1px solid #bae6fd', marginBottom: '14px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase', marginBottom: '2px' }}>
                    OTA Voucher Package Amount
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: '#0284c7', lineHeight: 1.1 }}>
                    {formatCurrency(otaPackageAmount)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', color: '#475569' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pre-Booked Stay:</span>
                    <strong>{otaPrebookedTotalRooms} Room(s), {nights} Night(s)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Voucher Guests:</span>
                    <strong>{otaBookedAdults} Adult(s), {otaBookedChildren} Child(ren)</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Voucher Extra Bed:</span>
                    <strong>{otaBookedExtraBeds > 0 ? `${otaBookedExtraBeds} Bed (Included • ₹0)` : 'None'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Voucher Breakfast:</span>
                    <strong>{draft.mealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast'}</strong>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed #bae6fd' }}>
                {draft.isPrepaid ? (
                  <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 850, fontSize: '0.82rem', color: '#15803d' }}>
                        ✓ Pre-Paid via {draft.otaPlatform || 'OTA'}
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#166534', marginTop: '1px' }}>
                        Collected online. Excluded from hotel front desk collection.
                      </div>
                    </div>
                    <span style={{ fontWeight: 900, fontSize: '1rem', color: '#15803d' }}>₹0 Due</span>
                  </div>
                ) : (
                  <div style={{ background: '#fef3c7', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 850, fontSize: '0.82rem', color: '#b45309' }}>
                        🏨 Pay at Hotel Desk
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#92400e', marginTop: '1px' }}>
                        Collect full voucher package at desk.
                      </div>
                    </div>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#b45309' }}>{formatCurrency(otaPackageAmount)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT BIG DIV: EXTRA BOOKINGS AT HOTEL */}
            <div
              style={{
                background: '#ffffff',
                border: '2px solid #cbd5e1',
                borderRadius: '16px',
                padding: '20px 22px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1.5px solid #e2e8f0', paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🏨</span>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                        Extra Bookings at Hotel
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        Front desk additions &amp; hotel incidentals (Add Extra Persons (Hotel Extras))
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      color: totalHotelExtras > 0 ? '#b45309' : '#16a34a',
                      background: totalHotelExtras > 0 ? '#fef3c7' : '#dcfce7',
                      padding: '4px 12px',
                      borderRadius: '12px',
                      border: totalHotelExtras > 0 ? '1px solid #fde68a' : '1px solid #86efac'
                    }}
                  >
                    {totalHotelExtras > 0 ? 'Hotel Extras Added' : 'No Hotel Extras'}
                  </span>
                </div>

                {/* Itemized Calculations */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.84rem' }}>
                  {/* Extra Adults / Beds */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <span style={{ fontWeight: 750, color: '#334155' }}>Hotel Extra Adults / Beds:</span>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {extraBedCharge > 0 || otaExtraAdults > 0
                          ? `${currentExtraBeds > otaBookedExtraBeds ? (currentExtraBeds - otaBookedExtraBeds) + ' Bed(s)' : otaExtraAdults + ' Extra Adult(s)'} × ${nights} nt`
                          : '0 Extra Adults (₹0)'}
                      </div>
                    </div>
                    <strong style={{ color: extraBedCharge > 0 ? '#b45309' : '#64748b' }}>
                      {extraBedCharge > 0 ? `+ ${formatCurrency(extraBedCharge)}` : '₹0'}
                    </strong>
                  </div>

                  {/* Additional Rooms */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <span style={{ fontWeight: 750, color: '#334155' }}>Additional Rooms:</span>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {otaExtraRooms.length > 0
                          ? `${otaExtraRooms.length} Room(s) × ${nights} nt`
                          : '0 Additional Rooms (₹0)'}
                      </div>
                    </div>
                    <strong style={{ color: otaExtraRooms.length > 0 ? '#0284c7' : '#64748b' }}>
                      {otaExtraRooms.length > 0 ? `+ ${formatCurrency(extraRoomsCharge)}` : '₹0'}
                    </strong>
                  </div>

                  {/* Extra Breakfast */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <span style={{ fontWeight: 750, color: '#334155' }}>Breakfast for Extra Guests:</span>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {extraBreakfastCharge > 0
                          ? `${otaExtraAdults} Adult(s) × ₹${breakfastRate}/nt × ${nights} nt`
                          : 'Without Breakfast (₹0)'}
                      </div>
                    </div>
                    <strong style={{ color: extraBreakfastCharge > 0 ? '#d97706' : '#64748b' }}>
                      {extraBreakfastCharge > 0 ? `+ ${formatCurrency(extraBreakfastCharge)}` : '₹0'}
                    </strong>
                  </div>

                  {/* Extended Stay Charge */}
                  {extensionCharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <span style={{ fontWeight: 750, color: '#334155' }}>Extended Checkout Surcharge:</span>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Late checkout fee</div>
                      </div>
                      <strong style={{ color: '#b45309' }}>+ {formatCurrency(extensionCharge)}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Final Amount Due at Front Desk */}
              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '2px solid #e2e8f0' }}>
                {draft.isPrepaid ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ fontSize: '0.76rem', color: '#1e40af', textTransform: 'uppercase', fontWeight: 900 }}>
                        Balance Due at Hotel Desk
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 600 }}>
                        {totalHotelExtras > 0
                          ? '(Hotel Extras & Incidentals only)'
                          : '(Fully Settled Online)'}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: '2rem',
                        fontWeight: 900,
                        color: totalHotelExtras > 0 ? '#d97706' : '#16a34a',
                        lineHeight: 1.1
                      }}
                    >
                      {formatCurrency(totalHotelExtras)}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ fontSize: '0.76rem', color: '#1e40af', textTransform: 'uppercase', fontWeight: 900 }}>
                        Total Net Due at Desk
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#64748b', fontWeight: 600 }}>
                        (OTA Package + Hotel Extras)
                      </div>
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#0071e3', lineHeight: 1.1 }}>
                      {formatCurrency(otaPackageAmount + totalHotelExtras)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="checkin-step6-grid">
          {/* Left Card: Room Allocation & Guest Capacity Steppers */}
          <div className="simple-form-card">
            {/* Header with Total Max Capacity Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Guests &amp; Room Allocation
              </h4>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: '#0369a1',
                  background: '#e0f2fe',
                  padding: '4px 12px',
                  borderRadius: '8px',
                  border: '1px solid #bae6fd'
                }}
              >
                👥 Total Max: {totalMaxCapacity} Persons (Base: {totalBaseAdults} + Extra Bed: {totalMaxExtraBeds})
              </span>
            </div>

            {/* ALLOCATED ROOMS CARDS */}
            <div
              style={{
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: '16px',
                padding: '12px 16px',
                marginBottom: '16px',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                alignItems: 'center'
              }}
            >
              {allRooms.map((r, idx) => {
                const isPrimary = idx === 0;
                const rBase = Number(r.max_adults) && Number(r.max_adults) >= 2 ? Number(r.max_adults) : (r.room_type?.toLowerCase().includes('deluxe') ? 2 : (Number(r.max_adults) || 2));
                const rExtra = Number(r.max_extra_beds) || 1;
                const rMax = rBase + rExtra;
                const rExtraCount = Number(draft.roomExtraBeds?.[r.id]) || 0;
                return (
                  <div
                    key={r.id}
                    style={{
                      background: isPrimary ? 'linear-gradient(135deg, #ffffff 0%, #faf5ff 100%)' : '#ffffff',
                      border: isPrimary ? '2px solid #a855f7' : '1.5px solid #cbd5e1',
                      borderRadius: '14px',
                      padding: '12px 18px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '14px',
                      boxShadow: isPrimary ? '0 4px 16px rgba(168, 85, 247, 0.12)' : '0 2px 8px rgba(0,0,0,0.03)'
                    }}
                  >
                    {/* Room Badge: Room #{r.room_number} */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.25rem' }}>
                        🔑
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '1.14rem', fontWeight: 900, color: isPrimary ? '#581c87' : '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                          Room {r.room_number}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: isPrimary ? '#7e22ce' : '#64748b', fontWeight: 700 }}>
                          {isPrimary ? 'Primary Booking' : 'Additional Room'}
                        </span>
                      </div>
                    </div>

                    {/* Room Type */}
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: isPrimary ? '#6b21a8' : '#334155',
                        background: isPrimary ? '#f3e8ff' : '#f1f5f9',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        border: isPrimary ? '1px solid #d8b4fe' : '1px solid #cbd5e1'
                      }}
                    >
                      {r.room_type || 'Deluxe Suite'}
                    </span>

                    {/* Capacity Pill */}
                    <div
                      style={{
                        background: '#f0f9ff',
                        padding: '5px 12px',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: '#0369a1',
                        border: '1.5px solid #bae6fd',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                      title={`Base Capacity: ${rBase} Adults, Max Extra Bed: ${rExtra}`}
                    >
                      <span>👥</span>
                      <span>Max: <strong>{rMax}</strong> <span style={{ opacity: 0.85, fontWeight: 700 }}>({rBase}+{rExtra})</span></span>
                    </div>

                    {/* Tariff */}
                    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '3px' }}>
                      <span style={{ fontSize: '1.08rem', fontWeight: 900, color: '#15803d', letterSpacing: '-0.01em' }}>
                        ₹{Number(r.price).toLocaleString('en-IN')}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>/nt</span>
                    </div>

                    {/* Modern Extra Bed Stepper */}
                    {rExtra > 0 && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: rExtraCount > 0 ? '#f5f3ff' : '#f8fafc',
                          border: rExtraCount > 0 ? '1.5px solid #8b5cf6' : '1.5px solid #cbd5e1',
                          borderRadius: '12px',
                          padding: '5px 12px',
                          boxShadow: rExtraCount > 0 ? '0 2px 10px rgba(139, 92, 246, 0.18)' : 'none',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: rExtraCount > 0 ? '#6b21a8' : '#334155' }}>
                          🛏️ Extra Bed:
                        </span>

                        <button
                          type="button"
                          onClick={() => handleRoomExtraBedChange(r.id, -1)}
                          disabled={rExtraCount <= 0}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            cursor: rExtraCount > 0 ? 'pointer' : 'not-allowed',
                            fontWeight: 900,
                            fontSize: '1.1rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: rExtraCount > 0 ? '#0f172a' : '#cbd5e1',
                            opacity: rExtraCount > 0 ? 1 : 0.45,
                            transition: 'all 0.15s ease',
                            boxShadow: rExtraCount > 0 ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                          }}
                        >
                          −
                        </button>

                        <span
                          style={{
                            minWidth: '22px',
                            textAlign: 'center',
                            fontSize: '1rem',
                            fontWeight: 900,
                            color: rExtraCount > 0 ? '#6b21a8' : '#0f172a'
                          }}
                        >
                          {rExtraCount}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleDirectAddExtraBed(r.id)}
                          disabled={rExtraCount >= rExtra}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            border: 'none',
                            background: rExtraCount < rExtra ? 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' : '#e2e8f0',
                            cursor: rExtraCount < rExtra ? 'pointer' : 'not-allowed',
                            fontWeight: 900,
                            fontSize: '1.1rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: rExtraCount < rExtra ? '#ffffff' : '#94a3b8',
                            boxShadow: rExtraCount < rExtra ? '0 2px 8px rgba(139, 92, 246, 0.35)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          +
                        </button>

                        <span
                          onClick={() => rExtraCount > 0 && handleOpenExtraBedModal(r.id, 'edit')}
                          style={{
                            fontSize: '0.74rem',
                            color: '#7c3aed',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            cursor: rExtraCount > 0 ? 'pointer' : 'default',
                            textDecoration: rExtraCount > 0 ? 'underline dotted' : 'none'
                          }}
                          title={rExtraCount > 0 ? "Click to edit specific extra bed charge" : undefined}
                        >
                          (+₹{getRoomExtraBedRate(r)}/nt)
                        </span>
                      </div>
                    )}

                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAdditionalRoom(r.id)}
                        title="Remove room"
                        style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          borderRadius: '10px',
                          padding: '6px 12px',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                );
              })}

              {readyRoomsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsRoomPickerOpen(true)}
                  style={{
                    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                    border: '2px dashed #0284c7',
                    color: '#0284c7',
                    borderRadius: '14px',
                    padding: '12px 20px',
                    fontSize: '0.86rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.08)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                >
                  <span
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: '#0284c7',
                      color: '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontWeight: 900
                    }}
                  >
                    +
                  </span>
                  <span style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>Add Room</span>
                  <span
                    style={{
                      background: '#ffffff',
                      color: '#0369a1',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.76rem',
                      fontWeight: 900,
                      border: '1px solid #bae6fd'
                    }}
                  >
                    {readyRoomsList.length} ready
                  </span>
                </button>
              )}
            </div>

            {/* Walk-in Capacity Steppers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.75fr 1fr',
                gap: '14px'
              }}
            >
              {/* BOX 1: ADULTS (MALE & FEMALE) */}
              <div
                className="guest-card"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  border: currentAdults > currentAllowedAdults
                    ? '2px solid #ef4444'
                    : adultFillPct >= 100
                    ? '2px solid #16a34a'
                    : adultFillPct > 0
                    ? '1.5px solid #86efac'
                    : '1.5px solid #e2e8f0',
                  borderRadius: '18px',
                  padding: '16px 18px',
                  background: currentAdults > currentAllowedAdults
                    ? '#fef2f2'
                    : adultFillPct > 0
                    ? '#fafffd'
                    : '#ffffff',
                  transition: 'all 0.3s ease',
                  boxShadow: adultFillPct >= 100
                    ? '0 4px 18px rgba(22, 163, 74, 0.16)'
                    : adultFillPct > 0
                    ? '0 4px 14px rgba(34, 197, 94, 0.10)'
                    : '0 2px 6px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${adultFillPct}%`,
                    background: currentAdults > currentAllowedAdults
                      ? 'linear-gradient(180deg, rgba(239, 68, 68, 0.22) 0%, rgba(220, 38, 38, 0.12) 100%)'
                      : adultFillPct >= 100
                      ? 'linear-gradient(180deg, rgba(74, 222, 128, 0.32) 0%, rgba(34, 197, 94, 0.18) 100%)'
                      : 'linear-gradient(180deg, rgba(134, 239, 172, 0.28) 0%, rgba(74, 222, 128, 0.14) 100%)',
                    borderTop: adultFillPct > 0
                      ? (currentAdults > currentAllowedAdults ? '2px solid #ef4444' : '2px solid #22c55e')
                      : 'none',
                    transition: 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />

                <div style={{ position: 'relative', zIndex: 1, marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1.2rem' }}>👥</span>
                      <span style={{ fontWeight: 900, fontSize: '0.96rem', color: '#0f172a' }}>Adults</span>
                      <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700 }}>(Male &amp; Female)</span>
                    </div>

                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        color: currentAdults > currentAllowedAdults ? '#b91c1c' : currentAdults === currentAllowedAdults ? '#065f46' : '#15803d',
                        background: currentAdults > currentAllowedAdults ? '#fee2e2' : currentAdults === currentAllowedAdults ? '#ecfdf5' : '#dcfce7',
                        padding: '3px 12px',
                        borderRadius: '14px',
                        border: currentAdults > currentAllowedAdults ? '1px solid #fca5a5' : currentAdults === currentAllowedAdults ? '1px solid #a7f3d0' : '1px solid #bbf7d0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                      }}
                    >
                      Manage: <strong>{currentAdults} / {currentAllowedAdults} Adults</strong>
                    </span>
                  </div>
                </div>

                <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '14px', margin: '6px 0' }}>
                  {/* Adults (Male) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div
                      className="guest-avatar-badge"
                      style={{
                        margin: '0 auto 6px',
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: '#eff6ff',
                        border: '1.5px solid #bfdbfe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(59, 130, 246, 0.12)'
                      }}
                    >
                      <img src="/man.png" className="guest-img-avatar" alt="Adult Male" style={{ width: '30px', height: '30px' }} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#1e293b', marginBottom: '8px' }}>
                      Adults (Male)
                    </div>
                    <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleAdultDecrement('male')}
                        disabled={maleCount <= 0}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: maleCount > 0 ? 'pointer' : 'not-allowed' }}
                      >
                        −
                      </button>
                      <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                        {maleCount}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleAdultIncrement('male')}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: 'pointer' }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '1px', height: '28px', background: '#cbd5e1' }} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 900, color: '#94a3b8', background: '#f1f5f9', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #cbd5e1' }}>
                      &amp;
                    </span>
                    <div style={{ width: '1px', height: '28px', background: '#cbd5e1' }} />
                  </div>

                  {/* Adults (Female) */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div
                      className="guest-avatar-badge"
                      style={{
                        margin: '0 auto 6px',
                        width: '42px',
                        height: '42px',
                        borderRadius: '50%',
                        background: '#fdf2f8',
                        border: '1.5px solid #fbcfe8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(236, 72, 153, 0.12)'
                      }}
                    >
                      <img src="/woman.png" className="guest-img-avatar" alt="Adult Female" style={{ width: '30px', height: '30px' }} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#1e293b', marginBottom: '8px' }}>
                      Adults (Female)
                    </div>
                    <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleAdultDecrement('female')}
                        disabled={femaleCount <= 0}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: femaleCount > 0 ? 'pointer' : 'not-allowed' }}
                      >
                        −
                      </button>
                      <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                        {femaleCount}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => handleAdultIncrement('female')}
                        style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: 'pointer' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ position: 'relative', zIndex: 1, marginTop: '8px', textAlign: 'center', fontSize: '0.76rem', fontWeight: 750, color: currentAdults > currentAllowedAdults ? '#dc2626' : currentAdults === currentAllowedAdults ? '#15803d' : '#166534' }}>
                  {currentAdults < currentAllowedAdults && `✓ ${currentAllowedAdults - currentAdults} adult bed spot${currentAllowedAdults - currentAdults > 1 ? 's' : ''} available`}
                  {currentAdults === currentAllowedAdults && `✓ 100% Full Bed Capacity (${currentAdults}/${currentAllowedAdults} Beds Allocated)`}
                  {currentAdults > currentAllowedAdults && `⚠️ Exceeds capacity by +${currentAdults - currentAllowedAdults} guest${currentAdults - currentAllowedAdults > 1 ? 's' : ''}`}
                </div>
              </div>

              {/* BOX 2: CHILDREN (<6) */}
              <div
                className="guest-card"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  border: childrenCount > maxChildren
                    ? '2px solid #ef4444'
                    : childrenFillPct >= 100
                    ? '2px solid #16a34a'
                    : childrenFillPct > 0
                    ? '1.5px solid #86efac'
                    : '1.5px solid #e2e8f0',
                  borderRadius: '18px',
                  padding: '16px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'center',
                  background: childrenCount > maxChildren
                    ? '#fef2f2'
                    : childrenFillPct > 0
                    ? '#fafffd'
                    : '#ffffff',
                  transition: 'all 0.3s ease',
                  boxShadow: childrenFillPct >= 100
                    ? '0 4px 18px rgba(22, 163, 74, 0.16)'
                    : childrenFillPct > 0
                    ? '0 4px 14px rgba(34, 197, 94, 0.10)'
                    : '0 2px 6px rgba(0,0,0,0.02)'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${childrenFillPct}%`,
                    background: childrenCount > maxChildren
                      ? 'linear-gradient(180deg, rgba(239, 68, 68, 0.22) 0%, rgba(220, 38, 38, 0.12) 100%)'
                      : childrenFillPct >= 100
                      ? 'linear-gradient(180deg, rgba(74, 222, 128, 0.32) 0%, rgba(34, 197, 94, 0.18) 100%)'
                      : 'linear-gradient(180deg, rgba(134, 239, 172, 0.28) 0%, rgba(74, 222, 128, 0.14) 100%)',
                    borderTop: childrenFillPct > 0
                      ? (childrenCount > maxChildren ? '2px solid #ef4444' : '2px solid #22c55e')
                      : 'none',
                    transition: 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />

                <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 900, fontSize: '0.88rem', color: '#0f172a' }}>
                      Children (&lt;6)
                    </span>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: childrenCount > 0 ? '#15803d' : '#64748b',
                        background: childrenCount > 0 ? '#dcfce7' : '#f1f5f9',
                        padding: '2px 9px',
                        borderRadius: '12px',
                        border: childrenCount > 0 ? '1px solid #bbf7d0' : '1px solid #e2e8f0'
                      }}
                    >
                      Manage: {childrenCount} / {maxChildren}
                    </span>
                  </div>

                  <div
                    className="guest-avatar-badge"
                    style={{
                      margin: '0 auto 8px',
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: '#fefce8',
                      border: '1.5px solid #fef08a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 6px rgba(234, 179, 8, 0.12)'
                    }}
                  >
                    <img src="/children.png" className="guest-img-avatar" alt="Children" style={{ width: '30px', height: '30px' }} />
                  </div>

                  <div className="stepper-box" style={{ background: '#ffffff', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => handleChildrenChange(-1)}
                      disabled={childrenCount <= 0}
                      style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: childrenCount > 0 ? 'pointer' : 'not-allowed' }}
                    >
                      −
                    </button>
                    <span className="stepper-val" style={{ fontWeight: 900, fontSize: '1.28rem', minWidth: '36px', textAlign: 'center', color: '#0f172a' }}>
                      {draft.children ?? 0}
                    </span>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => handleChildrenChange(1)}
                      disabled={childrenCount >= maxChildren}
                      style={{ width: '36px', height: '36px', fontSize: '1.2rem', cursor: childrenCount < maxChildren ? 'pointer' : 'not-allowed' }}
                    >
                      +
                    </button>
                  </div>

                  <div style={{ marginTop: '8px', fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                    {childrenCount === 0 ? 'Complimentary (<6 yrs)' : `✓ ${childrenCount} child stay free (<6 yrs)`}
                  </div>
                </div>
              </div>
            </div>

            {/* Stay Dates & Times */}
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="form-grid-2" style={{ marginBottom: 0, gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      📅 Expected Checkout <span style={{ color: '#dc2626', fontWeight: 900 }}>* (Mandatory)</span>
                    </label>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: checkoutTimeStr && checkoutTimeStr.split(':')[0] < 12 ? '#0369a1' : '#b45309',
                        background: checkoutTimeStr && checkoutTimeStr.split(':')[0] < 12 ? '#e0f2fe' : '#fef3c7',
                        padding: '1px 8px',
                        borderRadius: '8px',
                        border: checkoutTimeStr && checkoutTimeStr.split(':')[0] < 12 ? '1px solid #bae6fd' : '1px solid #fde68a'
                      }}
                    >
                      ✓ {formatTime12(checkoutTimeStr) || '11:00 AM'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '6px' }}>
                    <input
                      type="date"
                      className="form-input"
                      value={checkoutDateStr}
                      min={draft.checkinTime ? draft.checkinTime.split('T')[0] : ''}
                      onChange={(e) => handleCheckoutChange(e.target.value, checkoutTimeStr)}
                      style={{
                        padding: '6px 8px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        borderRadius: '8px',
                        border: !checkoutDateStr ? '2px solid #ef4444' : '1.5px solid #cbd5e1',
                        background: !checkoutDateStr ? '#fff5f5' : '#ffffff'
                      }}
                    />
                    <UnifiedTimeInput
                      value={checkoutTimeStr || '11:00'}
                      onChange={(val) => handleCheckoutChange(checkoutDateStr, val)}
                      style={{
                        height: '38px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: '1.5px solid #cbd5e1',
                        background: '#ffffff'
                      }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ margin: 0, fontWeight: 800, fontSize: '0.80rem', color: '#1e293b' }}>
                      🕒 Check-In Time
                    </label>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    readOnly
                    value={
                      draft.checkinTime
                        ? `${new Date(draft.checkinTime).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}, ${new Date(draft.checkinTime).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}`
                        : 'Now'
                    }
                    style={{ background: '#f8fafc', color: '#334155', fontWeight: 600, padding: '7px 10px', fontSize: '0.84rem', borderRadius: '8px' }}
                  />

                  <div
                    style={{
                      marginTop: '8px',
                      padding: '6px 10px',
                      background: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.72rem',
                      color: '#475569'
                    }}
                  >
                    <span>Duration:</span>
                    <strong style={{ color: '#0071e3' }}>
                      {nights} {nights === 1 ? 'Night' : 'Nights'} Stay
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Walk-in Right Card: Room Tariff & Discount */}
          <div className="simple-form-card">
            <h4 style={{ fontSize: '0.88rem', fontWeight: 800, marginBottom: '10px', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
              Room Tariff &amp; Discount
            </h4>

            <div className="form-grid-2" style={{ marginBottom: '12px' }}>
              <div className="form-group">
                <label>Base Tariff (₹) {allRooms.length > 1 ? `(${allRooms.length} Rooms)` : ''}</label>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  value={basePrice}
                  onChange={(e) => updateDraft({ baseRate: Number(e.target.value) })}
                  style={{ background: '#f8fafc', fontWeight: 700, color: 'var(--text-primary)' }}
                />
              </div>
              <div className="form-group">
                <label>Discount (%) [Max: {room.max_discount_pct || 15}%]</label>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  max={room.max_discount_pct || 15}
                  value={discountPct}
                  onChange={(e) => {
                    const val = Math.min(Number(e.target.value) || 0, room.max_discount_pct || 15);
                    updateDraft({ discountPct: val });
                  }}
                  style={{ fontWeight: 700 }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROOM MEMBERS & SCANNED DOCUMENTS SECTION */}
      <div
        className="room-members-doc-card"
        style={{
          marginTop: '16px',
          background: '#ffffff',
          border: '1.5px solid #e2e8f0',
          borderRadius: '16px',
          padding: '16px 20px',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>
              👥
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Companion ID Documents
                </h4>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                  {(draft.memberDocuments || []).length} Attached
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: '#64748b' }}>
                Scan and attach ID documents for room companions (preserved with booking &amp; PDF)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMemberModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: '#0071e3',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.84rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0, 113, 227, 0.28)',
              transition: 'all 0.15s ease'
            }}
          >
            <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>+</span> Scan Companion ID
          </button>
        </div>

        {/* Horizontal Container: Thumbnails with + Scan More on the Right Side */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            overflowX: 'auto',
            padding: '4px 2px 10px',
            scrollbarWidth: 'thin'
          }}
        >
          {(draft.memberDocuments || []).map((mem, mIdx) => (
            <div
              key={mem.id || mIdx}
              style={{
                minWidth: '220px',
                maxWidth: '240px',
                background: '#f8fafc',
                border: '1.5px solid #cbd5e1',
                borderRadius: '14px',
                padding: '12px',
                position: 'relative',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
              }}
            >
              {/* Delete button */}
              <button
                type="button"
                onClick={() => handleDeleteMember(mem.id)}
                title="Remove Scanned Document"
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  color: '#dc2626',
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900
                }}
              >
                &times;
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 800 }}>
                  {mIdx + 1}
                </div>
                <div style={{ overflow: 'hidden', paddingRight: '22px' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mem.name || `Companion ID #${mIdx + 1}`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 700 }}>
                    {mem.docFront && mem.docBack ? '✓ Front & Back Attached' : (mem.docFront ? '✓ Front Scan Attached' : '✓ Back Scan Attached')}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '0.74rem', color: '#334155', fontWeight: 750 }}>
                📄 <span style={{ color: '#0071e3' }}>ID Document Scan</span>
              </div>

              {/* Scanned Image Previews */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                {mem.docFront ? (
                  <div
                    onClick={() => { setMemberLightboxImg(mem.docFront); setMemberLightboxTitle(`${mem.name || `Companion #${mIdx + 1}`} - Front ID`); }}
                    style={{ flex: 1, height: '54px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'pointer', position: 'relative', background: '#fff' }}
                    title="Click to Zoom Front Scan"
                  >
                    <img src={mem.docFront} alt="Front ID" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <span style={{ position: 'absolute', bottom: 1, left: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.6rem', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>Front</span>
                  </div>
                ) : (
                  <div style={{ flex: 1, height: '54px', borderRadius: '6px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', color: '#94a3b8' }}>
                    No Front
                  </div>
                )}

                {mem.docBack ? (
                  <div
                    onClick={() => { setMemberLightboxImg(mem.docBack); setMemberLightboxTitle(`${mem.name || `Companion #${mIdx + 1}`} - Back ID`); }}
                    style={{ flex: 1, height: '54px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #cbd5e1', cursor: 'pointer', position: 'relative', background: '#fff' }}
                    title="Click to Zoom Back Scan"
                  >
                    <img src={mem.docBack} alt="Back ID" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <span style={{ position: 'absolute', bottom: 1, left: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '0.6rem', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>Back</span>
                  </div>
                ) : (
                  <div style={{ flex: 1, height: '54px', borderRadius: '6px', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', color: '#94a3b8' }}>
                    No Back
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* + Button at Right Side to Scan More */}
          <div
            onClick={() => setIsMemberModalOpen(true)}
            style={{
              minWidth: '140px',
              height: '130px',
              border: '2px dashed #0284c7',
              borderRadius: '14px',
              background: '#f0f9ff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '10px',
              flexShrink: 0,
              transition: 'all 0.15s ease'
            }}
            title="Click + to scan companion ID documents"
          >
            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#0284c7', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 900 }}>
              +
            </div>
            <span style={{ fontSize: '0.80rem', fontWeight: 800, color: '#0369a1', textAlign: 'center', lineHeight: 1.2 }}>
              + Scan More
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
              Companion ID
            </span>
          </div>
        </div>
      </div>

      {/* 4. MEAL PLAN SELECTION (Only for Walk-In / BTC, since OTA plan is pre-booked & locked at Step 1 and extra breakfast is in Extra Persons card) */}
      {!isOta && (
        <div
          className="meal-plan-section"
          style={{
            marginTop: '16px',
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '16px',
            padding: '16px 20px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div
              style={{
                fontSize: '0.92rem',
                fontWeight: 900,
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>🍽️</span> Meal Plan Inclusions *
            </div>
            <span
              style={{
                fontSize: '0.76rem',
                fontWeight: 800,
                background: '#eff6ff',
                color: '#1e40af',
                padding: '4px 12px',
                borderRadius: '20px',
                border: '1px solid #bfdbfe'
              }}
            >
              {draft.mealPlan === 'with_breakfast' ? 'With Breakfast' : 'Without Breakfast'}
            </span>
          </div>

          <div
            className="meal-plan-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}
          >
            {/* EP: Without Breakfast */}
            <div
              className={`meal-plan-card ${draft.mealPlan !== 'with_breakfast' ? 'active' : ''}`}
              onClick={() => updateDraft({ mealPlan: 'without_breakfast' })}
              style={{
                border: draft.mealPlan !== 'with_breakfast' ? '2px solid #0071e3' : '1.5px solid #e2e8f0',
                background: draft.mealPlan !== 'with_breakfast' ? '#eff6ff' : '#ffffff',
                borderRadius: '12px',
                padding: '14px 16px',
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '1.1rem' }}>
                  🥣
                </span>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '12px' }}>
                  Included
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>Without Breakfast</div>
              <div style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.3 }}>
                Standard room stay only. Meals charged separately.
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0071e3', marginTop: '10px' }}>₹0 / guest</div>
            </div>

            {/* With Breakfast */}
            <div
              className={`meal-plan-card ${draft.mealPlan === 'with_breakfast' ? 'active' : ''}`}
              onClick={() => updateDraft({ mealPlan: 'with_breakfast' })}
              style={{
                border: draft.mealPlan === 'with_breakfast' ? '2px solid #d97706' : '1.5px solid #e2e8f0',
                background: draft.mealPlan === 'with_breakfast' ? '#fffbeb' : '#ffffff',
                borderRadius: '12px',
                padding: '14px 16px',
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '1.1rem' }}>
                  🍳
                </span>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '2px 8px', borderRadius: '12px' }}>
                  Breakfast Included
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>With Breakfast</div>
              <div style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.3 }}>
                Delicious buffet breakfast included every morning.
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#d97706', marginTop: '10px' }}>
                + ₹{breakfastRate} / guest / nt
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CAPACITY LIMIT PROMPT (Centered, 3 Big Buttons) */}
      {capacityPrompt.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              margin: 'auto',
              background: '#ffffff',
              borderRadius: '24px',
              padding: '36px 30px',
              textAlign: 'center',
              boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.45)',
              border: '2.5px solid #f59e0b',
              boxSizing: 'border-box',
              position: 'relative'
            }}
          >
            {/* Warning Icon Badge */}
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: '#fef3c7',
                border: '2px solid #fde68a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '2.4rem'
              }}
            >
              ⚠️
            </div>

            <h3 style={{ margin: '0 0 10px', fontSize: '1.4rem', fontWeight: 900, color: '#92400e' }}>
              Room Capacity Limit Reached
            </h3>

            <p style={{ margin: '0 0 18px', fontSize: '0.94rem', color: '#475569', lineHeight: 1.5 }}>
              Selected room bed capacity of <strong>{currentAllowedAdults} persons</strong> has been reached.
              To accommodate <strong>{capacityPrompt.targetTotal} adults</strong>, please select an option:
            </p>

            {/* Mini Capacity Tracking Bar inside Prompt */}
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '14px',
                padding: '12px 14px',
                marginBottom: '22px',
                display: 'flex',
                justifyContent: 'space-around',
                alignItems: 'center',
                textAlign: 'center'
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Our Count</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#dc2626' }}>{capacityPrompt.targetTotal} Adults</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#cbd5e1' }} />
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Bed Limit</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0284c7' }}>{currentAllowedAdults} Persons</div>
              </div>
              <div style={{ width: '1px', height: '32px', background: '#cbd5e1' }} />
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Max Room Limit</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#6b21a8' }}>{totalMaxCapacity} Persons</div>
              </div>
            </div>

            {/* 3 BIG BUTTONS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Extra Bed Option(s): Dedicated per room when multiple rooms allocated */}
              {allRooms.length === 1 ? (
                <button
                  type="button"
                  disabled={currentExtraBeds >= totalMaxExtraBeds}
                  onClick={() => handleAddExtraBedAndGuest(room.id)}
                  style={{
                    background: currentExtraBeds < totalMaxExtraBeds
                      ? 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)'
                      : '#f1f5f9',
                    color: currentExtraBeds < totalMaxExtraBeds ? '#ffffff' : '#94a3b8',
                    border: currentExtraBeds < totalMaxExtraBeds ? 'none' : '1.5px solid #cbd5e1',
                    padding: '16px 20px',
                    borderRadius: '16px',
                    cursor: currentExtraBeds < totalMaxExtraBeds ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    boxShadow: currentExtraBeds < totalMaxExtraBeds ? '0 8px 24px rgba(147, 51, 234, 0.35)' : 'none',
                    transition: 'all 0.18s ease',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.08rem', fontWeight: 800 }}>
                    <span style={{ fontSize: '1.3rem' }}>🛏️</span>
                    <span>
                      {currentExtraBeds < totalMaxExtraBeds
                        ? `Add Extra Bed to Room #${room.room_number} (+₹${getRoomExtraBedRate(room)}/nt)`
                        : `Extra Bed Limit Reached (${totalMaxExtraBeds}/${totalMaxExtraBeds})`}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', fontWeight: 650, opacity: 0.9 }}>
                    {currentExtraBeds < totalMaxExtraBeds
                      ? `Expands capacity to ${currentAllowedAdults + 1} persons for this stay`
                      : `No more extra beds fit in Room #${room.room_number}`}
                  </div>
                </button>
              ) : (
                /* Multiple rooms allocated: show room-specific buttons so extra bed is added ONLY to that specific room */
                <>
                  {allRooms.map((r) => {
                    const curBeds = Number(draft.roomExtraBeds?.[r.id]) || 0;
                    const maxBeds = Number(r.max_extra_beds) || 1;
                    const canAdd = curBeds < maxBeds;
                    if (!canAdd) return null;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleAddExtraBedAndGuest(r.id)}
                        style={{
                          background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)',
                          color: '#ffffff',
                          border: 'none',
                          padding: '14px 18px',
                          borderRadius: '16px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          boxShadow: '0 8px 24px rgba(147, 51, 234, 0.35)',
                          transition: 'all 0.18s ease',
                          width: '100%',
                          boxSizing: 'border-box'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: 800 }}>
                          <span style={{ fontSize: '1.25rem' }}>🛏️</span>
                          <span>Add Extra Bed to Room #{r.room_number} (+₹${getRoomExtraBedRate(r)}/nt)</span>
                        </div>
                        <div style={{ fontSize: '0.74rem', fontWeight: 650, opacity: 0.9 }}>
                          {r.room_type} • Adds +1 extra bed strictly to Room #{r.room_number} (Currently {curBeds}/{maxBeds})
                        </div>
                      </button>
                    );
                  })}
                  {currentExtraBeds >= totalMaxExtraBeds && (
                    <div
                      style={{
                        background: '#f8fafc',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '14px',
                        padding: '12px 16px',
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '0.84rem',
                        fontWeight: 700
                      }}
                    >
                      🛏️ All extra bed slots are occupied across all {allRooms.length} rooms ({totalMaxExtraBeds}/{totalMaxExtraBeds} Beds active)
                    </div>
                  )}
                </>
              )}

              {/* Button 2: Big Blue Add Another Room */}
              <button
                type="button"
                onClick={handleOpenRoomPicker}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '16px 20px',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  boxShadow: '0 8px 24px rgba(2, 132, 199, 0.35)',
                  transition: 'all 0.18s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.08rem', fontWeight: 800 }}>
                  <span style={{ fontSize: '1.3rem' }}>🏨</span>
                  <span>Add Another Room ({readyRoomsList.length} Available)</span>
                </div>
                <div style={{ fontSize: '0.76rem', fontWeight: 650, opacity: 0.9 }}>
                  Choose another ready room from hotel inventory
                </div>
              </button>

              {/* Button 3: Big Neutral Cancel Button */}
              <button
                type="button"
                onClick={() => setCapacityPrompt({ isOpen: false, pendingType: null, mode: null })}
                style={{
                  background: '#ffffff',
                  color: '#475569',
                  border: '2px solid #cbd5e1',
                  padding: '14px 20px',
                  fontSize: '1rem',
                  fontWeight: 750,
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.18s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <span>✕</span>
                <span>Cancel / Keep Current Count ({currentAdults} Adults)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXTRA BED CONFIGURATION POPUP (Specific Charges & Room Selection) */}
      {extraBedModal.isOpen && (() => {
        const selectedRoom = allRooms.find((r) => r.id === extraBedModal.roomId) || allRooms[0];
        const curBeds = Number(draft.roomExtraBeds?.[selectedRoom?.id]) || 0;
        const maxBeds = Number(selectedRoom?.max_extra_beds) || 1;
        const currentRateNum = Math.max(0, Number(extraBedModal.rate) || 0);
        const currentQty = extraBedModal.mode === 'edit' ? Math.max(1, curBeds) : Math.max(1, Number(extraBedModal.qty) || 1);
        const totalBedCost = currentRateNum * currentQty * nights;

        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15, 23, 42, 0.75)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              zIndex: 1000001,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              boxSizing: 'border-box'
            }}
          >
            <div
              style={{
                maxWidth: '480px',
                width: '100%',
                background: '#ffffff',
                borderRadius: '24px',
                padding: '28px 24px',
                boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.45)',
                border: '2px solid #8b5cf6',
                boxSizing: 'border-box',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px'
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)',
                      border: '1.5px solid #d8b4fe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem'
                    }}
                  >
                    🛏️
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 900, color: '#0f172a' }}>
                      {extraBedModal.mode === 'edit' ? 'Edit Extra Bed Charges' : 'Add Extra Bed'}
                    </h3>
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                      {extraBedModal.mode === 'edit'
                        ? 'Update specific charges for allocated extra bed'
                        : 'Specify room assignment and custom daily extra bed rate'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseExtraBedModal}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    fontSize: '1.1rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Room Selection (if multiple rooms exist) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Target Room
                </label>
                {allRooms.length > 1 ? (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {allRooms.map((r) => {
                      const isSel = r.id === selectedRoom?.id;
                      const rBeds = Number(draft.roomExtraBeds?.[r.id]) || 0;
                      const rMaxBeds = Number(r.max_extra_beds) || 1;
                      const isFull = extraBedModal.mode !== 'edit' && rBeds >= rMaxBeds;

                      return (
                        <button
                          key={r.id}
                          type="button"
                          disabled={isFull}
                          onClick={() => setExtraBedModal((prev) => ({
                            ...prev,
                            roomId: r.id,
                            rate: getRoomExtraBedRate(r)
                          }))}
                          style={{
                            flex: 1,
                            minWidth: '130px',
                            padding: '10px 12px',
                            borderRadius: '12px',
                            border: isSel ? '2px solid #8b5cf6' : '1.5px solid #cbd5e1',
                            background: isSel ? '#f5f3ff' : isFull ? '#f8fafc' : '#ffffff',
                            color: isFull ? '#94a3b8' : isSel ? '#6b21a8' : '#1e293b',
                            cursor: isFull ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            boxShadow: isSel ? '0 2px 8px rgba(139, 92, 246, 0.2)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span style={{ fontWeight: 850, fontSize: '0.92rem' }}>
                            🔑 Room {r.room_number}
                          </span>
                          <span style={{ fontSize: '0.72rem', fontWeight: 650, opacity: 0.85 }}>
                            {r.room_type} • Extra Beds: {rBeds}/{rMaxBeds}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '10px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.2rem' }}>🔑</span>
                      <div>
                        <div style={{ fontWeight: 850, fontSize: '0.94rem', color: '#0f172a' }}>
                          Room {selectedRoom?.room_number}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                          {selectedRoom?.room_type || 'Deluxe Room'}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#6b21a8', background: '#f3e8ff', padding: '3px 10px', borderRadius: '8px', border: '1px solid #d8b4fe' }}>
                      Extra Beds: {curBeds} / {maxBeds}
                    </span>
                  </div>
                )}
              </div>

              {/* Specific Extra Bed Charge Input */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0, fontSize: '0.80rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Specific Extra Bed Charge (₹/night)
                  </label>
                  <span style={{ fontSize: '0.74rem', color: '#6b21a8', fontWeight: 700 }}>
                    Per Bed / Per Night
                  </span>
                </div>

                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    border: '2px solid #a855f7',
                    borderRadius: '14px',
                    background: '#ffffff',
                    overflow: 'hidden',
                    boxShadow: '0 2px 10px rgba(168, 85, 247, 0.12)'
                  }}
                >
                  <span
                    style={{
                      padding: '0 14px',
                      fontSize: '1.35rem',
                      fontWeight: 900,
                      color: '#6b21a8',
                      background: '#faf5ff',
                      borderRight: '1.5px solid #e9d5ff',
                      height: '48px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={extraBedModal.rate}
                    onChange={(e) => setExtraBedModal((prev) => ({ ...prev, rate: e.target.value }))}
                    placeholder="0"
                    style={{
                      width: '100%',
                      border: 'none',
                      outline: 'none',
                      padding: '10px 14px',
                      fontSize: '1.3rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      background: 'transparent'
                    }}
                  />
                </div>

                {/* Quick Preset Buttons */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                  {[
                    { label: '₹0 (Free)', val: 0 },
                    { label: '₹300', val: 300 },
                    { label: '₹500', val: 500 },
                    { label: '₹800', val: 800 },
                    { label: '₹1,000', val: 1000 }
                  ].map((p) => {
                    const isPActive = Number(extraBedModal.rate) === p.val;
                    return (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setExtraBedModal((prev) => ({ ...prev, rate: p.val }))}
                        style={{
                          flex: 1,
                          minWidth: '68px',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: isPActive ? '1.5px solid #8b5cf6' : '1px solid #cbd5e1',
                          background: isPActive ? '#f3e8ff' : '#f8fafc',
                          color: isPActive ? '#6b21a8' : '#475569',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          transition: 'all 0.12s ease'
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Calculation & Stay Summary */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
                  border: '1.5px solid #e9d5ff',
                  borderRadius: '14px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem', color: '#6b21a8' }}>
                  <span>Calculation:</span>
                  <strong>₹{currentRateNum} × {currentQty} Bed(s) × {nights} Night(s)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '4px', borderTop: '1px dashed #d8b4fe' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#4c1d95' }}>
                    Total Extra Bed Fee:
                  </span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#6b21a8' }}>
                    {formatCurrency(totalBedCost)}
                  </span>
                </div>
                {isOta && (
                  <div style={{ fontSize: '0.72rem', color: '#7e22ce', fontWeight: 650, marginTop: '2px' }}>
                    ℹ️ In OTA bookings, hotel extra bed is added to Hotel Balance Due.
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={handleCloseExtraBedModal}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: '14px',
                    border: '1.5px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    fontWeight: 800,
                    fontSize: '0.92rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmExtraBedModal}
                  style={{
                    flex: 2,
                    padding: '12px 16px',
                    borderRadius: '14px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: '0.96rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 16px rgba(147, 51, 234, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>✓</span>
                  <span>
                    {extraBedModal.mode === 'edit'
                      ? 'Update Charges'
                      : `Add Extra Bed (+${formatCurrency(totalBedCost)})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 2: INVENTORY ROOM SELECTOR (Dashboard Room Cards Style, Current Room in Purple) */}
      {isRoomPickerOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              width: '96vw',
              maxWidth: '1550px',
              height: '92vh',
              maxHeight: '94vh',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '20px 26px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.45)',
              border: '2px solid #cbd5e1',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxSizing: 'border-box'
            }}
          >
            {/* Header with Close Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🏨</span> Select Additional Room
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  Choose an available ready room to add to this booking
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRoomPickerOpen(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s ease'
                }}
              >
                ✕
              </button>
            </div>

            {/* Live Capacity Info Ribbon inside Room Picker */}
            <div
              style={{
                background: '#f8fafc',
                border: '1.5px solid #e2e8f0',
                borderRadius: '12px',
                padding: '10px 16px',
                marginBottom: '14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>
                <span>👥 Our Count: <strong style={{ color: '#0f172a', fontSize: '0.94rem' }}>{currentAdults} Adults</strong></span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span>🏨 Allocated: <strong style={{ color: '#0f172a' }}>{allRooms.length} Room{allRooms.length > 1 ? 's' : ''}</strong></span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span>📊 Combined Max: <strong style={{ color: '#0284c7' }}>{totalMaxCapacity} Persons ({totalBaseAdults}+{totalMaxExtraBeds} Bed)</strong></span>
              </div>
              <span
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  color: '#6b21a8',
                  background: '#faf5ff',
                  padding: '3px 10px',
                  borderRadius: '18px',
                  border: '1.5px solid #ddd6fe',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Current Room {room.room_number} (in Purple)
              </span>
            </div>

            {/* Room Cards Grid (Dashboard Room Cards Style, Current Room in Purple) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                gap: '14px',
                overflowY: 'auto',
                padding: '6px 4px',
                flex: 1
              }}
            >
              {/* 1. CURRENT BOOKING ROOM (PURPLE DASHBOARD CARD) */}
              <div
                className="room-card"
                style={{
                  background: 'linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%)',
                  border: '2.5px solid #8b5cf6',
                  borderRadius: '14px',
                  padding: '12px 10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'center',
                  position: 'relative',
                  boxShadow: '0 6px 20px rgba(139, 92, 246, 0.22)',
                  minHeight: '175px',
                  boxSizing: 'border-box'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: '#8b5cf6',
                    color: '#ffffff',
                    fontSize: '0.62rem',
                    fontWeight: 900,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    boxShadow: '0 2px 5px rgba(139, 92, 246, 0.35)'
                  }}
                >
                  Current Room
                </div>

                <div
                  className="room-number-badge"
                  style={{
                    fontSize: '2.1rem',
                    fontWeight: 900,
                    color: '#6b21a8',
                    lineHeight: 1,
                    letterSpacing: '-0.03em',
                    marginTop: '16px'
                  }}
                >
                  {room.room_number}
                </div>

                <div
                  className="status-pill"
                  style={{
                    background: '#ede9fe',
                    color: '#7c3aed',
                    border: '1px solid #c4b5fd',
                    padding: '2px 10px',
                    borderRadius: '14px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    marginTop: '4px'
                  }}
                >
                  PRIMARY ROOM
                </div>

                <div style={{ fontSize: '0.78rem', fontWeight: 750, color: '#7c3aed', marginTop: '3px' }}>
                  {room.room_type || 'Deluxe Room'}
                </div>

                {/* Capacity breakdown: (3+1) notation */}
                <div
                  className="room-capacity-pill"
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#6b21a8',
                    background: '#ede9fe',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid #ddd6fe',
                    marginTop: '4px',
                    display: 'inline-block'
                  }}
                >
                  👥 Max: {Number(room.max_adults || 2) + Number(room.max_extra_beds || 1)} ({room.max_adults || 2}+{room.max_extra_beds || 1} Bed)
                </div>

                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                  ₹{room.price} / nt
                </div>

                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    color: '#6b21a8',
                    background: '#ffffff',
                    padding: '4px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid #c4b5fd'
                  }}
                >
                  ✓ Active in Booking
                </div>
              </div>

              {/* 2. Any Already Added Additional Rooms (PURPLE CARD with Remove option) */}
              {additionalRooms.map((ar) => {
                const arBase = ar.max_adults || 2;
                const arExtra = ar.max_extra_beds || 1;
                const arMax = arBase + arExtra;
                return (
                  <div
                    key={ar.id}
                    className="room-card"
                    style={{
                      background: 'linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%)',
                      border: '2.5px solid #a855f7',
                      borderRadius: '14px',
                      padding: '12px 10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'center',
                      position: 'relative',
                      boxShadow: '0 6px 20px rgba(168, 85, 247, 0.18)',
                      minHeight: '175px',
                      boxSizing: 'border-box'
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: '#a855f7',
                        color: '#ffffff',
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        textTransform: 'uppercase'
                      }}
                    >
                      Added Room
                    </div>

                    <div
                      className="room-number-badge"
                      style={{
                        fontSize: '2.1rem',
                        fontWeight: 900,
                        color: '#7e22ce',
                        lineHeight: 1,
                        letterSpacing: '-0.03em',
                        marginTop: '16px'
                      }}
                    >
                      {ar.room_number}
                    </div>

                    <div
                      className="status-pill"
                      style={{
                        background: '#f3e8ff',
                        color: '#7e22ce',
                        border: '1px solid #e9d5ff',
                        padding: '2px 10px',
                        borderRadius: '14px',
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        marginTop: '4px'
                      }}
                    >
                      ADDED
                    </div>

                    <div style={{ fontSize: '0.78rem', fontWeight: 750, color: '#7c3aed', marginTop: '3px' }}>
                      {ar.room_type || 'Deluxe Room'}
                    </div>

                    <div
                      className="room-capacity-pill"
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#7e22ce',
                        background: '#f3e8ff',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #e9d5ff',
                        marginTop: '4px'
                      }}
                    >
                      👥 Max: {arMax} ({arBase}+{arExtra} Bed)
                    </div>

                    <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                      ₹{ar.price} / nt
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveAdditionalRoom(ar.id)}
                      style={{
                        marginTop: '8px',
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: '1px solid #fca5a5',
                        borderRadius: '8px',
                        padding: '4px 12px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✕</span> Remove Room
                    </button>
                  </div>
                );
              })}

              {/* 3. Available Ready Rooms (EXACT DASHBOARD GREEN READY CARDS) */}
              {readyRoomsList.map((r) => {
                const rBase = r.max_adults || 2;
                const rExtra = r.max_extra_beds || 1;
                const rMax = rBase + rExtra;
                return (
                  <div
                    key={r.id}
                    className="room-card status-ready"
                    onClick={() => handleSelectAdditionalRoom(r)}
                    style={{
                      background: '#f2fbf4',
                      border: '1.5px solid #86efac',
                      borderRadius: '14px',
                      padding: '12px 10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'center',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                      boxShadow: '0 4px 14px rgba(34, 197, 94, 0.1)',
                      minHeight: '175px',
                      boxSizing: 'border-box'
                    }}
                  >
                    <div
                      className="status-pill ready"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        fontSize: '0.62rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: '#dcfce7',
                        color: '#16a34a',
                        border: '1px solid #bbf7d0'
                      }}
                    >
                      Ready
                    </div>

                    <div
                      className="room-number-badge"
                      style={{
                        fontSize: '2.1rem',
                        fontWeight: 900,
                        color: '#1e293b',
                        lineHeight: 1,
                        letterSpacing: '-0.03em',
                        marginTop: '16px'
                      }}
                    >
                      {r.room_number}
                    </div>

                    <div
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 750,
                        color: '#64748b',
                        marginTop: '3px'
                      }}
                    >
                      {r.room_type || 'Deluxe Room'}
                    </div>

                    <div
                      className="room-capacity-pill"
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        color: '#0369a1',
                        background: '#e0f2fe',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #bae6fd',
                        marginTop: '4px'
                      }}
                    >
                      👥 Max: {rMax} ({rBase}+{rExtra} Bed)
                    </div>

                    <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                      ₹{r.price} / nt
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectAdditionalRoom(r);
                      }}
                      style={{
                        marginTop: '8px',
                        background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '6px 14px',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        boxShadow: '0 3px 10px rgba(5, 150, 105, 0.25)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>➕</span> Add Room
                    </button>
                  </div>
                );
              })}

              {readyRoomsList.length === 0 && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: '#64748b',
                    fontSize: '0.92rem',
                    fontWeight: 700
                  }}
                >
                  No other ready rooms currently available in inventory.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SCAN COMPANION ID DOCUMENT */}
      {isMemberModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              maxWidth: '580px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Modal Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1.5px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem' }}>📄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                    Scan Companion ID Document
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    Quick scan or upload ID copies. Safely preserved with booking and printed on registration PDF.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMemberScans({ docFront: null, docBack: null });
                  setIsMemberModalOpen(false);
                }}
                style={{ background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 800, color: '#64748b' }}
              >
                &times;
              </button>
            </div>

            {/* Modal Body: Direct Scan Only (No text typing needed) */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#166534', fontWeight: 700 }}>
                <span style={{ fontSize: '1rem' }}>⚡</span>
                <span>Quick Scan Mode: No typing needed. Just take a photo or upload front &amp; back copies.</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* Front Scan Box */}
                <div style={{ border: '2px dashed #cbd5e1', borderRadius: '14px', padding: '16px', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', minHeight: '190px', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0f172a' }}>
                    📄 Document Scan (Front) *
                  </span>

                  {memberScans.docFront ? (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <div
                        onClick={() => { setMemberLightboxImg(memberScans.docFront); setMemberLightboxTitle('Front ID Scan Preview'); }}
                        style={{ width: '100%', height: '120px', borderRadius: '10px', overflow: 'hidden', border: '1.5px solid #22c55e', position: 'relative', cursor: 'pointer', background: '#fff' }}
                        title="Click to zoom"
                      >
                        <img src={memberScans.docFront} alt="Front Scan" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(34, 197, 94, 0.9)', color: '#fff', fontSize: '0.66rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>✓ FRONT ATTACHED</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                        <button
                          type="button"
                          disabled={isMemberScanning === 'docFront'}
                          onClick={() => handleMemberHardwareScan('docFront')}
                          style={{ flex: 1, padding: '6px 8px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          {isMemberScanning === 'docFront' ? '⏳ Scanning...' : '⚡ Rescan (HP)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => memberFrontInputRef.current && memberFrontInputRef.current.click()}
                          style={{ padding: '6px 8px', background: '#e2e8f0', color: '#1e293b', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          📁 File
                        </button>
                        <button
                          type="button"
                          onClick={() => setMemberScans(prev => ({ ...prev, docFront: null }))}
                          style={{ padding: '6px 8px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center', width: '100%' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#e0f2fe', color: '#0369a1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                        📄
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.3 }}>
                        Aadhar / DL / Passport Front
                      </div>
                      <button
                        type="button"
                        disabled={isMemberScanning === 'docFront'}
                        onClick={() => handleMemberHardwareScan('docFront')}
                        style={{ width: '100%', padding: '8px 10px', background: '#0071e3', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.80rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0, 113, 227, 0.25)' }}
                      >
                        {isMemberScanning === 'docFront' ? '⚡ Scanning document...' : '⚡ Hardware Scan (HP)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => memberFrontInputRef.current && memberFrontInputRef.current.click()}
                        style={{ width: '100%', padding: '6px 10px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.74rem', fontWeight: 750, cursor: 'pointer' }}
                      >
                        📁 Choose File from PC
                      </button>
                    </div>
                  )}
                  <input
                    ref={memberFrontInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => handleMemberDocUpload('docFront', e.target.files?.[0])}
                  />
                </div>

                {/* Back Scan Box */}
                <div style={{ border: '2px dashed #cbd5e1', borderRadius: '14px', padding: '16px', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', minHeight: '190px', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0f172a' }}>
                    📄 Document Scan (Back)
                  </span>

                  {memberScans.docBack ? (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <div
                        onClick={() => { setMemberLightboxImg(memberScans.docBack); setMemberLightboxTitle('Back ID Scan Preview'); }}
                        style={{ width: '100%', height: '120px', borderRadius: '10px', overflow: 'hidden', border: '1.5px solid #22c55e', position: 'relative', cursor: 'pointer', background: '#fff' }}
                        title="Click to zoom"
                      >
                        <img src={memberScans.docBack} alt="Back Scan" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(34, 197, 94, 0.9)', color: '#fff', fontSize: '0.66rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>✓ BACK ATTACHED</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                        <button
                          type="button"
                          disabled={isMemberScanning === 'docBack'}
                          onClick={() => handleMemberHardwareScan('docBack')}
                          style={{ flex: 1, padding: '6px 8px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          {isMemberScanning === 'docBack' ? '⏳ Scanning...' : '⚡ Rescan (HP)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => memberBackInputRef.current && memberBackInputRef.current.click()}
                          style={{ padding: '6px 8px', background: '#e2e8f0', color: '#1e293b', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          📁 File
                        </button>
                        <button
                          type="button"
                          onClick={() => setMemberScans(prev => ({ ...prev, docBack: null }))}
                          style={{ padding: '6px 8px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center', width: '100%' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                        📄
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.3 }}>
                        Back side of ID (Optional)
                      </div>
                      <button
                        type="button"
                        disabled={isMemberScanning === 'docBack'}
                        onClick={() => handleMemberHardwareScan('docBack')}
                        style={{ width: '100%', padding: '8px 10px', background: '#0071e3', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.80rem', fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0, 113, 227, 0.25)' }}
                      >
                        {isMemberScanning === 'docBack' ? '⚡ Scanning document...' : '⚡ Hardware Scan (HP)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => memberBackInputRef.current && memberBackInputRef.current.click()}
                        style={{ width: '100%', padding: '6px 10px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.74rem', fontWeight: 750, cursor: 'pointer' }}
                      >
                        📁 Choose File from PC
                      </button>
                    </div>
                  )}
                  <input
                    ref={memberBackInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => handleMemberDocUpload('docBack', e.target.files?.[0])}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1.5px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', borderBottomLeftRadius: '20px', borderBottomRightRadius: '20px' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                {memberScans.docFront || memberScans.docBack ? (
                  <span style={{ color: '#16a34a', fontWeight: 800 }}>✓ Ready to save scan</span>
                ) : (
                  <span>Please scan at least Front or Back copy</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setMemberScans({ docFront: null, docBack: null });
                    setIsMemberModalOpen(false);
                  }}
                  style={{ padding: '8px 16px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '10px', fontSize: '0.84rem', fontWeight: 750, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveMember}
                  disabled={!memberScans.docFront && !memberScans.docBack}
                  style={{
                    padding: '8px 20px',
                    background: (memberScans.docFront || memberScans.docBack) ? '#16a34a' : '#94a3b8',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '0.84rem',
                    fontWeight: 850,
                    color: '#ffffff',
                    cursor: (memberScans.docFront || memberScans.docBack) ? 'pointer' : 'not-allowed',
                    boxShadow: (memberScans.docFront || memberScans.docBack) ? '0 2px 6px rgba(22, 163, 74, 0.3)' : 'none'
                  }}
                >
                  ✓ Save Scanned Document
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX FOR MEMBER DOC PREVIEW */}
      {memberLightboxImg && (
        <div
          onClick={() => setMemberLightboxImg(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 1000000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            cursor: 'zoom-out'
          }}
        >
          <div style={{ color: '#fff', fontSize: '1rem', fontWeight: 800, marginBottom: '10px' }}>
            {memberLightboxTitle}
          </div>
          <img
            src={memberLightboxImg}
            alt="Preview"
            style={{ maxWidth: '90%', maxHeight: '82vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
          />
          <div style={{ color: '#cbd5e1', fontSize: '0.8rem', marginTop: '8px' }}>
            Click anywhere to close
          </div>
        </div>
      )}
    </div>
  );
}
