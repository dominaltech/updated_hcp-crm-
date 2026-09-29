import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../services/api';
import UnifiedTimeInput from '../../common/UnifiedTimeInput';
import ThemedDatePicker from '../../common/ThemedDatePicker';
import { useApp } from '../../../context/AppContext';
import { blockNonNumericKeys, sanitizePhoneInput, blockNumericKeys, sanitizeNameInput } from '../../../utils/inputEnhancements';
import { timeToMinutes, getMinCheckoutDate, getLocalIsoDate } from '../../../utils/formatters';

const CHANNELS = [
  {
    id: 'Walk-in',
    title: 'Walk-in',
    icon: '🚶',
    accentClass: 'channel-walkin',
    themeColor: '#10b981',
    badgeText: '🚶 Walk-in',
    badgeStyle: { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
  },
  {
    id: 'OTA',
    title: 'OTA',
    icon: '🌐',
    accentClass: 'channel-ota',
    themeColor: '#0284c7',
    badgeText: '🌐 OTA',
    badgeStyle: { background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd' }
  },
  {
    id: 'BTC',
    title: 'BTC',
    icon: '🏢',
    accentClass: 'channel-btc',
    themeColor: '#4f46e5',
    badgeText: '🏢 BTC',
    badgeStyle: { background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe' }
  },
  {
    id: 'Website',
    title: 'Website',
    icon: '💻',
    accentClass: 'channel-website',
    themeColor: '#7c3aed',
    badgeText: '💻 Website',
    badgeStyle: { background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe' }
  }
];

export function to12Hour(time24) {
  if (!time24) return { hour: '11', minute: '00', ampm: 'AM', display: '11:00 AM' };
  const parts = String(time24).split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] ? parts[1].padStart(2, '0').slice(0, 2) : '00';
  if (isNaN(h)) h = 11;
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const h12Str = String(h12).padStart(2, '0');
  return { hour: h12Str, minute: m, ampm, display: `${h12Str}:${m} ${ampm}` };
}

export function to24Hour(h12, m, ampm) {
  let h = parseInt(h12, 10);
  if (isNaN(h)) h = 11;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
}

export default function Step1Source({
  room,
  additionalRooms = [],
  setAdditionalRooms,
  availableRooms = [],
  draft,
  updateDraft,
  onManualEntry,
  onProceedToScan
}) {
  const { showToast } = useApp();
  const [otaPlatforms, setOtaPlatforms] = useState([]);
  const [btcCompanies, setBtcCompanies] = useState([]);
  const [btcSearchQuery, setBtcSearchQuery] = useState('');
  const [btcSuggestions, setBtcSuggestions] = useState([]);
  const [btcHighlightIndex, setBtcHighlightIndex] = useState(-1);
  const btcDropdownRef = useRef(null);
  const btcInputRef = useRef(null);
  const btcContainerRef = useRef(null);
  const [selectedBtcCompany, setSelectedBtcCompany] = useState(null);
  const [isAddBtcOpen, setIsAddBtcOpen] = useState(false);
  const [isOtaRoomPickerOpen, setIsOtaRoomPickerOpen] = useState(false);
  const [shakeAttention, setShakeAttention] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState('');

  const [newBtcForm, setNewBtcForm] = useState({
    company_name: '',
    gst_number: '',
    pan_number: '',
    address: '',
    contact_person: '',
    contact_phone: '',
    contact_email: '',
    credit_limit: 100000
  });

  const isChannelSelected = Boolean(draft.bookingSource);
  const isBtcReady = draft.bookingSource === 'BTC' ? Boolean(draft.btcCompanyId) : true;
  const isOta = draft.bookingSource === 'OTA';
  const schedMins = timeToMinutes(draft.originalCheckinTime);
  const earlyMins = timeToMinutes(draft.earlyCheckinTime);
  const isScheduledBeforeEarly = Boolean(
    isOta &&
    draft.isEarlyCheckin === true &&
    schedMins !== null &&
    earlyMins !== null &&
    schedMins <= earlyMins
  );

  const todayStr = getLocalIsoDate(new Date());

  const currentCheckoutDate = draft.checkoutDate || (draft.approxCheckout ? draft.approxCheckout.split('T')[0] : '');
  const currentCheckoutTime = draft.checkoutTime || (draft.approxCheckout && draft.approxCheckout.includes('T') ? draft.approxCheckout.split('T')[1]?.slice(0, 5) : '');

  const checkinDateStr = draft.checkinTime ? draft.checkinTime.split('T')[0] : todayStr;
  const minCheckoutDate = getMinCheckoutDate(checkinDateStr);
  let nights = 1;
  if (checkinDateStr && currentCheckoutDate) {
    const dIn = new Date(checkinDateStr);
    const dOut = new Date(currentCheckoutDate);
    const diffDays = Math.round((dOut - dIn) / (1000 * 60 * 60 * 24));
    nights = Math.max(1, diffDays);
  }

  const isOtaStep1PlatformDone = Boolean(draft.otaPlatform);
  const isOtaStep2PaymentDone = isOtaStep1PlatformDone && (draft.isPrepaid !== null && draft.isPrepaid !== undefined);
  const isOtaStep3BillDone = isOtaStep2PaymentDone && Boolean(draft.otaManualAmount && Number(draft.otaManualAmount) > 0);
  const isOtaStep4TimingDone = isOtaStep3BillDone && (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined) && (!draft.isEarlyCheckin || (Boolean(draft.originalCheckinTime) && Boolean(draft.earlyCheckinTime) && !isScheduledBeforeEarly));
  const isOtaReady = isOta
    ? (isOtaStep4TimingDone && Boolean(draft.otaVoucherNo?.trim()) && Boolean(draft.checkoutDate) && draft.checkoutDate >= minCheckoutDate)
    : true;

  // Room rates & extension configuration
  const allRooms = [room, ...(additionalRooms || [])].filter(Boolean);
  const otaEarlyPrice = room?.ota_early_checkin_price !== undefined && room?.ota_early_checkin_price !== null ? Number(room.ota_early_checkin_price) : 900;
  const otaEarlyMaxHours = room?.ota_early_checkin_max_hours !== undefined && room?.ota_early_checkin_max_hours !== null ? Number(room.ota_early_checkin_max_hours) : 6;
  const totalMaxExtraBeds = allRooms.reduce((sum, r) => sum + (Number(r?.max_extra_beds) || 1), 0);
  const baseRoomRate = Number(draft.baseRate || room?.price || 2000);
  const extGraceMins = Number(room?.ext_grace_mins ?? 60);
  const ext3hRate = Number(room?.ext_3h_rate ?? 500);
  const ext6hRate = Number(room?.ext_6h_rate ?? 1000);
  const ext9hRate = Number(room?.ext_9h_rate ?? 1500);

  const calculateExtension = (timeStr, targetDate = currentCheckoutDate, source = draft.bookingSource) => {
    if (source === 'OTA') return { charge: 0, label: 'Standard Rate (₹0)', isExtended: false };
    if (!timeStr) return { charge: 0, label: 'Standard Rate (₹0)', isExtended: false };

    const checkinIso = draft.checkinTime || todayStr;
    const checkoutIso = targetDate ? `${targetDate}T${timeStr}` : '';
    if (!checkoutIso) return { charge: 0, label: 'Standard Rate (₹0)', isExtended: false };

    const dIn = new Date(checkinIso);
    const dOut = new Date(checkoutIso);
    if (isNaN(dIn.getTime()) || isNaN(dOut.getTime()) || dOut <= dIn) {
      return { charge: 0, label: 'Standard Rate (₹0)', isExtended: false };
    }

    const elapsedHours = (dOut.getTime() - dIn.getTime()) / (1000 * 60 * 60);
    const cInStr = checkinIso.split('T')[0];
    const cOutStr = checkoutIso.split('T')[0];
    let calendarDays = 1;
    if (cInStr && cOutStr) {
      calendarDays = Math.max(1, Math.round((new Date(cOutStr) - new Date(cInStr)) / (1000 * 60 * 60 * 24)));
    }
    const paidStayHours = calendarDays * 24;

    if (elapsedHours <= paidStayHours) {
      return { charge: 0, label: 'Standard Stay (Within 24h Cycle)', isExtended: false };
    }

    const extraMinutes = (elapsedHours - paidStayHours) * 60;
    const graceMins = Number(room?.ext_grace_mins) || 60;

    if (extraMinutes <= graceMins) {
      return { charge: 0, label: 'Standard Rate (Grace Period ₹0)', isExtended: false };
    } else if (extraMinutes <= 180) {
      return { charge: ext3hRate, label: `Extended 1–3 Hours (+₹${ext3hRate.toLocaleString('en-IN')})`, isExtended: true };
    } else if (extraMinutes <= 360) {
      return { charge: ext6hRate, label: `Extended 3–6 Hours (+₹${ext6hRate.toLocaleString('en-IN')})`, isExtended: true };
    } else if (extraMinutes <= 540) {
      return { charge: ext9hRate, label: `Extended 6–9 Hours (+₹${ext9hRate.toLocaleString('en-IN')})`, isExtended: true };
    } else {
      return { charge: baseRoomRate, label: `Extended >9 Hours (+₹${baseRoomRate.toLocaleString('en-IN')})`, isExtended: true };
    }
  };

  const QUICK_CHECKOUT_TIMES = [
    { time24: '10:00', label: '10:00 AM' },
    { time24: '11:00', label: '11:00 AM' },
    { time24: '13:00', label: '01:00 PM' },
    { time24: '16:00', label: '04:00 PM' },
    { time24: '19:00', label: '07:00 PM' }
  ];

  const currentExtInfo = calculateExtension(currentCheckoutTime, currentCheckoutDate, draft.bookingSource);

  const applyCheckoutUpdate = (newDate, newTime) => {
    let targetDate = newDate !== undefined ? newDate : currentCheckoutDate;
    if (draft.bookingSource === 'OTA' && targetDate && minCheckoutDate && targetDate < minCheckoutDate) {
      targetDate = minCheckoutDate;
    }
    const isOta = draft.bookingSource === 'OTA';
    const isOtaEarly = draft.bookingSource === 'OTA' && draft.isEarlyCheckin === true;
    const targetTime = isOtaEarly ? '10:00' : (isOta ? '10:00' : (newTime !== undefined ? newTime : currentCheckoutTime));
    const approx = targetDate ? (targetTime ? `${targetDate}T${targetTime}` : targetDate) : '';
    const dIn = new Date(draft.checkinTime ? draft.checkinTime.split('T')[0] : todayStr);
    const dOut = targetDate ? new Date(targetDate) : null;
    const diffDays = dOut && !isNaN(dOut.getTime()) ? Math.max(1, Math.round((dOut - dIn) / (1000 * 60 * 60 * 24))) : 1;
    const ext = calculateExtension(targetTime, targetDate, draft.bookingSource);
    updateDraft({
      checkoutDate: targetDate || '',
      checkoutTime: targetDate ? targetTime : '',
      approxCheckout: approx,
      stayNights: diffDays,
      extensionCharge: draft.bookingSource === 'OTA' ? 0 : ext.charge
    });
  };

  const triggerShake = (msg = 'Please select a Booking Source / Channel first to proceed.') => {
    setShakeAttention(true);
    setBlockedNotice(msg);
    setTimeout(() => {
      setShakeAttention(false);
    }, 600);
  };

  const loadCompanies = () => {
    api.getBtcCompanies()
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.companies || []);
        setBtcCompanies(list);
        if (draft.btcCompanyId) {
          const matched = list.find(c => c.id === draft.btcCompanyId);
          if (matched) {
            setSelectedBtcCompany(matched);
            setBtcSearchQuery(matched.company_name || matched.name);
          }
        }
      })
      .catch((e) => console.warn('Error loading BTC companies:', e));
  };

  useEffect(() => {
    api.getOtaPlatforms()
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.platforms || []);
        setOtaPlatforms(list);
      })
      .catch((e) => console.warn('Error loading OTA platforms:', e));

    loadCompanies();
  }, []);

  // Close BTC suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (btcContainerRef.current && !btcContainerRef.current.contains(e.target)) {
        setBtcSuggestions([]);
        setBtcHighlightIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll highlighted BTC suggestion into view
  useEffect(() => {
    if (btcHighlightIndex >= 0 && btcDropdownRef.current) {
      const items = btcDropdownRef.current.querySelectorAll('.btc-suggestion-item');
      if (items[btcHighlightIndex]) {
        items[btcHighlightIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [btcHighlightIndex]);

  const handleOtaEarlyCheckinToggle = (isEarly) => {
    if (isEarly) {
      const now = new Date();
      const currentActualTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      updateDraft({
        isEarlyCheckin: true,
        originalCheckinTime: '',
        earlyCheckinTime: currentActualTime,
        checkoutDate: draft.checkoutDate || '',
        checkoutTime: '10:00', // automatically fixed 10 am for OTA
        approxCheckout: draft.checkoutDate ? `${draft.checkoutDate}T10:00` : '',
        extensionCharge: 0
      });
    } else {
      updateDraft({
        isEarlyCheckin: false,
        originalCheckinTime: null,
        earlyCheckinTime: null,
        checkoutDate: draft.checkoutDate || '',
        checkoutTime: '10:00', // automatically fixed 10 am for OTA
        approxCheckout: draft.checkoutDate ? `${draft.checkoutDate}T10:00` : '',
        extensionCharge: 0
      });
    }
  };

  const handleSourceSelect = (source) => {
    setBlockedNotice('');
    updateDraft({
      bookingSource: source,
      isPrepaid: null, // No default selection! Staff must explicitly choose Pre-Paid or Pay at Hotel
      otaPlatform: '', // No platform selected by default!
      isEarlyCheckin: null, // Mandatory selection for OTA: Early vs On-Time
      originalCheckinTime: '',
      earlyCheckinTime: '',
      checkoutDate: '',
      checkoutTime: source === 'OTA' ? '10:00' : '',
      approxCheckout: '',
      extensionCharge: 0
    });
  };

  // Keyboard Navigation: Arrow keys navigate channel cards, Enter selects & proceeds
  useEffect(() => {
    const handleStep1KeyDown = (e) => {
      const active = document.activeElement;
      // Don't intercept when user is typing in form inputs / textareas / selects
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        return;
      }

      // Left / Right / Up / Down across channels
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const curIdx = CHANNELS.findIndex((c) => c.id === draft.bookingSource);
        let nextIdx = 0;
        if (curIdx !== -1) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIdx = (curIdx + 1) % CHANNELS.length;
          } else {
            nextIdx = (curIdx - 1 + CHANNELS.length) % CHANNELS.length;
          }
        }
        e.preventDefault();
        handleSourceSelect(CHANNELS[nextIdx].id);
        const btn = document.querySelector(`.modern-channel-card.${CHANNELS[nextIdx].accentClass}`);
        if (btn) btn.focus();
        return;
      }

      // Enter key: Select channel & proceed
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!draft.bookingSource) {
          e.preventDefault();
          handleSourceSelect('Walk-in');
          return;
        }

        // Walk-in or Website: proceed directly to Scan
        if ((draft.bookingSource === 'Walk-in' || draft.bookingSource === 'Website') && onProceedToScan) {
          e.preventDefault();
          onProceedToScan(draft.docType || 'Aadhar Card');
          return;
        }

        // OTA: if ready, proceed to Scan
        if (draft.bookingSource === 'OTA' && isOtaReady && onProceedToScan) {
          e.preventDefault();
          onProceedToScan(draft.docType || 'Aadhar Card');
          return;
        }

        // NOTE: For BTC, Enter does NOT jump to scan. User must explicitly choose document below.
      }
    };

    window.addEventListener('keydown', handleStep1KeyDown);
    return () => window.removeEventListener('keydown', handleStep1KeyDown);
  }, [draft.bookingSource, draft.docType, isOtaReady, isBtcReady, onProceedToScan]);

  const handleDocTypeSelect = (docType) => {
    if (!isChannelSelected) {
      triggerShake('⚠️ Please select a Booking Source / Channel above before choosing a document to scan.');
      return;
    }
    if (draft.bookingSource === 'OTA') {
      if (!isOtaStep1PlatformDone) {
        triggerShake('⚠️ Step 1 Required: Please select an OTA Platform first.');
        return;
      }
      if (!isOtaStep2PaymentDone) {
        triggerShake('⚠️ Step 2 Required: Please select OTA Payment Collection Mode (Pre-Paid or Pay at Hotel).');
        return;
      }
      if (!draft.otaManualAmount || Number(draft.otaManualAmount) <= 0) {
        triggerShake('⚠️ Step 3 Required: OTA Bill amount is mandatory. Please enter OTA Bill before choosing a document.');
        return;
      }
      if (!draft.otaVoucherNo?.trim()) {
        triggerShake('⚠️ Step 3 Required: Please enter OTA Booking ID / Voucher No. before choosing a document.');
        return;
      }
      if (!draft.checkoutDate) {
        triggerShake('⚠️ Step 3 Required: Please select Check-Out Date from OTA voucher.');
        return;
      }
      if (draft.checkoutDate < minCheckoutDate) {
        triggerShake('⚠️ Check-Out Date cannot be today when current time is past 10:00 AM. Minimum check-out date is tomorrow.');
        return;
      }
      if (draft.isEarlyCheckin === null || draft.isEarlyCheckin === undefined) {
        triggerShake('⚠️ Step 4 Required: Mandatory: Please select Early Check-In or On-Time Check-In for OTA guest.');
        return;
      }
      if (draft.isEarlyCheckin) {
        if (!draft.originalCheckinTime) {
          triggerShake('⚠️ Please enter Original Scheduled Check-In Time for early check-in.');
          return;
        }
        if (!draft.earlyCheckinTime) {
          triggerShake('⚠️ Please enter Actual Early Check-In Time.');
          return;
        }
        if (isScheduledBeforeEarly) {
          triggerShake('⚠️ Original (Scheduled) Check-In Time cannot be earlier than or equal to Actual Early Check-In Time.');
          return;
        }
      }
    }
    if (draft.bookingSource === 'BTC' && !draft.btcCompanyId) {
      triggerShake('⚠️ Please search and select a verified Corporate BTC Company before scanning.');
      return;
    }
    updateDraft({ docType });
    if (onProceedToScan) {
      onProceedToScan(docType);
    }
  };

  const handleManualClick = () => {
    if (!isChannelSelected) {
      triggerShake('⚠️ Please select a Booking Source / Channel above before filling form.');
      return;
    }
    if (draft.bookingSource === 'OTA') {
      if (!isOtaStep1PlatformDone) {
        triggerShake('⚠️ Step 1 Required: Please select an OTA Platform first.');
        return;
      }
      if (!isOtaStep2PaymentDone) {
        triggerShake('⚠️ Step 2 Required: Please select OTA Payment Collection Mode (Pre-Paid or Pay at Hotel).');
        return;
      }
      if (!draft.otaManualAmount || Number(draft.otaManualAmount) <= 0) {
        triggerShake('⚠️ Step 3 Required: OTA Bill amount is mandatory. Please enter OTA Bill before filling form.');
        return;
      }
      if (!draft.otaVoucherNo?.trim()) {
        triggerShake('⚠️ Step 3 Required: Please enter OTA Booking ID / Voucher No. before filling form.');
        return;
      }
      if (!draft.checkoutDate) {
        triggerShake('⚠️ Step 3 Required: Please select Check-Out Date from OTA voucher.');
        return;
      }
      if (draft.checkoutDate < minCheckoutDate) {
        triggerShake('⚠️ Check-Out Date cannot be today when current time is past 10:00 AM. Minimum check-out date is tomorrow.');
        return;
      }
      if (draft.isEarlyCheckin === null || draft.isEarlyCheckin === undefined) {
        triggerShake('⚠️ Step 4 Required: Mandatory: Please select Early Check-In or On-Time Check-In for OTA guest.');
        return;
      }
      if (draft.isEarlyCheckin) {
        if (!draft.originalCheckinTime) {
          triggerShake('⚠️ Please enter Original Scheduled Check-In Time for early check-in.');
          return;
        }
        if (!draft.earlyCheckinTime) {
          triggerShake('⚠️ Please enter Actual Early Check-In Time.');
          return;
        }
        if (isScheduledBeforeEarly) {
          triggerShake('⚠️ Original (Scheduled) Check-In Time cannot be earlier than or equal to Actual Early Check-In Time.');
          return;
        }
      }
    }
    if (draft.bookingSource === 'BTC' && !draft.btcCompanyId) {
      triggerShake('⚠️ Please search and select a verified Corporate BTC Company first.');
      return;
    }
    if (onManualEntry) {
      onManualEntry();
    }
  };

  const handleBtcSearch = (query) => {
    setBtcSearchQuery(query);
    if (!query.trim()) {
      setBtcSuggestions([]);
      setBtcHighlightIndex(-1);
      return;
    }
    const q = query.toLowerCase();
    const filtered = btcCompanies.filter(
      (c) =>
        (c.company_name || c.name || '').toLowerCase().includes(q) ||
        (c.gst_number || c.gstin || '').toLowerCase().includes(q) ||
        (c.pan_number || c.pan || '').toLowerCase().includes(q) ||
        (c.contact_person || '').toLowerCase().includes(q)
    );
    setBtcSuggestions(filtered);
    setBtcHighlightIndex(filtered.length > 0 ? 0 : -1);
  };

  const handleBtcKeyDown = (e) => {
    if (btcSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setBtcHighlightIndex((prev) => (prev < btcSuggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setBtcHighlightIndex((prev) => (prev > 0 ? prev - 1 : btcSuggestions.length - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13 || e.key === 'Tab') {
        e.preventDefault();
        const targetComp = btcHighlightIndex >= 0 ? btcSuggestions[btcHighlightIndex] : btcSuggestions[0];
        if (targetComp) {
          handleSelectBtc(targetComp);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setBtcSuggestions([]);
        setBtcHighlightIndex(-1);
        return;
      }
    } else {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && btcSearchQuery.trim()) {
        e.preventDefault();
        handleBtcSearch(btcSearchQuery);
        return;
      }
      if (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13) {
        e.preventDefault();
        // If user typed a company name that matches, select it
        if (btcSearchQuery.trim() && !draft.btcCompanyId) {
          const q = btcSearchQuery.trim().toLowerCase();
          const match = btcCompanies.find((c) =>
            (c.company_name || c.name || '').toLowerCase() === q ||
            (c.company_name || c.name || '').toLowerCase().includes(q)
          );
          if (match) {
            handleSelectBtc(match);
            return;
          }
        }
        // If company is already selected, do NOT advance to scan. Smooth scroll to document selection.
        if (draft.bookingSource === 'BTC' && (draft.btcCompanyId || selectedBtcCompany)) {
          const docSection = document.querySelector('.channel-gated-section') || document.querySelector('.doc-selection-grid');
          if (docSection) {
            docSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          return;
        }
      }
    }
  };

  const handleSelectBtc = (company) => {
    setSelectedBtcCompany(company);
    const compName = company.company_name || company.name;
    setBtcSearchQuery(compName);
    setBtcSuggestions([]);
    setBtcHighlightIndex(-1);
    setBlockedNotice('');
    updateDraft({
      btcCompanyId: company.id,
      btcCompanyName: compName,
      companyName: compName,
      company_name: compName,
      gstNumber: company.gst_number || company.gstin || '',
      gst_number: company.gst_number || company.gstin || '',
      btcCompanyGst: company.gst_number || company.gstin || '',
      btcCompanyAddress: company.address || '',
      btcCompanyPhone: company.contact_phone || company.phone || '',
      btcCompanyEmail: company.contact_email || company.email || '',
      btcCompanyContactPerson: company.contact_person || '',
      btcCompanyPan: company.pan_number || company.pan || ''
    });
    if (btcInputRef.current) {
      btcInputRef.current.blur();
    }
    // Smooth scroll down so user sees and chooses document
    setTimeout(() => {
      const docSection = document.querySelector('.channel-gated-section') || document.querySelector('.doc-selection-grid');
      if (docSection) {
        docSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 120);
  };

  const handleCreateBtc = async (e) => {
    e.preventDefault();
    if (!newBtcForm.company_name.trim()) return;
    try {
      const res = await api.createBtcCompany(newBtcForm);
      if (res && (res.success || res.id)) {
        setIsAddBtcOpen(false);
        setNewBtcForm({ company_name: '', gst_number: '', pan_number: '', address: '', contact_person: '', contact_phone: '', contact_email: '', credit_limit: 100000 });
        loadCompanies();
        const createdComp = res.company || { ...newBtcForm, id: res.id };
        handleSelectBtc(createdComp);
      }
    } catch (err) {
      showToast('Error adding company: ' + err.message, 'red');
    }
  };

  const docOptions = [
    {
      type: 'Aadhar Card',
      icon: '🪪'
    },
    {
      type: 'Driving License',
      icon: '🚗'
    },
    {
      type: 'Passport',
      icon: '🛂'
    }
  ];

  const activeChannelConfig = CHANNELS.find((c) => c.id === draft.bookingSource);
  const time12 = to12Hour(currentCheckoutTime);

  return (
    <div className="checkin-step-content" id="checkin-step-1">
      {/* 1. Booking Source & Channel Selector */}
      <div
        className={`booking-source-section ${shakeAttention ? 'shake-attention' : ''}`}
        style={{
          marginBottom: '20px',
          background: 'var(--bg-surface, #ffffff)',
          border: shakeAttention ? '2px solid #ef4444' : '1.5px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '18px 20px',
          boxShadow: shakeAttention ? '0 0 20px rgba(239, 68, 68, 0.25)' : '0 2px 10px rgba(0, 0, 0, 0.03)',
          transition: 'border-color 0.25s ease, box-shadow 0.25s ease'
        }}
      >
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 800,
            color: 'var(--text-primary, #334155)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>1. Booking Channel *</span>
          </div>

          {activeChannelConfig && (
            <span
              className="adv-tbl-mode-badge"
              style={{
                ...activeChannelConfig.badgeStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.78rem',
                fontWeight: 800,
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
              }}
            >
              {activeChannelConfig.badgeText}
            </span>
          )}
        </div>

        {/* Modern Horizontal Segmented Cards Bar */}
        <div className="modern-channel-horizontal-row">
          {CHANNELS.map((ch) => {
            const isSelected = draft.bookingSource === ch.id;
            return (
              <button
                key={ch.id}
                type="button"
                className={`modern-channel-card ${ch.accentClass} ${isSelected ? 'active' : ''}`}
                onClick={() => handleSourceSelect(ch.id)}
              >
                <div className="channel-card-top">
                  <div
                    className="channel-icon-wrap"
                    style={{
                      background: isSelected ? ch.themeColor + '18' : '#f1f5f9'
                    }}
                  >
                    <span>{ch.icon}</span>
                  </div>

                  {isSelected ? (
                    <span
                      className="channel-check-badge"
                      style={{
                        background: ch.themeColor,
                        color: '#ffffff'
                      }}
                    >
                      ✓ Selected
                    </span>
                  ) : (
                    <span className="channel-radio-indicator" />
                  )}
                </div>

                <div className="channel-card-body">
                  <div className="channel-card-title">
                    <span>{ch.title}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Attention blocked warning banner if user tries to skip selection */}
        {blockedNotice && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: '#fef2f2',
              border: '1.5px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#b91c1c',
              fontSize: '0.84rem',
              fontWeight: 750,
              animation: 'channelShake 0.4s ease-in-out'
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <span>{blockedNotice}</span>
          </div>
        )}

        {/* OTA Platform Panel with Progressive Gating & Streamlined Modern UI */}
        {draft.bookingSource === 'OTA' && (
          <div
            id="ota-platform-selection-panel"
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px dashed #cbd5e1',
              animation: 'fadeIn 0.25s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            {/* Step 1: Select OTA Platform * */}
            <div
              className="ota-step-card"
              style={{
                background: '#ffffff',
                border: isOtaStep1PlatformDone ? '1.5px solid #0284c7' : '2px solid #38bdf8',
                borderRadius: '14px',
                padding: '16px',
                boxShadow: isOtaStep1PlatformDone ? '0 2px 8px rgba(2, 132, 199, 0.06)' : '0 4px 16px rgba(2, 132, 199, 0.12)',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🌐</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    1. Select OTA Platform *
                  </span>
                </div>
                {isOtaStep1PlatformDone ? (
                  <span
                    style={{
                      fontSize: '0.80rem',
                      fontWeight: 850,
                      color: '#15803d',
                      background: '#dcfce7',
                      padding: '3px 12px',
                      borderRadius: '10px',
                      border: '1px solid #86efac'
                    }}
                  >
                    ✓ Selected: {draft.otaPlatform}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      color: '#ef4444',
                      background: '#fef2f2',
                      padding: '3px 10px',
                      borderRadius: '10px',
                      border: '1px solid #fecaca'
                    }}
                  >
                    Mandatory Selection
                  </span>
                )}
              </div>

              <div className="ota-platform-chips-grid">
                {(otaPlatforms.length > 0
                  ? otaPlatforms
                  : ['MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'Airbnb', 'EaseMyTrip', 'Yatra', 'Expedia']
                ).map((p) => {
                  const name = typeof p === 'string' ? p : (p.name || p.platform_name);
                  const isSelected = draft.otaPlatform === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`ota-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => updateDraft({ otaPlatform: name })}
                      style={{
                        padding: '9px 16px',
                        borderRadius: '10px',
                        fontWeight: isSelected ? 850 : 650,
                        border: isSelected ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                        background: isSelected ? '#0284c7' : '#f8fafc',
                        color: isSelected ? '#ffffff' : '#334155',
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                        boxShadow: isSelected ? '0 3px 10px rgba(2, 132, 199, 0.3)' : 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {isSelected && <span>✓</span>}
                      <span>{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: OTA Payment Collection Mode * (Gated until Platform chosen) */}
            <div
              className="ota-step-card"
              style={{
                background: isOtaStep1PlatformDone ? '#ffffff' : '#f8fafc',
                border: isOtaStep2PaymentDone
                  ? '1.5px solid #0284c7'
                  : (isOtaStep1PlatformDone ? '2px solid #38bdf8' : '1.5px dashed #cbd5e1'),
                borderRadius: '14px',
                padding: '16px',
                boxShadow: isOtaStep1PlatformDone ? '0 2px 8px rgba(2, 132, 199, 0.06)' : 'none',
                opacity: isOtaStep1PlatformDone ? 1 : 0.45,
                pointerEvents: isOtaStep1PlatformDone ? 'auto' : 'none',
                userSelect: isOtaStep1PlatformDone ? 'auto' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>💳</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    2. OTA Payment Collection Mode *
                  </span>
                </div>
                {!isOtaStep1PlatformDone ? (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '3px 10px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                    🔒 Choose Platform First
                  </span>
                ) : isOtaStep2PaymentDone ? (
                  <span
                    style={{
                      fontSize: '0.80rem',
                      fontWeight: 850,
                      color: draft.isPrepaid ? '#16a34a' : '#b45309',
                      background: draft.isPrepaid ? '#dcfce7' : '#fef3c7',
                      padding: '3px 12px',
                      borderRadius: '10px',
                      border: draft.isPrepaid ? '1px solid #86efac' : '1px solid #fde68a'
                    }}
                  >
                    ✓ {draft.isPrepaid ? 'Pre-Paid (OTA Collected)' : 'Pay at Hotel'}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ef4444', background: '#fef2f2', padding: '3px 10px', borderRadius: '10px', border: '1px solid #fecaca' }}>
                    Mandatory Choice
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                <button
                  type="button"
                  className={`source-toggle-btn ${draft.isPrepaid === true ? 'active' : ''}`}
                  onClick={() => updateDraft({ isPrepaid: true })}
                  style={{
                    padding: '14px 16px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    background: draft.isPrepaid === true ? '#0284c7' : '#ffffff',
                    color: draft.isPrepaid === true ? '#ffffff' : '#0369a1',
                    border: draft.isPrepaid === true ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    boxShadow: draft.isPrepaid === true ? '0 4px 12px rgba(2, 132, 199, 0.25)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.98rem' }}>
                    <span>💳</span>
                    <span>Pre-Paid (OTA Collected)</span>
                  </div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, opacity: 0.9, textAlign: 'left' }}>
                    Guest already paid OTA online. Hotel collects ₹0 room tariff from guest.
                  </span>
                </button>

                <button
                  type="button"
                  className={`source-toggle-btn ${draft.isPrepaid === false ? 'active' : ''}`}
                  onClick={() => updateDraft({ isPrepaid: false })}
                  style={{
                    padding: '14px 16px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    background: draft.isPrepaid === false ? '#b45309' : '#ffffff',
                    color: draft.isPrepaid === false ? '#ffffff' : '#b45309',
                    border: draft.isPrepaid === false ? '2px solid #b45309' : '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    boxShadow: draft.isPrepaid === false ? '0 4px 12px rgba(180, 83, 9, 0.25)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.98rem' }}>
                    <span>🏨</span>
                    <span>Pay at Hotel</span>
                  </div>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, opacity: 0.9, textAlign: 'left' }}>
                    Collect full stay amount directly from guest at hotel front desk.
                  </span>
                </button>
              </div>
            </div>

            {/* Step 3: OTA Bill Amount, Voucher No. & Stay Dates (Gated until Payment Mode chosen) */}
            <div
              className="ota-step-card"
              style={{
                background: isOtaStep2PaymentDone ? '#ffffff' : '#f8fafc',
                border: isOtaStep3BillDone
                  ? '1.5px solid #0284c7'
                  : (isOtaStep2PaymentDone ? '2px solid #38bdf8' : '1.5px dashed #cbd5e1'),
                borderRadius: '14px',
                padding: '16px',
                boxShadow: isOtaStep2PaymentDone ? '0 2px 8px rgba(2, 132, 199, 0.06)' : 'none',
                opacity: isOtaStep2PaymentDone ? 1 : 0.45,
                pointerEvents: isOtaStep2PaymentDone ? 'auto' : 'none',
                userSelect: isOtaStep2PaymentDone ? 'auto' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>💵</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    3. OTA Bill Amount, Voucher No. &amp; Dates *
                  </span>
                </div>
                {!isOtaStep2PaymentDone ? (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '3px 10px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                    🔒 Choose Payment Mode First
                  </span>
                ) : isOtaStep3BillDone ? (
                  <span style={{ fontSize: '0.80rem', fontWeight: 850, color: '#15803d', background: '#dcfce7', padding: '3px 12px', borderRadius: '10px', border: '1px solid #86efac' }}>
                    ✓ Bill: ₹{Number(draft.otaManualAmount).toLocaleString('en-IN')}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ef4444', background: '#fef2f2', padding: '3px 10px', borderRadius: '10px', border: '1px solid #fecaca' }}>
                    Bill Amount Mandatory
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '14px'
                }}
              >
                {/* OTA Bill */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a', display: 'block', margin: 0 }}>
                      OTA Bill * <span style={{ fontSize: '0.74rem', color: '#0284c7', fontWeight: 700 }}>(5% GST Included)</span>
                    </label>
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#ef4444', background: '#fef2f2', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                      Mandatory
                    </span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontWeight: 800,
                        color: '#0284c7',
                        fontSize: '1.1rem'
                      }}
                    >
                      ₹
                    </span>
                    <input
                      type="number"
                      required
                      className="form-input"
                      placeholder="Enter mandatory OTA bill amount"
                      value={draft.otaManualAmount || ''}
                      onChange={(e) => updateDraft({ otaManualAmount: e.target.value })}
                      style={{
                        paddingLeft: '32px',
                        height: '44px',
                        fontSize: '1.05rem',
                        fontWeight: 750,
                        color: '#0284c7',
                        background: '#ffffff',
                        border: (!draft.otaManualAmount || Number(draft.otaManualAmount) <= 0) ? '2px solid #f87171' : '1.5px solid #0284c7'
                      }}
                    />
                  </div>
                  {Number(draft.otaManualAmount) > 0 && (
                    <div style={{ fontSize: '0.74rem', color: '#0369a1', marginTop: '4px', fontWeight: 650 }}>
                      ✓ Includes 5% GST (Base: ₹{(Number(draft.otaManualAmount) / 1.05).toFixed(2)} + GST: ₹{(Number(draft.otaManualAmount) - (Number(draft.otaManualAmount) / 1.05)).toFixed(2)})
                    </div>
                  )}
                </div>

                {/* OTA Booking ID / Voucher No. */}
                <div>
                  <label
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 750,
                      color: '#334155',
                      marginBottom: '6px',
                      display: 'block'
                    }}
                  >
                    OTA Booking ID / Voucher No. *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. MMT-98248102 / AGD-4412"
                    value={draft.otaVoucherNo || ''}
                    onChange={(e) => updateDraft({ otaVoucherNo: e.target.value })}
                    style={{
                      height: '44px',
                      fontWeight: 600,
                      background: '#ffffff',
                      width: '100%',
                      boxSizing: 'border-box',
                      border: !draft.otaVoucherNo ? '1.5px solid #cbd5e1' : '1.5px solid #0284c7'
                    }}
                  />
                </div>

                {/* Check-Out Date & Time */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 750,
                        color: '#334155',
                        margin: 0
                      }}
                    >
                      Check-Out Date &amp; Time *
                    </label>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: draft.isEarlyCheckin ? '#b45309' : '#0369a1',
                        background: draft.isEarlyCheckin ? '#fef3c7' : '#f0f9ff',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: draft.isEarlyCheckin ? '1px solid #fde68a' : '1px solid #bae6fd'
                      }}
                    >
                      {draft.isEarlyCheckin ? '🔒 10:00 AM Fixed' : 'Fixed & Paid'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '6px' }}>
                    <ThemedDatePicker
                      required
                      min={minCheckoutDate}
                      value={currentCheckoutDate}
                      onChange={(e) => applyCheckoutUpdate(e.target.value, draft.isEarlyCheckin ? '10:00' : currentCheckoutTime)}
                      error={!currentCheckoutDate || (currentCheckoutDate < minCheckoutDate)}
                      style={{ height: '44px', fontSize: '0.92rem' }}
                    />
                    {currentCheckoutDate && currentCheckoutDate < minCheckoutDate && (
                      <div style={{ gridColumn: 'span 2', marginTop: '4px', fontSize: '0.74rem', color: '#b91c1c', fontWeight: 800 }}>
                        ⚠️ Check-out date cannot be today when current time is past 10:00 AM. Minimum check-out date is tomorrow ({minCheckoutDate}).
                      </div>
                    )}
                    {draft.bookingSource === 'OTA' ? (
                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          readOnly
                          disabled
                          value={currentCheckoutDate ? "10:00 AM (Fixed)" : ""}
                          placeholder={currentCheckoutDate ? "10:00 AM (Fixed)" : "--:--"}
                          title={currentCheckoutDate ? "Fixed to 10:00 AM standard checkout for OTA" : "Select Check-Out Date first"}
                          style={{
                            height: '44px',
                            fontSize: '0.92rem',
                            fontWeight: 850,
                            color: currentCheckoutDate ? '#0369a1' : '#94a3b8',
                            border: currentCheckoutDate ? '1.5px solid #0284c7' : '1.5px solid var(--border-color, #cbd5e1)',
                            borderRadius: '8px',
                            padding: '0 8px',
                            background: currentCheckoutDate ? '#f0f9ff' : 'var(--bg-surface-secondary, #f8fafc)',
                            cursor: 'not-allowed',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}
                        />
                        {currentCheckoutDate ? (
                          <span style={{ fontSize: '0.66rem', color: '#0369a1', fontWeight: 800, marginTop: '2px', display: 'block' }}>
                            🔒 10:00 AM (Fixed for OTA)
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <UnifiedTimeInput
                        value={currentCheckoutTime || ''}
                        onChange={(val) => applyCheckoutUpdate(currentCheckoutDate, val)}
                        style={{
                          height: '44px',
                          fontSize: '0.92rem',
                          fontWeight: 750,
                          border: !currentCheckoutTime ? '2px solid #ef4444' : '1.5px solid #0284c7',
                          borderRadius: '8px',
                          padding: '0 8px',
                          width: '100%',
                          boxSizing: 'border-box',
                          background: !currentCheckoutTime ? '#fff5f5' : '#ffffff'
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4: Breakfast & Check-In Timing (Gated until Bill entered) */}
            <div
              className="ota-step-card"
              style={{
                background: isOtaStep3BillDone ? '#ffffff' : '#f8fafc',
                border: isOtaStep4TimingDone
                  ? '1.5px solid #0284c7'
                  : (isOtaStep3BillDone ? '2px solid #38bdf8' : '1.5px dashed #cbd5e1'),
                borderRadius: '14px',
                padding: '16px',
                boxShadow: isOtaStep3BillDone ? '0 2px 8px rgba(2, 132, 199, 0.06)' : 'none',
                opacity: isOtaStep3BillDone ? 1 : 0.45,
                pointerEvents: isOtaStep3BillDone ? 'auto' : 'none',
                userSelect: isOtaStep3BillDone ? 'auto' : 'none',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>⏰</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    4. Breakfast &amp; Check-In Timing *
                  </span>
                </div>
                {!isOtaStep3BillDone ? (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '3px 10px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                    🔒 Enter Bill Amount First
                  </span>
                ) : isScheduledBeforeEarly ? (
                  <span style={{ fontSize: '0.76rem', fontWeight: 850, color: '#b91c1c', background: '#fef2f2', padding: '3px 12px', borderRadius: '10px', border: '1px solid #fecaca' }}>
                    ⚠️ Scheduled Time Must Be After Actual Early Time
                  </span>
                ) : isOtaStep4TimingDone ? (
                  <span style={{ fontSize: '0.80rem', fontWeight: 850, color: '#15803d', background: '#dcfce7', padding: '3px 12px', borderRadius: '10px', border: '1px solid #86efac' }}>
                    ✓ Timing: {draft.isEarlyCheckin ? 'Early Check-In' : 'On-Time'}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ef4444', background: '#fef2f2', padding: '3px 10px', borderRadius: '10px', border: '1px solid #fecaca' }}>
                    Timing Choice Mandatory
                  </span>
                )}
              </div>

              {/* Breakfast Inclusion */}
              <div
                id="ota-breakfast-inclusion-panel"
                style={{
                  padding: '12px 14px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1.5px solid #cbd5e1'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '1.1rem' }}>🍽️</span>
                    <label style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0369a1', margin: 0 }}>
                      OTA Breakfast Included? *
                    </label>
                  </div>
                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      color: '#0369a1',
                      background: '#e0f2fe',
                      padding: '2px 9px',
                      borderRadius: '6px',
                      border: '1px solid #bae6fd'
                    }}
                  >
                    Included in OTA Rate • ₹0 Extra
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    className={`source-toggle-btn ${draft.mealPlan === 'without_breakfast' ? 'active' : ''}`}
                    onClick={() => updateDraft({ mealPlan: 'without_breakfast' })}
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.90rem',
                      fontWeight: 800,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.18s ease',
                      background: draft.mealPlan === 'without_breakfast' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#ffffff',
                      color: draft.mealPlan === 'without_breakfast' ? '#ffffff' : '#0369a1',
                      border: draft.mealPlan === 'without_breakfast' ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                      boxShadow: draft.mealPlan === 'without_breakfast' ? '0 4px 12px rgba(2, 132, 199, 0.25)' : 'none'
                    }}
                  >
                    <span>🥣</span> Without Breakfast
                  </button>

                  <button
                    type="button"
                    className={`source-toggle-btn ${draft.mealPlan === 'with_breakfast' ? 'active' : ''}`}
                    onClick={() => updateDraft({ mealPlan: 'with_breakfast' })}
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.90rem',
                      fontWeight: 800,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.18s ease',
                      background: draft.mealPlan === 'with_breakfast' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : '#ffffff',
                      color: draft.mealPlan === 'with_breakfast' ? '#ffffff' : '#b45309',
                      border: draft.mealPlan === 'with_breakfast' ? '2px solid #b45309' : '1.5px solid #fde68a',
                      boxShadow: draft.mealPlan === 'with_breakfast' ? '0 4px 12px rgba(217, 119, 6, 0.25)' : 'none'
                    }}
                  >
                    <span>🍳</span> With Breakfast
                  </button>
                </div>

                <div style={{ marginTop: '6px', fontSize: '0.74rem', color: '#64748b', fontWeight: 650 }}>
                  💡 Note: OTA booking charge remains unchanged. Either choice records the meal plan from the voucher with ₹0 surcharge. If extra persons/beds are added at Step 6, their breakfast plan can be chosen separately.
                </div>
              </div>

              {/* Timing Type */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1.5px solid #cbd5e1'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0369a1', margin: 0 }}>
                    ⏰ OTA Check-In Timing Type *
                  </label>
                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      color: isScheduledBeforeEarly ? '#b91c1c' : (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined ? '#15803d' : '#ef4444'),
                      background: isScheduledBeforeEarly ? '#fef2f2' : (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined ? '#dcfce7' : '#fef2f2'),
                      padding: '2px 8px',
                      borderRadius: '6px',
                      border: isScheduledBeforeEarly ? '1px solid #fecaca' : (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined ? '1px solid #86efac' : '1px solid #fecaca')
                    }}
                  >
                    {isScheduledBeforeEarly ? '⚠️ Invalid Time' : (draft.isEarlyCheckin !== null && draft.isEarlyCheckin !== undefined ? '✓ Selected' : 'Mandatory Choice')}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    className={`source-toggle-btn ${draft.isEarlyCheckin === true ? 'active' : ''}`}
                    onClick={() => handleOtaEarlyCheckinToggle(true)}
                    style={{
                      padding: '12px 14px',
                      fontSize: '0.92rem',
                      fontWeight: 800,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.18s ease',
                      background: draft.isEarlyCheckin === true ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : '#ffffff',
                      color: draft.isEarlyCheckin === true ? '#ffffff' : '#b45309',
                      border: draft.isEarlyCheckin === true ? '2px solid #b45309' : '1.5px solid #fde68a',
                      boxShadow: draft.isEarlyCheckin === true ? '0 4px 12px rgba(217, 119, 6, 0.25)' : 'none'
                    }}
                  >
                    <span>🌅</span> Early Check-In
                  </button>

                  <button
                    type="button"
                    className={`source-toggle-btn ${draft.isEarlyCheckin === false ? 'active' : ''}`}
                    onClick={() => handleOtaEarlyCheckinToggle(false)}
                    style={{
                      padding: '12px 14px',
                      fontSize: '0.92rem',
                      fontWeight: 800,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.18s ease',
                      background: draft.isEarlyCheckin === false ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#ffffff',
                      color: draft.isEarlyCheckin === false ? '#ffffff' : '#0369a1',
                      border: draft.isEarlyCheckin === false ? '2px solid #0284c7' : '1.5px solid #bae6fd',
                      boxShadow: draft.isEarlyCheckin === false ? '0 4px 12px rgba(2, 132, 199, 0.25)' : 'none'
                    }}
                  >
                    <span>⏱️</span> On-Time Check-In
                  </button>
                </div>

                {/* If Early Check-in: inputs for Original Check-in time & Actual Early Check-in time (Locked) */}
                {draft.isEarlyCheckin === true && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '12px 14px',
                      background: '#fffbeb',
                      borderRadius: '10px',
                      border: '1.5px solid #fde68a',
                      animation: 'fadeIn 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.80rem', fontWeight: 800, color: isScheduledBeforeEarly ? '#b91c1c' : '#475569', display: 'block', marginBottom: '4px' }}>
                          📅 Original (Scheduled) Check-In Time *
                        </label>
                        <UnifiedTimeInput
                          value={draft.originalCheckinTime || ''}
                          onChange={(val) => updateDraft({ originalCheckinTime: val })}
                          minTime={draft.earlyCheckinTime}
                          hasError={isScheduledBeforeEarly}
                          style={{ height: '38px', width: '100%', borderRadius: '8px' }}
                        />
                        {isScheduledBeforeEarly && (
                          <div style={{ marginTop: '5px', fontSize: '0.72rem', color: '#b91c1c', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>⚠️</span>
                            <span>Original scheduled check-in time cannot be earlier than or equal to actual early check-in time ({to12Hour(draft.earlyCheckinTime).display}).</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#b45309', margin: 0 }}>
                            🌅 Actual Early Check-In Time *
                          </label>
                          <span
                            style={{
                              background: '#fef3c7',
                              border: '1px solid #fde68a',
                              color: '#b45309',
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '6px'
                            }}
                          >
                            ⏱️ Current Time (Locked)
                          </span>
                        </div>
                        <input
                          type="text"
                          readOnly
                          disabled
                          value={`${to12Hour(draft.earlyCheckinTime || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`).display} (Current Clock Time)`}
                          style={{
                            height: '38px',
                            width: '100%',
                            borderRadius: '8px',
                            border: '1.5px solid #d97706',
                            background: '#fef3c7',
                            color: '#92400e',
                            fontWeight: 800,
                            padding: '0 10px',
                            cursor: 'not-allowed',
                            boxSizing: 'border-box'
                          }}
                        />
                        <span style={{ fontSize: '0.70rem', color: '#b45309', fontWeight: 700, marginTop: '2px', display: 'block' }}>
                          🔒 Auto-captured live clock time — unable to edit
                        </span>
                      </div>
                    </div>

                    <div style={{ marginTop: '12px', padding: '10px 14px', background: '#eff6ff', borderRadius: '10px', border: '1.5px solid #bfdbfe', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 900, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🌅</span>
                          <span>OTA Early Check-In Extra Charge: <strong>+₹{otaEarlyPrice.toLocaleString('en-IN')}</strong></span>
                        </div>
                        <span style={{ fontSize: '0.74rem', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '6px', fontWeight: 800 }}>
                          Max {otaEarlyMaxHours} hrs early
                        </span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#475569', fontWeight: 700 }}>
                        Guest arriving early (up to {otaEarlyMaxHours} hours prior to scheduled check-in). Extra charge of ₹{otaEarlyPrice} applies (Payable at Front Desk).
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 5: Pre-Booked Rooms & Guest Occupancy (Gated until Timing chosen) */}
            <div
              className="ota-step-card"
              style={{
                background: isOtaStep4TimingDone ? '#ffffff' : '#f8fafc',
                border: isOtaStep4TimingDone ? '1.5px solid #0284c7' : '1.5px dashed #cbd5e1',
                borderRadius: '14px',
                padding: '16px',
                boxShadow: isOtaStep4TimingDone ? '0 2px 8px rgba(2, 132, 199, 0.06)' : 'none',
                opacity: isOtaStep4TimingDone ? 1 : 0.45,
                pointerEvents: isOtaStep4TimingDone ? 'auto' : 'none',
                userSelect: isOtaStep4TimingDone ? 'auto' : 'none',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>👥</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 850, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    5. Pre-Booked Rooms &amp; Guest Occupancy
                  </span>
                </div>
                {!isOtaStep4TimingDone && (
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '3px 10px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                    🔒 Complete Step 4 First
                  </span>
                )}
              </div>

              {/* Pre-Booked Rooms Section */}
              <div
                style={{
                  padding: '12px 14px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1.5px solid #cbd5e1'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>
                    🏨 Pre-Booked Rooms (OTA Reservation)
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsOtaRoomPickerOpen(prev => !prev)}
                    style={{
                      background: '#f0f9ff',
                      border: '1.5px solid #0284c7',
                      color: '#0369a1',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>+</span> Add Room from Pre-booking
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Primary Room */}
                  <span
                    style={{
                      background: '#e0f2fe',
                      border: '1.5px solid #7dd3fc',
                      color: '#0369a1',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.85rem'
                    }}
                  >
                    Room {room?.room_number} ({room?.room_type || 'Standard'}) • Lead Room
                  </span>

                  {/* Additional Pre-booked Rooms */}
                  {additionalRooms.map((ar) => (
                    <span
                      key={ar.id}
                      style={{
                        background: '#eff6ff',
                        border: '1.5px solid #93c5fd',
                        color: '#1d4ed8',
                        padding: '4px 8px 4px 10px',
                        borderRadius: '8px',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      Room #{ar.room_number} ({ar.room_type || 'Standard'})
                      <button
                        type="button"
                        onClick={() => setAdditionalRooms && setAdditionalRooms(additionalRooms.filter(r => r.id !== ar.id))}
                        style={{ border: 'none', background: 'transparent', color: '#ef4444', fontWeight: 900, cursor: 'pointer', fontSize: '0.82rem', padding: '0 2px' }}
                        title="Remove room"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>

                {/* Room Picker Dropdown if open */}
                {isOtaRoomPickerOpen && (
                  <div style={{ marginTop: '10px', padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#475569', marginBottom: '6px' }}>
                      Select an available ready room to add to this OTA booking:
                    </div>
                    {(() => {
                      const readyRoomsForOta = (availableRooms || []).filter(
                        (r) => r.status === 'ready' && r.id !== room?.id && !additionalRooms.some(ar => ar.id === r.id)
                      );
                      if (readyRoomsForOta.length === 0) {
                        return <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic' }}>No other ready rooms available.</div>;
                      }
                      return (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {readyRoomsForOta.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                if (setAdditionalRooms) setAdditionalRooms([...additionalRooms, r]);
                                setIsOtaRoomPickerOpen(false);
                              }}
                              style={{
                                background: '#ffffff',
                                border: '1.5px solid #0284c7',
                                color: '#0f172a',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontWeight: 800,
                                fontSize: '0.82rem',
                                cursor: 'pointer'
                              }}
                            >
                              + Room #{r.room_number} ({r.room_type})
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Guest Occupancy & Extra Person */}
              <div
                style={{
                  padding: '14px 16px',
                  background: '#f8fafc',
                  borderRadius: '12px',
                  border: '1.5px solid #e2e8f0'
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase', marginBottom: '10px' }}>
                  👥 OTA Guest Details &amp; Occupancy
                </div>

                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Male Count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: 750, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <img src="/man.png" alt="" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                      Male:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curM = Number.isFinite(Number(draft.adultsMale)) ? Number(draft.adultsMale) : 1;
                          const curF = Number.isFinite(Number(draft.adultsFemale)) ? Number(draft.adultsFemale) : 0;
                          const nextMale = Math.max(0, curM - 1);
                          const curFemale = curF;
                          updateDraft({
                            adultsMale: nextMale,
                            adultsFemale: curFemale,
                            otaBookedAdults: Math.max(1, nextMale + curFemale)
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        -
                      </button>
                      <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem' }}>
                        {Number.isFinite(Number(draft.adultsMale)) ? Number(draft.adultsMale) : 1}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curM = Number.isFinite(Number(draft.adultsMale)) ? Number(draft.adultsMale) : 1;
                          const curF = Number.isFinite(Number(draft.adultsFemale)) ? Number(draft.adultsFemale) : 0;
                          const nextMale = curM + 1;
                          const curFemale = curF;
                          updateDraft({
                            adultsMale: nextMale,
                            adultsFemale: curFemale,
                            otaBookedAdults: Math.max(1, nextMale + curFemale)
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Female Count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: 750, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <img src="/woman.png" alt="" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                      Female:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curM = Number.isFinite(Number(draft.adultsMale)) ? Number(draft.adultsMale) : 1;
                          const curF = Number.isFinite(Number(draft.adultsFemale)) ? Number(draft.adultsFemale) : 0;
                          const curMale = curM;
                          const nextFemale = Math.max(0, curF - 1);
                          updateDraft({
                            adultsMale: curMale,
                            adultsFemale: nextFemale,
                            otaBookedAdults: Math.max(1, curMale + nextFemale)
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        -
                      </button>
                      <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem' }}>
                        {Number.isFinite(Number(draft.adultsFemale)) ? Number(draft.adultsFemale) : 0}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curM = Number.isFinite(Number(draft.adultsMale)) ? Number(draft.adultsMale) : 1;
                          const curF = Number.isFinite(Number(draft.adultsFemale)) ? Number(draft.adultsFemale) : 0;
                          const curMale = curM;
                          const nextFemale = curF + 1;
                          updateDraft({
                            adultsMale: curMale,
                            adultsFemale: nextFemale,
                            otaBookedAdults: Math.max(1, curMale + nextFemale)
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Child Count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: 750, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <img src="/children.png" alt="" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
                      Child:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const nextChild = Math.max(0, (Number(draft.children) || 0) - 1);
                          updateDraft({
                            children: nextChild,
                            otaBookedChildren: nextChild
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        -
                      </button>
                      <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem' }}>
                        {draft.children ?? 0}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const nextChild = (Number(draft.children) || 0) + 1;
                          updateDraft({
                            children: nextChild,
                            otaBookedChildren: nextChild
                          });
                        }}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Extra Mattress Count (Included in OTA Package Voucher) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: 750, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1.05rem' }}>🛏️</span>
                      Extra Mattress:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curBeds = Number(draft.otaBookedExtraBeds) || 0;
                          const nextBeds = Math.max(0, curBeds - 1);
                          let remaining = nextBeds;
                          const nextRoomExtraBeds = {};
                          allRooms.forEach((r) => {
                            const maxB = Number(r.max_extra_beds) || 1;
                            const b = Math.min(maxB, remaining);
                            nextRoomExtraBeds[r.id] = b;
                            remaining -= b;
                          });
                          updateDraft({
                            otaBookedExtraBeds: nextBeds,
                            extraBeds: nextBeds,
                            roomExtraBeds: nextRoomExtraBeds
                          });
                        }}
                        disabled={(Number(draft.otaBookedExtraBeds) || 0) <= 0}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          cursor: (Number(draft.otaBookedExtraBeds) || 0) <= 0 ? 'not-allowed' : 'pointer',
                          fontWeight: 800
                        }}
                      >
                        -
                      </button>
                      <span style={{ minWidth: '28px', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
                        {draft.otaBookedExtraBeds ?? 0}
                      </span>
                      <button
                        type="button"
                        className="stepper-btn"
                        onClick={() => {
                          const curBeds = Number(draft.otaBookedExtraBeds) || 0;
                          if (curBeds >= totalMaxExtraBeds) return;
                          const nextBeds = curBeds + 1;
                          let remaining = nextBeds;
                          const nextRoomExtraBeds = {};
                          allRooms.forEach((r) => {
                            const maxB = Number(r.max_extra_beds) || 1;
                            const b = Math.min(maxB, remaining);
                            nextRoomExtraBeds[r.id] = b;
                            remaining -= b;
                          });
                          updateDraft({
                            otaBookedExtraBeds: nextBeds,
                            extraBeds: nextBeds,
                            roomExtraBeds: nextRoomExtraBeds
                          });
                        }}
                        disabled={(Number(draft.otaBookedExtraBeds) || 0) >= totalMaxExtraBeds}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          background: (Number(draft.otaBookedExtraBeds) || 0) >= totalMaxExtraBeds ? '#f1f5f9' : '#fff',
                          cursor: (Number(draft.otaBookedExtraBeds) || 0) >= totalMaxExtraBeds ? 'not-allowed' : 'pointer',
                          fontWeight: 800
                        }}
                      >
                        +
                      </button>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#16a34a', fontWeight: 700, background: '#f0fdf4', padding: '2px 8px', borderRadius: '6px', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>
                      Inclusive in OTA Bill (₹0 Extra)
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      (Max: {totalMaxExtraBeds})
                    </span>
                  </div>

                  {/* Extra Persons Yes/No Prompt */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#0f172a' }}>
                      Extra Persons?
                    </span>
                    <div style={{ display: 'inline-flex', borderRadius: '8px', overflow: 'hidden', border: '1.5px solid #cbd5e1' }}>
                      <button
                        type="button"
                        onClick={() => {
                          updateDraft({
                            hasExtraPersons: false,
                            extraAdults: 0,
                            extraChildren: 0
                          });
                        }}
                        style={{
                          padding: '6px 14px',
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          border: 'none',
                          cursor: 'pointer',
                          background: !draft.hasExtraPersons ? '#0284c7' : '#ffffff',
                          color: !draft.hasExtraPersons ? '#ffffff' : '#475569'
                        }}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateDraft({
                            hasExtraPersons: true
                          });
                        }}
                        style={{
                          padding: '6px 14px',
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          border: 'none',
                          cursor: 'pointer',
                          background: draft.hasExtraPersons ? '#0284c7' : '#ffffff',
                          color: draft.hasExtraPersons ? '#ffffff' : '#475569'
                        }}
                      >
                        Yes
                      </button>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: draft.hasExtraPersons ? '#0369a1' : '#64748b', fontWeight: 700 }}>
                      {draft.hasExtraPersons ? '✓ Add extra guests at Stage 6' : '(No extra guests)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BTC Corporate Panel */}
        {draft.bookingSource === 'BTC' && (
          <div
            id="btc-selection-panel"
            style={{
              marginTop: '14px',
              paddingTop: '16px',
              borderTop: '1px dashed #cbd5e1',
              animation: 'fadeIn 0.25s ease'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Corporate BTC Company Verification *
              </span>
            </div>

            <div ref={btcContainerRef} data-autocomplete-container="true" style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                ref={btcInputRef}
                type="text"
                className="form-input"
                data-autocomplete-input="true"
                role="combobox"
                aria-autocomplete="list"
                placeholder="🔍 Type Company Name, GST No. or PAN No. to verify..."
                value={btcSearchQuery}
                onChange={(e) => handleBtcSearch(e.target.value)}
                onKeyDown={handleBtcKeyDown}
                style={{ height: '42px', fontWeight: 600, paddingRight: '88px', background: '#ffffff' }}
              />

              <div
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  zIndex: 10
                }}
              >
                {btcSuggestions.length > 0 && (
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button
                      type="button"
                      id="btc-btn-nav-up"
                      title="Previous company (Arrow Up)"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setBtcHighlightIndex((prev) => (prev <= 0 ? btcSuggestions.length - 1 : prev - 1));
                        btcInputRef.current?.focus();
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        padding: '3px 7px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: '#334155',
                        lineHeight: 1
                      }}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      id="btc-btn-nav-down"
                      title="Next company (Arrow Down)"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setBtcHighlightIndex((prev) => (prev < btcSuggestions.length - 1 ? prev + 1 : 0));
                        btcInputRef.current?.focus();
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        padding: '3px 7px',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: '#334155',
                        lineHeight: 1
                      }}
                    >
                      ▼
                    </button>
                  </div>
                )}
                {btcSearchQuery && (
                  <button
                    type="button"
                    id="btc-btn-clear"
                    title="Clear search"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setBtcSearchQuery('');
                      setBtcSuggestions([]);
                      setBtcHighlightIndex(-1);
                      btcInputRef.current?.focus();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: '#94a3b8',
                      padding: '2px 4px'
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {btcSuggestions.length > 0 && (
                <div
                  ref={btcDropdownRef}
                  className="autocomplete-dropdown"
                  style={{
                    display: 'block',
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                    zIndex: 50,
                    maxHeight: '220px',
                    overflowY: 'auto'
                  }}
                >
                  {btcSuggestions.map((comp, idx) => {
                    const cName = comp.company_name || comp.name;
                    const isHighlighted = idx === btcHighlightIndex;
                    return (
                      <div
                        key={comp.id || idx}
                        id={`btc-suggestion-${idx}`}
                        className={`btc-suggestion-item ${isHighlighted ? 'active-highlight' : ''}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectBtc(comp);
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectBtc(comp);
                        }}
                        onMouseEnter={() => setBtcHighlightIndex(idx)}
                        style={{
                          padding: '10px 14px',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          background: isHighlighted ? '#eef2ff' : '#ffffff',
                          borderLeft: isHighlighted ? '4px solid #4f46e5' : '4px solid transparent',
                          transition: 'background 0.15s ease, border-left 0.15s ease',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: isHighlighted ? 850 : 750, color: isHighlighted ? '#312e81' : '#1e3a8a' }}>
                            {cName}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: isHighlighted ? '#4338ca' : '#64748b', marginTop: '2px' }}>
                            GST: {comp.gst_number || comp.gstin || 'N/A'} • PAN: {comp.pan_number || comp.pan || 'N/A'} • Contact: {comp.contact_person || 'N/A'}
                          </div>
                        </div>
                        {isHighlighted ? (
                          <button
                            type="button"
                            id={`btc-btn-enter-${idx}`}
                            className="btc-enter-badge-btn"
                            title="Click or press Enter to select"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleSelectBtc(comp);
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleSelectBtc(comp);
                            }}
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: '#ffffff',
                              background: '#4f46e5',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.35)'
                            }}
                          >
                            <span>↵ Enter</span>
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', padding: '2px 6px' }}>
                            Click to Select
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedBtcCompany && (
              <div
                id="btc-company-detail-card"
                style={{
                  background: '#eff6ff',
                  border: '1.5px solid #93c5fd',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  marginBottom: '14px',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.08)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '8px'
                  }}
                >
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#1e3a8a' }}>
                      {selectedBtcCompany.company_name || selectedBtcCompany.name}
                    </h4>
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#475569' }}>
                      {selectedBtcCompany.address || 'Corporate Partner'}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      background: '#dcfce7',
                      color: '#15803d',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      border: '1px solid #86efac'
                    }}
                  >
                    ✓ Verified Corporate
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '8px',
                    fontSize: '0.78rem',
                    color: '#334155',
                    background: '#ffffff',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #bfdbfe',
                    marginBottom: '10px'
                  }}
                >
                  <div><strong>👤 Contact:</strong> {selectedBtcCompany.contact_person || 'N/A'} {selectedBtcCompany.contact_phone ? `(${selectedBtcCompany.contact_phone})` : ''}</div>
                  <div><strong>📧 Email:</strong> {selectedBtcCompany.contact_email || 'N/A'}</div>
                  <div><strong>📜 GST:</strong> {selectedBtcCompany.gst_number || selectedBtcCompany.gstin || 'N/A'}</div>
                  <div><strong>💳 PAN:</strong> {selectedBtcCompany.pan_number || selectedBtcCompany.pan || 'N/A'}</div>
                </div>

                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>
                    Corporate Voucher / PO / Approval Reference No.
                  </label>
                  <input
                    type="text"
                    id="checkin-btc-voucher-no"
                    className="form-input"
                    placeholder="e.g. TCS-PO-2026-991 / INF-VOUCH-441"
                    value={draft.btcVoucherNo || ''}
                    onChange={(e) => updateDraft({ btcVoucherNo: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const docSection = document.querySelector('.channel-gated-section') || document.querySelector('.doc-selection-grid');
                        if (docSection) {
                          docSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                      }
                    }}
                    style={{ height: '38px', fontWeight: 600, background: '#ffffff' }}
                  />
                </div>
              </div>
            )}

            {/* Quick Add Corporate BTC Modal */}
            {isAddBtcOpen && (
              <div className="modal-overlay" style={{ zIndex: 10090, display: 'flex' }}>
                <div className="modal-dialog" style={{ maxWidth: '520px', width: '90%' }}>
                  <div className="modal-header" style={{ background: '#1e3a8a', color: '#fff' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Add New Corporate BTC Company</h3>
                    <button type="button" className="close-btn" onClick={() => setIsAddBtcOpen(false)} style={{ color: '#fff' }}>✕</button>
                  </div>
                  <form onSubmit={handleCreateBtc} style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>Company Name *</label>
                      <input
                        type="text"
                        className="form-input"
                        required
                        placeholder="e.g. Tata Consultancy Services"
                        value={newBtcForm.company_name}
                        onChange={(e) => setNewBtcForm({ ...newBtcForm, company_name: e.target.value })}
                        style={{ height: '38px' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>GST Number</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="27AAACT1234F1Z5"
                          value={newBtcForm.gst_number}
                          onChange={(e) => setNewBtcForm({ ...newBtcForm, gst_number: e.target.value })}
                          style={{ height: '38px' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>PAN Number</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="AAACT1234F"
                          value={newBtcForm.pan_number}
                          onChange={(e) => setNewBtcForm({ ...newBtcForm, pan_number: e.target.value })}
                          style={{ height: '38px' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>Contact Person</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Name"
                          value={newBtcForm.contact_person}
                          onKeyDown={blockNumericKeys}
                          onChange={(e) => setNewBtcForm({ ...newBtcForm, contact_person: sanitizeNameInput(e.target.value) })}
                          style={{ height: '38px' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>Phone</label>
                        <input
                          type="tel"
                          className="form-input"
                          placeholder="10-digit Mobile"
                          maxLength={10}
                          value={newBtcForm.contact_phone}
                          onKeyDown={(e) => blockNonNumericKeys(e, 10)}
                          onChange={(e) => setNewBtcForm({ ...newBtcForm, contact_phone: sanitizePhoneInput(e.target.value, 10) })}
                          style={{ height: '38px' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', display: 'block', marginBottom: '4px' }}>Email</label>
                      <input
                        type="email"
                        className="form-input"
                        placeholder="billing@company.com"
                        value={newBtcForm.contact_email}
                        onChange={(e) => setNewBtcForm({ ...newBtcForm, contact_email: e.target.value })}
                        style={{ height: '38px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                      <button type="button" className="btn-secondary" onClick={() => setIsAddBtcOpen(false)}>Cancel</button>
                      <button type="submit" className="btn-primary" style={{ background: '#1e3a8a' }}>Save &amp; Select</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Document Selection Grid - Gated until Channel is Selected */}
      <div
        className={`channel-gated-section ${!isChannelSelected || !isBtcReady || !isOtaReady ? 'locked' : ''}`}
        onClick={() => {
          if (!isChannelSelected) {
            triggerShake('Please select a Booking Channel first.');
          } else if (!isBtcReady) {
            triggerShake('Please select a Corporate BTC Company first.');
          } else if (isOta && !isOtaStep1PlatformDone) {
            triggerShake('⚠️ Step 1 Required: Please select an OTA Platform first.');
          } else if (isOta && !isOtaStep2PaymentDone) {
            triggerShake('⚠️ Step 2 Required: Please choose OTA Payment Collection Mode first.');
          } else if (isOta && !isOtaStep3BillDone) {
            triggerShake('⚠️ Step 3 Required: Please enter OTA Bill amount first.');
          } else if (isOta && !draft.otaVoucherNo?.trim()) {
            triggerShake('⚠️ Step 3 Required: Please enter OTA Booking ID / Voucher No. first.');
          } else if (isOta && !isOtaStep4TimingDone) {
            triggerShake('⚠️ Step 4 Required: Please choose Early vs On-Time Check-In first.');
          }
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              2. Document Type
            </h3>
            {!isChannelSelected ? (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 750,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-surface-secondary)',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Select Channel First
              </span>
            ) : !isBtcReady ? (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 750,
                  color: '#4338ca',
                  background: '#eef2ff',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Select BTC First
              </span>
            ) : !isOtaReady ? (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 750,
                  color: '#0369a1',
                  background: '#e0f2fe',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Complete OTA Details First
              </span>
            ) : (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  color: '#15803d',
                  background: '#dcfce7',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  border: '1px solid #86efac',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                ✓ Channel Ready • Choose Document
              </span>
            )}
          </div>
        </div>

        {/* Prominent Prompt when BTC company is verified */}
        {draft.bookingSource === 'BTC' && isBtcReady && (
          <div
            id="btc-choose-doc-banner"
            style={{
              background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
              border: '1.5px solid #818cf8',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.10)',
              animation: 'fadeIn 0.25s ease'
            }}
          >
            <span style={{ fontSize: '1.4rem' }}>🪪</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.90rem', fontWeight: 850, color: '#312e81' }}>
                Corporate Verified: <strong>{draft.btcCompanyName || selectedBtcCompany?.company_name}</strong>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#4338ca', fontWeight: 700, marginTop: '2px' }}>
                👇 Please click on a guest ID document below to proceed to scanning:
              </div>
            </div>
          </div>
        )}

        <div className="doc-selection-grid">
          {docOptions.map((opt) => {
            const isSelected = draft.docType === opt.type && isChannelSelected;
            return (
              <div
                key={opt.type}
                tabIndex={isChannelSelected && isBtcReady ? 0 : -1}
                role="button"
                className={`doc-option-card ${isSelected ? 'selected' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDocTypeSelect(opt.type);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDocTypeSelect(opt.type);
                }}
                style={{
                  cursor: isChannelSelected && isBtcReady ? 'pointer' : 'not-allowed'
                }}
              >
                <div className="doc-option-icon">{opt.icon}</div>
                <h4>{opt.type}</h4>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: '14px', textAlign: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleManualClick}
            disabled={!isChannelSelected || !isBtcReady}
            style={{
              padding: '8px 18px',
              fontSize: '0.82rem',
              fontWeight: 750,
              borderRadius: '10px',
              color: '#475569',
              background: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              cursor: isChannelSelected && isBtcReady ? 'pointer' : 'not-allowed'
            }}
          >
            ✍️ Skip Scan &amp; Fill Form Manually
          </button>
        </div>
      </div>
    </div>
  );
}
