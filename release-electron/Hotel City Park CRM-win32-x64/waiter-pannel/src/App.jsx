import React, { useState, useEffect, useCallback } from 'react';
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
      return 'dark';
    } catch {
      return 'dark';
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

  const [activeTab, setActiveTab] = useState('tables'); // 'tables' | 'rooms' | 'parcels' | 'orders'
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

  const showToast = (message, duration = 4000) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? '' : prev));
    }, duration);
  };

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

  // 1. Fetch live tables, rooms, and orders with offline cache backup
  const fetchLiveData = useCallback(async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      if (department === 'bar') {
        const res = await api.getBarTables();
        const rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
        setTables(rawTables);
        setCachedTables('bar', rawTables);
      } else {
        const res = await api.getRestaurantTables();
        const rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
        setTables(rawTables);
        setCachedTables('restaurant', rawTables);
      }

      // Fetch occupied rooms for Room Service
      try {
        const rooms = await api.getOccupiedRooms();
        setOccupiedRooms(rooms);
      } catch (rErr) {
        console.warn('Occupied rooms fetch warning:', rErr.message);
      }

      // Fetch recent orders
      try {
        const ordRes = department === 'bar' ? await api.getBarOrders() : await api.getRestaurantOrders();
        const ordList = (ordRes && ordRes.orders) || (ordRes && ordRes.data) || [];
        setRecentOrders(ordList);
      } catch (oErr) {
        console.warn('Recent orders fetch warning:', oErr.message);
      }

      setServerStatus('connected');
    } catch (err) {
      console.error('Data fetch error:', err.message);
      setServerStatus('error');
      // Load cached tables if current tables list is empty
      const cached = getCachedTables(department);
      if (cached && cached.length > 0) {
        setTables((prev) => (prev && prev.length > 0 ? prev : cached));
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, department]);

  // 2. Fetch menu items and categories with offline cache backup
  const fetchMenu = useCallback(async () => {
    if (!currentUser) return;
    setIsLoadingMenu(true);
    try {
      if (department === 'bar') {
        const [menuRes, catRes] = await Promise.all([
          api.getBarMenu(),
          api.getBarCategories()
        ]);
        const items = (menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []);
        const cats = (catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []);
        setMenuItems(items);
        setCategories(cats);
        setCachedMenu('bar', items, cats);
      } else {
        const [menuRes, catRes] = await Promise.all([
          api.getRestaurantMenu(),
          api.getRestaurantCategories()
        ]);
        const items = (menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []);
        const cats = (catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []);
        setMenuItems(items);
        setCategories(cats);
        setCachedMenu('restaurant', items, cats);
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

  // Auto-refresh tables periodically every 12 seconds when idle
  useEffect(() => {
    if (!currentUser || destination) return;
    const interval = setInterval(() => {
      fetchLiveData();
    }, 12000);
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

  // Destination pickers
  const handleSelectTable = (table) => {
    setDestination({
      type: 'table',
      id: table.id,
      label: table.name || table.table_number || `Table ${table.id}`,
      rawTable: table
    });
    setCart([]);
  };

  const handleSelectRoom = (room) => {
    setDestination({
      type: 'room',
      id: room.id,
      label: `Room ${room.room_number} • ${room.guest_name || 'Guest'}`,
      guest_phone: room.guest_phone,
      guest_name: room.guest_name,
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
  const handlePunchOrder = async ({ notes }) => {
    if (!destination || cart.length === 0) return;
    setIsPunching(true);

    const orderPayload = {
      department,
      destination_type: destination.type,
      destination_id: destination.id,
      destination_label: destination.label,
      items: cart,
      waiter_id: currentUser.id,
      waiter_name: currentUser.full_name || currentUser.username,
      notes
    };

    // If device is explicitly offline
    if (!navigator.onLine) {
      addToOfflineQueue(orderPayload);
      setOfflineQueue(getOfflineQueue());
      setIsCartOpen(false);
      setCart([]);
      setDestination(null);
      setActiveTab('tables');
      setIsPunching(false);
      showToast('⚡ Saved Offline! Will auto-sync when Wi-Fi connects.', 5000);
      return;
    }

    try {
      const res = await api.punchOrder(orderPayload);

      const kotNo = res?.kotNumber || res?.botNumber || res?.order_id || 'OK';
      const tokenNo = res?.tokenNumber ? ` (Token #${res.tokenNumber})` : '';

      showToast(`🚀 Order Punched & KOT #${kotNo}${tokenNo} dispatched!`);

      // Reset cart and return to destinations view
      setIsCartOpen(false);
      setCart([]);
      setDestination(null);
      setActiveTab('tables');

      // Refresh live tables and orders
      fetchLiveData();
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

      {/* Top Header */}
      <HeaderBar
        user={currentUser}
        department={department}
        onOpenSettings={() => setIsSettingsOpen(true)}
        offlineCount={offlineQueue.length}
        isOnline={isOnline}
      />

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
            onClick={fetchLiveData}
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

      {/* Department Switcher: RESTAURANT vs BAR */}
      <DepartmentSwitcher
        department={department}
        onDepartmentChange={handleDepartmentChange}
      />

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
              onSelectDestinationForMore={handleSelectTable}
              onRefresh={fetchLiveData}
              isLoading={isLoading}
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
