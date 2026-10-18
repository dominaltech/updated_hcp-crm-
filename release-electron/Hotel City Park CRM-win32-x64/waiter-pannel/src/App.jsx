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

  // 1. Fetch live tables, rooms, and orders
  const fetchLiveData = useCallback(async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      if (department === 'bar') {
        const res = await api.getBarTables();
        const rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
        setTables(rawTables);
      } else {
        const res = await api.getRestaurantTables();
        const rawTables = res && res.tables ? res.tables : (Array.isArray(res) ? res : []);
        setTables(rawTables);
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
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, department]);

  // 2. Fetch menu items and categories
  const fetchMenu = useCallback(async () => {
    if (!currentUser) return;
    setIsLoadingMenu(true);
    try {
      if (department === 'bar') {
        const [menuRes, catRes] = await Promise.all([
          api.getBarMenu(),
          api.getBarCategories()
        ]);
        setMenuItems((menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []));
        setCategories((catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []));
      } else {
        const [menuRes, catRes] = await Promise.all([
          api.getRestaurantMenu(),
          api.getRestaurantCategories()
        ]);
        setMenuItems((menuRes && menuRes.items) || (menuRes && menuRes.data) || (Array.isArray(menuRes) ? menuRes : []));
        setCategories((catRes && catRes.categories) || (catRes && catRes.data) || (Array.isArray(catRes) ? catRes : []));
      }
    } catch (err) {
      console.error('Menu fetch error:', err.message);
    } finally {
      setIsLoadingMenu(false);
    }
  }, [currentUser, department]);

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

  // Punch KOT order
  const handlePunchOrder = async ({ notes }) => {
    if (!destination || cart.length === 0) return;
    setIsPunching(true);
    try {
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
      setModalConfig({
        type: 'alert',
        title: 'Order Punch Failed',
        message: err.message || 'Server error. Please verify table/room status.',
        icon: '❌',
        confirmText: 'Dismiss',
        confirmColor: 'var(--apple-red)'
      });
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
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleRequestLogout}
      />

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
    </div>
  );
}
