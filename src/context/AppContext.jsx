import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Current logged in staff
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const token = localStorage.getItem('hotel_auth_token');
      if (!token) return null;
      return JSON.parse(localStorage.getItem('hotel_staff_user') || 'null');
    } catch {
      return null;
    }
  });

  // Department-specific staff sessions (hospitality, restaurant, bar, manager)
  const [departmentStaff, setDepartmentStaff] = useState(() => {
    try {
      const saved = localStorage.getItem('hotel_department_staff');
      if (saved) return JSON.parse(saved);
      const single = localStorage.getItem('hotel_staff_user');
      if (single) {
        const u = JSON.parse(single);
        return { [u.role || 'hospitality']: u };
      }
      return {};
    } catch {
      return {};
    }
  });

  // Department-specific tokens
  const [departmentTokens, setDepartmentTokens] = useState(() => {
    try {
      const saved = localStorage.getItem('hotel_department_tokens');
      if (saved) return JSON.parse(saved);
      const single = localStorage.getItem('hotel_auth_token');
      if (single) {
        return { default: single };
      }
      return {};
    } catch {
      return {};
    }
  });

  // Active panel
  const [activePanel, setActivePanelState] = useState(() => {
    const path = window.location.pathname.replace('/', '').toLowerCase();
    if (['hospitality', 'restaurant', 'bar', 'manage', 'expenses'].includes(path)) {
      return path;
    }
    return 'hospitality';
  });

  const [previousPanel, setPreviousPanel] = useState(null);
  const [restaurantSubTab, setRestaurantSubTab] = useState('tables');
  const [barSubTab, setBarSubTab] = useState('tables');

  // Dark Theme Management ('light' | 'dark')
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem('hcp_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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

  // Sync DOM attributes on mount or theme changes
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

  // Global Keyboard Shortcut: Ctrl+Shift+D or Alt+T to toggle theme
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) ||
          (e.altKey && (e.key === 'T' || e.key === 't'))) {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTheme]);

  // Card & UPI Surcharge Settings (Managed via Manager Panel)
  const [surchargeSettings, setSurchargeSettings] = useState({
    card_surcharge_pct: 2.5,
    upi_tax_pct: 0.4,
    upi_tax_threshold: 2000
  });

  const refreshSurcharges = useCallback(async () => {
    try {
      const res = await api.getSurcharges();
      if (res && res.success) {
        setSurchargeSettings({
          card_surcharge_pct: res.card_surcharge_pct !== undefined ? Number(res.card_surcharge_pct) : 2.5,
          upi_tax_pct: res.upi_tax_pct !== undefined ? Number(res.upi_tax_pct) : 0.4,
          upi_tax_threshold: res.upi_tax_threshold !== undefined ? Number(res.upi_tax_threshold) : 2000
        });
      }
    } catch (err) {
      console.warn('Could not fetch surcharge settings:', err);
    }
  }, []);

  useEffect(() => {
    refreshSurcharges();
  }, [refreshSurcharges]);

  // Minimum Check-In Advance Payment Percentage (Managed via Manager Panel)
  const [minCheckinAdvancePct, setMinCheckinAdvancePct] = useState(50);

  const refreshCheckinPolicy = useCallback(async () => {
    try {
      const res = await api.getCheckinPolicy();
      if (res && res.success && res.min_checkin_advance_pct !== undefined) {
        setMinCheckinAdvancePct(Number(res.min_checkin_advance_pct));
      }
    } catch (err) {
      console.warn('Could not fetch checkin policy setting:', err);
    }
  }, []);

  useEffect(() => {
    refreshCheckinPolicy();
  }, [refreshCheckinPolicy]);

  const getDepartmentStaff = useCallback((dept) => {
    if (!dept) return currentUser;
    if (departmentStaff[dept]) return departmentStaff[dept];
    if (departmentStaff.manager) return departmentStaff.manager;
    return null;
  }, [departmentStaff, currentUser]);

  const setActivePanel = (panel) => {
    const valid = ['hospitality', 'restaurant', 'bar', 'manage', 'expenses'];
    const target = valid.includes(panel) ? panel : 'hospitality';
    if (target !== activePanel) {
      setPreviousPanel(activePanel);
    }
    setActivePanelState(target);
    window.history.pushState({}, '', `/${target}`);

    // Department sync: update active user & token for target section
    const targetDept = target === 'manage' ? 'manager' : target;
    const targetUser = departmentStaff[targetDept] || departmentStaff.manager || null;
    const targetToken = departmentTokens[targetDept] || departmentTokens.manager || departmentTokens.default || null;

    if (targetUser) {
      setCurrentUser(targetUser);
      if (targetToken) api.setAuthToken(targetToken);
    } else {
      if (departmentStaff.manager) {
        setCurrentUser(departmentStaff.manager);
        if (departmentTokens.manager) api.setAuthToken(departmentTokens.manager);
      } else {
        const savedToken = localStorage.getItem('hotel_auth_token');
        if (!savedToken && !isManagerUnlocked) {
          setCurrentUser(null);
          api.clearAuthToken();
        }
      }
    }
  };

  const goBackPanel = () => {
    if (previousPanel && previousPanel !== activePanel) {
      const target = previousPanel;
      setPreviousPanel(activePanel);
      setActivePanelState(target);
      window.history.pushState({}, '', `/${target}`);
    } else {
      setActivePanelState('hospitality');
      window.history.pushState({}, '', '/hospitality');
    }
  };

  // Toast Alerts
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, type = 'red', duration = 6000) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    let colorClass = 'alert-red';
    let icon = '⚠️';
    if (type === 'success' || type === 'green') {
      colorClass = 'alert-green';
      icon = '✓';
    } else if (type === 'info' || type === 'blue') {
      colorClass = 'alert-blue';
      icon = 'ℹ️';
    }

    setToast({
      message,
      colorClass,
      icon,
      duration,
      visible: true
    });

    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, visible: false } : null));
      setTimeout(() => setToast(null), 320);
    }, duration);
  }, []);

  const hideToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast((prev) => (prev ? { ...prev, visible: false } : null));
    setTimeout(() => setToast(null), 320);
  }, []);

  // Global window.alert override: route any native browser alert call to custom red alert toast
  useEffect(() => {
    window.alert = (message) => {
      showToast(String(message), 'red', 6000);
    };
  }, [showToast]);

  // Universal Custom Confirm Modal
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: 'Confirmation',
    message: 'Are you sure you want to proceed?',
    icon: '⚠️',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    isDestructive: false,
    resolver: null
  });

  const showConfirm = useCallback((options, optionalCallbackOrMsg) => {
    return new Promise((resolve) => {
      let title = 'Confirmation';
      let message = 'Are you sure you want to proceed?';
      let icon = '⚠️';
      let confirmText = 'Confirm';
      let cancelText = 'Cancel';
      let isDestructive = false;
      let callback = null;

      if (typeof options === 'string') {
        if (typeof optionalCallbackOrMsg === 'function') {
          message = options;
          callback = optionalCallbackOrMsg;
        } else {
          message = options;
          if (typeof optionalCallbackOrMsg === 'string') message = optionalCallbackOrMsg;
        }
        isDestructive = true;
      } else if (options && typeof options === 'object') {
        title = options.title || title;
        message = options.message || message;
        icon = options.icon || icon;
        confirmText = options.confirmText || confirmText;
        cancelText = options.cancelText || cancelText;
        isDestructive = options.isDestructive || false;
        if (typeof optionalCallbackOrMsg === 'function') {
          callback = optionalCallbackOrMsg;
        }
      }

      setConfirmState({
        isOpen: true,
        title,
        message,
        icon,
        confirmText,
        cancelText,
        isDestructive,
        resolver: (val) => {
          if (val && callback) callback();
          resolve(val);
        }
      });
    });
  }, []);

  const handleConfirmOk = () => {
    if (confirmState.resolver) confirmState.resolver(true);
    setConfirmState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  };

  const handleConfirmCancel = () => {
    if (confirmState.resolver) confirmState.resolver(false);
    setConfirmState((prev) => ({ ...prev, isOpen: false, resolver: null }));
  };

  // Capacity Exceeded Modal
  const [capacityModal, setCapacityModal] = useState({
    isOpen: false,
    message: '',
    onAddRooms: null,
    onProceedSingle: null
  });

  const openCapacityModal = useCallback((message, onAddRooms, onProceedSingle) => {
    setCapacityModal({
      isOpen: true,
      message,
      onAddRooms,
      onProceedSingle
    });
  }, []);

  const closeCapacityModal = useCallback(() => {
    setCapacityModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Sync user state with localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('hotel_staff_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('hotel_staff_user');
      localStorage.removeItem('hotel_auth_token');
    }
  }, [currentUser]);

  // Listen for unauthorized 401 events to clear stale session
  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
    };
    window.addEventListener('hotel:auth_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('hotel:auth_unauthorized', handleUnauthorized);
  }, []);

  // Shift Login & Logout Modal Global State
  const [isStaffLoginOpen, setIsStaffLoginOpen] = useState(false);
  const [isCashierLogoutOpen, setIsCashierLogoutOpen] = useState(false);
  const [loginTargetDepartment, setLoginTargetDepartment] = useState(null);
  const [logoutTargetDepartment, setLogoutTargetDepartment] = useState(null);
  const [isLoginMandatory, setIsLoginMandatory] = useState(() => {
    return localStorage.getItem('hotel_mandatory_login') === 'true';
  });

  // Login a staff member for a department
  const loginDepartmentStaff = useCallback((dept, user, token) => {
    const roleKey = dept || user.role || 'hospitality';
    setDepartmentStaff((prev) => {
      const updated = { ...prev, [roleKey]: user };
      localStorage.setItem('hotel_department_staff', JSON.stringify(updated));
      return updated;
    });

    if (token) {
      setDepartmentTokens((prev) => {
        const updated = { ...prev, [roleKey]: token, default: token };
        localStorage.setItem('hotel_department_tokens', JSON.stringify(updated));
        return updated;
      });
      api.setAuthToken(token);
    }

    setCurrentUser(user);
    localStorage.setItem('hotel_staff_user', JSON.stringify(user));
    setIsLoginMandatory(false);
    localStorage.removeItem('hotel_mandatory_login');
    setIsStaffLoginOpen(false);
    setLoginTargetDepartment(null);
  }, []);

  // Logout a staff member from a department
  const logoutDepartmentStaff = useCallback((dept) => {
    const roleKey = dept || (currentUser?.role) || 'hospitality';
    setDepartmentStaff((prev) => {
      const updated = { ...prev };
      delete updated[roleKey];
      localStorage.setItem('hotel_department_staff', JSON.stringify(updated));
      return updated;
    });

    setDepartmentTokens((prev) => {
      const updated = { ...prev };
      delete updated[roleKey];
      localStorage.setItem('hotel_department_tokens', JSON.stringify(updated));
      return updated;
    });

    if (!dept || currentUser?.role === roleKey) {
      setCurrentUser(null);
      api.clearAuthToken();
      localStorage.removeItem('hotel_staff_user');
      localStorage.removeItem('hotel_auth_token');
    }
  }, [currentUser]);

  const openStaffLogin = useCallback((department = null, mandatory = false) => {
    setLoginTargetDepartment(department);
    if (mandatory) {
      setIsLoginMandatory(true);
      localStorage.setItem('hotel_mandatory_login', 'true');
    }
    setIsStaffLoginOpen(true);
  }, []);

  const closeStaffLogin = useCallback((force = false) => {
    if (!force && isLoginMandatory) return; // Block closing if login is mandatory
    setIsStaffLoginOpen(false);
    setLoginTargetDepartment(null);
  }, [isLoginMandatory]);

  // Open mandatory login on mount if locked
  useEffect(() => {
    if (isLoginMandatory && !currentUser) {
      setIsStaffLoginOpen(true);
    }
  }, [isLoginMandatory, currentUser]);

  const openCashierLogout = useCallback((department = null) => {
    setLogoutTargetDepartment(department);
    setIsCashierLogoutOpen(true);
  }, []);

  const closeCashierLogout = useCallback(() => {
    setIsCashierLogoutOpen(false);
    setLogoutTargetDepartment(null);
  }, []);

  // Manager Panel Lock State (Locks immediately upon leaving the panel)
  const [isManagerUnlocked, setIsManagerUnlocked] = useState(false);
  const [isManagerLockModalOpen, setIsManagerLockModalOpen] = useState(false);
  const [managerLockTargetDept, setManagerLockTargetDept] = useState('hospitality');

  const openManagerLock = useCallback((dept = 'hospitality') => {
    setManagerLockTargetDept(dept);
    setIsManagerLockModalOpen(true);
  }, []);

  const closeManagerLock = useCallback(() => {
    setIsManagerLockModalOpen(false);
  }, []);

  const unlockManager = useCallback((authenticatedUser, token) => {
    setIsManagerUnlocked(true);
    setIsManagerLockModalOpen(false);

    if (token) {
      api.setAuthToken(token);
    }

    if (authenticatedUser) {
      loginDepartmentStaff('manager', authenticatedUser, token);
    }

    if (managerLockTargetDept === 'restaurant') {
      setActivePanelState('restaurant');
      setRestaurantSubTab('manager');
      window.history.pushState({}, '', '/restaurant');
    } else if (managerLockTargetDept === 'bar') {
      setActivePanelState('bar');
      setBarSubTab('manager');
      window.history.pushState({}, '', '/bar');
    } else {
      setActivePanelState('manage');
      window.history.pushState({}, '', '/manage');
    }

    showToast('🔓 Manager Panel unlocked', 'green');
  }, [managerLockTargetDept, loginDepartmentStaff, showToast]);

  const lockManager = useCallback((manual = false) => {
    setIsManagerUnlocked(false);

    setActivePanelState((prev) => {
      if (prev === 'manage') {
        window.history.pushState({}, '', '/hospitality');
        return 'hospitality';
      }
      return prev;
    });

    setRestaurantSubTab((prev) => (prev === 'manager' ? 'tables' : prev));
    setBarSubTab((prev) => (prev === 'manager' ? 'tables' : prev));

    if (manual) {
      showToast('🔒 Manager Panel locked', 'blue');
    }
  }, [showToast]);

  // Immediately lock as soon as user navigates out of the manager tab/panel
  useEffect(() => {
    const isCurrentlyOnManager =
      activePanel === 'manage' ||
      (activePanel === 'restaurant' && restaurantSubTab === 'manager') ||
      (activePanel === 'bar' && barSubTab === 'manager');

    if (!isCurrentlyOnManager && isManagerUnlocked) {
      setIsManagerUnlocked(false);
    }
  }, [activePanel, restaurantSubTab, barSubTab, isManagerUnlocked]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace('/', '').toLowerCase();
      if (['hospitality', 'restaurant', 'bar', 'manage', 'expenses'].includes(path)) {
        setActivePanelState(path);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const value = {
    currentUser,
    setCurrentUser,
    activePanel,
    setActivePanel,
    previousPanel,
    goBackPanel,
    showToast,
    hideToast,
    toast,
    showConfirm,
    confirmState,
    handleConfirmOk,
    handleConfirmCancel,
    capacityModal,
    openCapacityModal,
    closeCapacityModal,
    isStaffLoginOpen,
    isCashierLogoutOpen,
    loginTargetDepartment,
    logoutTargetDepartment,
    isLoginMandatory,
    setIsLoginMandatory,
    openStaffLogin,
    closeStaffLogin,
    openCashierLogout,
    closeCashierLogout,
    departmentStaff,
    getDepartmentStaff,
    loginDepartmentStaff,
    logoutDepartmentStaff,
    restaurantSubTab,
    setRestaurantSubTab,
    barSubTab,
    setBarSubTab,
    isManagerUnlocked,
    isManagerLockModalOpen,
    managerLockTargetDept,
    openManagerLock,
    closeManagerLock,
    unlockManager,
    lockManager,
    surchargeSettings,
    refreshSurcharges,
    minCheckinAdvancePct,
    setMinCheckinAdvancePct,
    refreshCheckinPolicy,
    theme,
    setTheme,
    toggleTheme
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
