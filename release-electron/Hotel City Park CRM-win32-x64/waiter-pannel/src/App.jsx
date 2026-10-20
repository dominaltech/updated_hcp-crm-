import React, { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { api } from './api/client';
import LoginScreen from './components/LoginScreen';
import HeaderBar from './components/HeaderBar';
import DepartmentSwitcher from './components/DepartmentSwitcher';
import DestinationTabs from './components/DestinationTabs';
import TablesView from './components/TablesView';
import RoomServiceView from './components/RoomServiceView';
import ParcelsView from './components/ParcelsView';
import MenuView from './components/MenuView';
import CartDrawer from './components/CartDrawer';
import MyOrdersView from './components/MyOrdersView';
import CustomModal from './components/CustomModal';
import SettingsModal from './components/SettingsModal';
import {
  getOfflineQueue,
  addToOfflineQueue,
  syncOfflineQueue,
  getCachedMenu,
  setCachedMenu,
  getCachedTables,
  setCachedTables
} from './utils/offlineSync';

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => api.getCurrentUser());
  const [department, setDepartment] = useState(() => {
    return localStorage.getItem('hcp_waiter_dept') || 'restaurant';
  });
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem('hcp_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return 'light';
    } catch {
      return 'light';
    }
  });

  const setTheme = useCallback((newTheme) => {
    const val = newTheme === 'dark' ? 'dark' : 'light';
    setThemeState(val);
    try {
      localStorage.setItem('hcp_theme', val);
      document.documentElement.setAttribute('data-theme', val);
      if (val === 'dark') {
        document.documentElement.classList.add('dark-theme');
        document.body.classList.add('dark-theme');
      } else {
        document.documentElement.classList.remove('dark-theme');
        document.body.classList.remove('dark-theme');
      }
    } catch (e) {
      console.warn('Error setting theme:', e);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-theme');
      document.body.classList.add('dark-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
      document.body.classList.remove('dark-theme');
    }
  }, [theme]);

  const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'tables' | 'rooms' | 'parcels'
  const [destination, setDestination] = useState(null); // active destination when taking an order

  // Data states
  const [tables, setTables] = useState([]);
  const [occupiedRooms, setOccupiedRooms] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);

  // UI & Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isPunching, setIsPunching] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [serverStatus, setServerStatus] = useState('connected'); // 'connected' | 'error'
  const [modalConfig, setModalConfig] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Offline queue and PWA install states
  const [offlineQueue, setOfflineQueue] = useState(() => getOfflineQueue());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [installPrompt, setInstallPrompt] = useState(null);

  // Data cache and diffing refs to eliminate 100% of UI blinking
  const tablesHashRef = useRef('');
  const roomsHashRef = useRef('');
  const ordersHashRef = useRef('');
  const menuHashRef = useRef('');
  const isInitialLoadRef = useRef(true);

  const showToast = (message, duration = 4000) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? '' : prev));
    }, duration);
  };

  // Reference to hold current UI state for Android Back Button navigation
  const stateRef = useRef({
    modalConfig,
    isSettingsOpen,
    isCartOpen,
    destination,
    activeTab,
    currentUser
  });
  useEffect(() => {
    stateRef.current = {
      modalConfig,
      isSettingsOpen,
      isCartOpen,
      destination,
      activeTab,
      currentUser
    };
  }, [modalConfig, isSettingsOpen, isCartOpen, destination, activeTab, currentUser]);

  const lastBackPressRef = useRef(0);

  const handleBackStep = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentUser) return false;

    // 1. If any modal is active (CustomModal)
    if (s.modalConfig) {
      setModalConfig(null);
      return true;
    }

    // 2. If settings modal is open
    if (s.isSettingsOpen) {
      setIsSettingsOpen(false);
      return true;
    }

    // 3. If cart drawer is open
    if (s.isCartOpen) {
      setIsCartOpen(false);
      return true;
    }

    // 4. If viewing menu for a destination (table / room / parcel)
    if (s.destination) {
      setDestination(null);
      return true;
    }

    // 5. If on another tab than 'tables'
    if (s.activeTab !== 'tables') {
      setActiveTab('tables');
      return true;
    }

    // 6. At root 'tables' view: double-press back to exit cleanly
    const now = Date.now();
    if (now - lastBackPressRef.current < 2000) {
      return false; // signals exit
    } else {
      lastBackPressRef.current = now;
      showToast('Press back again to exit', 2000);
      return true; // handled
    }
  }, []);

  // Capacitor Android Hardware / Gesture Back Button Listener
  useEffect(() => {
    let removeListener = null;

    try {
      const sub = CapApp.addListener('backButton', () => {
        const handled = handleBackStep();
        if (!handled) {
          CapApp.exitApp();
        }
      });
      if (sub && typeof sub.then === 'function') {
        sub.then((handler) => {
          removeListener = handler;
        });
      } else {
        removeListener = sub;
      }
    } catch (e) {
      console.log('Capacitor backButton not available in web context:', e);
    }

    return () => {
      if (removeListener && typeof removeListener.remove === 'function') {
        removeListener.remove();
      }
    };
  }, [handleBackStep]);

  // Browser / PWA back button listener (popstate)
  useEffect(() => {
    const onPopState = () => {
      const handled = handleBackStep();
      if (handled) {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [handleBackStep]);

  const handleDepartmentChange = (newDept) => {
    if (newDept === department) return;
    // If cart has items, prompt waiter with custom themed confirmation
    if (cart.length > 0) {
      setModalConfig({
        type: 'confirm',
        title: 'Switch Department?',
        message: 'Switching department will clear your current cart. Continue?',
        icon: '🔄',
        confirmText: 'Switch Department',
        cancelText: 'Keep Cart',
        confirmColor: 'var(--apple-orange)',
        onConfirm: () => {
          setCart([]);
          setDestination(null);
          setDepartment(newDept);
          localStorage.setItem('hcp_waiter_dept', newDept);
        }
      });
    } else {
      setDepartment(newDept);
      localStorage.setItem('hcp_waiter_dept', newDept);
      setDestination(null);
    }
  };

  // 1. Fetch live tables, rooms, and orders with smart diffing (Never blinks UI)
  const fetchLiveData = useCallback(async (isSilent = false) => {
    if (!currentUser) return;
    
    // Only display spinner on very first initial load if no data is present yet
    const shouldShowSpinner = !isSilent && isInitialLoadRef.current && !tablesHashRef.current;
    if (shouldShowSpinner) {
      setIsLoading(true);
    }

    try {
      let rawTables = [];
      if (department === 'bar') {
        const res = await api.getBarTables();
        rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
      } else {
        const res = await api.getRestaurantTables();
        rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
      }

      // Normalize all tables to ensure cart items, cart_total, and order_started_at are always available!
      const normalizedTables = rawTables.map(t => {
        let cart = [];
        if (Array.isArray(t.cart) && t.cart.length > 0) {
          cart = t.cart;
        } else if (typeof t.active_cart_json === 'string' && t.active_cart_json.trim()) {
          try {
            const p = JSON.parse(t.active_cart_json);
            if (Array.isArray(p)) cart = p;
          } catch (_) {}
        } else if (typeof t.printed_cart_json === 'string' && t.printed_cart_json.trim()) {
          try {
            const p = JSON.parse(t.printed_cart_json);
            if (Array.isArray(p)) cart = p;
          } catch (_) {}
        }

        const subtotal = cart.reduce((sum, it) => sum + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
        const gst = Math.round((subtotal * 5) / 100);
        const grandTotal = subtotal + gst;

        return {
          ...t,
          cart,
          active_cart_json: typeof t.active_cart_json === 'string' ? t.active_cart_json : JSON.stringify(cart),
          cart_total: t.cart_total || grandTotal,
          total_amount: t.total_amount || grandTotal,
          order_started_at: t.order_started_at || t.created_at || null
        };
      });

      // Smart diffing & optimistic retention: Ensure newly punched orders aren't wiped while cloud syncs
      const tablesHash = JSON.stringify(normalizedTables);
      if (tablesHash !== tablesHashRef.current) {
        tablesHashRef.current = tablesHash;
        setTables(prev => {
          const pendingOptimistic = (prev || []).filter(pt => {
            const isOccupied = pt.status === 'occupied' || (Array.isArray(pt.cart) && pt.cart.length > 0);
            const isRecent = pt.order_started_at && (Date.now() - new Date(pt.order_started_at).getTime() < 45000);
            const alreadyInServer = normalizedTables.some(nt => 
              String(nt.id) === String(pt.id) || 
              nt.table_number === pt.table_number ||
              (pt.table_number && nt.table_number && String(nt.table_number).replace(/^RS-/i, '').trim() === String(pt.table_number).replace(/^RS-/i, '').trim())
            );
            return isOccupied && isRecent && !alreadyInServer;
          });
          const merged = [...pendingOptimistic, ...normalizedTables];
          setCachedTables(department, merged);
          return merged;
        });
      }

      // Fetch occupied rooms for Room Service
      try {
        const rooms = await api.getOccupiedRooms();
        const roomsHash = JSON.stringify(rooms);
        if (roomsHash !== roomsHashRef.current) {
          roomsHashRef.current = roomsHash;
          setOccupiedRooms(rooms);
        }
      } catch (rErr) {
        console.warn('Occupied rooms fetch warning:', rErr.message);
      }

      // Fetch recent orders
      try {
        const ordRes = department === 'bar' ? await api.getBarOrders() : await api.getRestaurantOrders();
        const ordList = (ordRes && ordRes.orders) || (ordRes && ordRes.data) || [];
        const ordersHash = JSON.stringify(ordList);
        if (ordersHash !== ordersHashRef.current) {
          ordersHashRef.current = ordersHash;
          setRecentOrders(ordList);
        }
      } catch (oErr) {
        console.warn('Recent orders fetch warning:', oErr.message);
      }

      setServerStatus('connected');
    } catch (err) {
      console.error('Data fetch error:', err.message);
      setServerStatus('error');
      const cached = getCachedTables(department);
      if (cached && cached.length > 0) {
        setTables((prev) => (prev && prev.length > 0 ? prev : cached));
      }
    } finally {
      if (shouldShowSpinner) {
        setIsLoading(false);
      }
      isInitialLoadRef.current = false;
    }
  }, [currentUser, department]);

  // 2. Fetch menu items and categories with smart diffing
  const fetchMenu = useCallback(async (isSilent = false) => {
    if (!currentUser) return;
    if (!isSilent && isInitialLoadRef.current) {
      setIsLoadingMenu(true);
    }
    try {
      let items = [];
      let cats = [];
      if (department === 'bar') {
        const [menuRes, catRes] = await Promise.all([
          api.getBarMenu(),
          api.getBarCategories()
        ]);
        items = (menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []);
        cats = (catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []);
      } else {
        const [menuRes, catRes] = await Promise.all([
          api.getRestaurantMenu(),
          api.getRestaurantCategories()
        ]);
        items = (menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []);
        cats = (catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []);
      }

      const menuHash = JSON.stringify({ items, cats });
      if (menuHash !== menuHashRef.current) {
        menuHashRef.current = menuHash;
        setMenuItems(items);
        setCategories(cats);
        setCachedMenu(department, items, cats);
      }
    } catch (err) {
      console.error('Menu fetch error:', err.message);
      const cached = getCachedMenu(department);
      if (cached?.items?.length > 0) {
        setMenuItems((prev) => (prev && prev.length > 0 ? prev : cached.items));
        setCategories((prev) => (prev && prev.length > 0 ? prev : cached.categories));
      }
    } finally {
      setIsLoadingMenu(false);
    }
  }, [currentUser, department]);

  // Sync offline orders queue to server
  const handleSyncOffline = useCallback(async () => {
    if (isSyncing) return;
    const q = getOfflineQueue();
    if (!q || q.length === 0) return;
    setIsSyncing(true);
    try {
      const res = await syncOfflineQueue(api, (progress) => {
        showToast(`🔄 Syncing offline order ${progress.current}/${progress.total}...`, 2000);
      });
      setOfflineQueue(getOfflineQueue());
      if (res.syncedCount > 0) {
        showToast(`✅ Synced ${res.syncedCount} offline order(s) successfully!`, 4000);
        fetchLiveData();
      } else if (res.remainingCount > 0) {
        showToast(`⚠️ Server offline: ${res.remainingCount} order(s) remain queued.`, 4000);
      }
    } catch (e) {
      console.warn('Sync failed:', e);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, fetchLiveData]);

  // Online / Offline listeners & auto-sync trigger
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('📶 Back online! Auto-syncing pending orders...');
      handleSyncOffline();
      fetchLiveData();
      fetchMenu();
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('⚠️ Offline mode: Orders saved locally and auto-synced.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic sync check every 25 seconds if online
    const interval = setInterval(() => {
      if (navigator.onLine && getOfflineQueue().length > 0) {
        handleSyncOffline();
      }
    }, 25000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [handleSyncOffline, fetchLiveData, fetchMenu]);

  // Capture PWA install prompt
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallPWA = async () => {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPrompt(null);
        showToast('🎉 Hotel City Park Waiter app installed successfully!');
      }
    } catch (e) {
      console.warn('Install prompt error:', e);
    }
  };

  // Initial and reactive effects
  useEffect(() => {
    if (currentUser) {
      fetchLiveData();
      fetchMenu();
    }
  }, [currentUser, department, fetchLiveData, fetchMenu]);

  // Auto-refresh tables periodically every 7 seconds when idle, completely silent background fetch
  useEffect(() => {
    if (!currentUser || destination) return;
    const interval = setInterval(() => {
      fetchLiveData(true);
    }, 7000);
    return () => clearInterval(interval);
  }, [currentUser, destination, fetchLiveData]);

  // Cart operations
  const handleAddToCart = (item) => {
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.id === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: parseFloat(item.price || item.rate || 0),
          quantity: 1,
          category: item.category_name || item.category || '',
          notes: ''
        }
      ];
    });
  };

  const handleUpdateCartQty = (itemId, newQty) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((it) => it.id !== itemId));
    } else {
      setCart((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, quantity: newQty } : it))
      );
    }
  };

  const handleSelectTable = (table) => {
    const numStr = String(table.table_number || table.name || '');
    const isRS = table.table_type === 'room_service' || numStr.startsWith('RS-');
    const isP = table.table_type === 'parcel' || numStr.startsWith('P-');
    setDestination({
      type: isRS ? 'room' : (isP ? 'parcel' : 'table'),
      id: table.id,
      label: table.name || table.table_number || `Table ${table.id}`,
      rawTable: table,
      customerName: table.customer_name || '',
      customerPhone: table.customer_phone || '',
      guest_name: table.customer_name || '',
      guest_phone: table.customer_phone || '',
      isExistingOrder: (table.cart && table.cart.length > 0) || table.status !== 'available'
    });
    setCart([]);
  };

  const handleSelectDestinationForMore = (dest) => {
    let type = dest.type || 'table';
    const label = dest.label || dest.table_number || `Table ${dest.id}`;
    if (label.startsWith('RS-') || type === 'room') {
      type = 'room';
    } else if (label.startsWith('P-') || type === 'parcel') {
      type = 'parcel';
    }
    const custName = dest.customerName || dest.rawTable?.customer_name || dest.rawOrder?.customer_name || dest.guest_name || '';
    const custPhone = dest.customerPhone || dest.rawTable?.customer_phone || dest.rawOrder?.customer_phone || dest.guest_phone || '';

    setDestination({
      type,
      id: dest.id,
      label,
      rawTable: dest.rawTable || null,
      rawOrder: dest.rawOrder || null,
      customerName: custName,
      customerPhone: custPhone,
      guest_name: custName,
      guest_phone: custPhone,
      isExistingOrder: true
    });
    setCart([]);
  };

  const handleSelectRoom = (room) => {
    setDestination({
      type: 'room',
      id: room.id,
      label: `Room ${room.room_number} • ${room.guest_name || 'Guest'}`,
      guest_phone: room.guest_phone || '',
      guest_name: room.guest_name || '',
      customerName: room.guest_name || '',
      customerPhone: room.guest_phone || '',
      room_number: room.room_number
    });
    setCart([]);
  };

  const handleStartParcel = (parcelInfo) => {
    setDestination({
      type: 'parcel',
      id: parcelInfo.tokenNo,
      label: parcelInfo.label,
      customerName: parcelInfo.customerName,
      customerPhone: parcelInfo.customerPhone
    });
    setCart([]);
  };

  // Punch KOT order with offline queue resilience
  const handlePunchOrder = async ({ notes, customerName, customerPhone }) => {
    if (!destination || cart.length === 0) return;
    setIsPunching(true);

    const resolvedCustName = customerName || destination.customerName || (destination.type === 'parcel' ? destination.label : '');
    const resolvedCustPhone = customerPhone || destination.customerPhone || '';

    const orderPayload = {
      department,
      destination_type: destination.type,
      destination_id: destination.id,
      destination_label: destination.label,
      items: cart,
      waiter_id: currentUser.id,
      waiter_name: currentUser.full_name || currentUser.username,
      customer_name: resolvedCustName,
      customer_phone: resolvedCustPhone,
      guest_phone: resolvedCustPhone,
      notes
    };

    // If device is explicitly offline
    if (!navigator.onLine) {
      addToOfflineQueue(orderPayload);
      setOfflineQueue(getOfflineQueue());
      setIsCartOpen(false);
      setCart([]);
      setDestination(null);
      setActiveTab('orders');
      setIsPunching(false);
      showToast('⚡ Saved Offline! Will auto-sync when Wi-Fi connects.', 5000);
      return;
    }

    try {
      const res = await api.punchOrder(orderPayload);

      const kotNo = res?.kotNumber || res?.botNumber || res?.order_id || 'OK';
      const tokenNo = res?.tokenNumber ? ` (Token #${res.tokenNumber})` : '';

      showToast(`🚀 Order Punched & KOT #${kotNo}${tokenNo} dispatched!`);

      // Optimistically insert/update the table in state immediately (0ms instant display in Active Running!)
      const nowIso = new Date().toISOString();
      const punchedItems = cart.map(it => ({
        ...it,
        qty: Number(it.qty || it.quantity) || 1,
        quantity: Number(it.qty || it.quantity) || 1,
        added_at: it.added_at || nowIso
      }));

      let targetTableNumber = destination.label || `Table ${destination.id}`;
      let cleanRoomNum = '';
      if (destination.type === 'room') {
        cleanRoomNum = String(destination.room_number || destination.id || destination.label || '')
          .replace(/^RS-/i, '')
          .replace(/^Room\s*/i, '')
          .replace(/•.*$/, '')
          .trim();
        targetTableNumber = `RS-Room ${cleanRoomNum}`;
      } else if (destination.type === 'parcel') {
        const pNum = String(destination.id || destination.label || '').replace(/^P-/i, '').trim();
        targetTableNumber = `P-${pNum}`;
      }

      setTables(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(t => {
          if (String(t.id) === String(destination.id)) return true;
          if (t.table_number === targetTableNumber) return true;
          if (cleanRoomNum && String(t.table_number || '').includes(cleanRoomNum)) return true;
          return false;
        });
        
        let existingCart = [];
        if (idx >= 0) {
          existingCart = copy[idx].cart || [];
          if (existingCart.length === 0 && copy[idx].active_cart_json) {
            try { existingCart = JSON.parse(copy[idx].active_cart_json); } catch (_) {}
          }
        }
        // Merge added items with existing items if this table already had an order
        const mergedCart = [...existingCart];
        for (const it of punchedItems) {
          const mIdx = mergedCart.findIndex(c => String(c.id) === String(it.id));
          if (mIdx >= 0) {
            mergedCart[mIdx] = {
              ...mergedCart[mIdx],
              qty: (Number(mergedCart[mIdx].qty || mergedCart[mIdx].quantity) || 1) + it.qty,
              quantity: (Number(mergedCart[mIdx].qty || mergedCart[mIdx].quantity) || 1) + it.quantity,
              added_at: nowIso
            };
          } else {
            mergedCart.push({ ...it, added_at: nowIso });
          }
        }

        const mergedSub = mergedCart.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.quantity || it.qty) || 1)), 0);
        const mergedGrand = Math.round(mergedSub + (mergedSub * 5 / 100));

        const updatedTableObj = {
          ...(idx >= 0 ? copy[idx] : {}),
          id: destination.id,
          table_number: targetTableNumber,
          table_type: destination.type === 'room' ? 'room_service' : (destination.type || 'dine_in'),
          status: 'occupied',
          cart: mergedCart,
          active_cart_json: JSON.stringify(mergedCart),
          printed_cart_json: JSON.stringify(mergedCart),
          cart_total: mergedGrand,
          total_amount: mergedGrand,
          token_number: res?.tokenNumber || (idx >= 0 ? copy[idx].token_number : 1) || 1,
          kot_count: ((idx >= 0 ? copy[idx].kot_count : 0) || 0) + 1,
          order_started_at: (idx >= 0 && copy[idx].order_started_at) ? copy[idx].order_started_at : nowIso,
          waiter_name: currentUser.full_name || currentUser.username || 'Waiter',
          customer_name: resolvedCustName || (idx >= 0 ? copy[idx].customer_name : ''),
          customer_phone: resolvedCustPhone || (idx >= 0 ? copy[idx].customer_phone : '')
        };

        if (idx >= 0) {
          copy[idx] = updatedTableObj;
        } else {
          copy.unshift(updatedTableObj);
        }
        return copy;
      });

      // Also add to recentOrders optimistically so it shows in All Orders immediately with clean KOT number!
      const cleanKotNumber = kotNo && kotNo !== 'OK' ? `KOT-${kotNo}` : `KOT-${Date.now().toString().slice(-4)}`;
      const newRecentOrder = {
        id: res?.order_id || 'kot_' + Date.now(),
        order_number: cleanKotNumber,
        bill_no: cleanKotNumber,
        table_number: targetTableNumber,
        waiter_name: currentUser.full_name || currentUser.username || 'Waiter',
        total: punchedItems.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.quantity || it.qty) || 1)), 0),
        created_at: nowIso,
        status: 'KOT Dispatched',
        items: punchedItems,
        department
      };
      setRecentOrders(prev => [newRecentOrder, ...(prev || [])]);

      // Reset cart and return to destinations view
      setIsCartOpen(false);
      setCart([]);
      setDestination(null);
      setActiveTab('orders');

      // Refresh live tables after short delay to let CRM process and sync
      setTimeout(() => fetchLiveData(true), 2500);
    } catch (err) {
      console.error('Order punch failed:', err);

      const isNetworkError =
        !navigator.onLine ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError') ||
        err.message?.includes('network') ||
        err.message?.includes('timeout') ||
        err.message?.includes('Load failed');

      if (isNetworkError) {
        addToOfflineQueue(orderPayload);
        setOfflineQueue(getOfflineQueue());
        setIsCartOpen(false);
        setCart([]);
        setDestination(null);
        setActiveTab('tables');
        showToast('⚡ Wi-Fi dropped! Order saved offline and will auto-sync.', 5000);
      } else {
        setModalConfig({
          type: 'alert',
          title: 'Order Punch Failed',
          message: err.message || 'Server error. Please verify table/room status.',
          icon: '❌',
          confirmText: 'Dismiss',
          confirmColor: 'var(--apple-red)'
        });
      }
    } finally {
      setIsPunching(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setCart([]);
    setDestination(null);
  };

  const handleRequestLogout = () => {
    setModalConfig({
      type: 'confirm',
      title: 'End Shift & Log Out?',
      message: `You are logged in as ${currentUser?.full_name || currentUser?.username}. Do you want to end your shift?`,
      icon: '🚪',
      confirmText: 'Log Out',
      cancelText: 'Stay Logged In',
      confirmColor: 'var(--apple-red)',
      onConfirm: () => {
        handleLogout();
      }
    });
  };

  // If user is not logged in, show permanent Login Screen
  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={setCurrentUser}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  // Count active tables attended by this waiter
  const myName = currentUser?.full_name || currentUser?.username || '';
  const myTablesCount = tables.filter((t) => {
    const isMine =
      (t.waiter_name && t.waiter_name.toLowerCase() === myName.toLowerCase()) ||
      (t.waiter_id && t.waiter_id === currentUser.id);
    const hasOrder = (t.status !== 'available' && t.status !== '') || (t.cart && t.cart.length > 0);
    return isMine && hasOrder;
  }).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100%',
        background: 'var(--bg-app)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Toast Alert Banner */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--apple-green)',
            color: 'var(--text-on-accent)',
            padding: '8px 18px',
            borderRadius: 'var(--radius-xl)',
            fontSize: '0.84rem',
            fontWeight: 850,
            boxShadow: 'var(--shadow-floating)',
            zIndex: 10001,
            animation: 'fadeInModal var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap'
          }}
        >
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header - only visible when choosing destination */}
      {!destination && (
        <HeaderBar
          user={currentUser}
          department={department}
          onOpenSettings={() => setIsSettingsOpen(true)}
          offlineCount={offlineQueue.length}
          isOnline={isOnline}
        />
      )}

      {/* Offline Pending Queue Banner */}
      {offlineQueue.length > 0 && (
        <div
          style={{
            padding: '7px 12px',
            background: 'linear-gradient(90deg, #f59e0b, #d97706)',
            color: '#ffffff',
            fontSize: '0.78rem',
            fontWeight: 850,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
            zIndex: 99
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>⚡</span>
            <span>
              <strong>{offlineQueue.length}</strong> offline order{offlineQueue.length > 1 ? 's' : ''} waiting to sync
            </span>
          </div>
          <button
            type="button"
            onClick={handleSyncOffline}
            disabled={isSyncing}
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-xs)',
              background: '#ffffff',
              color: '#b45309',
              fontSize: '0.72rem',
              fontWeight: 900,
              border: 'none',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>{isSyncing ? '⏳' : '🔄'}</span>
            <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      )}

      {/* Offline mode indicator if network is disconnected */}
      {!isOnline && (
        <div
          style={{
            padding: '5px 12px',
            background: 'var(--apple-red-subtle)',
            borderBottom: '1px solid var(--apple-red)',
            color: 'var(--apple-red)',
            fontSize: '0.74rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>📡 Offline Mode Active — Orders saved locally &amp; will sync once Wi-Fi reconnects</span>
        </div>
      )}

      {/* Server Status Warning if disconnected */}
      {serverStatus === 'error' && (
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--apple-red-subtle)',
            borderBottom: '1px solid var(--apple-red)',
            color: 'var(--apple-red)',
            fontSize: '0.74rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>⚠️ Connecting to POS Server... Check Wi-Fi connection</span>
          <button
            type="button"
            onClick={async () => {
              if (typeof api.fetchCloudTunnelUrl === 'function') {
                await api.fetchCloudTunnelUrl(true).catch(() => {});
              }
              fetchLiveData();
            }}
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-xs)',
              background: 'var(--apple-red)',
              color: 'var(--text-on-accent)',
              fontSize: '0.70rem',
              fontWeight: 800
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Department Switcher: RESTAURANT vs BAR - hidden when taking an order */}
      {!destination && (
        <DepartmentSwitcher
          department={department}
          onDepartmentChange={handleDepartmentChange}
        />
      )}

      {/* Main View Area: Either taking order for Destination or choosing Destination */}
      {destination ? (
        <MenuView
          destination={destination}
          department={department}
          menuItems={menuItems}
          categories={categories}
          cart={cart}
          onAddToCart={handleAddToCart}
          onUpdateCartQty={handleUpdateCartQty}
          onOpenCart={() => setIsCartOpen(true)}
          onBackToDestinations={() => setDestination(null)}
          isLoading={isLoadingMenu}
        />
      ) : (
        <>
          {/* Destination Navigation Tabs: Tables, Room Service, Parcels, My Orders */}
          <DestinationTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            department={department}
            myOrdersCount={myTablesCount}
          />

          {/* View corresponding to tab */}
          {activeTab === 'tables' && (
            <TablesView
              tables={tables}
              department={department}
              currentUser={currentUser}
              onSelectTable={handleSelectTable}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'rooms' && (
            <RoomServiceView
              rooms={occupiedRooms}
              onSelectRoom={handleSelectRoom}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'parcels' && (
            <ParcelsView
              department={department}
              onStartParcel={handleStartParcel}
            />
          )}

          {activeTab === 'orders' && (
            <MyOrdersView
              department={department}
              currentUser={currentUser}
              tables={tables}
              recentOrders={recentOrders}
              occupiedRooms={occupiedRooms}
              onSelectDestinationForMore={handleSelectDestinationForMore}
              onRefresh={() => fetchLiveData(true)}
              isLoading={isLoading}
              setTables={setTables}
            />
          )}
        </>
      )}

      {/* Floating Review Cart & KOT Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        destination={destination}
        department={department}
        cart={cart}
        onUpdateCartQty={handleUpdateCartQty}
        onClearCart={() => setCart([])}
        onPunchOrder={handlePunchOrder}
        isPunching={isPunching}
      />

      {/* Universal Themed Custom Dialog (replaces browser alert/confirm) */}
      <CustomModal
        config={modalConfig}
        onClose={() => setModalConfig(null)}
      />

      {/* Settings & Settled Bills Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        department={department}
        currentUser={currentUser}
        onLogout={handleRequestLogout}
        offlineQueue={offlineQueue}
        onSyncOffline={handleSyncOffline}
        isSyncing={isSyncing}
        installPrompt={installPrompt}
        onInstallPWA={handleInstallPWA}
      />
    </div>
  );
}
