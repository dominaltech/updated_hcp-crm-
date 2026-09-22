import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { printFullMenuA4, printThermalBillSlip, printPosThermalClosingSlip } from '../../services/printService';
import { blockNumericKeys, sanitizeNameInput } from '../../utils/inputEnhancements';

export default function PosManagerPanel({ department = 'restaurant', onMenuChanged, onTablesChanged }) {
  const {
    currentUser,
    departmentStaff,
    openStaffLogin,
    showToast,
    showConfirm,
    isManagerUnlocked,
    openManagerLock,
    lockManager
  } = useApp();

  // Automatically popup lock if not unlocked
  useEffect(() => {
    if (!isManagerUnlocked) {
      openManagerLock(department);
    }
  }, [isManagerUnlocked, openManagerLock, department]);

  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'rates' | 'tables' | 'staff' | 'settings'

  // Analytics states
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsFromDate, setAnalyticsFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [analyticsToDate, setAnalyticsToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');

  // Data states
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tables, setTables] = useState([]);
  const [settings, setSettings] = useState({
    restaurant_gst_pct: 5,
    bar_gst_pct: 5,
    bar_pax_charge: 0
  });

  const [isLoading, setIsLoading] = useState(false);

  // Search & Filter states
  const [rateSearch, setRateSearch] = useState('');
  const [rateCategoryFilter, setRateCategoryFilter] = useState('all');
  const [editingRates, setEditingRates] = useState({}); // { [id]: number }

  // Category modal / input
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [renamingCat, setRenamingCat] = useState(null); // { id, name }
  const [renamedName, setRenamedName] = useState('');

  // Table modal / input
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);
  const [newTableNum, setNewTableNum] = useState('');
  const [newTableType, setNewTableType] = useState(department === 'bar' ? 'table' : 'dine_in');
  const [newTableCap, setNewTableCap] = useState(4);
  const [editingTable, setEditingTable] = useState(null);

  // New item modal & Edit item modal
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemVeg, setNewItemVeg] = useState(1);
  const [newItemCode, setNewItemCode] = useState('');

  // Department Staff state
  const [staffList, setStaffList] = useState([]);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [staffForm, setStaffForm] = useState({
    username: '',
    full_name: '',
    phone: '',
    password: '',
    status: 'active',
    can_access_manager: 0
  });

  // Load Departmental POS Analytics
  const loadAnalytics = useCallback(async (fromStr, toStr) => {
    setIsAnalyticsLoading(true);
    try {
      const from = fromStr || analyticsFromDate;
      const to = toStr || analyticsToDate;
      const res = await api.getPosAnalytics(department, { startDate: from, endDate: to });
      if (res && res.success) {
        setAnalyticsData(res);
      }
    } catch (e) {
      console.warn('POS analytics fetch error:', e);
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, [department, analyticsFromDate, analyticsToDate]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalytics(analyticsFromDate, analyticsToDate);
    }
  }, [activeTab, analyticsFromDate, analyticsToDate, loadAnalytics]);

  // Fetch all manager data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    if (activeTab === 'analytics') {
      loadAnalytics(analyticsFromDate, analyticsToDate);
    }
    try {
      if (department === 'bar') {
        const [mRes, cRes, tRes, sRes, staffRes] = await Promise.all([
          api.getBarMenu(),
          api.getBarCategories(),
          api.getBarTables(),
          api.getPosSettings(),
          api.getStaff({ department }).catch(() => [])
        ]);
        setMenuItems(Array.isArray(mRes) ? mRes : (mRes?.items || mRes?.drinks || []));
        setCategories(Array.isArray(cRes) ? cRes : (cRes?.categories || []));
        setTables(Array.isArray(tRes) ? tRes : (tRes?.tables || []));
        if (sRes?.settings) setSettings(sRes.settings);
        setStaffList(Array.isArray(staffRes) ? staffRes : (staffRes?.staff || []));
      } else {
        const [mRes, cRes, tRes, sRes, staffRes] = await Promise.all([
          api.getRestaurantMenu(),
          api.getRestaurantCategories(),
          api.getRestaurantTables(),
          api.getPosSettings(),
          api.getStaff({ department }).catch(() => [])
        ]);
        setMenuItems(Array.isArray(mRes) ? mRes : (mRes?.items || mRes?.dishes || []));
        setCategories(Array.isArray(cRes) ? cRes : (cRes?.categories || []));
        setTables(Array.isArray(tRes) ? tRes : (tRes?.tables || []));
        if (sRes?.settings) setSettings(sRes.settings);
        setStaffList(Array.isArray(staffRes) ? staffRes : (staffRes?.staff || []));
      }
    } catch (err) {
      showToast('Error loading manager data: ' + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [department, activeTab, analyticsFromDate, analyticsToDate, loadAnalytics, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // --------------------------------------------------------------------------
  // TAB 1: DISHES / DRINKS RATES MANAGEMENT
  // --------------------------------------------------------------------------
  const filteredRates = useMemo(() => {
    return menuItems.filter((item) => {
      if (rateCategoryFilter !== 'all' && item.category !== rateCategoryFilter) return false;
      if (rateSearch.trim()) {
        const q = rateSearch.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesCode = item.shortcode && String(item.shortcode).toLowerCase().includes(q.replace('#', ''));
        return matchesName || matchesCode;
      }
      return true;
    });
  }, [menuItems, rateCategoryFilter, rateSearch]);

  const handleRateInputChange = (id, val) => {
    setEditingRates((prev) => ({ ...prev, [id]: val }));
  };

  const handleSaveRate = async (item) => {
    const updatedPrice = editingRates[item.id];
    if (updatedPrice === undefined || updatedPrice === '' || isNaN(parseFloat(updatedPrice))) {
      showToast('Please enter a valid price', 'red');
      return;
    }

    try {
      const priceNum = parseFloat(updatedPrice);
      if (department === 'bar') {
        await api.updateBarDrink(item.id, { price: priceNum });
      } else {
        await api.updateRestaurantDish(item.id, { price: priceNum });
      }
      showToast(`Rate updated for "${item.name}" -> ${formatCurrency(priceNum)}`, 'green');
      setEditingRates((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error updating rate: ' + err.message, 'red');
    }
  };

  const handleDeleteItem = async (item) => {
    const confirmed = await showConfirm({
      title: `Delete "${item.name}"?`,
      message: `Are you sure you want to permanently delete this ${department === 'bar' ? 'drink' : 'dish'} from the menu?`,
      icon: '🗑️',
      confirmText: 'Delete Item',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      if (department === 'bar') {
        await api.deleteBarDrink(item.id);
      } else {
        await api.deleteRestaurantDish(item.id);
      }
      showToast(`"${item.name}" deleted from menu`, 'green');
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error deleting item: ' + err.message, 'red');
    }
  };

  const handleOpenAddItem = () => {
    setNewItemName('');
    setNewItemPrice('');
    setNewItemCategory(rateCategoryFilter !== 'all' ? rateCategoryFilter : (categories[0]?.name || 'Main Course'));
    setNewItemVeg(1);
    setNewItemCode('');
    setIsAddItemOpen(true);
  };

  const handleCreateNewItem = async (e) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) {
      showToast('Item name and price are required', 'red');
      return;
    }

    try {
      const payload = {
        name: newItemName.trim(),
        price: parseFloat(newItemPrice) || 0,
        category: newItemCategory || (categories[0]?.name || 'Main Course'),
        is_veg: newItemVeg,
        shortcode: newItemCode.trim() || undefined
      };

      if (department === 'bar') {
        await api.saveBarDrink(payload);
      } else {
        await api.saveRestaurantDish(payload);
      }

      showToast(`New ${department === 'bar' ? 'drink' : 'dish'} "${newItemName}" added successfully!`, 'green');
      setIsAddItemOpen(false);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemCode('');
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error creating item: ' + err.message, 'red');
    }
  };

  const handleUpdateItem = async (e) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name.trim()) return;

    try {
      const payload = {
        name: editingItem.name.trim(),
        price: parseFloat(editingItem.price) || 0,
        category: editingItem.category || (categories[0]?.name || 'Main Course'),
        is_veg: editingItem.is_veg !== undefined ? (editingItem.is_veg ? 1 : 0) : 1,
        shortcode: editingItem.shortcode ? String(editingItem.shortcode).trim() : undefined,
        description: editingItem.description || ''
      };

      if (department === 'bar') {
        await api.updateBarDrink(editingItem.id, payload);
      } else {
        await api.updateRestaurantDish(editingItem.id, payload);
      }

      showToast(`"${payload.name}" updated successfully!`, 'green');
      setEditingItem(null);
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error updating item: ' + err.message, 'red');
    }
  };

  // --------------------------------------------------------------------------
  // CATEGORIES MANAGEMENT (Integrated into Dishes & Rates)
  // --------------------------------------------------------------------------
  const categoryCounts = useMemo(() => {
    const map = {};
    for (const it of menuItems) {
      if (it.category) {
        map[it.category] = (map[it.category] || 0) + 1;
      }
    }
    return map;
  }, [menuItems]);

  // Filter out transient dynamic room service orders (RS-*) and takeaway parcels (P-*, BP-*)
  const physicalTables = useMemo(() => {
    return tables.filter(
      (t) => t.table_type !== 'room_service' && t.table_type !== 'parcel' && !String(t.table_number || '').startsWith('RS-') && !String(t.table_number || '').startsWith('P-') && !String(t.table_number || '').startsWith('BP-')
    );
  }, [tables]);

  const getTableTypeDisplay = (type) => {
    const map = {
      dine_in: '🍽️ Dine-in Table',
      family: '👨‍👩‍👧 Family Section',
      ac_hall: '❄️ AC Dining Hall',
      garden: '🌿 Garden / Rooftop',
      table: '🍸 Bar Table',
      counter: '🍷 Bar Counter Seat',
      lounge: '🛋️ Lounge Sofa / VIP'
    };
    return map[type] || (type ? type.replace(/_/g, ' ') : (department === 'bar' ? 'Bar Table' : 'Dine In'));
  };

  const handleAddCategory = async (e) => {
    if (e) e.preventDefault();
    if (!newCatName.trim()) {
      showToast('Please enter a category name', 'red');
      return;
    }

    try {
      const catTrimmed = newCatName.trim();
      if (department === 'bar') {
        await api.saveBarCategory({ name: catTrimmed });
      } else {
        await api.saveRestaurantCategory({ name: catTrimmed });
      }
      showToast(`Category "${catTrimmed}" created!`, 'green');
      setNewCatName('');
      setIsAddCategoryOpen(false);
      setRateCategoryFilter(catTrimmed);
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error creating category: ' + err.message, 'red');
    }
  };

  const handleRenameCategory = async () => {
    if (!renamingCat || !renamedName.trim()) return;
    try {
      if (department === 'bar') {
        await api.renameBarCategory(renamingCat.id, { name: renamedName.trim() });
      } else {
        await api.renameRestaurantCategory(renamingCat.id, { name: renamedName.trim() });
      }
      showToast(`Category renamed to "${renamedName.trim()}"`, 'green');
      setRenamingCat(null);
      setRenamedName('');
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error renaming category: ' + err.message, 'red');
    }
  };

  const handleDeleteCategory = async (cat) => {
    const count = categoryCounts[cat.name] || 0;
    const confirmed = await showConfirm({
      title: `Delete Category "${cat.name}"?`,
      message: count > 0
        ? `This category currently has ${count} items. Deleting it will remove the category tag from those items. Proceed?`
        : `Are you sure you want to delete category "${cat.name}"?`,
      icon: '🗑️',
      confirmText: 'Delete Category',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      if (department === 'bar') {
        await api.deleteBarCategory(cat.id);
      } else {
        await api.deleteRestaurantCategory(cat.id);
      }
      showToast(`Category "${cat.name}" deleted`, 'green');
      loadData();
      if (onMenuChanged) onMenuChanged();
    } catch (err) {
      showToast('Error deleting category: ' + err.message, 'red');
    }
  };

  // --------------------------------------------------------------------------
  // TAB 3: TABLES & COUNTERS MANAGEMENT
  // --------------------------------------------------------------------------
  const handleCreateTable = async (e) => {
    e.preventDefault();
    if (!newTableNum.trim()) {
      showToast('Table number is required', 'red');
      return;
    }

    try {
      const payload = {
        table_number: newTableNum.trim().toUpperCase(),
        table_type: newTableType,
        capacity: parseInt(newTableCap, 10) || 4
      };

      if (department === 'bar') {
        await api.saveBarTable(payload);
      } else {
        await api.saveRestaurantTable(payload);
      }

      showToast(`Table "${payload.table_number}" created!`, 'green');
      setIsAddTableOpen(false);
      setNewTableNum('');
      setNewTableCap(4);
      setNewTableType(department === 'bar' ? 'table' : 'dine_in');
      loadData();
      if (onTablesChanged) onTablesChanged();
    } catch (err) {
      showToast('Error creating table: ' + err.message, 'red');
    }
  };

  const handleUpdateTable = async (e) => {
    e.preventDefault();
    if (!editingTable || !editingTable.table_number.trim()) return;

    try {
      const payload = {
        table_number: editingTable.table_number.trim().toUpperCase(),
        table_type: editingTable.table_type || (department === 'bar' ? 'table' : 'dine_in'),
        capacity: parseInt(editingTable.capacity, 10) || 4
      };

      if (department === 'bar') {
        await api.updateBarTable(editingTable.id, payload);
      } else {
        await api.updateRestaurantTable(editingTable.id, payload);
      }

      showToast(`Table "${payload.table_number}" updated!`, 'green');
      setEditingTable(null);
      loadData();
      if (onTablesChanged) onTablesChanged();
    } catch (err) {
      showToast('Error updating table: ' + err.message, 'red');
    }
  };

  const handleDeleteTable = async (table) => {
    if (table.status && table.status !== 'available') {
      showToast(`Cannot delete table "${table.table_number}" while it is ${table.status.toUpperCase()}. Settle or cancel order first.`, 'red');
      return;
    }

    const confirmed = await showConfirm({
      title: `Delete Table "${table.table_number}"?`,
      message: `Are you sure you want to permanently delete table ${table.table_number}?`,
      icon: '🗑️',
      confirmText: 'Delete Table',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      if (department === 'bar') {
        await api.deleteBarTable(table.id);
      } else {
        await api.deleteRestaurantTable(table.id);
      }
      showToast(`Table "${table.table_number}" deleted!`, 'green');
      loadData();
      if (onTablesChanged) onTablesChanged();
    } catch (err) {
      showToast('Error deleting table: ' + err.message, 'red');
    }
  };

  // --------------------------------------------------------------------------
  // TAB 4: TAX & GST SETTINGS
  // --------------------------------------------------------------------------
  const handleSaveSettings = async () => {
    try {
      await api.savePosSettings(settings);
      showToast('Tax & GST settings saved successfully!', 'green');
    } catch (err) {
      showToast('Error saving settings: ' + err.message, 'red');
    }
  };

  // --------------------------------------------------------------------------
  // TAB 5: STAFF CRUD HANDLERS
  // --------------------------------------------------------------------------
  const handleOpenStaffModal = (staff = null) => {
    if (staff) {
      setEditingStaff(staff);
      setStaffForm({
        username: staff.username,
        full_name: staff.full_name || '',
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
        phone: '',
        password: '',
        status: 'active',
        can_access_manager: 0
      });
    }
    setIsStaffModalOpen(true);
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...staffForm,
        role: department,
        can_access_manager: staffForm.can_access_manager ? 1 : 0
      };
      if (editingStaff) {
        await api.updateStaff(editingStaff.id, payload);
        showToast(`${department === 'bar' ? 'Bar' : 'Restaurant'} staff "${staffForm.full_name || staffForm.username}" updated!`, 'green');
      } else {
        await api.createStaff(payload);
        showToast(`New ${department === 'bar' ? 'Bar' : 'Restaurant'} staff "${staffForm.username}" registered!`, 'green');
      }
      setIsStaffModalOpen(false);
      setEditingStaff(null);
      const staffRes = await api.getStaff({ department });
      setStaffList(Array.isArray(staffRes) ? staffRes : (staffRes?.staff || []));
    } catch (err) {
      showToast('Error saving staff: ' + err.message, 'red');
    }
  };

  const handleDeleteStaff = async (staff) => {
    const confirmed = await showConfirm({
      title: `Delete Staff Account "${staff.username}"?`,
      message: `Are you sure you want to remove ${staff.full_name || staff.username} from ${department === 'bar' ? 'Bar Lounge' : 'Restaurant'} staff?`,
      icon: '🗑️',
      confirmText: 'Delete Staff',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      await api.deleteStaff(staff.id);
      showToast('Staff account removed.', 'green');
      const staffRes = await api.getStaff({ department });
      setStaffList(Array.isArray(staffRes) ? staffRes : (staffRes?.staff || []));
    } catch (err) {
      showToast('Error deleting staff: ' + err.message, 'red');
    }
  };

  const filteredLedgerOrders = useMemo(() => {
    const list = analyticsData?.orders || [];
    if (!ledgerSearch.trim()) return list;
    const q = ledgerSearch.toLowerCase().trim();
    return list.filter((ord) => {
      const orderNum = String(ord.order_number || ord.orderNumber || '').toLowerCase();
      const token = String(ord.token_number || '').toLowerCase();
      const tbl = String(ord.table_number || '').toLowerCase();
      const cust = String(ord.customer_name || '').toLowerCase();
      const waiter = String(ord.waiter_name || '').toLowerCase();
      const cashier = String(ord.cashier_name || '').toLowerCase();
      const mode = String(ord.payment_mode || '').toLowerCase();
      const utr = String(ord.utr_number || '').toLowerCase();
      return orderNum.includes(q) || token.includes(q) || tbl.includes(q) || cust.includes(q) || waiter.includes(q) || cashier.includes(q) || mode.includes(q) || utr.includes(q);
    });
  }, [analyticsData?.orders, ledgerSearch]);

  if (!isManagerUnlocked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', padding: '24px' }}>
        <div
          className="folio-card"
          style={{
            background: '#ffffff',
            border: '1.5px solid rgba(234, 179, 8, 0.5)',
            borderRadius: '18px',
            padding: '36px 32px',
            textAlign: 'center',
            maxWidth: '520px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)'
          }}
        >
          <div style={{ fontSize: '3.2rem', marginBottom: '12px' }}>🔒</div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', marginBottom: '8px' }}>
            {department === 'bar' ? 'Bar Lounge' : 'Restaurant'} Manager Panel Locked
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '24px' }}>
            Type manager password to access this panel. Access locks immediately when you leave this panel.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => openManagerLock(department)}
              style={{
                padding: '11px 24px',
                borderRadius: '12px',
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
      </div>
    );
  }

  return (
    <div className="pos-manager-container" style={{ padding: '4px 0 20px 0' }}>
      
      {/* Sub-tabs header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '18px',
          borderBottom: '2px solid #e2e8f0',
          paddingBottom: '12px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`subnav-pill ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.86rem',
              fontWeight: 800,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'analytics' ? '#0071e3' : '#f1f5f9',
              color: activeTab === 'analytics' ? '#fff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>📊</span>
            <span>Financial Analytics</span>
          </button>

          <button
            type="button"
            className={`subnav-pill ${activeTab === 'rates' ? 'active' : ''}`}
            onClick={() => setActiveTab('rates')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.86rem',
              fontWeight: 800,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'rates' ? '#0071e3' : '#f1f5f9',
              color: activeTab === 'rates' ? '#fff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>💰</span>
            <span>{department === 'bar' ? 'Drinks & Rates' : 'Dishes & Rates'}</span>
          </button>

          <button
            type="button"
            className={`subnav-pill ${activeTab === 'tables' ? 'active' : ''}`}
            onClick={() => setActiveTab('tables')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.86rem',
              fontWeight: 800,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'tables' ? '#0071e3' : '#f1f5f9',
              color: activeTab === 'tables' ? '#fff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>🪑</span>
            <span>Tables &amp; Counters ({tables.length})</span>
          </button>

          <button
            type="button"
            className={`subnav-pill ${activeTab === 'staff' ? 'active' : ''}`}
            onClick={() => setActiveTab('staff')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.86rem',
              fontWeight: 800,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'staff' ? '#0071e3' : '#f1f5f9',
              color: activeTab === 'staff' ? '#fff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>👥</span>
            <span>{department === 'bar' ? 'Bar Staff' : 'Restaurant Staff'} ({staffList.length})</span>
          </button>

          <button
            type="button"
            className={`subnav-pill ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '0.86rem',
              fontWeight: 800,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'settings' ? '#0071e3' : '#f1f5f9',
              color: activeTab === 'settings' ? '#fff' : '#475569',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>⚙️</span>
            <span>Tax &amp; GST Settings</span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadData}
          className="btn-secondary"
          style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <span>🔄</span> Refresh
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 0: FINANCIAL ANALYTICS & AUDIT (DEPARTMENT SCOPED) */}
      {/* ========================================================================= */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Top Control & Date Filter Bar */}
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
              <h3 style={{ fontSize: '1.22rem', fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📊</span> {department === 'bar' ? 'Bar & Lounge Financial Analytics' : 'Restaurant Dining Financial Analytics'}
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                Audited metrics, revenue breakdowns, and transaction ledger strictly for <strong>{department === 'bar' ? 'Bar & Lounge' : 'Restaurant Dining'}</strong>
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Date Inputs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
                <span>From:</span>
                <input
                  type="date"
                  value={analyticsFromDate}
                  onChange={(e) => {
                    setAnalyticsFromDate(e.target.value);
                    loadAnalytics(e.target.value, analyticsToDate);
                  }}
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 700, background: '#f8fafc' }}
                />
                <span>To:</span>
                <input
                  type="date"
                  value={analyticsToDate}
                  onChange={(e) => {
                    setAnalyticsToDate(e.target.value);
                    loadAnalytics(analyticsFromDate, e.target.value);
                  }}
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 700, background: '#f8fafc' }}
                />
              </div>

              {/* Preset buttons */}
              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setAnalyticsFromDate(today);
                    setAnalyticsToDate(today);
                    loadAnalytics(today, today);
                  }}
                  style={{ padding: '6px 10px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 750 }}
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
                  style={{ padding: '6px 10px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 750 }}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const e = new Date();
                    const s = new Date();
                    s.setDate(s.getDate() - 7);
                    const sStr = s.toISOString().slice(0, 10);
                    const eStr = e.toISOString().slice(0, 10);
                    setAnalyticsFromDate(sStr);
                    setAnalyticsToDate(eStr);
                    loadAnalytics(sStr, eStr);
                  }}
                  style={{ padding: '6px 10px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 750 }}
                >
                  Last 7 Days
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const now = new Date();
                    const s = new Date(now.getFullYear(), now.getMonth(), 1);
                    const sStr = s.toISOString().slice(0, 10);
                    const eStr = now.toISOString().slice(0, 10);
                    setAnalyticsFromDate(sStr);
                    setAnalyticsToDate(eStr);
                    loadAnalytics(sStr, eStr);
                  }}
                  style={{ padding: '6px 10px', fontSize: '0.78rem', borderRadius: '8px', fontWeight: 750 }}
                >
                  This Month
                </button>
              </div>

              {/* 80mm Print Audit Slip */}
              <button
                type="button"
                className="btn-primary"
                onClick={() => printPosThermalClosingSlip(analyticsData, department)}
                disabled={!analyticsData}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.82rem',
                  borderRadius: '8px',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#0f172a',
                  color: '#ffffff',
                  cursor: analyticsData ? 'pointer' : 'not-allowed'
                }}
              >
                <span>🖨️</span> Print Shift Audit (80mm)
              </button>
            </div>
          </div>

          {isAnalyticsLoading && (
            <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '0.9rem', fontWeight: 700 }}>
              <span>🔄 Loading {department} analytics...</span>
            </div>
          )}

          {/* KPI Summary Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {/* Card 1: Realized Revenue */}
            <div className="folio-card" style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                Total Realized Revenue
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 900, margin: '4px 0 2px' }}>
                {formatCurrency(analyticsData?.summary?.realizedRevenue || 0)}
              </div>
              <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>Direct Cash + UPI + Card Collections</div>
            </div>

            {/* Card 2: Net Cash in Drawer */}
            <div className="folio-card" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#ffffff', padding: '16px', border: 'none' }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9 }}>
                Net Cash in Drawer
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 900, margin: '4px 0 2px' }}>
                {formatCurrency(analyticsData?.paymentModes?.cash || 0)}
              </div>
              <div style={{ fontSize: '0.74rem', opacity: 0.85 }}>
                {analyticsData?.paymentModes?.cashCount || 0} Cash settled order(s)
              </div>
            </div>

            {/* Card 3: Online UPI / QR */}
            <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #0284c7', padding: '16px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>
                Online UPI / QR Collections
              </div>
              <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0284c7', margin: '4px 0 2px' }}>
                {formatCurrency(analyticsData?.paymentModes?.upi || 0)}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#0369a1', fontWeight: 700 }}>
                {analyticsData?.paymentModes?.upiCount || 0} order(s) ({analyticsData?.paymentModes?.upiWithUtrCount || 0} with verified UTR)
              </div>
              {Number(analyticsData?.paymentModes?.upiTax || 0) > 0 && (
                <div style={{ fontSize: '0.70rem', color: '#0369a1', fontWeight: 800, marginTop: '2px' }}>
                  + {formatCurrency(analyticsData.paymentModes.upiTax)} 0.4% UPI Tax
                </div>
              )}
            </div>

            {/* Card 4: Card POS Swipes */}
            <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #7c3aed', padding: '16px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase' }}>
                Card POS Swipes
              </div>
              <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#7c3aed', margin: '4px 0 2px' }}>
                {formatCurrency(analyticsData?.paymentModes?.card || 0)}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#6d28d9', fontWeight: 700 }}>
                {analyticsData?.paymentModes?.cardCount || 0} Card payment(s)
              </div>
              {Number(analyticsData?.paymentModes?.cardSurcharge || 0) > 0 && (
                <div style={{ fontSize: '0.70rem', color: '#b45309', fontWeight: 800, marginTop: '2px' }}>
                  + {formatCurrency(analyticsData.paymentModes.cardSurcharge)} 2.5% Card Fee
                </div>
              )}
            </div>

            {/* Card 5: In-House Room Folio */}
            <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #f59e0b', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>
                  Room Folio (In-House)
                </div>
                <span style={{ fontSize: '0.70rem', background: '#fef3c7', color: '#b45309', padding: '2px 7px', borderRadius: '6px', fontWeight: 850 }}>
                  Pay at Checkout
                </span>
              </div>
              <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#d97706', margin: '4px 0 2px' }}>
                {formatCurrency(analyticsData?.summary?.roomFolioRevenue || 0)}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 700 }}>
                {analyticsData?.summary?.roomFolioOrdersCount || 0} bill(s) charged to guest room folio
              </div>
            </div>

            {/* Card 6: Total Orders & Average Ticket Size */}
            <div className="folio-card" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', padding: '16px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Total Orders &amp; Ticket Size
              </div>
              <div style={{ fontSize: '1.55rem', fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0 2px' }}>
                {analyticsData?.summary?.totalOrdersCount || 0} Orders
              </div>
              <div style={{ fontSize: '0.74rem', color: '#059669', fontWeight: 700 }}>
                Average Ticket: {formatCurrency(analyticsData?.summary?.averageOrderValue || 0)}
              </div>
            </div>
          </div>

          {/* ADVANCED DEPARTMENTAL ANALYTICS GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            
            {/* Box 1: Category Contribution */}
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🏷️</span> {department === 'bar' ? 'Bar Categories Sales' : 'Menu Categories Sales'}
                </h4>
                <span style={{ fontWeight: 900, color: '#0284c7', fontSize: '0.95rem' }}>
                  {formatCurrency(analyticsData?.summary?.grossSales || 0)}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(!analyticsData?.categories || analyticsData.categories.length === 0) ? (
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '10px 0' }}>
                    No category sales recorded in this period.
                  </div>
                ) : (
                  analyticsData.categories.map((cat, idx) => (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 700, marginBottom: '4px' }}>
                        <span style={{ color: '#334155' }}>{cat.name} ({cat.quantity} items)</span>
                        <strong style={{ color: '#0f172a' }}>{formatCurrency(cat.revenue)} ({cat.percentage}%)</strong>
                      </div>
                      <div style={{ background: '#f1f5f9', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                        <div
                          style={{
                            background: department === 'bar' ? '#8b5cf6' : '#059669',
                            height: '100%',
                            width: `${cat.percentage}%`
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Box 2: Order Types Breakdown */}
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🍽️</span> Order Fulfillment Modes
                </h4>
                <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.82rem' }}>
                  {analyticsData?.summary?.totalOrdersCount || 0} Total Orders
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', display: 'block' }}>🍽️ Dine-In Table Service</span>
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{analyticsData?.orderTypes?.dineIn?.count || 0} order(s)</span>
                  </div>
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                    {formatCurrency(analyticsData?.orderTypes?.dineIn?.revenue || 0)}
                  </strong>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', display: 'block' }}>🥡 Takeaway / Parcel Counter</span>
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{analyticsData?.orderTypes?.parcel?.count || 0} order(s)</span>
                  </div>
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                    {formatCurrency(analyticsData?.orderTypes?.parcel?.revenue || 0)}
                  </strong>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', display: 'block' }}>🛎️ In-House Room Service</span>
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{analyticsData?.orderTypes?.roomService?.count || 0} order(s)</span>
                  </div>
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                    {formatCurrency(analyticsData?.orderTypes?.roomService?.revenue || 0)}
                  </strong>
                </div>
              </div>
            </div>

            {/* Box 3: GST, Discounts & Surcharges Audit */}
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚡</span> Taxes, Surcharges &amp; Discounts
                </h4>
                <span style={{ fontWeight: 850, color: '#b45309', fontSize: '0.82rem' }}>
                  Audit Overview
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.84rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Gross Subtotal (Food/Beverage):</span>
                  <strong style={{ color: '#0f172a' }}>{formatCurrency(analyticsData?.summary?.totalSubtotal || 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Total Discount Granted:</span>
                  <strong style={{ color: '#dc2626' }}>- {formatCurrency(analyticsData?.summary?.totalDiscount || 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>GST Collected (CGST + SGST):</span>
                  <strong style={{ color: '#059669' }}>+ {formatCurrency(analyticsData?.summary?.totalTax || 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Card POS 2.5% Surcharge:</span>
                  <strong style={{ color: '#b45309' }}>+ {formatCurrency(analyticsData?.summary?.totalCardSurcharge || 0)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>UPI 0.4% Convenience Tax:</span>
                  <strong style={{ color: '#0284c7' }}>+ {formatCurrency(analyticsData?.summary?.totalUpiTax || 0)}</strong>
                </div>

                <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: '#334155' }}>Total Department Sales:</span>
                  <strong style={{ fontSize: '1.15rem', fontWeight: 950, color: '#059669' }}>
                    {formatCurrency(analyticsData?.summary?.grossSales || 0)}
                  </strong>
                </div>
              </div>
            </div>

          </div>

          {/* TOP SELLERS LEADERBOARD & STAFF AUDIT ROW */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
            
            {/* Top 10 Best Sellers Table */}
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🏆</span> Top 10 Best-Selling {department === 'bar' ? 'Drinks & Liquor' : 'Dishes & Food'}
                </h4>
                <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 700 }}>By Quantity Sold</span>
              </div>

              {(!analyticsData?.topItems || analyticsData.topItems.length === 0) ? (
                <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '10px 0' }}>
                  No item sales recorded in this period.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>#</th>
                        <th style={{ padding: '6px 8px' }}>Item Name</th>
                        <th style={{ padding: '6px 8px' }}>Category</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center' }}>Qty</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.topItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '7px 8px', fontWeight: 800 }}>
                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`}
                          </td>
                          <td style={{ padding: '7px 8px', fontWeight: 750, color: '#1e293b' }}>
                            {item.name}
                          </td>
                          <td style={{ padding: '7px 8px', color: '#64748b' }}>
                            <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '0.74rem' }}>
                              {item.category}
                            </span>
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 800, color: '#0284c7' }}>
                            {item.quantity}
                          </td>
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                            {formatCurrency(item.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Staff Performance Audit (Cashiers & Captains) */}
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', padding: '20px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🧑‍💼</span> Cashier Settlement Audit
                  </h4>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>Bills Settled</span>
                </div>

                {(!analyticsData?.staffPerformance?.cashiers || analyticsData.staffPerformance.cashiers.length === 0) ? (
                  <div style={{ fontSize: '0.80rem', color: '#94a3b8', fontStyle: 'italic' }}>No cashier activity recorded.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {analyticsData.staffPerformance.cashiers.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8fafc', borderRadius: '8px', fontSize: '0.82rem' }}>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{c.name}</strong>
                          <span style={{ color: '#64748b', marginLeft: '6px', fontSize: '0.74rem' }}>({c.count} bills)</span>
                        </div>
                        <strong style={{ color: '#059669' }}>{formatCurrency(c.revenue)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🤵</span> Captain &amp; Order Taker Audit
                  </h4>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>Orders Taken</span>
                </div>

                {(!analyticsData?.staffPerformance?.captains || analyticsData.staffPerformance.captains.length === 0) ? (
                  <div style={{ fontSize: '0.80rem', color: '#94a3b8', fontStyle: 'italic' }}>No captain activity recorded.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {analyticsData.staffPerformance.captains.map((w, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f8fafc', borderRadius: '8px', fontSize: '0.82rem' }}>
                        <div>
                          <strong style={{ color: '#1e293b' }}>{w.name}</strong>
                          <span style={{ color: '#64748b', marginLeft: '6px', fontSize: '0.74rem' }}>({w.count} orders)</span>
                        </div>
                        <strong style={{ color: '#0284c7' }}>{formatCurrency(w.revenue)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ITEM TRANSACTION LEDGER AUDIT TRAIL */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              border: '1.5px solid #e2e8f0',
              padding: '20px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 850, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📜</span> {department === 'bar' ? 'Bar Settled Orders Ledger' : 'Restaurant Settled Orders Ledger'}
                </h4>
                <span style={{ fontSize: '0.80rem', color: '#64748b' }}>
                  Showing up to 200 settled orders in selected date range. Live search enabled.
                </span>
              </div>

              {/* Search Box */}
              <input
                type="text"
                placeholder="Search by Bill#, Token, Table, Customer, Waiter, Mode..."
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.82rem',
                  width: '320px',
                  maxWidth: '100%'
                }}
              />
            </div>

            {filteredLedgerOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.86rem' }}>
                No completed {department} orders found matching your search.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #e2e8f0', background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                      <th style={{ padding: '9px 10px' }}>Bill / Token #</th>
                      <th style={{ padding: '9px 10px' }}>Date &amp; Time</th>
                      <th style={{ padding: '9px 10px' }}>Table / Location</th>
                      <th style={{ padding: '9px 10px' }}>Customer / Guest</th>
                      <th style={{ padding: '9px 10px' }}>Staff (Waiter / Cashier)</th>
                      <th style={{ padding: '9px 10px' }}>Payment Mode</th>
                      <th style={{ padding: '9px 10px', textAlign: 'right' }}>Total</th>
                      <th style={{ padding: '9px 10px', textAlign: 'center', width: '120px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedgerOrders.map((ord, idx) => {
                      const isPaid = Number(ord.is_paid) === 1 && ord.payment_mode !== 'room_folio';
                      const isRoomFolio = !isPaid;
                      const hasUtr = ord.utr_number && ord.utr_number.trim();
                      const tStr = String(ord.table_number || '');
                      const isRS = tStr.startsWith('RS-');
                      const isParcel = tStr.startsWith('P-') || tStr.startsWith('BP-');

                      return (
                        <tr key={ord.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '9px 10px', fontWeight: 800, color: '#1e293b' }}>
                            <div>{ord.order_number || `#${ord.id}`}</div>
                            {ord.token_number && (
                              <span style={{ fontSize: '0.72rem', color: '#0284c7', background: '#e0f2fe', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                                Token #{ord.token_number}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', color: '#64748b' }}>
                            {ord.created_at ? formatDateTime(ord.created_at) : '—'}
                          </td>
                          <td style={{ padding: '9px 10px', fontWeight: 750 }}>
                            {isRS ? (
                              <span style={{ color: '#d97706' }}>🛎️ Room #{tStr.replace(/^RS-/i, '')}</span>
                            ) : isParcel ? (
                              <span style={{ color: '#7c3aed' }}>🥡 Parcel #{tStr.replace(/^BP-|^P-/i, '')}</span>
                            ) : (
                              <span style={{ color: '#0f172a' }}>🍽️ Table {tStr}</span>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', color: '#334155' }}>
                            <div>{ord.customer_name || 'Walk-in Guest'}</div>
                            {ord.room_number && (
                              <span style={{ fontSize: '0.72rem', color: '#059669', background: '#d1fae5', padding: '1px 5px', borderRadius: '4px', fontWeight: 750 }}>
                                Linked to Room #{ord.room_number}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', color: '#64748b', fontSize: '0.78rem' }}>
                            <div>W: <strong>{ord.waiter_name || '—'}</strong></div>
                            <div>C: <strong>{ord.cashier_name || '—'}</strong></div>
                          </td>
                          <td style={{ padding: '9px 10px' }}>
                            {isRoomFolio ? (
                              <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.74rem' }}>
                                ⏳ Room Folio
                              </span>
                            ) : ord.payment_mode === 'split' ? (
                              <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.74rem' }}>
                                🔀 Split Payment
                              </span>
                            ) : ord.payment_mode === 'online' || ord.payment_mode === 'upi' ? (
                              <div>
                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.74rem' }}>
                                  📱 UPI / QR
                                </span>
                                {hasUtr && (
                                  <div style={{ fontSize: '0.68rem', color: '#0284c7', marginTop: '2px', fontWeight: 700 }}>
                                    UTR: {ord.utr_number}
                                  </div>
                                )}
                              </div>
                            ) : ord.payment_mode === 'card' ? (
                              <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.74rem' }}>
                                💳 Card POS
                              </span>
                            ) : (
                              <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.74rem' }}>
                                💵 Cash
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 900, color: '#0f172a', fontSize: '0.90rem' }}>
                            {formatCurrency(ord.total || 0)}
                          </td>
                          <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => printThermalBillSlip(ord, department === 'bar' ? 'HOTEL CITY PARK - BAR & LOUNGE' : 'HOTEL CITY PARK - RESTAURANT')}
                              style={{ padding: '4px 8px', fontSize: '0.74rem', borderRadius: '6px', fontWeight: 750, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <span>🖨️</span> Slip
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: RATES MANAGEMENT */}
      {/* ========================================================================= */}
      {activeTab === 'rates' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px' }}>
          
          {/* Top Category Row with + Add Category Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              overflowX: 'auto',
              paddingBottom: '12px',
              marginBottom: '16px',
              borderBottom: '1.5px solid #f1f5f9'
            }}
          >
            <button
              type="button"
              onClick={() => setRateCategoryFilter('all')}
              style={{
                padding: '7px 16px',
                borderRadius: '20px',
                fontSize: '0.84rem',
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: rateCategoryFilter === 'all' ? '#0071e3' : '#f1f5f9',
                color: rateCategoryFilter === 'all' ? '#ffffff' : '#475569',
                boxShadow: rateCategoryFilter === 'all' ? '0 2px 8px rgba(0, 113, 227, 0.35)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              All Categories ({menuItems.length})
            </button>

            {categories.map((c) => {
              const count = categoryCounts[c.name] || 0;
              const isSelected = rateCategoryFilter === c.name;

              return (
                <div
                  key={c.id || c.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: isSelected ? '#0071e3' : '#f1f5f9',
                    color: isSelected ? '#ffffff' : '#475569',
                    borderRadius: '20px',
                    padding: '4px 6px 4px 14px',
                    boxShadow: isSelected ? '0 2px 8px rgba(0, 113, 227, 0.35)' : 'none',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    gap: '6px'
                  }}
                >
                  <span
                    onClick={() => setRateCategoryFilter(c.name)}
                    style={{
                      cursor: 'pointer',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                      paddingRight: '2px'
                    }}
                  >
                    {c.name} ({count})
                  </span>

                  {/* Rename Category Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingCat(c);
                      setRenamedName(c.name);
                    }}
                    style={{
                      background: isSelected ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                      border: 'none',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.65rem',
                      color: isSelected ? '#ffffff' : '#334155'
                    }}
                    title={`Rename category "${c.name}"`}
                  >
                    ✏️
                  </button>

                  {/* Delete Category Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCategory(c);
                    }}
                    style={{
                      background: isSelected ? 'rgba(239,68,68,0.3)' : '#fee2e2',
                      border: 'none',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '0.65rem',
                      color: isSelected ? '#ffffff' : '#dc2626'
                    }}
                    title={`Delete category "${c.name}"`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}

            {/* + Add Category Button */}
            <button
              type="button"
              onClick={() => setIsAddCategoryOpen(true)}
              style={{
                padding: '7px 14px',
                borderRadius: '20px',
                fontSize: '0.84rem',
                fontWeight: 800,
                border: '1.5px dashed #0071e3',
                background: '#eff6ff',
                color: '#0071e3',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.15s ease'
              }}
              title="Create a new dish category"
            >
              <span>+</span>
              <span>Add Category</span>
            </button>
          </div>

          {/* Top filter toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
              <input
                type="text"
                className="form-input"
                placeholder={`Search ${department === 'bar' ? 'drink' : 'dish'} name or shortcode...`}
                value={rateSearch}
                onChange={(e) => setRateSearch(e.target.value)}
                style={{ width: '280px', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => printFullMenuA4(department, menuItems, categories)}
                style={{
                  background: '#f1f5f9',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '8px 16px',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease'
                }}
                title="Print the entire menu category-wise on A4 paper"
              >
                <span>🖨️</span>
                <span>Print Entire Menu (A4)</span>
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={handleOpenAddItem}
                style={{
                  background: 'linear-gradient(135deg, #0071e3 0%, #0284c7 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '8px 16px',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(0, 113, 227, 0.35)'
                }}
              >
                <span>+</span>
                <span>Add New {department === 'bar' ? 'Drink' : 'Dish'}</span>
              </button>
            </div>
          </div>

          {/* Rates Table */}
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px' }}>Item Name</th>
                  <th style={{ padding: '10px 14px' }}>Category</th>
                  <th style={{ padding: '10px 14px' }}>Shortcode</th>
                  <th style={{ padding: '10px 14px', width: '200px' }}>Rate / Price (₹)</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRates.map((item) => {
                  const isDirty = editingRates[item.id] !== undefined && editingRates[item.id] !== String(item.price);
                  const currentInputValue = editingRates[item.id] !== undefined ? editingRates[item.id] : item.price;

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 750, color: '#0f172a' }}>
                        <span style={{ marginRight: '6px' }}>{item.is_veg ? '🟢' : '🔴'}</span>
                        {item.name}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 700 }}>
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {item.shortcode ? `#${item.shortcode}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 800, color: '#475569' }}>₹</span>
                          <input
                            type="number"
                            className="form-input"
                            value={currentInputValue}
                            onChange={(e) => handleRateInputChange(item.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRate(item);
                            }}
                            style={{
                              width: '90px',
                              padding: '5px 8px',
                              fontSize: '0.90rem',
                              fontWeight: 800,
                              borderRadius: '8px',
                              borderColor: isDirty ? '#0071e3' : '#cbd5e1',
                              background: isDirty ? '#eff6ff' : '#ffffff'
                            }}
                          />
                          {isDirty && (
                            <button
                              type="button"
                              onClick={() => handleSaveRate(item)}
                              style={{
                                background: '#10b981',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                cursor: 'pointer'
                              }}
                            >
                              Save
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => setEditingItem({ ...item })}
                          style={{
                            background: '#eff6ff',
                            color: '#0071e3',
                            border: '1px solid #bfdbfe',
                            borderRadius: '8px',
                            padding: '4px 10px',
                            fontSize: '0.76rem',
                            fontWeight: 750,
                            cursor: 'pointer',
                            marginRight: '6px'
                          }}
                          title="Rename dish, change category, food type or price"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item)}
                          style={{
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fca5a5',
                            borderRadius: '8px',
                            padding: '4px 10px',
                            fontSize: '0.76rem',
                            fontWeight: 750,
                            cursor: 'pointer'
                          }}
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRates.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: '36px', textAlign: 'center', color: '#94a3b8' }}>
                      No items found. Click "+ Add New" to add items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: TABLES & COUNTERS MANAGEMENT */}
      {/* ========================================================================= */}
      {activeTab === 'tables' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '20px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                Floor Tables &amp; Service Counters ({physicalTables.length})
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '0.80rem', color: '#64748b' }}>
                Configure floor tables, seating capacity, and table numbers for {department === 'bar' ? 'Bar' : 'Restaurant'}.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setEditingTable(null);
                setNewTableNum('');
                setNewTableType(department === 'bar' ? 'table' : 'dine_in');
                setNewTableCap(4);
                setIsAddTableOpen(true);
              }}
              style={{
                background: 'linear-gradient(135deg, #0071e3 0%, #0284c7 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 16px',
                fontWeight: 800,
                fontSize: '0.86rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>+</span>
              <span>Add New Table</span>
            </button>
          </div>

          <div
            style={{
              padding: '10px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              marginBottom: '16px',
              fontSize: '0.82rem',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>📌</span>
            <span>
              <strong>Mandatory Default Sections:</strong> Room Service and Takeaway Parcels are fixed system workflows automatically available on the floor. Only custom physical seating sections are managed here.
            </span>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px' }}>Table Number</th>
                  <th style={{ padding: '10px 14px' }}>Service Type</th>
                  <th style={{ padding: '10px 14px' }}>Capacity</th>
                  <th style={{ padding: '10px 14px' }}>Current Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {physicalTables.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                      No {department === 'bar' ? 'bar tables or counter seats' : 'restaurant tables'} added yet. Click &quot;+ Add New Table&quot; above.
                    </td>
                  </tr>
                ) : (
                  physicalTables.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 800, color: '#0f172a' }}>
                        {t.table_number}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#334155', fontWeight: 650 }}>
                        {getTableTypeDisplay(t.table_type)}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {t.capacity || 4} Guests
                      </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          background: t.status === 'occupied' ? '#eff6ff' : t.status === 'ready' ? '#dcfce7' : '#f1f5f9',
                          color: t.status === 'occupied' ? '#1d4ed8' : t.status === 'ready' ? '#166534' : '#64748b',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          textTransform: 'uppercase'
                        }}
                      >
                        {t.status || 'available'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => setEditingTable({ ...t })}
                        style={{
                          background: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '4px 10px',
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          cursor: 'pointer',
                          marginRight: '6px'
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTable(t)}
                        style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          borderRadius: '8px',
                          padding: '4px 10px',
                          fontSize: '0.76rem',
                          fontWeight: 750,
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: TAX & GST SETTINGS */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '24px', maxWidth: '640px' }}>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
            Tax &amp; Service Charge Configuration
          </h4>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.82rem', color: '#64748b' }}>
            Configure GST percentages and bar PAX cover charges applied to bills.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                Restaurant GST (%)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  className="form-input"
                  value={settings.restaurant_gst_pct}
                  onChange={(e) => setSettings({ ...settings, restaurant_gst_pct: parseFloat(e.target.value) || 0 })}
                  style={{ width: '120px', padding: '8px 12px', fontSize: '0.90rem', borderRadius: '10px' }}
                />
                <span style={{ fontWeight: 800, color: '#64748b' }}>% (Current default: 5%)</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                Bar Lounge GST (%)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  className="form-input"
                  value={settings.bar_gst_pct}
                  onChange={(e) => setSettings({ ...settings, bar_gst_pct: parseFloat(e.target.value) || 0 })}
                  style={{ width: '120px', padding: '8px 12px', fontSize: '0.90rem', borderRadius: '10px' }}
                />
                <span style={{ fontWeight: 800, color: '#64748b' }}>% (Current default: 5%)</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                Bar Lounge PAX / Cover Charge (₹ per pax)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, color: '#64748b' }}>₹</span>
                <input
                  type="number"
                  className="form-input"
                  value={settings.bar_pax_charge}
                  onChange={(e) => setSettings({ ...settings, bar_pax_charge: parseFloat(e.target.value) || 0 })}
                  style={{ width: '120px', padding: '8px 12px', fontSize: '0.90rem', borderRadius: '10px' }}
                />
                <span style={{ fontSize: '0.80rem', color: '#64748b' }}>Applied to bar dining covers</span>
              </div>
            </div>

            <div style={{ paddingTop: '10px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveSettings}
                style={{
                  background: 'linear-gradient(135deg, #0071e3 0%, #0284c7 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 24px',
                  fontWeight: 800,
                  fontSize: '0.90rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,113,227,0.3)'
                }}
              >
                💾 Save Tax Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: DEPARTMENT STAFF MANAGEMENT */}
      {/* ========================================================================= */}
      {activeTab === 'staff' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header & Action Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              background: '#ffffff',
              padding: '16px 20px',
              borderRadius: '14px',
              border: '1.5px solid #e2e8f0'
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                {department === 'bar' ? '🍸 Bar Lounge Staff Accounts' : '🍽️ Restaurant POS Staff Accounts'}
              </h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                Manage cashier logins, passwords, and manager panel permissions strictly for {department === 'bar' ? 'Bar Lounge' : 'Restaurant'} POS.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="🔍 Search staff name, ID..."
                value={staffSearchQuery}
                onChange={(e) => setStaffSearchQuery(e.target.value)}
                className="form-input"
                style={{ height: '36px', width: '220px', fontSize: '0.82rem', borderRadius: '8px' }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleOpenStaffModal()}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>➕</span> Add {department === 'bar' ? 'Bar' : 'Restaurant'} Staff
              </button>
            </div>
          </div>

          {/* Staff Table */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
            <table className="owner-rooms-table" style={{ width: '100%', margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Cashier ID</th>
                  <th>Staff Name</th>
                  <th style={{ width: '180px' }}>Manager Panel Access</th>
                  <th style={{ textAlign: 'right', width: '220px', minWidth: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList
                  .filter((s) => s.role === department)
                  .filter((s) => {
                    if (!staffSearchQuery.trim()) return true;
                    const q = staffSearchQuery.toLowerCase().trim();
                    return (
                      (s.username || '').toLowerCase().includes(q) ||
                      (s.full_name || '').toLowerCase().includes(q)
                    );
                  })
                  .map((s) => (
                    <tr key={s.id || s.username}>
                      <td style={{ fontWeight: 800 }}>
                        <code style={{ fontSize: '0.88rem', background: '#f1f5f9', padding: '3px 8px', borderRadius: '6px' }}>
                          {s.username}
                        </code>
                      </td>
                      <td style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.94rem' }}>{s.full_name}</td>
                      <td>
                        {s.role === 'manager' || s.can_access_manager == 1 ? (
                          <span
                            style={{
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              padding: '2px 10px',
                              borderRadius: '8px',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            🔑 Allowed
                          </span>
                        ) : (
                          <span
                            style={{
                              background: '#f8fafc',
                              color: '#94a3b8',
                              border: '1px solid #e2e8f0',
                              padding: '2px 10px',
                              borderRadius: '8px',
                              fontSize: '0.74rem',
                              fontWeight: 700
                            }}
                          >
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
                  ))}
                {staffList.filter(s => s.role === department).length === 0 && (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                      No staff accounts found for {department === 'bar' ? 'Bar Lounge' : 'Restaurant'}. Click "Add {department === 'bar' ? 'Bar' : 'Restaurant'} Staff" above to register one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW ITEM */}
      {/* ========================================================================= */}
      {isAddItemOpen && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setIsAddItemOpen(false)}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '460px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              Add New {department === 'bar' ? 'Drink' : 'Dish'}
            </h3>

            <form onSubmit={handleCreateNewItem} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Item Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Paneer Butter Masala"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="250"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                    Shortcode
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 101"
                    value={newItemCode}
                    onChange={(e) => setNewItemCode(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Category
                </label>
                <select
                  className="form-select"
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                >
                  {categories.map((c) => (
                    <option key={c.id || c.name} value={c.name}>{c.name}</option>
                  ))}
                  <option value="Main Course">Main Course</option>
                  <option value="Starters">Starters</option>
                  <option value="Desserts">Desserts</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Type
                </label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 750 }}>
                    <input type="radio" checked={newItemVeg === 1} onChange={() => setNewItemVeg(1)} />
                    <span>🟢 Veg</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 750 }}>
                    <input type="radio" checked={newItemVeg === 0} onChange={() => setNewItemVeg(0)} />
                    <span>🔴 Non-Veg</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsAddItemOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT / RENAME DISH */}
      {/* ========================================================================= */}
      {editingItem && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setEditingItem(null)}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '460px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              Edit / Rename {department === 'bar' ? 'Drink' : 'Dish'}
            </h3>

            <form onSubmit={handleUpdateItem} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  {department === 'bar' ? 'Drink' : 'Dish'} Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={editingItem.name}
                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={editingItem.price}
                    onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                    Shortcode
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingItem.shortcode || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, shortcode: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Category
                </label>
                <select
                  className="form-select"
                  value={editingItem.category || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                >
                  {categories.map((c) => (
                    <option key={c.id || c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {department !== 'bar' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                    Food Type
                  </label>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 750 }}>
                      <input
                        type="radio"
                        checked={Number(editingItem.is_veg) === 1}
                        onChange={() => setEditingItem({ ...editingItem, is_veg: 1 })}
                      />
                      <span>🟢 Veg</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 750 }}>
                      <input
                        type="radio"
                        checked={Number(editingItem.is_veg) === 0}
                        onChange={() => setEditingItem({ ...editingItem, is_veg: 0 })}
                      />
                      <span>🔴 Non-Veg</span>
                    </label>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingItem(null)}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD CATEGORY */}
      {/* ========================================================================= */}
      {isAddCategoryOpen && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setIsAddCategoryOpen(false)}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '420px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              + Add New Category
            </h3>
            <form onSubmit={handleAddCategory} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Category Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Tandoori Starters, Mocktails, Soups..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsAddCategoryOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RENAME CATEGORY */}
      {/* ========================================================================= */}
      {renamingCat && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setRenamingCat(null)}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '420px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              ✏️ Rename Category
            </h3>
            <form onSubmit={(e) => { e.preventDefault(); handleRenameCategory(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  New Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={renamedName}
                  onChange={(e) => setRenamedName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem', borderRadius: '10px' }}
                  autoFocus
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRenamingCat(null)}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD / EDIT TABLE */}
      {/* ========================================================================= */}
      {(isAddTableOpen || editingTable) && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => {
            setIsAddTableOpen(false);
            setEditingTable(null);
          }}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '440px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
              {editingTable ? `Edit Table ${editingTable.table_number}` : 'Add New Table / Counter'}
            </h3>

            <form
              onSubmit={editingTable ? handleUpdateTable : handleCreateTable}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Table / Counter Number *
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={department === 'bar' ? 'e.g. B-1, Counter-1, Sofa-2' : 'e.g. T-1, Family-1, AC-1'}
                  value={editingTable ? editingTable.table_number : newTableNum}
                  onChange={(e) => {
                    if (editingTable) setEditingTable({ ...editingTable, table_number: e.target.value });
                    else setNewTableNum(e.target.value);
                  }}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  {department === 'bar' ? 'Bar Section / Service Type' : 'Restaurant Section / Service Type'}
                </label>
                <select
                  className="form-select"
                  value={editingTable ? editingTable.table_type : newTableType}
                  onChange={(e) => {
                    if (editingTable) setEditingTable({ ...editingTable, table_type: e.target.value });
                    else setNewTableType(e.target.value);
                  }}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                >
                  {department === 'bar' ? (
                    <>
                      <option value="table">🍸 Bar Table / High Top</option>
                      <option value="counter">🍷 Bar Counter Seat</option>
                      <option value="lounge">🛋️ Lounge Sofa / VIP Area</option>
                    </>
                  ) : (
                    <>
                      <option value="dine_in">🍽️ Dine-in Table</option>
                      <option value="family">👨‍👩‍👧 Family Section</option>
                      <option value="ac_hall">❄️ AC Dining Hall</option>
                      <option value="garden">🌿 Garden / Rooftop</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Seating Capacity (Guests)
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={editingTable ? editingTable.capacity : newTableCap}
                  onChange={(e) => {
                    if (editingTable) setEditingTable({ ...editingTable, capacity: e.target.value });
                    else setNewTableCap(e.target.value);
                  }}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                  min="1"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setIsAddTableOpen(false);
                    setEditingTable(null);
                  }}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  {editingTable ? 'Update Table' : 'Create Table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: STAFF ADD / EDIT */}
      {/* ========================================================================= */}
      {isStaffModalOpen && (
        <div
          className="modal-backdrop-fixed"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10070,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setIsStaffModalOpen(false)}
        >
          <div
            className="modal-card"
            style={{
              maxWidth: '460px',
              width: '90%',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{department === 'bar' ? '🍸' : '🍽️'}</span>
              <span>
                {editingStaff
                  ? `Edit Staff: ${editingStaff.full_name || editingStaff.username}`
                  : `Add ${department === 'bar' ? 'Bar Lounge' : 'Restaurant'} Staff`}
              </span>
            </h3>

            <form onSubmit={handleSaveStaff} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Full Employee Name *
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={staffForm.full_name}
                  onKeyDown={blockNumericKeys}
                  onChange={(e) => setStaffForm({ ...staffForm, full_name: sanitizeNameInput(e.target.value) })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  Cashier Login ID / Username *
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder={department === 'bar' ? 'e.g. bar_kiran' : 'e.g. rest_rahul'}
                  disabled={editingStaff && editingStaff.username === 'admin'}
                  value={staffForm.username}
                  onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.80rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}>
                  {editingStaff ? 'Reset Password (leave blank to keep current)' : 'Login Password *'}
                </label>
                <input
                  type="password"
                  className="form-input"
                  required={!editingStaff}
                  placeholder={editingStaff ? '••••••••' : 'Enter login password'}
                  value={staffForm.password}
                  onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '0.86rem', borderRadius: '10px' }}
                />
              </div>

              <div style={{ marginTop: '2px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 750, color: '#0f172a' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(staffForm.can_access_manager == 1)}
                    onChange={(e) => setStaffForm({ ...staffForm, can_access_manager: e.target.checked ? 1 : 0 })}
                    style={{ width: '17px', height: '17px', cursor: 'pointer' }}
                  />
                  <span>Allow Manager Panel Access</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsStaffModalOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.86rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    background: '#0071e3',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '8px 20px',
                    fontWeight: 800,
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  {editingStaff ? 'Save Changes' : `Register ${department === 'bar' ? 'Bar' : 'Restaurant'} Staff`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
