import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import ExpensesPage from './ExpensesPage';
import ThemedSelect from '../components/common/ThemedSelect';

export default function ManagePage({ onPrintClosingReport }) {
  const {
    currentUser,
    showToast,
    showConfirm,
    setActivePanel,
    openStaffLogin,
    isManagerUnlocked,
    openManagerLock,
    lockManager,
    surchargeSettings,
    refreshSurcharges,
    minCheckinAdvancePct,
    refreshCheckinPolicy
  } = useApp();

  // Auto popup lock if not unlocked
  useEffect(() => {
    if (!isManagerUnlocked) {
      openManagerLock('hospitality');
    }
  }, [isManagerUnlocked, openManagerLock]);

  const [subTab, setSubTab] = useState('analytics');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsFromDate, setAnalyticsFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [analyticsToDate, setAnalyticsToDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Rooms CRUD state
  const [rooms, setRooms] = useState([]);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState({
    room_number: '',
    room_type: 'Deluxe AC',
    price: 2000,
    max_adults: 2,
    max_children: 1,
    max_extra_beds: 1,
    max_discount_pct: 15,
    extra_bed_price: 500,
    extra_bed_rate: 500,
    breakfast_price: 250,
    ext_grace_mins: 60,
    ext_3h_rate: 500,
    ext_6h_rate: 1000,
    ext_9h_rate: 1500
  });

  // Staff CRUD state
  const [staffList, setStaffList] = useState([]);
  const [editingStaff, setEditingStaff] = useState(null);
  const [staffDepartmentFilter, setStaffDepartmentFilter] = useState('all');
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({
    username: '',
    full_name: '',
    role: 'hospitality',
    phone: '',
    password: '',
    status: 'active',
    can_access_manager: 0
  });

  // Cleaner / Housekeeping Staff state
  const [cleanersList, setCleanersList] = useState([]);
  const [cleanersSearchQuery, setCleanersSearchQuery] = useState('');
  const [isCleanerModalOpen, setIsCleanerModalOpen] = useState(false);
  const [editingCleaner, setEditingCleaner] = useState(null);
  const [cleanerForm, setCleanerForm] = useState({
    name: '',
    phone: '',
    status: 'active'
  });
  const [staffSection, setStaffSection] = useState('front_desk'); // 'front_desk' | 'cleaners'

  // BTC Companies
  const [btcCompanies, setBtcCompanies] = useState([]);
  const [isBtcModalOpen, setIsBtcModalOpen] = useState(false);
  const [editingBtc, setEditingBtc] = useState(null);
  const [btcForm, setBtcForm] = useState({
    name: '',
    gstin: '',
    pan: '',
    address: '',
    contact_person: '',
    phone: '',
    email: '',
    credit_limit: 50000
  });

  // AI & OTA Settings
  const [aiKey, setAiKey] = useState('');
  const [isAiKeyConfigured, setIsAiKeyConfigured] = useState(false);
  const [aiKeyMasked, setAiKeyMasked] = useState('');
  const [showAiKey, setShowAiKey] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [testAiResult, setTestAiResult] = useState(null);
  const [isSavingAi, setIsSavingAi] = useState(false);
  const [otaPlatforms, setOtaPlatforms] = useState([]);
  const [newOtaName, setNewOtaName] = useState('');

  // Surcharges Settings State
  const [surchargeForm, setSurchargeForm] = useState({
    card_surcharge_pct: 2.5,
    upi_tax_pct: 0.4,
    upi_tax_threshold: 2000
  });
  const [isSavingSurcharges, setIsSavingSurcharges] = useState(false);

  useEffect(() => {
    if (surchargeSettings) {
      setSurchargeForm({
        card_surcharge_pct: surchargeSettings.card_surcharge_pct !== undefined ? surchargeSettings.card_surcharge_pct : 2.5,
        upi_tax_pct: surchargeSettings.upi_tax_pct !== undefined ? surchargeSettings.upi_tax_pct : 0.4,
        upi_tax_threshold: surchargeSettings.upi_tax_threshold !== undefined ? surchargeSettings.upi_tax_threshold : 2000
      });
    }
  }, [surchargeSettings]);

  const [advancePolicyPct, setAdvancePolicyPct] = useState(50);
  const [isSavingAdvancePolicy, setIsSavingAdvancePolicy] = useState(false);

  useEffect(() => {
    if (minCheckinAdvancePct !== undefined) {
      setAdvancePolicyPct(minCheckinAdvancePct);
    }
  }, [minCheckinAdvancePct]);

  // Loaders
  const loadAnalytics = useCallback(async (fromDateStr, toDateStr) => {
    try {
      const from = fromDateStr || analyticsFromDate;
      const to = toDateStr || analyticsToDate;
      const res = await api.get(`/manager/analytics?startDate=${from}&endDate=${to}`);
      const s = res?.stats || {};
      const an = res?.analytics || {};
      const normalized = {
        ...res,
        totalRealized: s.totalRealized || s.grossRevenue || 0,
        todayRevenue: s.totalRealized || s.grossRevenue || 0,
        totalCashInflow: s.totalCashInflow || an.drawer?.totalCashInflow || 0,
        totalUpiInflow: s.totalUpiInflow || an.paymentModes?.upi || 0,
        totalCardInflow: s.totalCardInflow || an.paymentModes?.card || 0,
        gstCollections: s.gstCollections || s.totalGstCollections || an.gstCollections || 0,
        netToHotel: s.netToHotel || s.baseRevenue || an.netToHotel || 0,
        baseRevenue: s.netToHotel || s.baseRevenue || an.netToHotel || 0,
        prebookedTotal: s.prebookedTotal || an.prebookedTotal || 0,
        prebookedCount: s.prebookedCount || an.prebookedCount || 0,
        drawerCash: s.cashInDrawer || 0,
        advancesTotal: s.advancesCollected || 0,
        advancesCash: an.breakdown?.advances?.cash || 0,
        settlementsTotal: s.roomRevenue || (an.breakdown?.billSettlements?.total || 0),
        settlementsCash: an.breakdown?.billSettlements?.cash || 0,
        fnbTotal: (s.restaurantRevenue || 0) + (s.barRevenue || 0),
        restaurantRevenue: s.restaurantRevenue || 0,
        barRevenue: s.barRevenue || 0,
        expensesTotal: s.totalExpenses || 0,
        expensesCashOut: an.drawer?.totalCashOutflow || 0,
        pendingChequesCount: s.pendingChequesCount || 0,
        pendingChequesAmount: s.pendingChequesAmount || 0,
        btcPendingCount: an.btcCorporate?.pending_invoice_count || 0,
        btcPendingAmount: an.btcCorporate?.pending_receivable || 0,
        expensesList: an.expensesList || [],
        stats: s,
        analytics: an
      };
      setAnalyticsData(normalized);
    } catch {
      // Fallback stats
      api.getStats().then((s) => setAnalyticsData(s)).catch(() => {});
    }
  }, [analyticsFromDate, analyticsToDate]);

  const loadRooms = useCallback(async () => {
    try {
      const data = await api.getRooms();
      const list = Array.isArray(data) ? data : (data?.rooms || []);
      setRooms(list);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      const pubData = await api.getPublicStaffList({ department: 'hospitality', include_manager: 1 });
      const pubList = Array.isArray(pubData) ? pubData : (pubData?.staff || []);
      setStaffList(pubList);
    } catch (err2) {
      console.warn('Public staff load failed:', err2);
    }
  }, []);

  const loadBtc = useCallback(async () => {
    try {
      const data = await api.getBtcCompanies();
      const list = Array.isArray(data) ? data : (data?.companies || []);
      setBtcCompanies(list);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadCleaners = useCallback(async () => {
    try {
      const data = await api.getManagerCleaners();
      const list = Array.isArray(data) ? data : (data?.cleaners || []);
      setCleanersList(list);
    } catch (e) {
      console.warn('Error loading cleaners in ManagePage:', e);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const [keyRes, otaRes] = await Promise.all([
        api.getAiKey(),
        api.getOtaPlatforms()
      ]);
      if (keyRes) {
        setIsAiKeyConfigured(Boolean(keyRes.isConfigured || keyRes.hasKey));
        setAiKeyMasked(keyRes.masked || '');
      }
      const rawList = Array.isArray(otaRes) ? otaRes : (otaRes?.platforms || []);
      const otaList = rawList.map(p => (typeof p === 'string' ? p : (p?.name || p?.platform_name || '')).trim()).filter(Boolean);
      setOtaPlatforms(otaList);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useEffect(() => {
    if (!isManagerUnlocked && (!currentUser || (!currentUser.can_access_manager && currentUser.role !== 'manager'))) {
      return;
    }
    if (subTab === 'analytics' || subTab === 'btc') loadAnalytics(analyticsFromDate, analyticsToDate);
    if (subTab === 'rooms') {
      loadRooms();
    }
    if (subTab === 'staff') {
      loadStaff();
      loadCleaners();
    }
    if (subTab === 'btc') loadBtc();
    if (subTab === 'settings') {
      loadSettings();
      loadCleaners();
    }
  }, [isManagerUnlocked, currentUser, subTab, analyticsFromDate, analyticsToDate, loadAnalytics, loadRooms, loadStaff, loadCleaners, loadBtc, loadSettings]);

  // Preload staff, cleaners, and settings immediately on mount so tables are ready
  useEffect(() => {
    loadStaff();
    loadCleaners();
    loadSettings();
  }, [loadStaff, loadCleaners, loadSettings]);

  // Room CRUD Handlers
  const handleOpenRoomModal = (r = null) => {
    if (r) {
      setEditingRoom(r);
      setRoomForm({
        room_number: r.room_number,
        room_type: r.room_type || 'Deluxe AC',
        price: r.price || 2000,
        gst_pct: r.gst_pct !== undefined && r.gst_pct !== null ? r.gst_pct : 5,
        max_adults: r.max_adults !== undefined && r.max_adults !== null ? r.max_adults : 2,
        max_children: r.max_children !== undefined && r.max_children !== null ? r.max_children : 1,
        max_extra_beds: r.max_extra_beds !== undefined && r.max_extra_beds !== null ? r.max_extra_beds : 1,
        max_discount_pct: r.max_discount_pct || 15,
        extra_bed_price: r.extra_bed_price || r.extra_bed_rate || 500,
        extra_bed_rate: r.extra_bed_price || r.extra_bed_rate || 500,
        breakfast_price: r.breakfast_price || 250,
        ext_grace_mins: r.ext_grace_mins || 60,
        ext_3h_rate: r.ext_3h_rate || 500,
        ext_6h_rate: r.ext_6h_rate || 1000,
        ext_9h_rate: r.ext_9h_rate || 1500
      });
    } else {
      setEditingRoom(null);
      setRoomForm({
        room_number: '',
        room_type: 'Deluxe AC',
        price: 2000,
        gst_pct: 5,
        max_adults: 2,
        max_children: 1,
        max_extra_beds: 1,
        max_discount_pct: 15,
        extra_bed_price: 500,
        extra_bed_rate: 500,
        breakfast_price: 250,
        ext_grace_mins: 60,
        ext_3h_rate: 500,
        ext_6h_rate: 1000,
        ext_9h_rate: 1500
      });
    }
    setIsRoomModalOpen(true);
  };

  const handleSaveRoom = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...roomForm,
        price: Number(roomForm.price) || 0,
        gst_pct: parseFloat(roomForm.gst_pct) !== undefined && !isNaN(parseFloat(roomForm.gst_pct)) ? parseFloat(roomForm.gst_pct) : 5,
        max_adults: Math.max(1, Number(roomForm.max_adults) || 1),
        max_children: Number(roomForm.max_children) || 0,
        max_extra_beds: Number(roomForm.max_extra_beds) || 0,
        max_discount_pct: Number(roomForm.max_discount_pct) || 0,
        extra_bed_price: Number(roomForm.extra_bed_price) || 0,
        extra_bed_rate: Number(roomForm.extra_bed_price) || 0,
        breakfast_price: Number(roomForm.breakfast_price) || 0,
        ext_3h_rate: Number(roomForm.ext_3h_rate) || 0,
        ext_6h_rate: Number(roomForm.ext_6h_rate) || 0,
        ext_9h_rate: Number(roomForm.ext_9h_rate) || 0
      };
      if (editingRoom) {
        await api.updateRoom(editingRoom.id, payload);
        showToast(`Room #${roomForm.room_number} updated!`, 'green');
      } else {
        await api.createRoom(payload);
        showToast(`Room #${roomForm.room_number} created!`, 'green');
      }
      setIsRoomModalOpen(false);
      loadRooms();
    } catch (err) {
      showToast('Error saving room: ' + err.message, 'red');
    }
  };

  const handleDeleteRoom = async (r) => {
    const confirmed = await showConfirm({
      title: `Delete Room #${r.room_number}?`,
      message: 'Are you sure you want to permanently delete this room configuration?',
      icon: '🗑️',
      confirmText: 'Yes, Delete',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      await api.deleteRoom(r.id);
      showToast(`Room #${r.room_number} deleted.`, 'green');
      loadRooms();
    } catch (err) {
      showToast('Error deleting room: ' + err.message, 'red');
    }
  };

  // Staff CRUD Handlers
  const handleOpenStaffModal = (staff = null, defaultRole = 'hospitality') => {
    if (staff) {
      setEditingStaff(staff);
      setStaffForm({
        username: staff.username,
        full_name: staff.full_name || '',
        role: staff.role || 'hospitality',
        phone: staff.phone || '',
        password: '',
        status: staff.status || 'active',
        can_access_manager: (staff.can_access_manager == 1 || staff.role === 'manager') ? 1 : 0
      });
    } else {
      setEditingStaff(null);
      setStaffForm({
        username: '',
        full_name: '',
        role: defaultRole === 'manager' ? 'manager' : 'hospitality',
        phone: '',
        password: '',
        status: 'active',
        can_access_manager: defaultRole === 'manager' ? 1 : 0
      });
    }
    setIsStaffModalOpen(true);
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...staffForm,
        can_access_manager: (staffForm.role === 'manager' || staffForm.can_access_manager == 1) ? 1 : 0
      };
      if (editingStaff) {
        await api.updateStaff(editingStaff.id, payload);
        showToast(`Staff account "${staffForm.full_name || staffForm.username}" updated!`, 'green');
      } else {
        await api.createStaff(payload);
        showToast(`Staff account "${staffForm.username}" registered for ${staffForm.role.toUpperCase()}!`, 'green');
      }
      setIsStaffModalOpen(false);
      setEditingStaff(null);
      loadStaff();
    } catch (err) {
      showToast('Error saving staff: ' + err.message, 'red');
    }
  };

  const handleDeleteStaff = async (s) => {
    const confirmed = await showConfirm({
      title: `Delete Staff Account ${s.username}?`,
      message: 'Are you sure you want to remove this staff account?',
      icon: '🗑️',
      confirmText: 'Yes, Delete',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      await api.deleteStaff(s.id);
      showToast('Staff account deleted.', 'green');
      loadStaff();
    } catch (err) {
      showToast('Error deleting staff: ' + err.message, 'red');
    }
  };

  // BTC Handlers
  const handleOpenBtcModal = (company = null) => {
    if (company) {
      setEditingBtc(company);
      setBtcForm({
        name: company.name || company.company_name || '',
        gstin: company.gstin || company.gst_number || '',
        pan: company.pan || company.pan_number || '',
        address: company.address || '',
        contact_person: company.contact_person || '',
        phone: company.phone || company.contact_phone || '',
        email: company.email || company.contact_email || '',
        credit_limit: company.credit_limit !== undefined ? company.credit_limit : 50000
      });
    } else {
      setEditingBtc(null);
      setBtcForm({
        name: '',
        gstin: '',
        pan: '',
        address: '',
        contact_person: '',
        phone: '',
        email: '',
        credit_limit: 50000
      });
    }
    setIsBtcModalOpen(true);
  };

  const handleSaveBtc = async (e) => {
    if (e) e.preventDefault();
    const name = (btcForm.name || '').trim();
    if (!name) {
      showToast('Please enter the corporate company name', 'amber');
      return;
    }
    const payload = {
      name,
      company_name: name,
      gstin: (btcForm.gstin || '').trim().toUpperCase(),
      gst_number: (btcForm.gstin || '').trim().toUpperCase(),
      pan: (btcForm.pan || '').trim().toUpperCase(),
      pan_number: (btcForm.pan || '').trim().toUpperCase(),
      address: (btcForm.address || '').trim(),
      contact_person: (btcForm.contact_person || '').trim(),
      phone: (btcForm.phone || '').trim(),
      contact_phone: (btcForm.phone || '').trim(),
      email: (btcForm.email || '').trim(),
      contact_email: (btcForm.email || '').trim(),
      credit_limit: parseFloat(btcForm.credit_limit) || 0
    };

    try {
      if (editingBtc && editingBtc.id) {
        await api.updateBtcCompany(editingBtc.id, payload);
        showToast(`Corporate Account "${name}" updated!`, 'green');
      } else {
        await api.createBtcCompany(payload);
        showToast(`Corporate Account "${name}" registered!`, 'green');
      }
      setIsBtcModalOpen(false);
      setEditingBtc(null);
      setBtcForm({
        name: '',
        gstin: '',
        pan: '',
        address: '',
        contact_person: '',
        phone: '',
        email: '',
        credit_limit: 50000
      });
      loadBtc();
    } catch (err) {
      showToast('Error saving company: ' + err.message, 'red');
    }
  };

  const handleDeleteBtc = async (company) => {
    const name = company.name || company.company_name;
    const confirmed = await showConfirm({
      title: 'Deactivate Corporate Account?',
      message: `Are you sure you want to deactivate "${name}" from active BTC directory?`,
      icon: '🏢',
      confirmText: 'Yes, Deactivate',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      await api.deleteBtcCompany(company.id);
      showToast(`Company "${name}" deactivated.`, 'green');
      loadBtc();
    } catch (err) {
      showToast('Error deactivating company: ' + err.message, 'red');
    }
  };

  // Settings Handlers
  const handleSaveAiKey = async () => {
    if (!aiKey || !aiKey.trim()) {
      showToast('Please enter a valid Gemini API Key', 'yellow');
      return;
    }
    setIsSavingAi(true);
    try {
      await api.saveAiKey(aiKey.trim());
      showToast('✓ Google Gemini AI Vision API Key saved & activated!', 'green');
      setAiKey('');
      loadSettings();
    } catch (err) {
      showToast('Error saving API Key: ' + err.message, 'red');
    } finally {
      setIsSavingAi(false);
    }
  };

  const handleTestAiKey = async () => {
    const keyToTest = aiKey ? aiKey.trim() : '';
    if (!keyToTest && !isAiKeyConfigured) {
      showToast('Please enter a Gemini API key first to test connection.', 'yellow');
      return;
    }
    setIsTestingAi(true);
    setTestAiResult(null);
    try {
      const res = await api.testAiKey(keyToTest);
      setTestAiResult(res);
      if (res && res.success) {
        showToast(res.message || '✓ Connected to Gemini AI Vision successfully!', 'green');
      } else {
        showToast((res && res.error) || 'Failed to connect to Google Gemini API', 'red');
      }
    } catch (err) {
      setTestAiResult({ success: false, error: err.message });
      showToast('Connection test error: ' + err.message, 'red');
    } finally {
      setIsTestingAi(false);
    }
  };

  const handleSaveSurcharges = async () => {
    setIsSavingSurcharges(true);
    try {
      const cardNum = parseFloat(surchargeForm.card_surcharge_pct);
      const upiNum = parseFloat(surchargeForm.upi_tax_pct);
      const threshNum = parseFloat(surchargeForm.upi_tax_threshold);

      if (isNaN(cardNum) || cardNum < 0) {
        showToast('Card surcharge % must be a positive number or 0.', 'red');
        return;
      }
      if (isNaN(upiNum) || upiNum < 0) {
        showToast('UPI fee % must be a positive number or 0.', 'red');
        return;
      }
      if (isNaN(threshNum) || threshNum < 0) {
        showToast('UPI threshold amount must be a positive number or 0.', 'red');
        return;
      }

      const res = await api.saveSurcharges({
        card_surcharge_pct: cardNum,
        upi_tax_pct: upiNum,
        upi_tax_threshold: threshNum
      });

      if (res && res.success) {
        showToast('✓ Card & UPI surcharge settings saved successfully!', 'green');
        if (refreshSurcharges) refreshSurcharges();
      } else {
        showToast('Failed to save surcharges: ' + (res?.error || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Error saving surcharges: ' + err.message, 'red');
    } finally {
      setIsSavingSurcharges(false);
    }
  };

  const handleSaveAdvancePolicy = async () => {
    const val = parseFloat(advancePolicyPct);
    if (isNaN(val) || val < 0 || val > 100) {
      showToast('Advance percentage must be between 0% and 100%.', 'red');
      return;
    }
    setIsSavingAdvancePolicy(true);
    try {
      const res = await api.saveCheckinPolicy(val);
      if (res && res.success) {
        showToast(`✓ Minimum check-in advance policy updated to ${val}%!`, 'green');
        if (refreshCheckinPolicy) refreshCheckinPolicy();
      } else {
        showToast('Failed to save advance policy: ' + (res?.error || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Error saving check-in policy: ' + err.message, 'red');
    } finally {
      setIsSavingAdvancePolicy(false);
    }
  };

  const handleOpenCleanerModal = (cleaner = null) => {
    if (cleaner) {
      setEditingCleaner(cleaner);
      setCleanerForm({
        name: cleaner.name || '',
        phone: cleaner.phone || '',
        status: cleaner.status || 'active'
      });
    } else {
      setEditingCleaner(null);
      setCleanerForm({
        name: '',
        phone: '',
        status: 'active'
      });
    }
    setIsCleanerModalOpen(true);
  };

  const handleSaveCleaner = async (e) => {
    e.preventDefault();
    const name = (cleanerForm.name || '').trim();
    if (!name) {
      showToast('Cleaner staff name is required', 'amber');
      return;
    }
    try {
      if (editingCleaner && editingCleaner.id) {
        const res = await api.updateCleaner(editingCleaner.id, {
          name,
          phone: (cleanerForm.phone || '').trim(),
          status: cleanerForm.status || 'active'
        });
        showToast(res.message || `Cleaner "${name}" updated!`, 'green');
      } else {
        const res = await api.createCleaner({
          name,
          phone: (cleanerForm.phone || '').trim(),
          status: cleanerForm.status || 'active'
        });
        showToast(res.message || `Cleaner "${name}" added!`, 'green');
      }
      setIsCleanerModalOpen(false);
      setEditingCleaner(null);
      setCleanerForm({ name: '', phone: '', status: 'active' });
      loadCleaners();
    } catch (err) {
      showToast('Error saving cleaner: ' + err.message, 'red');
    }
  };

  const handleToggleCleanerStatus = async (cleaner) => {
    const newStatus = cleaner.status === 'active' ? 'inactive' : 'active';
    try {
      await api.updateCleaner(cleaner.id, {
        name: cleaner.name,
        phone: cleaner.phone || '',
        status: newStatus
      });
      showToast(`Cleaner "${cleaner.name}" is now ${newStatus}.`, 'green');
      loadCleaners();
    } catch (err) {
      showToast('Error updating cleaner status: ' + err.message, 'red');
    }
  };

  const handleDeleteCleaner = async (cleaner) => {
    const confirmed = await showConfirm({
      title: 'Delete Cleaner Staff',
      message: `Are you sure you want to remove "${cleaner.name}" from the cleaner staff list?`,
      confirmText: 'Yes, Delete',
      confirmColor: 'red'
    });
    if (!confirmed) return;
    try {
      await api.deleteCleaner(cleaner.id);
      showToast(`Cleaner "${cleaner.name}" deleted.`, 'green');
      loadCleaners();
    } catch (err) {
      showToast('Error deleting cleaner: ' + err.message, 'red');
    }
  };

  const handleAddOta = async () => {
    const cleanName = newOtaName.trim();
    if (!cleanName) {
      showToast('Please type a platform name first (e.g. Agoda, Booking.com, Trip.com)', 'amber');
      return;
    }
    const exists = otaPlatforms.some(p => {
      const n = typeof p === 'string' ? p : (p.name || p.platform_name || '');
      return n.toLowerCase() === cleanName.toLowerCase();
    });
    if (exists) {
      showToast(`Platform "${cleanName}" is already added!`, 'amber');
      return;
    }
    try {
      const res = await api.addOtaPlatform(cleanName);
      const updated = (res && Array.isArray(res.platforms))
        ? res.platforms
        : [...otaPlatforms, cleanName];
      setOtaPlatforms(updated);
      setNewOtaName('');
      showToast(`OTA platform "${cleanName}" added!`, 'green');
    } catch (err) {
      showToast('Error adding OTA platform: ' + err.message, 'red');
    }
  };

  const handleDeleteOta = async (platformName) => {
    try {
      const res = await api.deleteOtaPlatform(platformName);
      const updated = (res && Array.isArray(res.platforms))
        ? res.platforms
        : otaPlatforms.filter(p => {
            const n = typeof p === 'string' ? p : (p.name || p.platform_name || '');
            return n.toLowerCase() !== platformName.toLowerCase();
          });
      setOtaPlatforms(updated);
      showToast(`Platform "${platformName}" removed.`, 'green');
    } catch (err) {
      showToast('Error removing platform: ' + err.message, 'red');
    }
  };

  if (!isManagerUnlocked) {
    return (
      <section className="panel-view active" id="view-manage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid rgba(234, 179, 8, 0.5)', borderRadius: '18px', padding: '40px 32px', textAlign: 'center', maxWidth: '540px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '14px' }}>🔒</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', marginBottom: '8px' }}>
            Manager Panel Locked
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
            Type manager password to access this panel. Access locks immediately when you leave this panel.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActivePanel('hospitality')}
              style={{ padding: '10px 20px', borderRadius: '10px', fontWeight: 700 }}
            >
              ← Back to Front Desk
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => openManagerLock('hospitality')}
              style={{
                padding: '10px 24px',
                borderRadius: '10px',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              🔓 Type Password to Unlock
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-view active" id="view-manage">
      {/* Top Standard Action Bar with Universal Back & Close Buttons */}
      <div className="page-top-action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            className="universal-back-btn"
            id="btn-manage-back"
            onClick={() => setActivePanel('hospitality')}
            title="Back to Front Desk / Hospitality"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 850, color: 'var(--text-primary)', margin: 0 }}>
              Management &amp; Master Settings
            </h2>
          </div>
        </div>

        <button
          type="button"
          className="universal-close-btn"
          onClick={() => setActivePanel('hospitality')}
          title="Close Manager & Return to Front Desk"
        >
          &times;
        </button>
      </div>

      {/* Top Manager Sub-Navigation Tabs */}
      <div className="manager-subnav-bar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '22px' }}>
        {[
          { key: 'analytics', icon: '📊', label: 'Financial Analytics & Drawer' },
          { key: 'btc', icon: '🏢', label: 'Corporate BTC Companies' },
          { key: 'expenses', icon: '💸', label: 'Petty Cash & Expenses' },
          { key: 'rooms', icon: '🛏️', label: 'Rooms & Tariff' },
          { key: 'staff', icon: '👥', label: 'Staff Accounts' },
          { key: 'settings', icon: '⚙️', label: 'AI, Surcharges & Settings' }
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`manager-subnav-btn ${subTab === tab.key ? 'active' : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Subview 1: Analytics */}
      {subTab === 'analytics' && (
        <div className="manager-subview-panel" id="man-subview-analytics">
          <div className="section-toolbar" style={{ marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            <div className="toolbar-title">
              <h2>Financial Analytics &amp; Real-Time Cash Drawer</h2>
              <p>Consolidated revenue audit across Room Advances, Settlements, Restaurant POS, Bar POS, and Expenses.</p>
            </div>

            {/* Date Range Filter Toolbar */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', padding: '4px 10px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b' }}>From:</span>
                <input
                  type="date"
                  className="form-input"
                  value={analyticsFromDate}
                  onChange={(e) => {
                    setAnalyticsFromDate(e.target.value);
                    loadAnalytics(e.target.value, analyticsToDate);
                  }}
                  style={{ height: '32px', width: '136px', fontWeight: 750, fontSize: '0.84rem', border: 'none', background: 'transparent' }}
                />
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b' }}>To:</span>
                <input
                  type="date"
                  className="form-input"
                  value={analyticsToDate}
                  onChange={(e) => {
                    setAnalyticsToDate(e.target.value);
                    loadAnalytics(analyticsFromDate, e.target.value);
                  }}
                  style={{ height: '32px', width: '136px', fontWeight: 750, fontSize: '0.84rem', border: 'none', background: 'transparent' }}
                />
              </div>

              {/* Quick Presets */}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  setAnalyticsFromDate(today);
                  setAnalyticsToDate(today);
                  loadAnalytics(today, today);
                }}
                style={{ fontWeight: 800, height: '38px', padding: '0 12px', fontSize: '0.82rem' }}
                title="View today's financial audit"
              >
                Today
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const y = new Date();
                  y.setDate(y.getDate() - 1);
                  const yStr = y.toISOString().slice(0, 10);
                  setAnalyticsFromDate(yStr);
                  setAnalyticsToDate(yStr);
                  loadAnalytics(yStr, yStr);
                }}
                style={{ fontWeight: 800, height: '38px', padding: '0 12px', fontSize: '0.82rem' }}
                title="View yesterday's audit"
              >
                Yesterday
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - 7);
                  const sStr = start.toISOString().slice(0, 10);
                  const eStr = end.toISOString().slice(0, 10);
                  setAnalyticsFromDate(sStr);
                  setAnalyticsToDate(eStr);
                  loadAnalytics(sStr, eStr);
                }}
                style={{ fontWeight: 800, height: '38px', padding: '0 12px', fontSize: '0.82rem' }}
                title="View last 7 days audit"
              >
                Last 7 Days
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const now = new Date();
                  const sStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                  const eStr = now.toISOString().slice(0, 10);
                  setAnalyticsFromDate(sStr);
                  setAnalyticsToDate(eStr);
                  loadAnalytics(sStr, eStr);
                }}
                style={{ fontWeight: 800, height: '38px', padding: '0 12px', fontSize: '0.82rem' }}
                title="View this month's audit"
              >
                This Month
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={() => onPrintClosingReport && onPrintClosingReport({
                  ...analyticsData,
                  fromDate: analyticsFromDate,
                  toDate: analyticsToDate,
                  cashierName: currentUser?.full_name || currentUser?.name || currentUser?.username || ''
                })}
                style={{ fontWeight: 850, height: '38px', background: '#0284c7', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 16px' }}
              >
                <span>🖨️</span> Print Daily Closing
              </button>
            </div>
          </div>

          {/* 3 Dedicated Departmental Sections: Hospitality, Restaurant, and Bar Lounge */}
          {(() => {
            const an = analyticsData?.analytics || {};
            const stats = analyticsData?.stats || {};
            const bd = an.breakdown || {};
            const exp = an.expenses || {};

            // 1. Hospitality Breakdown
            const hospAdv = bd.advances || {};
            const hospBill = bd.billSettlements || {};
            const hospBtc = bd.btcSettlements || {};
            const hospData = bd.hospitality || {};
            const btcChequeData = an.btcCheque || an.btcCorporate || {};
            const hospTotal = Number(hospData.total ?? ((Number(hospAdv.total) || 0) + (Number(hospBill.total) || 0) + (Number(hospBtc.total) || 0)));
            const hospBase = Number(hospData.base ?? (hospTotal > 0 ? Math.round((hospTotal / 1.05) * 100) / 100 : 0));
            const hospGst = Number(hospData.gst ?? Math.round((hospTotal - hospBase) * 100) / 100);
            const hospCash = Number(hospData.cash ?? ((Number(hospAdv.cash) || 0) + (Number(hospBill.cash) || 0) + (Number(hospBtc.cash) || 0)));
            const hospUpi = Number(hospData.upi ?? ((Number(hospAdv.upi) || 0) + (Number(hospBill.upi) || 0) + (Number(hospBtc.upi) || 0)));
            const hospCard = Number(hospData.card ?? ((Number(hospAdv.card) || 0) + (Number(hospBill.card) || 0) + (Number(hospBtc.card) || 0)));
            const hospCheque = Number(hospData.cheque ?? hospData.cheque_realized ?? 0);
            const hospBtcCheque = Number(btcChequeData.passed_amount || btcChequeData.btc_cheque_passed || hospData.btc_cheque || 0);
            const hospBtcChequePending = Number(btcChequeData.pending_amount || btcChequeData.btc_cheque_pending || 0);
            const hospBtcChequeCount = Number(btcChequeData.passed_count || btcChequeData.btc_cheque_count || 0);
            const hospCardSurcharge = Number(hospData.card_surcharge || (Number(hospAdv.card_surcharge) || 0) + (Number(hospBill.card_surcharge) || 0) + (Number(hospBtc.card_surcharge) || 0));
            const hospUpiTax = Number(hospData.upi_tax || (Number(hospAdv.upi_tax) || 0) + (Number(hospBill.upi_tax) || 0) + (Number(hospBtc.upi_tax) || 0));
            const hospPrebookedTotal = Number(analyticsData?.prebookedTotal || stats.prebookedTotal || an.prebookedTotal || 0);
            const hospPrebookedCount = Number(analyticsData?.prebookedCount || stats.prebookedCount || an.prebookedCount || 0);
            const hospRefunds = Number(exp.refunds || 0);
            const hospMaintenance = Number(exp.maintenance || 0);
            const hospOwnerDrawings = Number(exp.owner_drawings || 0);
            const hospExpensesTotal = hospRefunds + hospMaintenance + hospOwnerDrawings;
            const hospDrawerCash = hospCash - hospRefunds;

            // 2. Restaurant Breakdown
            const restData = bd.restaurant || {};
            const restTotal = Number(restData.total ?? (analyticsData?.restaurantRevenue || 0));
            const restBase = Number(restData.subtotal ?? (restTotal > 0 ? Math.round((restTotal / 1.05) * 100) / 100 : 0));
            const restGst = Number(restData.tax ?? Math.round((restTotal - restBase) * 100) / 100);
            const restCash = Number(restData.cash ?? 0);
            const restUpi = Number(restData.upi ?? 0);
            const restCard = Number(restData.card ?? 0);
            const restCardSurcharge = Number(restData.card_surcharge ?? 0);
            const restUpiTax = Number(restData.upi_tax ?? 0);
            const restCount = Number(restData.count ?? (restTotal > 0 ? 1 : 0));
            const restStorePantry = Number(exp.store_pantry || 0);
            const restExpensesTotal = restStorePantry;
            const restDrawerCash = restCash;

            // 3. Bar Breakdown
            const barData = bd.bar || {};
            const barTotal = Number(barData.total ?? (analyticsData?.barRevenue || 0));
            const barBase = Number(barData.subtotal ?? (barTotal > 0 ? Math.round((barTotal / 1.05) * 100) / 100 : 0));
            const barGst = Number(barData.tax ?? Math.round((barTotal - barBase) * 100) / 100);
            const barCash = Number(barData.cash ?? 0);
            const barUpi = Number(barData.upi ?? 0);
            const barCard = Number(barData.card ?? 0);
            const barCardSurcharge = Number(barData.card_surcharge ?? 0);
            const barUpiTax = Number(barData.upi_tax ?? 0);
            const barCount = Number(barData.count ?? (barTotal > 0 ? 1 : 0));
            const barExpensesTotal = 0;
            const barDrawerCash = barCash;

            // Grand Consolidated
            const grandRealized = Number(analyticsData?.totalRealized || stats.grossRevenue || (hospTotal + restTotal + barTotal));
            const grandDrawerCash = Number(analyticsData?.drawerCash || stats.cashInDrawer || (hospDrawerCash + restDrawerCash + barDrawerCash));
            const grandBase = Number(analyticsData?.netToHotel || stats.netToHotel || (hospBase + restBase + barBase));
            const grandGst = Number(analyticsData?.gstCollections || stats.gstCollections || (hospGst + restGst + barGst));
            const grandSurcharges = Number(analyticsData?.totalSurcharges || (stats.totalCardSurcharge || 0) + (stats.totalUpiTax || 0) || (hospCardSurcharge + hospUpiTax + restCardSurcharge + restUpiTax + barCardSurcharge + barUpiTax));

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                
                {/* Grand Consolidated Overview Strip */}
                <div style={{
                  background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                  color: '#ffffff',
                  borderRadius: '16px',
                  padding: '16px 22px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '16px',
                  boxShadow: '0 4px 16px rgba(15, 23, 42, 0.14)'
                }}>
                  <div>
                    <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#94a3b8', fontWeight: 800 }}>
                      Grand Consolidated Overview (All 3 Departments)
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 950, color: '#38bdf8', marginTop: '2px' }}>
                      {formatCurrency(grandRealized)} <span style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>Total Realized Revenue</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ borderLeft: '1px solid #334155', paddingLeft: '16px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>💵 Combined Drawer Cash</div>
                      <strong style={{ fontSize: '1.15rem', color: '#4ade80' }}>{formatCurrency(grandDrawerCash)}</strong>
                    </div>
                    <div style={{ borderLeft: '1px solid #334155', paddingLeft: '16px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>🏨 Base Price (Excl. GST)</div>
                      <strong style={{ fontSize: '1.15rem', color: '#e2e8f0' }}>{formatCurrency(grandBase)}</strong>
                    </div>
                    <div style={{ borderLeft: '1px solid #334155', paddingLeft: '16px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>🏛️ Total GST Collections</div>
                      <strong style={{ fontSize: '1.15rem', color: '#f59e0b' }}>{formatCurrency(grandGst)}</strong>
                    </div>
                    <div style={{ borderLeft: '1px solid #334155', paddingLeft: '16px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>⚡ Total Fees &amp; Surcharges</div>
                      <strong style={{ fontSize: '1.15rem', color: '#cbd5e1' }}>{formatCurrency(grandSurcharges)}</strong>
                    </div>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* 1. SECTION 1: HOSPITALITY (HOTEL ROOMS ACCOMMODATION ONLY) */}
                {/* ========================================================================= */}
                <div style={{ background: '#f8fafc', border: '2px solid #bfdbfe', borderRadius: '18px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  
                  {/* Section Title Banner */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1.5px solid #dbeafe', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                        🏨
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 950, color: '#1e3a8a' }}>
                          Hospitality Front Desk &amp; Room Folio Audit
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          Room Check-in Advances, Checkout Bill Settlements, OTA Pre-Paid Vouchers &amp; Front Desk Cash Drawer
                        </span>
                      </div>
                    </div>
                    <span style={{ background: '#eff6ff', color: '#1e40af', border: '1.5px solid #93c5fd', fontWeight: 850, padding: '4px 14px', borderRadius: '8px', fontSize: '0.82rem' }}>
                      Department: Hospitality Only
                    </span>
                  </div>

                  {/* 8 Hospitality KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Total Realized Revenue
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(hospTotal)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Advances + Checkout Settlements</div>
                    </div>

                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Net Cash in Drawer
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(hospDrawerCash)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Hosp Cash In - Cash Outflows</div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Check-in Advances</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 2px' }}>
                        {formatCurrency(hospAdv.total || 0)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
                        Cash: {formatCurrency(hospAdv.cash || 0)}
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Checkout Settlements</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 2px' }}>
                        {formatCurrency(hospBill.total || 0)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
                        Cash: {formatCurrency(hospBill.cash || 0)}
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #6366f1', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#4338ca', textTransform: 'uppercase' }}>Corporate BTC Settled</div>
                        <span style={{ fontSize: '0.70rem', background: '#e0e7ff', color: '#4338ca', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                          Company Inflow
                        </span>
                      </div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#4338ca', margin: '4px 0 2px' }}>
                        {formatCurrency(hospBtc.total || 0)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#4f46e5', fontWeight: 700, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span>💵 Cash: {formatCurrency(hospBtc.cash || 0)}</span>
                        <span>📱 UPI: {formatCurrency(hospBtc.upi || 0)}</span>
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #0284c7', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>Pre-Booked Collections</div>
                        <span style={{ fontSize: '0.70rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                          OTA Pre-Paid
                        </span>
                      </div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0284c7', margin: '4px 0 2px' }}>
                        {formatCurrency(hospPrebookedTotal)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 700 }}>
                        {hospPrebookedCount} Pre-Paid Stay Voucher(s)
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #1e3a8a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase' }}>Net to Hotel (Base Price)</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#172554', margin: '4px 0 2px' }}>
                        {formatCurrency(hospBase)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#1e40af', fontWeight: 700 }}>
                        Base Price Only (Excl. GST &amp; Expenses)
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #d97706', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>GST Collections</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#78350f', margin: '4px 0 2px' }}>
                        {formatCurrency(hospGst)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700 }}>
                        Hotel Room Standard 5% GST
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #fde68a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>Card Fee &amp; UPI Tax</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#b45309', margin: '4px 0 2px' }}>
                        {formatCurrency(hospCardSurcharge + hospUpiTax)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Card: {formatCurrency(hospCardSurcharge)}</span>
                        <span>UPI: {formatCurrency(hospUpiTax)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Advance Financial Analytics for Hospitality (3 Cards) */}
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>📈</span> Advance Financial Analytics &amp; Departmental Audit
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Hospitality Front Desk Realized Inflows, Room Outflows &amp; Surcharges ({analyticsFromDate} to {analyticsToDate})
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                      {/* Card 1: Hospitality Payment Modes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            💳 Payment Modes Audit
                          </h5>
                          <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>
                            Realized Inflow
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💵 Cash Inflow</span>
                            <strong style={{ fontSize: '1.05rem', color: '#059669' }}>{formatCurrency(hospCash)}</strong>
                            {Number(hospBtc.cash || 0) > 0 && (
                              <span style={{ fontSize: '0.66rem', color: '#16a34a', display: 'block', marginTop: '1px' }}>
                                (Inc. BTC ₹{Number(hospBtc.cash).toLocaleString('en-IN')})
                              </span>
                            )}
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>📱 UPI / Online</span>
                            <strong style={{ fontSize: '1.05rem', color: '#0284c7' }}>{formatCurrency(hospUpi)}</strong>
                            {Number(hospBtc.upi || 0) > 0 && (
                              <span style={{ fontSize: '0.66rem', color: '#0284c7', display: 'block', marginTop: '1px' }}>
                                (Inc. BTC ₹{Number(hospBtc.upi).toLocaleString('en-IN')})
                              </span>
                            )}
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💳 Card POS</span>
                            <strong style={{ fontSize: '1.05rem', color: '#7c3aed' }}>{formatCurrency(hospCard)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>🏦 Cheque Passed</span>
                            <strong style={{ fontSize: '1.05rem', color: '#d97706' }}>{formatCurrency(hospCheque)}</strong>
                          </div>
                          <div style={{ background: '#eff6ff', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #93c5fd' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.74rem', color: '#1e40af', fontWeight: 850, display: 'block' }}>🏛️ BTC Cheque</span>
                              {hospBtcChequeCount > 0 && (
                                <span style={{ fontSize: '0.65rem', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                                  {hospBtcChequeCount} Cleared
                                </span>
                              )}
                            </div>
                            <strong style={{ fontSize: '1.05rem', color: '#1e40af', display: 'block', marginTop: '2px' }}>
                              {formatCurrency(hospBtcCheque)}
                            </strong>
                            {hospBtcChequePending > 0 && (
                              <span style={{ fontSize: '0.66rem', color: '#b45309', fontWeight: 750, display: 'block' }}>
                                ⏳ Pending: {formatCurrency(hospBtcChequePending)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card 2: Hospitality Expenses & Net Margin */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            📉 Expenses &amp; Net Margin
                          </h5>
                          <span style={{ fontWeight: 900, color: '#dc2626', fontSize: '0.92rem' }}>
                            - {formatCurrency(hospExpensesTotal)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Guest Refunds:</span>
                            <strong style={{ color: '#0f172a' }}>{formatCurrency(hospRefunds)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Repairs &amp; Maintenance:</span>
                            <strong style={{ color: '#0f172a' }}>{formatCurrency(hospMaintenance)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Owner Drawings:</span>
                            <strong style={{ color: '#0f172a' }}>{formatCurrency(hospOwnerDrawings)}</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '8px', marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155' }}>Operating Net Profit:</span>
                            <strong style={{ fontSize: '1.15rem', fontWeight: 950, color: (hospTotal - hospExpensesTotal) >= 0 ? '#15803d' : '#dc2626' }}>
                              {formatCurrency(hospTotal - hospExpensesTotal)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Card 3: Hospitality Extra Fees & Taxes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            ⚡ Extra Fees &amp; Taxes Audit
                          </h5>
                          <span style={{ fontWeight: 900, color: '#b45309', fontSize: '0.95rem' }}>
                            {formatCurrency(hospCardSurcharge + hospUpiTax)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ background: '#fffbeb', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#92400e', fontWeight: 750, display: 'block' }}>💳 Card 2.5% POS Surcharge</span>
                              <span style={{ fontSize: '0.68rem', color: '#b45309' }}>From room debit/credit swipes</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#b45309' }}>{formatCurrency(hospCardSurcharge)}</strong>
                          </div>
                          <div style={{ background: '#f0f9ff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bae6fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 750, display: 'block' }}>📱 UPI 0.4% Tax (&gt; ₹2,000)</span>
                              <span style={{ fontSize: '0.68rem', color: '#0284c7' }}>Convenience tax on stay online payments</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#0284c7' }}>{formatCurrency(hospUpiTax)}</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155', fontSize: '0.78rem' }}>Total Pass-through Collections:</span>
                            <strong style={{ fontSize: '1.05rem', fontWeight: 950, color: '#0f172a' }}>{formatCurrency(hospCardSurcharge + hospUpiTax)}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* 2. SECTION 2: RESTAURANT (DINING & ROOM SERVICE POS ONLY) */}
                {/* ========================================================================= */}
                <div style={{ background: '#f8fafc', border: '2px solid #a7f3d0', borderRadius: '18px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  
                  {/* Section Title Banner */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1.5px solid #d1fae5', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                        🍽️
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 950, color: '#047857' }}>
                          Restaurant Dining &amp; POS Audit
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          Dine-in Tables, Room Service Deliveries, Takeaway Parcels &amp; Restaurant Cash Drawer
                        </span>
                      </div>
                    </div>
                    <span style={{ background: '#ecfdf5', color: '#065f46', border: '1.5px solid #6ee7b7', fontWeight: 850, padding: '4px 14px', borderRadius: '8px', fontSize: '0.82rem' }}>
                      Department: Restaurant Only
                    </span>
                  </div>

                  {/* 8 Restaurant KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Total Realized Revenue
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(restTotal)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Direct Settled Restaurant Orders</div>
                    </div>

                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Net Cash in Drawer
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(restDrawerCash)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Rest. Cash In - Pantry Outflows</div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Cash Inflow</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#059669', margin: '4px 0 2px' }}>
                        {formatCurrency(restCash)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        Physical Counter Cash
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Online UPI &amp; Card</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0284c7', margin: '4px 0 2px' }}>
                        {formatCurrency(restUpi + restCard)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        UPI: {formatCurrency(restUpi)} • Card: {formatCurrency(restCard)}
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #059669', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#047857', textTransform: 'uppercase' }}>Settled Orders Count</div>
                        <span style={{ fontSize: '0.70rem', background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                          F&amp;B POS
                        </span>
                      </div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#047857', margin: '4px 0 2px' }}>
                        {restCount} Order(s)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
                        Paid Food &amp; Beverage Bills
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #1e3a8a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase' }}>Net to Hotel (Base Price)</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#172554', margin: '4px 0 2px' }}>
                        {formatCurrency(restBase)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#1e40af', fontWeight: 700 }}>
                        F&amp;B Base Price (Excl. GST)
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #d97706', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>GST Collections</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#78350f', margin: '4px 0 2px' }}>
                        {formatCurrency(restGst)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700 }}>
                        Restaurant Standard 5% F&amp;B GST
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #fde68a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>Card Fee &amp; UPI Tax</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#b45309', margin: '4px 0 2px' }}>
                        {formatCurrency(restCardSurcharge + restUpiTax)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Card: {formatCurrency(restCardSurcharge)}</span>
                        <span>UPI: {formatCurrency(restUpiTax)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Advance Financial Analytics for Restaurant (3 Cards) */}
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#047857', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>📈</span> Advance Financial Analytics &amp; Departmental Audit
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Restaurant POS Realized Inflows, Kitchen Pantry Outflows &amp; Surcharges ({analyticsFromDate} to {analyticsToDate})
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                      {/* Card 1: Restaurant Payment Modes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            💳 Payment Modes Audit
                          </h5>
                          <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>
                            Realized Inflow
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💵 Cash Inflow</span>
                            <strong style={{ fontSize: '1.05rem', color: '#059669' }}>{formatCurrency(restCash)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>📱 UPI / Online</span>
                            <strong style={{ fontSize: '1.05rem', color: '#0284c7' }}>{formatCurrency(restUpi)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💳 Card POS</span>
                            <strong style={{ fontSize: '1.05rem', color: '#7c3aed' }}>{formatCurrency(restCard)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>🍽️ Direct Settled</span>
                            <strong style={{ fontSize: '1.05rem', color: '#047857' }}>{formatCurrency(restTotal)}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Card 2: Restaurant Expenses & Net Margin */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            📉 Expenses &amp; Net Margin
                          </h5>
                          <span style={{ fontWeight: 900, color: '#dc2626', fontSize: '0.92rem' }}>
                            - {formatCurrency(restExpensesTotal)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Store / Kitchen Pantry:</span>
                            <strong style={{ color: '#0f172a' }}>{formatCurrency(restStorePantry)}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Gas &amp; Kitchen Upkeep:</span>
                            <strong style={{ color: '#0f172a' }}>₹0.00</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Kitchen Staff Meal Cost:</span>
                            <strong style={{ color: '#0f172a' }}>₹0.00</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '8px', marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155' }}>Operating Net Profit:</span>
                            <strong style={{ fontSize: '1.15rem', fontWeight: 950, color: (restTotal - restExpensesTotal) >= 0 ? '#15803d' : '#dc2626' }}>
                              {formatCurrency(restTotal - restExpensesTotal)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Card 3: Restaurant Extra Fees & Taxes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            ⚡ Extra Fees &amp; Taxes Audit
                          </h5>
                          <span style={{ fontWeight: 900, color: '#b45309', fontSize: '0.95rem' }}>
                            {formatCurrency(restCardSurcharge + restUpiTax)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ background: '#fffbeb', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#92400e', fontWeight: 750, display: 'block' }}>💳 Card 2.5% POS Surcharge</span>
                              <span style={{ fontSize: '0.68rem', color: '#b45309' }}>From restaurant card swipes</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#b45309' }}>{formatCurrency(restCardSurcharge)}</strong>
                          </div>
                          <div style={{ background: '#f0f9ff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bae6fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 750, display: 'block' }}>📱 UPI 0.4% Tax (&gt; ₹2,000)</span>
                              <span style={{ fontSize: '0.68rem', color: '#0284c7' }}>Convenience tax on restaurant online bills</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#0284c7' }}>{formatCurrency(restUpiTax)}</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155', fontSize: '0.78rem' }}>Total Pass-through Collections:</span>
                            <strong style={{ fontSize: '1.05rem', fontWeight: 950, color: '#0f172a' }}>{formatCurrency(restCardSurcharge + restUpiTax)}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ========================================================================= */}
                {/* 3. SECTION 3: BAR LOUNGE (BAR & LIQUOR POS ONLY) */}
                {/* ========================================================================= */}
                <div style={{ background: '#f8fafc', border: '2px solid #ddd6fe', borderRadius: '18px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  
                  {/* Section Title Banner */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1.5px solid #ede9fe', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                        🍸
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 950, color: '#6d28d9' }}>
                          Bar Lounge &amp; Liquor POS Audit
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          Counter Drinks, Lounge Seating, Beverage Settlements &amp; Bar Cash Drawer
                        </span>
                      </div>
                    </div>
                    <span style={{ background: '#f5f3ff', color: '#5b21b6', border: '1.5px solid #c4b5fd', fontWeight: 850, padding: '4px 14px', borderRadius: '8px', fontSize: '0.82rem' }}>
                      Department: Bar Lounge Only
                    </span>
                  </div>

                  {/* 8 Bar KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Total Realized Revenue
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(barTotal)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Direct Settled Bar Orders</div>
                    </div>

                    <div className="folio-card" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
                      <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                        Net Cash in Drawer
                      </div>
                      <div style={{ fontSize: '1.75rem', fontWeight: 900, margin: '4px 0 2px' }}>
                        {formatCurrency(barDrawerCash)}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Bar Cash In - Expenses Out</div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Cash Inflow</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#059669', margin: '4px 0 2px' }}>
                        {formatCurrency(barCash)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        Physical Counter &amp; Bar Cash
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Online UPI &amp; Card</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#7c3aed', margin: '4px 0 2px' }}>
                        {formatCurrency(barUpi + barCard)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>
                        UPI: {formatCurrency(barUpi)} • Card: {formatCurrency(barCard)}
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #7c3aed', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase' }}>Settled Bills Count</div>
                        <span style={{ fontSize: '0.70rem', background: '#f3e8ff', color: '#7e22ce', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                          Bar POS
                        </span>
                      </div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#6d28d9', margin: '4px 0 2px' }}>
                        {barCount} Bill(s)
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#7c3aed', fontWeight: 700 }}>
                        Paid Drink &amp; Snack Bills
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #1e3a8a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase' }}>Net to Hotel (Base Price)</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#172554', margin: '4px 0 2px' }}>
                        {formatCurrency(barBase)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#1e40af', fontWeight: 700 }}>
                        Liquor Base Price (Excl. GST)
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #d97706', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>GST Collections</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#78350f', margin: '4px 0 2px' }}>
                        {formatCurrency(barGst)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700 }}>
                        Standard 5% GST on Bar
                      </div>
                    </div>

                    <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #fde68a', padding: '16px' }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>Card Fee &amp; UPI Tax</div>
                      <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#b45309', margin: '4px 0 2px' }}>
                        {formatCurrency(barCardSurcharge + barUpiTax)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Card: {formatCurrency(barCardSurcharge)}</span>
                        <span>UPI: {formatCurrency(barUpiTax)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Advance Financial Analytics for Bar (3 Cards) */}
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>📈</span> Advance Financial Analytics &amp; Departmental Audit
                      </h4>
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Bar Lounge Realized Inflows, Beverage Outflows &amp; Surcharges ({analyticsFromDate} to {analyticsToDate})
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                      {/* Card 1: Bar Payment Modes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            💳 Payment Modes Audit
                          </h5>
                          <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase' }}>
                            Realized Inflow
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💵 Cash Inflow</span>
                            <strong style={{ fontSize: '1.05rem', color: '#059669' }}>{formatCurrency(barCash)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>📱 UPI / Online</span>
                            <strong style={{ fontSize: '1.05rem', color: '#0284c7' }}>{formatCurrency(barUpi)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>💳 Card POS</span>
                            <strong style={{ fontSize: '1.05rem', color: '#7c3aed' }}>{formatCurrency(barCard)}</strong>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700, display: 'block' }}>🍸 Direct Settled</span>
                            <strong style={{ fontSize: '1.05rem', color: '#6d28d9' }}>{formatCurrency(barTotal)}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Card 2: Bar Expenses & Net Margin */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            📉 Expenses &amp; Net Margin
                          </h5>
                          <span style={{ fontWeight: 900, color: '#dc2626', fontSize: '0.92rem' }}>
                            - {formatCurrency(barExpensesTotal)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Bar Stock / Store:</span>
                            <strong style={{ color: '#0f172a' }}>₹0.00</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Glassware &amp; Upkeep:</span>
                            <strong style={{ color: '#0f172a' }}>₹0.00</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>Bar License / Amortization:</span>
                            <strong style={{ color: '#0f172a' }}>₹0.00</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '8px', marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155' }}>Operating Net Profit:</span>
                            <strong style={{ fontSize: '1.15rem', fontWeight: 950, color: (barTotal - barExpensesTotal) >= 0 ? '#15803d' : '#dc2626' }}>
                              {formatCurrency(barTotal - barExpensesTotal)}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Card 3: Bar Extra Fees & Taxes */}
                      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                          <h5 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 850, color: '#1e293b' }}>
                            ⚡ Extra Fees &amp; Taxes Audit
                          </h5>
                          <span style={{ fontWeight: 900, color: '#b45309', fontSize: '0.95rem' }}>
                            {formatCurrency(barCardSurcharge + barUpiTax)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ background: '#fffbeb', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#92400e', fontWeight: 750, display: 'block' }}>💳 Card 2.5% POS Surcharge</span>
                              <span style={{ fontSize: '0.68rem', color: '#b45309' }}>From bar card swipes</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#b45309' }}>{formatCurrency(barCardSurcharge)}</strong>
                          </div>
                          <div style={{ background: '#f0f9ff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #bae6fd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 750, display: 'block' }}>📱 UPI 0.4% Tax (&gt; ₹2,000)</span>
                              <span style={{ fontSize: '0.68rem', color: '#0284c7' }}>Convenience tax on bar online bills</span>
                            </div>
                            <strong style={{ fontSize: '1rem', color: '#0284c7' }}>{formatCurrency(barUpiTax)}</strong>
                          </div>
                          <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: '#334155', fontSize: '0.78rem' }}>Total Pass-through Collections:</span>
                            <strong style={{ fontSize: '1.05rem', fontWeight: 950, color: '#0f172a' }}>{formatCurrency(barCardSurcharge + barUpiTax)}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            );
          })()}
        </div>
      )}

      {/* Subview 2: Corporate BTC */}
      {subTab === 'btc' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px',
              background: '#ffffff',
              padding: '18px 24px',
              borderRadius: '16px',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 3px' }}>
                🏢 Corporate Bill-To-Company (BTC) Accounts
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                Manage approved corporate client directory for direct billing, deferred invoicing, and check-in source assignment.
              </p>
            </div>
            <button
              id="btn-register-new-btc"
              type="button"
              className="btn-primary"
              onClick={() => handleOpenBtcModal(null)}
              style={{
                height: '42px',
                padding: '0 20px',
                fontWeight: 800,
                borderRadius: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>➕</span> Register New Company
            </button>
          </div>

          {/* BTC Corporate Financial KPI Cards */}
          {(() => {
            const an = analyticsData?.analytics || {};
            const bd = an.breakdown || {};
            const hospBtc = bd.btcSettlements || {};
            const btcChequeData = an.btcCheque || an.btcCorporate || {};
            const btcChequePassed = Number(btcChequeData.passed_amount || btcChequeData.btc_cheque_passed || 0);
            const btcChequePending = Number(btcChequeData.pending_amount || btcChequeData.btc_cheque_pending || 0);
            const btcChequeCount = Number(btcChequeData.passed_count || btcChequeData.btc_cheque_count || 0);

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '4px' }}>
                <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Active Corporate Accounts</div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 2px' }}>
                    {btcCompanies.length} Registered
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>Approved for Corporate Credit</div>
                </div>

                <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #fca5a5', padding: '16px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase' }}>Pending BTC Receivables</div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#dc2626', margin: '4px 0 2px' }}>
                    {formatCurrency(an.btcCorporate?.pending_receivable || 0)}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#991b1b', fontWeight: 700 }}>
                    {an.btcCorporate?.pending_invoice_count || 0} Invoice(s) Awaiting Company Settlement
                  </div>
                </div>

                <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #0284c7', padding: '16px' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>Realized BTC Settlements</div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0284c7', margin: '4px 0 2px' }}>
                    {formatCurrency(hospBtc.total || 0)}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 700 }}>
                    Cash: {formatCurrency(hospBtc.cash || 0)} • UPI: {formatCurrency(hospBtc.upi || 0)}
                  </div>
                </div>

                <div className="folio-card" style={{ background: '#eff6ff', border: '2px solid #93c5fd', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 850, color: '#1e40af', textTransform: 'uppercase' }}>🏛️ BTC Cheque</div>
                    {btcChequeCount > 0 && (
                      <span style={{ fontSize: '0.68rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                        {btcChequeCount} Cleared
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#1e40af', margin: '4px 0 2px' }}>
                    {formatCurrency(btcChequePassed)}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: btcChequePending > 0 ? '#b45309' : '#15803d', fontWeight: 750 }}>
                    {btcChequePending > 0 ? `⏳ Pending Clearance: ${formatCurrency(btcChequePending)}` : '✓ All BTC cheques cleared'}
                  </div>
                </div>
              </div>
            );
          })()}

          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              border: '1.5px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          >
            <table className="owner-rooms-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>Company Name</th>
                  <th>GSTIN</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Credit Limit</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right', width: '220px', minWidth: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {btcCompanies.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{c.name || c.company_name}</td>
                    <td>
                      <code style={{ fontSize: '0.82rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        {c.gstin || c.gst_number || '-'}
                      </code>
                    </td>
                    <td>{c.contact_person || '-'}</td>
                    <td>{c.phone || c.contact_phone || '-'}</td>
                    <td style={{ fontWeight: 800, color: '#0071e3' }}>{formatCurrency(c.credit_limit || 0)}</td>
                    <td>
                      <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                        ACTIVE
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleOpenBtcModal(c)}
                          style={{ fontWeight: 750, background: '#f8fafc', whiteSpace: 'nowrap', padding: '6px 14px' }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleDeleteBtc(c)}
                          style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fff1f2', whiteSpace: 'nowrap', padding: '6px 14px' }}
                        >
                          🗑️ Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {btcCompanies.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b', fontSize: '0.94rem' }}>
                      No corporate BTC accounts registered yet. Click &ldquo;Register New Company&rdquo; above to register one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Subview 3: Expenses */}
      {subTab === 'expenses' && <ExpensesPage />}

      {/* Subview 4: Rooms & Tariff */}
      {subTab === 'rooms' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.24rem', fontWeight: 850, color: 'var(--text-primary)' }}>
                Room Configuration &amp; Tariff Slabs
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Configure base tariff, room-specific GST tax rate, guest capacities, and stay extension slabs.
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={() => handleOpenRoomModal(null)} style={{ padding: '9px 18px', fontWeight: 800 }}>
              + Add New Room
            </button>
          </div>
          <table className="owner-rooms-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Room #</th>
                <th>Type</th>
                <th>Price (Tariff)</th>
                <th>GST %</th>
                <th>Max Adults</th>
                <th>Max Child</th>
                <th>Max Extra Bed</th>
                <th>Extra Bed Rate</th>
                <th>Breakfast</th>
                <th>Status</th>
                <th style={{ textAlign: 'right', width: '180px', minWidth: '160px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 800 }}>#{r.room_number}</td>
                  <td>{r.room_type}</td>
                  <td style={{ fontWeight: 800, color: '#0071e3' }}>{formatCurrency(r.price)}</td>
                  <td style={{ fontWeight: 850, color: '#10b981' }}>{r.gst_pct !== undefined && r.gst_pct !== null ? `${r.gst_pct}%` : '5%'}</td>
                  <td>👥 {r.max_adults !== undefined ? r.max_adults : 2}</td>
                  <td>🧒 {r.max_children !== undefined ? r.max_children : 1}</td>
                  <td>🛏️ {r.max_extra_beds !== undefined ? r.max_extra_beds : 1}</td>
                  <td>{formatCurrency(r.extra_bed_price || r.extra_bed_rate || 500)}</td>
                  <td>{formatCurrency(r.breakfast_price || 250)}</td>
                  <td>
                    <span className={`status-pill ${r.status}`} style={{ fontSize: '0.72rem' }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => handleOpenRoomModal(r)}
                        style={{ whiteSpace: 'nowrap', padding: '6px 14px' }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => handleDeleteRoom(r)}
                        style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fff1f2', whiteSpace: 'nowrap', padding: '6px 12px' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Subview 5: Staff */}
      {subTab === 'staff' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Section Switcher: Front Desk Cashiers vs Housekeeping Cleaners */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`filter-chip ${staffSection === 'front_desk' ? 'active' : ''}`}
              onClick={() => setStaffSection('front_desk')}
              style={{
                padding: '9px 20px',
                fontSize: '0.92rem',
                fontWeight: 800,
                borderRadius: '10px',
                border: staffSection === 'front_desk' ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                background: staffSection === 'front_desk' ? '#e0f2fe' : '#ffffff',
                color: staffSection === 'front_desk' ? '#0369a1' : '#475569',
                cursor: 'pointer'
              }}
            >
              🏨 Front Desk & Management ({staffList.filter(s => s.role === 'hospitality' || s.role === 'manager').length})
            </button>
            <button
              type="button"
              className={`filter-chip ${staffSection === 'cleaners' ? 'active' : ''}`}
              onClick={() => setStaffSection('cleaners')}
              style={{
                padding: '9px 20px',
                fontSize: '0.92rem',
                fontWeight: 800,
                borderRadius: '10px',
                border: staffSection === 'cleaners' ? '2px solid #059669' : '1.5px solid #cbd5e1',
                background: staffSection === 'cleaners' ? '#d1fae5' : '#ffffff',
                color: staffSection === 'cleaners' ? '#047857' : '#475569',
                cursor: 'pointer'
              }}
            >
              🧹 Housekeeping &amp; Cleaner Staff ({cleanersList.length})
            </button>
          </div>

          {/* Section 1: Front Desk Cashiers */}
          {staffSection === 'front_desk' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '14px',
                  background: '#ffffff',
                  padding: '16px 20px',
                  borderRadius: '14px',
                  border: '1.5px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                }}
              >
                <div>
                  <h3 style={{ fontSize: '1.24rem', fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                    🏨 Front Desk Staff Accounts
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Manage cashier accounts and shift credentials for Front Desk &amp; Hospitality reception.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ position: 'relative', minWidth: '220px' }}>
                    <input
                      type="text"
                      placeholder="🔍 Search staff name or ID..."
                      value={staffSearchQuery}
                      onChange={(e) => setStaffSearchQuery(e.target.value)}
                      className="form-input"
                      style={{ height: '38px', fontSize: '0.84rem', borderRadius: '10px', padding: '4px 12px' }}
                    />
                    {staffSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setStaffSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '0.9rem'
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    id="btn-add-staff-top"
                    onClick={() => handleOpenStaffModal(null, 'hospitality')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 18px',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      background: '#0284c7'
                    }}
                  >
                    <span>+</span> Add Front Desk Staff
                  </button>
                </div>
              </div>

              {/* Front Desk Staff Table */}
              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
                <table className="owner-rooms-table" style={{ width: '100%', margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '180px' }}>Cashier ID</th>
                      <th>Staff Name</th>
                      <th style={{ width: '180px' }}>Section</th>
                      <th style={{ width: '160px' }}>Manager Access</th>
                      <th style={{ textAlign: 'right', width: '220px', minWidth: '200px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffList
                      .filter(s => s.role === 'hospitality' || s.role === 'manager')
                      .filter(s => {
                        if (!staffSearchQuery.trim()) return true;
                        const q = staffSearchQuery.toLowerCase().trim();
                        return (s.username || '').toLowerCase().includes(q) ||
                               (s.full_name || '').toLowerCase().includes(q);
                      })
                      .sort((a, b) => {
                        if (a.role === 'manager' && b.role !== 'manager') return -1;
                        if (b.role === 'manager' && a.role !== 'manager') return 1;
                        return (a.full_name || a.username).localeCompare(b.full_name || b.username);
                      })
                      .map((s) => {
                        const isManager = s.role === 'manager';
                        const hasManagerAccess = isManager || s.can_access_manager == 1;

                        return (
                          <tr key={s.id || s.username}>
                            <td style={{ fontWeight: 800 }}>
                              <code style={{ fontSize: '0.88rem', padding: '3px 8px', borderRadius: '6px' }}>
                                {s.username}
                              </code>
                            </td>
                            <td style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.94rem' }}>
                              {s.full_name}
                            </td>
                            <td>
                              {isManager ? (
                                <span style={{
                                  background: '#f1f5f9',
                                  color: '#334155',
                                  padding: '3px 10px',
                                  borderRadius: '12px',
                                  fontSize: '0.76rem',
                                  fontWeight: 800,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  ⚙️ Jaijeet sir
                                </span>
                              ) : (
                                <span style={{
                                  background: '#e0f2fe',
                                  color: '#0369a1',
                                  padding: '3px 10px',
                                  borderRadius: '12px',
                                  fontSize: '0.76rem',
                                  fontWeight: 800,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  🏨 Front Desk
                                </span>
                              )}
                            </td>
                            <td>
                              {hasManagerAccess ? (
                                <span style={{
                                  background: '#ecfdf5',
                                  color: '#047857',
                                  border: '1px solid #a7f3d0',
                                  padding: '2px 8px',
                                  borderRadius: '8px',
                                  fontSize: '0.74rem',
                                  fontWeight: 800
                                }}>
                                  🔑 Allowed
                                </span>
                              ) : (
                                <span style={{
                                  background: '#f8fafc',
                                  color: '#94a3b8',
                                  border: '1px solid #e2e8f0',
                                  padding: '2px 8px',
                                  borderRadius: '8px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700
                                }}>
                                  Locked
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'nowrap' }}>
                                <button
                                  type="button"
                                  className="filter-chip"
                                  onClick={() => handleOpenStaffModal(s)}
                                  style={{ fontWeight: 750, background: '#f8fafc', whiteSpace: 'nowrap', padding: '6px 14px' }}
                                >
                                  ✏️ Edit
                                </button>
                                {s.username !== 'admin' && (
                                  <button
                                    type="button"
                                    className="filter-chip"
                                    onClick={() => handleDeleteStaff(s)}
                                    style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fff1f2', whiteSpace: 'nowrap', padding: '6px 14px' }}
                                  >
                                    🗑️ Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {staffList.filter(s => s.role === 'hospitality').length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '32px', color: '#64748b', fontSize: '0.90rem' }}>
                          No staff accounts found for Front Desk. Click &ldquo;+ Add Front Desk Staff&rdquo; above to register one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 2: Housekeeping & Cleaner Staff */}
          {staffSection === 'cleaners' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '14px',
                  background: '#ffffff',
                  padding: '16px 20px',
                  borderRadius: '14px',
                  border: '1.5px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                }}
              >
                <div>
                  <h3 style={{ fontSize: '1.24rem', fontWeight: 850, color: '#0f172a', margin: '0 0 2px' }}>
                    🧹 Housekeeping &amp; Room Cleaner Staff
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
                    Options managed here automatically appear in the &ldquo;Cleaner Staff Name&rdquo; dropdown when turning over rooms to ready status.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ position: 'relative', minWidth: '220px' }}>
                    <input
                      type="text"
                      placeholder="🔍 Search cleaner staff..."
                      value={cleanersSearchQuery}
                      onChange={(e) => setCleanersSearchQuery(e.target.value)}
                      className="form-input"
                      style={{ height: '38px', fontSize: '0.84rem', borderRadius: '10px', padding: '4px 12px' }}
                    />
                    {cleanersSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setCleanersSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '0.9rem'
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    id="btn-add-cleaner-top"
                    onClick={() => handleOpenCleanerModal(null)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 18px',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      background: '#059669'
                    }}
                  >
                    <span>+</span> Add Cleaner Staff
                  </button>
                </div>
              </div>

              {/* Cleaners Table */}
              <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
                <table className="owner-rooms-table" style={{ width: '100%', margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '90px' }}>ID</th>
                      <th>Cleaner Staff Name</th>
                      <th style={{ width: '180px' }}>Contact Phone</th>
                      <th style={{ width: '150px' }}>Status</th>
                      <th style={{ textAlign: 'right', width: '220px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cleanersList
                      .filter(c => {
                        if (!cleanersSearchQuery.trim()) return true;
                        const q = cleanersSearchQuery.toLowerCase().trim();
                        return (c.name || '').toLowerCase().includes(q) ||
                               (c.phone || '').toLowerCase().includes(q);
                      })
                      .map((c) => {
                        const isActive = c.status === 'active';
                        return (
                          <tr key={c.id || c.name}>
                            <td style={{ fontWeight: 800 }}>
                              <code style={{ fontSize: '0.88rem', background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px' }}>
                                #{c.id}
                              </code>
                            </td>
                            <td style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.96rem' }}>
                              🧹 {c.name}
                            </td>
                            <td style={{ color: '#475569', fontSize: '0.88rem', fontWeight: 600 }}>
                              {c.phone || '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleToggleCleanerStatus(c)}
                                title="Click to toggle Active / Inactive"
                                style={{
                                  background: isActive ? '#ecfdf5' : '#f8fafc',
                                  color: isActive ? '#047857' : '#94a3b8',
                                  border: `1px solid ${isActive ? '#a7f3d0' : '#e2e8f0'}`,
                                  padding: '4px 10px',
                                  borderRadius: '8px',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <span>{isActive ? '● Active' : '○ Inactive'}</span>
                              </button>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'nowrap' }}>
                                <button
                                  type="button"
                                  className="filter-chip"
                                  onClick={() => handleOpenCleanerModal(c)}
                                  style={{ fontWeight: 750, background: '#f8fafc', whiteSpace: 'nowrap', padding: '6px 14px' }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  className="filter-chip"
                                  onClick={() => handleDeleteCleaner(c)}
                                  style={{ color: '#dc2626', borderColor: '#fecaca', background: '#fff1f2', whiteSpace: 'nowrap', padding: '6px 14px' }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {cleanersList.length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '32px', color: '#64748b', fontSize: '0.90rem' }}>
                          No cleaner staff accounts found. Click &ldquo;+ Add Cleaner Staff&rdquo; above to register housekeeping members.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subview 6: Settings */}
      {/* Subview 6: Settings */}
      {subTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '1100px', margin: '0 auto' }}>
          {/* AI Vision Document OCR Engine Card */}
          <div
            className="folio-card"
            style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)'
            }}
          >
            {/* Header with Title & Live Status */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '14px',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    🤖 Google Gemini AI Vision Document OCR
                  </h2>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)',
                      color: '#0369a1',
                      border: '1px solid #bae6fd',
                      padding: '3px 10px',
                      borderRadius: '12px'
                    }}
                    title="Evergreen auto-updating model alias - permanently active"
                  >
                    gemini-flash-latest (Evergreen)
                  </span>
                </div>
                <p style={{ fontSize: '0.84rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                  High-precision multi-modal document intelligence. Automatically extracts Guest Name, Father Name,
                  DOB, Mobile Number, and Complete Residential Address from front &amp; back photos during check-in.
                </p>
              </div>

              {/* Status Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  background: isTestingAi
                    ? '#fef3c7'
                    : testAiResult && !testAiResult.success
                    ? '#fee2e2'
                    : aiKey
                    ? '#ecfdf5'
                    : '#f1f5f9',
                  color: isTestingAi
                    ? '#92400e'
                    : testAiResult && !testAiResult.success
                    ? '#991b1b'
                    : aiKey
                    ? '#065f46'
                    : '#475569',
                  border: isTestingAi
                    ? '1.5px solid #fde68a'
                    : testAiResult && !testAiResult.success
                    ? '1.5px solid #fecaca'
                    : aiKey
                    ? '1.5px solid #a7f3d0'
                    : '1.5px solid #cbd5e1'
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: isTestingAi
                      ? '#d97706'
                      : testAiResult && !testAiResult.success
                      ? '#dc2626'
                      : aiKey
                      ? '#10b981'
                      : '#94a3b8',
                    display: 'inline-block'
                  }}
                />
                {isTestingAi
                  ? 'Testing API Connection...'
                  : testAiResult && testAiResult.success
                  ? `Connected (${testAiResult.latencyMs || 250}ms)`
                  : testAiResult && !testAiResult.success
                  ? 'Connection Issue'
                  : aiKey
                  ? 'Operational & Active'
                  : 'API Key Required'}
              </div>
            </div>

            {/* API Key Form Field */}
            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Google Gemini API Key
                </label>
                {isAiKeyConfigured ? (
                  <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#15803d', background: '#dcfce7', padding: '3px 10px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    ✓ Key Configured: <code>{aiKeyMasked}</code>
                  </span>
                ) : (
                  <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#b91c1c', background: '#fee2e2', padding: '3px 10px', borderRadius: '12px' }}>
                    ⚠️ No API Key Configured
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '1rem',
                      opacity: 0.6,
                      pointerEvents: 'none'
                    }}
                  >
                    🔑
                  </span>
                  <input
                    type={showAiKey ? 'text' : 'password'}
                    className="form-input"
                    placeholder={isAiKeyConfigured ? "Enter new Gemini API key to update (leave blank to keep active key)" : "Enter Google Gemini API Key"}
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    style={{
                      paddingLeft: '40px',
                      paddingRight: '90px',
                      fontFamily: 'SF Pro Display, ui-monospace, Menlo, Consolas, monospace',
                      fontSize: '0.88rem',
                      letterSpacing: showAiKey ? '0.02em' : '0.12em',
                      height: '44px',
                      fontWeight: 700,
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAiKey(!showAiKey)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'var(--bg-surface-secondary, #f1f5f9)',
                      border: '1px solid var(--border-light, #cbd5e1)',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '0.74rem',
                      fontWeight: 750,
                      color: 'var(--text-primary, #475569)',
                      cursor: 'pointer'
                    }}
                  >
                    {showAiKey ? '🙈 Hide' : '👁️ Show'}
                  </button>
                </div>

                {/* Test Connection Button */}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isTestingAi || (!aiKey.trim() && !isAiKeyConfigured)}
                  onClick={handleTestAiKey}
                  style={{
                    height: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 750,
                    whiteSpace: 'nowrap',
                    padding: '0 18px',
                    borderRadius: '10px',
                    cursor: isTestingAi || (!aiKey.trim() && !isAiKeyConfigured) ? 'not-allowed' : 'pointer'
                  }}
                >
                  <span>{isTestingAi ? '⏳' : '⚡'}</span>
                  {isTestingAi ? 'Testing...' : (aiKey.trim() ? 'Test Typed Key' : 'Test Active Key')}
                </button>

                {/* Save API Key Button */}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={isSavingAi || !aiKey.trim()}
                  onClick={handleSaveAiKey}
                  style={{
                    height: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    padding: '0 20px',
                    borderRadius: '10px',
                    cursor: isSavingAi || !aiKey.trim() ? 'not-allowed' : 'pointer'
                  }}
                >
                  <span>{isSavingAi ? '⏳' : '💾'}</span>
                  {isSavingAi ? 'Saving...' : 'Save & Activate'}
                </button>
              </div>
            </div>

            {/* Live Test Results Alert Banner */}
            {testAiResult && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  background: testAiResult.success ? '#f0fdf4' : '#fef2f2',
                  border: `1.5px solid ${testAiResult.success ? '#86efac' : '#fca5a5'}`,
                  color: testAiResult.success ? '#15803d' : '#b91c1c'
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>{testAiResult.success ? '✓' : '⚠️'}</span>
                <span style={{ flex: 1 }}>{testAiResult.message || testAiResult.error}</span>
                {testAiResult.latencyMs && (
                  <span
                    style={{
                      fontSize: '0.74rem',
                      background: testAiResult.success ? '#dcfce7' : '#fee2e2',
                      padding: '2px 8px',
                      borderRadius: '6px'
                    }}
                  >
                    Latency: {testAiResult.latencyMs}ms
                  </span>
                )}
              </div>
            )}

            {/* AI Capabilities Checklist Strip */}
            <div
              style={{
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid #f1f5f9'
              }}
            >
              <div
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '10px'
                }}
              >
                Automated Fields Extracted from ID Documents:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {[
                  { icon: '👤', label: 'Primary Guest Full Name' },
                  { icon: '👨', label: 'Father / Guardian Name' },
                  { icon: '🎂', label: 'Date of Birth (DOB)' },
                  { icon: '📱', label: 'Mobile Number' },
                  { icon: '📍', label: 'Complete Residential Address' },
                  { icon: '📮', label: '6-Digit PIN Code' },
                  { icon: '🆔', label: 'Government ID Number' },
                  { icon: '⚡', label: 'Dual-Side Front & Back 1-Pass OCR' }
                ].map((item, idx) => (
                  <span
                    key={idx}
                    className="ai-field-tag"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: 'var(--bg-surface-secondary, #f8fafc)',
                      border: '1px solid var(--border-light, #e2e8f0)',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: 'var(--text-primary, #334155)'
                    }}
                  >
                    <span>{item.icon}</span> {item.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* OTA Platforms & Channels Management Card */}
          <div
            className="folio-card"
            style={{
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{ marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
                🌐 OTA Platforms &amp; Booking Channels
              </h2>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary, #64748b)', margin: 0 }}>
                Manage the booking platforms available in the horizontal Booking Source selector during check-in.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', maxWidth: '520px' }}>
              <input
                id="input-new-ota-channel"
                type="text"
                className="form-input"
                placeholder="Platform name (e.g. Agoda, Booking.com, Trip.com)..."
                value={newOtaName}
                onChange={(e) => setNewOtaName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddOta();
                  }
                }}
                style={{ height: '42px', fontWeight: 600 }}
              />
              <button
                id="btn-add-ota-channel"
                type="button"
                className="btn-primary"
                onClick={handleAddOta}
                style={{ height: '42px', whiteSpace: 'nowrap', padding: '0 18px', fontWeight: 750 }}
              >
                + Add Channel
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {otaPlatforms.map((p, idx) => {
                const name = typeof p === 'string' ? p : (p.name || p.platform_name || '');
                return (
                  <span
                    key={idx}
                    className="ota-platform-pill"
                    style={{
                      background: 'var(--bg-surface-secondary, #f1f5f9)',
                      border: '1.5px solid var(--border-light, #cbd5e1)',
                      padding: '6px 12px',
                      borderRadius: '10px',
                      fontSize: '0.82rem',
                      fontWeight: 750,
                      color: 'var(--text-primary, #1e293b)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>🌐 {name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteOta(name)}
                      title={`Remove ${name}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary, #94a3b8)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.9rem',
                        fontWeight: 900,
                        lineHeight: 1
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)')}
                    >
                      &times;
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Card & UPI Payment Surcharge Management Card */}
          <div
            className="folio-card"
            style={{
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>💳</span> Card &amp; Online UPI Surcharge Rates
                </h2>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary, #64748b)', margin: 0, lineHeight: 1.5 }}>
                  Configure transaction convenience fees charged to guests across Front Desk Check-in Advance, Room Folio Checkout, Restaurant POS, and Bar Lounge billing.
                </p>
              </div>

              <button
                type="button"
                className="btn-primary"
                id="btn-save-surcharges"
                disabled={isSavingSurcharges}
                onClick={handleSaveSurcharges}
                style={{
                  height: '42px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  padding: '0 20px',
                  borderRadius: '10px',
                  cursor: isSavingSurcharges ? 'not-allowed' : 'pointer'
                }}
              >
                <span>{isSavingSurcharges ? '⏳' : '💾'}</span>
                {isSavingSurcharges ? 'Saving...' : 'Save Surcharge Settings'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px', marginBottom: '18px' }}>
              {/* Card Surcharge */}
              <div className="surcharge-card card-surcharge" style={{ padding: '16px 18px', borderRadius: '12px', border: '1.5px solid #fde047' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>💳</span>
                  <label style={{ fontSize: '0.9rem', fontWeight: 850, margin: 0 }}>
                    Credit / Debit Card Surcharge (%)
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="form-input"
                    id="input-card-surcharge-pct"
                    value={surchargeForm.card_surcharge_pct}
                    onChange={(e) => setSurchargeForm({ ...surchargeForm, card_surcharge_pct: e.target.value })}
                    style={{ height: '44px', fontSize: '1.15rem', fontWeight: 900 }}
                  />
                  <span style={{ fontSize: '1.2rem', fontWeight: 900 }}>%</span>
                </div>
                <p style={{ fontSize: '0.76rem', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Default is 2.5%. Applied automatically whenever card is swiped at POS / EDC terminals. Set to 0% to disable card surcharge.
                </p>
              </div>

              {/* UPI Fee % */}
              <div className="surcharge-card upi-surcharge" style={{ padding: '16px 18px', borderRadius: '12px', border: '1.5px solid #bae6fd' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>📱</span>
                  <label style={{ fontSize: '0.9rem', fontWeight: 850, margin: 0 }}>
                    UPI / Online Convenience Fee (%)
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="100"
                    className="form-input"
                    id="input-upi-tax-pct"
                    value={surchargeForm.upi_tax_pct}
                    onChange={(e) => setSurchargeForm({ ...surchargeForm, upi_tax_pct: e.target.value })}
                    style={{ height: '44px', fontSize: '1.15rem', fontWeight: 900 }}
                  />
                  <span style={{ fontSize: '1.2rem', fontWeight: 900 }}>%</span>
                </div>
                <p style={{ fontSize: '0.76rem', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Default is 0.4%. Applied only when online transaction exceeds the exemption threshold below. Set to 0% to disable.
                </p>
              </div>

              {/* UPI Threshold */}
              <div className="surcharge-card upi-threshold" style={{ padding: '16px 18px', borderRadius: '12px', border: '1.5px solid #bbf7d0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>🛡️</span>
                  <label style={{ fontSize: '0.9rem', fontWeight: 850, margin: 0 }}>
                    UPI Free Exemption Threshold (₹)
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 900 }}>₹</span>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    className="form-input"
                    id="input-upi-tax-threshold"
                    value={surchargeForm.upi_tax_threshold}
                    onChange={(e) => setSurchargeForm({ ...surchargeForm, upi_tax_threshold: e.target.value })}
                    style={{ height: '44px', fontSize: '1.15rem', fontWeight: 900 }}
                  />
                </div>
                <p style={{ fontSize: '0.76rem', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Default is ₹2,000. All UPI payments up to ₹{Number(surchargeForm.upi_tax_threshold || 0).toLocaleString('en-IN')} incur 0% fee (Free for small guest bills).
                </p>
              </div>
            </div>

            {/* Live Calculation Example Preview */}
            <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', border: '1px solid var(--border-light, #e2e8f0)', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.84rem', color: 'var(--text-primary, #334155)' }}>
              <span style={{ fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>💡 Live Calculation Preview:</span>
              <span className="surcharge-preview-pill" style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-light, #cbd5e1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Card ₹10,000 = <strong style={{ color: '#d97706' }}>+₹{Math.round((10000 * (parseFloat(surchargeForm.card_surcharge_pct) || 0)) / 100)}</strong> ({surchargeForm.card_surcharge_pct || 0}%)
              </span>
              <span className="surcharge-preview-pill" style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-light, #cbd5e1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, color: 'var(--text-primary)' }}>
                UPI ₹1,500 = <strong style={{ color: '#10b981' }}>{1500 > Number(surchargeForm.upi_tax_threshold || 0) && Number(surchargeForm.upi_tax_pct || 0) > 0 ? `+₹${Math.round((1500 * (parseFloat(surchargeForm.upi_tax_pct) || 0)) / 100)}` : '₹0 Fee'}</strong> (≤ ₹{Number(surchargeForm.upi_tax_threshold || 0).toLocaleString('en-IN')})
              </span>
              <span className="surcharge-preview-pill" style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-light, #cbd5e1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, color: 'var(--text-primary)' }}>
                UPI ₹5,000 = <strong style={{ color: '#0284c7' }}>{5000 > Number(surchargeForm.upi_tax_threshold || 0) && Number(surchargeForm.upi_tax_pct || 0) > 0 ? `+₹${Math.round((5000 * (parseFloat(surchargeForm.upi_tax_pct) || 0)) / 100)}` : '₹0 Fee'}</strong> ({surchargeForm.upi_tax_pct || 0}%)
              </span>
            </div>
          </div>

          {/* Check-In Advance Payment Policy Card */}
          <div
            className="folio-card"
            style={{
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>🏨</span> Check-In Advance Payment Policy
                </h2>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary, #64748b)', margin: 0, lineHeight: 1.5 }}>
                  Set the minimum percentage of total stay charges that must be collected upfront at check-in (for Walk-in &amp; Pay at Hotel bookings).
                </p>
              </div>

              <button
                type="button"
                className="btn-primary"
                id="btn-save-checkin-policy"
                disabled={isSavingAdvancePolicy}
                onClick={handleSaveAdvancePolicy}
                style={{
                  height: '42px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  padding: '0 20px',
                  borderRadius: '10px',
                  cursor: isSavingAdvancePolicy ? 'not-allowed' : 'pointer',
                  background: '#2563eb'
                }}
              >
                <span>{isSavingAdvancePolicy ? '⏳' : '💾'}</span>
                {isSavingAdvancePolicy ? 'Saving...' : 'Save Check-In Policy'}
              </button>
            </div>

            <div style={{ maxWidth: '420px', marginBottom: '16px' }}>
              <div className="surcharge-card" style={{ padding: '16px 18px', borderRadius: '12px', border: '1.5px solid #93c5fd', background: '#f0f9ff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>💰</span>
                  <label style={{ fontSize: '0.9rem', fontWeight: 850, margin: 0, color: '#1e3a8a' }}>
                    Minimum Advance Required at Check-In (%)
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    className="form-input"
                    id="input-min-checkin-advance-pct"
                    value={advancePolicyPct}
                    onChange={(e) => setAdvancePolicyPct(e.target.value)}
                    style={{ height: '44px', fontSize: '1.15rem', fontWeight: 900, background: '#ffffff' }}
                  />
                  <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#1e3a8a' }}>%</span>
                </div>
                <p style={{ fontSize: '0.76rem', color: '#475569', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Default is 50%. Front desk will enforce that guests pay at least this percentage before check-in can be confirmed. (Set to 0% to allow ₹0 post-paid check-ins).
                </p>
              </div>
            </div>

            {/* Live Calculation Example Preview */}
            <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', border: '1px solid var(--border-light, #e2e8f0)', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.84rem', color: 'var(--text-primary, #334155)' }}>
              <span style={{ fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>💡 Policy Example:</span>
              <span className="surcharge-preview-pill" style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-light, #cbd5e1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>
                Stay Bill ₹3,000 → Guest pays at least <strong style={{ color: '#2563eb' }}>₹{Math.ceil((3000 * (parseFloat(advancePolicyPct) || 0)) / 100).toLocaleString('en-IN')}</strong> ({advancePolicyPct || 0}%)
              </span>
              <span className="surcharge-preview-pill" style={{ background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-light, #cbd5e1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>
                Stay Bill ₹5,000 → Guest pays at least <strong style={{ color: '#2563eb' }}>₹{Math.ceil((5000 * (parseFloat(advancePolicyPct) || 0)) / 100).toLocaleString('en-IN')}</strong> ({advancePolicyPct || 0}%)
              </span>
            </div>
          </div>

          {/* Housekeeping / Cleaner Staff Quick Card */}
          <div
            className="folio-card"
            style={{
              borderRadius: '16px',
              padding: '24px 28px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px'
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: '0 0 4px 0' }}>
                🧹 Housekeeping &amp; Room Cleaner Staff
              </h2>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary, #64748b)', margin: 0 }}>
                Manage cleaner staff options that populate the &ldquo;Cleaner Staff Name&rdquo; dropdown when turning over rooms to ready status.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setSubTab('staff');
                setStaffSection('cleaners');
              }}
              style={{
                background: '#059669',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: '10px',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              <span>🧹</span> Manage Cleaner Staff ({cleanersList.length}) →
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Room Add/Edit Modal */}
      {isRoomModalOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10050, background: 'rgba(15, 23, 42, 0.70)', backdropFilter: 'blur(8px)' }}>
          <div
            className="modal-container"
            style={{
              maxWidth: '820px',
              width: '94%',
              maxHeight: '90vh',
              borderRadius: '20px',
              border: '1.5px solid #cbd5e1',
              boxShadow: '0 30px 60px -15px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div className="modal-header" style={{ padding: '20px 28px', background: 'var(--bg-surface, #ffffff)', borderBottom: '2px solid var(--border-color, #f1f5f9)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '2rem', padding: '8px 10px', background: 'rgba(56, 189, 248, 0.15)', borderRadius: '14px', border: '1.5px solid rgba(56, 189, 248, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏨</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.42rem', fontWeight: 950, color: 'var(--text-primary, #0f172a)', letterSpacing: '-0.02em' }}>
                    {editingRoom ? `Edit Room #${editingRoom.room_number}` : 'Add New Room'}
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-secondary, #475569)' }}>
                    Configure room specifications, guest capacities, tariff, and add-on rates
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsRoomModalOpen(false)}
                style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--bg-surface-secondary, #f1f5f9)', border: '1.5px solid var(--border-color, #e2e8f0)', cursor: 'pointer', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary, #475569)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-secondary, #f1f5f9)'; e.currentTarget.style.color = 'var(--text-primary, #475569)'; }}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveRoom} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div
                className="modal-body"
                style={{
                  padding: '20px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  flex: 1,
                  boxSizing: 'border-box'
                }}
              >
                
                {/* 1. Basic Room Info */}
                <div style={{ background: 'var(--bg-surface-secondary, #f8fafc)', padding: '16px 18px', borderRadius: '14px', border: '1.5px solid var(--border-color, #cbd5e1)', boxSizing: 'border-box', width: '100%' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--apple-blue, #1e3a8a)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.05rem' }}>🏷️</span> ROOM IDENTIFICATION &amp; BASE TARIFF
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Room Number *</label>
                      <input
                        type="text"
                        className="form-input"
                        required
                        placeholder="e.g. 101"
                        value={roomForm.room_number}
                        onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, border: '2px solid var(--border-color, #cbd5e1)', borderRadius: '10px', padding: '0 12px', background: 'var(--bg-app, #ffffff)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Room Type / Category *</label>
                      <input
                        type="text"
                        className="form-input"
                        required
                        placeholder="e.g. Deluxe AC"
                        value={roomForm.room_type}
                        onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.02rem', fontWeight: 850, border: '2px solid var(--border-color, #cbd5e1)', borderRadius: '10px', padding: '0 12px', background: 'var(--bg-app, #ffffff)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Base Tariff (₹ / Night) *</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        required
                        value={roomForm.price}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, price: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.12rem', fontWeight: 950, color: 'var(--apple-blue, #0071e3)', border: '2px solid var(--apple-blue)', borderRadius: '10px', padding: '0 12px', background: 'var(--bg-app, #ffffff)' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Room GST Rate (%) *</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type="number"
                          min="0"
                          max="28"
                          step="0.5"
                          className="form-input"
                          required
                          value={roomForm.gst_pct}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setRoomForm({ ...roomForm, gst_pct: e.target.value === '' ? '' : Number(e.target.value) })}
                          style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, border: '2px solid var(--border-color, #cbd5e1)', borderRadius: '10px', padding: '0 30px 0 12px', background: 'var(--bg-app, #ffffff)', color: 'var(--text-primary)' }}
                        />
                        <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 850, color: 'var(--text-secondary)' }}>
                          %
                        </span>
                      </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>Max Discount Allowed (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="form-input"
                        value={roomForm.max_discount_pct}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, max_discount_pct: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 850, border: '2px solid var(--border-color, #cbd5e1)', borderRadius: '10px', padding: '0 12px', background: 'var(--bg-app, #ffffff)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Occupancy Limits */}
                <div style={{ background: 'rgba(34, 197, 94, 0.08)', padding: '16px 18px', borderRadius: '14px', border: '1.5px solid rgba(34, 197, 94, 0.3)', boxSizing: 'border-box', width: '100%' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.05rem' }}>👥</span> CAPACITY &amp; OCCUPANCY LIMITS
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                        Max Adults 👥
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        className="form-input"
                        required
                        value={roomForm.max_adults}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, max_adults: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: 'var(--bg-app, #ffffff)', border: '2px solid rgba(34, 197, 94, 0.5)', borderRadius: '10px', color: 'var(--text-primary)', textAlign: 'center' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                        Max Child 🧒
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        className="form-input"
                        value={roomForm.max_children}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, max_children: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: 'var(--bg-app, #ffffff)', border: '2px solid rgba(34, 197, 94, 0.5)', borderRadius: '10px', color: 'var(--text-primary)', textAlign: 'center' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                        Max Extra Bed 🛏️
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        className="form-input"
                        value={roomForm.max_extra_beds}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, max_extra_beds: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: 'var(--bg-app, #ffffff)', border: '2px solid rgba(34, 197, 94, 0.5)', borderRadius: '10px', color: 'var(--text-primary)', textAlign: 'center' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Add-on Rates */}
                <div style={{ background: 'rgba(168, 85, 247, 0.08)', padding: '16px 18px', borderRadius: '14px', border: '1.5px solid rgba(168, 85, 247, 0.3)', boxSizing: 'border-box', width: '100%' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--apple-purple, #86198f)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.05rem' }}>🛏️</span> EXTRA BED &amp; BREAKFAST RATES
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                        Extra Bed Rate (₹ / Night)
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        value={roomForm.extra_bed_price}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const val = raw === '' ? '' : Number(raw);
                          setRoomForm({ ...roomForm, extra_bed_price: val, extra_bed_rate: val });
                        }}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: 'var(--bg-app, #ffffff)', border: '2px solid rgba(168, 85, 247, 0.5)', borderRadius: '10px', padding: '0 12px', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 850, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                        Breakfast Price (₹ / Guest)
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        value={roomForm.breakfast_price}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, breakfast_price: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: 'var(--bg-app, #ffffff)', border: '2px solid rgba(168, 85, 247, 0.5)', borderRadius: '10px', padding: '0 12px', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Stay Extension Hourly Slabs */}
                <div style={{ padding: '16px 18px', background: 'var(--bg-surface-secondary, #f8fafc)', borderRadius: '14px', border: '1.5px solid var(--border-color, #cbd5e1)', boxSizing: 'border-box', width: '100%' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--apple-blue, #1e3a8a)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.05rem' }}>⏱️</span> STAY EXTENSION HOURLY SLABS (₹)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: 850, display: 'block', marginBottom: '6px' }}>1–3 Hours Rate (₹)</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        value={roomForm.ext_3h_rate}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, ext_3h_rate: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: '#ffffff', border: '2px solid #cbd5e1', borderRadius: '10px', padding: '0 12px', color: '#0f172a' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', color: '#0f172a', fontWeight: 850, display: 'block', marginBottom: '6px' }}>3–6 Hours Rate (₹)</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        value={roomForm.ext_6h_rate}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, ext_6h_rate: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: '#ffffff', border: '2px solid #cbd5e1', borderRadius: '10px', padding: '0 12px', color: '#0f172a' }}
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', color: '#0f172a', fontWeight: 850, display: 'block', marginBottom: '6px' }}>6–9 Hours Rate (₹)</label>
                      <input
                        type="number"
                        min="0"
                        className="form-input"
                        value={roomForm.ext_9h_rate}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setRoomForm({ ...roomForm, ext_9h_rate: e.target.value === '' ? '' : Number(e.target.value) })}
                        style={{ width: '100%', boxSizing: 'border-box', height: '44px', fontSize: '1.05rem', fontWeight: 900, background: '#ffffff', border: '2px solid #cbd5e1', borderRadius: '10px', padding: '0 12px', color: '#0f172a' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ padding: '16px 24px', background: '#f8fafc', borderTop: '2px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsRoomModalOpen(false)}
                  style={{ padding: '10px 24px', borderRadius: '10px', fontSize: '0.94rem', fontWeight: 850, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    padding: '10px 30px',
                    borderRadius: '10px',
                    fontSize: '1rem',
                    fontWeight: 950,
                    background: 'linear-gradient(135deg, #0071e3 0%, #0284c7 100%)',
                    boxShadow: '0 4px 14px rgba(0, 113, 227, 0.35)',
                    cursor: 'pointer'
                  }}
                >
                  💾 Save Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Modal */}
      {isStaffModalOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10050 }}>
          <div className="modal-container" style={{ maxWidth: '460px', width: '92%', borderRadius: '18px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>
                  {editingStaff ? '✏️' : '🏨'}
                </span>
                <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 800 }}>
                  {editingStaff
                    ? `Edit Staff: ${editingStaff.full_name || editingStaff.username}`
                    : 'Register New Front Desk Staff'}
                </h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setIsStaffModalOpen(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveStaff}>
              <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Full Employee Name *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="e.g. Aamir Khan"
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                    style={{ height: '42px', fontSize: '0.92rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Cashier Login ID / Username *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="e.g. aamir, priya, front1"
                    disabled={editingStaff && editingStaff.username === 'admin'}
                    value={staffForm.username}
                    onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                    style={{ height: '42px', fontSize: '0.92rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    {editingStaff ? 'Reset Password (optional)' : 'Login Password *'}
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="form-input"
                    required={!editingStaff}
                    placeholder={editingStaff ? 'Leave blank to keep current password' : 'Enter account password'}
                    value={staffForm.password}
                    onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                    style={{ height: '42px', fontSize: '0.92rem' }}
                  />
                </div>

                <div style={{ marginTop: '2px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 750, color: '#0f172a' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(staffForm.can_access_manager == 1 || staffForm.role === 'manager')}
                      disabled={staffForm.role === 'manager'}
                      onChange={(e) => setStaffForm({ ...staffForm, can_access_manager: e.target.checked ? 1 : 0 })}
                      style={{ width: '17px', height: '17px', cursor: 'pointer' }}
                    />
                    <span>Allow Manager Panel Access</span>
                  </label>
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsStaffModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ fontWeight: 750 }}>
                  {editingStaff ? '💾 Save Changes' : '➕ Register Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Housekeeping / Cleaner Staff Add/Edit Modal */}
      {isCleanerModalOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10050, background: 'rgba(15, 23, 42, 0.70)', backdropFilter: 'blur(6px)' }}>
          <div className="modal-container" style={{ maxWidth: '440px', width: '92%', borderRadius: '18px', overflow: 'hidden' }}>
            <div
              className="modal-header"
              style={{
                padding: '18px 20px',
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>🧹</span>
                <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 850, color: '#ffffff' }}>
                  {editingCleaner ? `Edit Cleaner: ${editingCleaner.name}` : 'Add Housekeeping Cleaner Staff'}
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsCleanerModalOpen(false)}
                style={{ color: '#ffffff', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveCleaner}>
              <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Cleaner Staff Full Name *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="e.g. Sunita Shinde / Ramesh Kumar"
                    value={cleanerForm.name}
                    onChange={(e) => setCleanerForm({ ...cleanerForm, name: e.target.value })}
                    style={{ height: '42px', fontSize: '0.94rem' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                    This name will appear as an option in the &ldquo;Cleaner Staff Name&rdquo; dropdown.
                  </span>
                </div>

                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                    Mobile / Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    className="form-input"
                    placeholder="e.g. 9876543210"
                    value={cleanerForm.phone}
                    onChange={(e) => setCleanerForm({ ...cleanerForm, phone: e.target.value })}
                    style={{ height: '42px', fontSize: '0.92rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '6px' }}>
                    Status
                  </label>
                  <ThemedSelect
                    value={cleanerForm.status}
                    onChange={(val) => setCleanerForm({ ...cleanerForm, status: val })}
                    colorTheme="emerald"
                    options={[
                      { value: 'active', label: 'Active (Visible in Dropdown)', icon: '●' },
                      { value: 'inactive', label: 'Inactive (Hidden from Dropdown)', icon: '○' }
                    ]}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: '8px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsCleanerModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#059669',
                    fontWeight: 800,
                    padding: '9px 20px',
                    borderRadius: '10px'
                  }}
                >
                  {editingCleaner ? '💾 Save Changes' : '➕ Add Cleaner Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Corporate BTC Register / Edit Modal */}
      {isBtcModalOpen && (
        <div
          className="modal-overlay active"
          id="modal-btc-company"
          style={{ zIndex: 10050, background: 'rgba(15, 23, 42, 0.70)', backdropFilter: 'blur(8px)' }}
          onClick={(e) => {
            if (e.target.id === 'modal-btc-company') setIsBtcModalOpen(false);
          }}
        >
          <div
            className="modal-container"
            style={{
              maxWidth: '680px',
              width: '94%',
              borderRadius: '20px',
              border: '1.5px solid #cbd5e1',
              boxShadow: '0 30px 60px -15px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff'
            }}
          >
            <div
              className="modal-header"
              style={{
                padding: '20px 24px',
                background: '#ffffff',
                borderBottom: '2px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span
                  style={{
                    fontSize: '1.8rem',
                    padding: '8px 10px',
                    background: '#eff6ff',
                    borderRadius: '14px',
                    border: '1.5px solid #bfdbfe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  🏢
                </span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: '#0f172a' }}>
                    {editingBtc ? 'Edit Corporate BTC Account' : 'Register Corporate BTC Account'}
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: '0.84rem', fontWeight: 600, color: '#64748b' }}>
                    Configure corporate billing details, GSTIN, and credit limits for direct billing
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsBtcModalOpen(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  color: '#64748b',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  fontSize: '1.2rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveBtc}>
              <div className="modal-body" style={{ padding: '22px 24px', maxHeight: '72vh', overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                  {/* Company Name */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Corporate Company / Client Name *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      placeholder="e.g. Tata Consultancy Services / Infosys Ltd"
                      value={btcForm.name}
                      onChange={(e) => setBtcForm({ ...btcForm, name: e.target.value })}
                      style={{ height: '42px', fontSize: '0.94rem', fontWeight: 700 }}
                    />
                  </div>

                  {/* GSTIN */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      GSTIN (GST Number)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. 27AABCT3518Q1Z6"
                      value={btcForm.gstin}
                      onChange={(e) => setBtcForm({ ...btcForm, gstin: e.target.value.toUpperCase() })}
                      style={{ height: '42px', fontSize: '0.92rem', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  {/* PAN */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      PAN Number
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. AABCT3518Q"
                      value={btcForm.pan}
                      onChange={(e) => setBtcForm({ ...btcForm, pan: e.target.value.toUpperCase() })}
                      style={{ height: '42px', fontSize: '0.92rem', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  {/* Contact Person */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Contact Person / Admin Name
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Rajesh Gupta (Travel Desk)"
                      value={btcForm.contact_person}
                      onChange={(e) => setBtcForm({ ...btcForm, contact_person: e.target.value })}
                      style={{ height: '42px', fontSize: '0.92rem' }}
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Phone / Mobile Number
                    </label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="e.g. +91 98765 43210"
                      value={btcForm.phone}
                      onChange={(e) => setBtcForm({ ...btcForm, phone: e.target.value })}
                      style={{ height: '42px', fontSize: '0.92rem' }}
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Official Billing Email
                    </label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="e.g. billing@company.com"
                      value={btcForm.email}
                      onChange={(e) => setBtcForm({ ...btcForm, email: e.target.value })}
                      style={{ height: '42px', fontSize: '0.92rem' }}
                    />
                  </div>

                  {/* Credit Limit */}
                  <div>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Credit Limit (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      className="form-input"
                      placeholder="e.g. 50000"
                      value={btcForm.credit_limit}
                      onChange={(e) => setBtcForm({ ...btcForm, credit_limit: e.target.value })}
                      style={{ height: '42px', fontSize: '0.94rem', fontWeight: 800, color: '#0071e3' }}
                    />
                  </div>

                  {/* Address */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '0.80rem', fontWeight: 800, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Registered Billing Address
                    </label>
                    <textarea
                      className="form-input"
                      rows={2}
                      placeholder="e.g. Corporate Office, MIDC Industrial Area, Pune 411014"
                      value={btcForm.address}
                      onChange={(e) => setBtcForm({ ...btcForm, address: e.target.value })}
                      style={{ padding: '8px 12px', fontSize: '0.92rem', resize: 'vertical' }}
                    />
                  </div>
                </div>
              </div>

              <div
                className="modal-footer"
                style={{
                  padding: '14px 24px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                  background: '#f8fafc',
                  borderTop: '1px solid #e2e8f0'
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsBtcModalOpen(false)}
                  style={{ height: '42px', padding: '0 18px', fontWeight: 750 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  id="btn-submit-btc-modal"
                  style={{
                    height: '42px',
                    padding: '0 24px',
                    fontWeight: 800,
                    borderRadius: '10px'
                  }}
                >
                  {editingBtc ? '💾 Save Changes' : '➕ Register Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
