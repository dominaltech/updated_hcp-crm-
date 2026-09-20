import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useHospitality } from '../context/HospitalityContext';
import StaffLittleBadge from '../components/common/StaffLittleBadge';

export default function Header() {
  const {
    currentUser,
    activePanel,
    setActivePanel,
    restaurantSubTab,
    setRestaurantSubTab,
    barSubTab,
    setBarSubTab,
    isManagerUnlocked,
    openManagerLock,
    theme,
    toggleTheme
  } = useApp();

  const hospitalityContext = useHospitality();
  const hospSubTab = hospitalityContext?.activeSubTab || 'rooms';
  const setHospSubTab = hospitalityContext?.setActiveSubTab || (() => {});

  const [currentTimeStr, setCurrentTimeStr] = useState('');

  // Live Digital Clock (every second)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-IN', { hour12: true });
      const dateStr = now.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      setCurrentTimeStr(`${dateStr} • ${timeStr}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine which of the 3 primary departments is currently active
  const activeDepartment =
    activePanel === 'restaurant'
      ? 'restaurant'
      : activePanel === 'bar'
      ? 'bar'
      : 'hospitality';

  return (
    <>
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="brand-section">
            <img src="/HCP_New_Logo_Png_witought-name-removebg.png" alt="Hotel City Park" className="brand-logo-img" />
            <div className="brand-text">
              <h1>Hotel City Park</h1>
              <p>Hospitality &amp; POS Suite</p>
            </div>
          </div>
        </div>

        {/* Navigation Section: 3 Little Department Switcher Icons on Left + Section Dynamic Navs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 3 Little Department Icons on Left */}
          <div
            id="dept-quick-switcher"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.07)',
              padding: '4px',
              borderRadius: '16px',
              gap: '4px'
            }}
          >
            <button
              type="button"
              id="icon-btn-hospitality"
              title="1) Hospitality / Front Desk"
              onClick={() => {
                setActivePanel('hospitality');
                setHospSubTab('rooms');
              }}
              style={{
                border: 'none',
                background: activeDepartment === 'hospitality' ? '#ffffff' : 'transparent',
                borderRadius: '11px',
                width: '38px',
                height: '38px',
                fontSize: '1.28rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow:
                  activeDepartment === 'hospitality' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                transform: activeDepartment === 'hospitality' ? 'scale(1.04)' : 'scale(1)',
                transition: 'all 0.15s ease'
              }}
            >
              🏨
            </button>
            <button
              type="button"
              id="icon-btn-restaurant"
              title="2) Restaurant POS"
              onClick={() => {
                setActivePanel('restaurant');
                if (setRestaurantSubTab) setRestaurantSubTab('tables');
              }}
              style={{
                border: 'none',
                background: activeDepartment === 'restaurant' ? '#ffffff' : 'transparent',
                borderRadius: '11px',
                width: '38px',
                height: '38px',
                fontSize: '1.28rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow:
                  activeDepartment === 'restaurant' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                transform: activeDepartment === 'restaurant' ? 'scale(1.04)' : 'scale(1)',
                transition: 'all 0.15s ease'
              }}
            >
              🍽️
            </button>
            <button
              type="button"
              id="icon-btn-bar"
              title="3) Bar Lounge POS"
              onClick={() => {
                setActivePanel('bar');
                if (setBarSubTab) setBarSubTab('tables');
              }}
              style={{
                border: 'none',
                background: activeDepartment === 'bar' ? '#ffffff' : 'transparent',
                borderRadius: '11px',
                width: '38px',
                height: '38px',
                fontSize: '1.28rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: activeDepartment === 'bar' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                transform: activeDepartment === 'bar' ? 'scale(1.04)' : 'scale(1)',
                transition: 'all 0.15s ease'
              }}
            >
              🍸
            </button>
          </div>

          {/* Dynamic Navs corresponding strictly to selected department */}
          <nav className="panel-nav">
            {/* 1) HOSPITALITY NAVS */}
            {activeDepartment === 'hospitality' && (
              <>
                <button
                  type="button"
                  className={`nav-tab-btn ${activePanel === 'hospitality' && hospSubTab === 'rooms' ? 'active' : ''}`}
                  id="tab-hosp-live-rooms"
                  onClick={() => {
                    setActivePanel('hospitality');
                    setHospSubTab('rooms');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  <span>Live Rooms</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${activePanel === 'expenses' ? 'active' : ''}`}
                  id="tab-hosp-expenses"
                  onClick={() => setActivePanel('expenses')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span>Expenses</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${activePanel === 'manage' ? 'active' : ''}`}
                  id="tab-hosp-manager"
                  onClick={() => {
                    if (!isManagerUnlocked) {
                      openManagerLock('hospitality');
                    } else {
                      setActivePanel('manage');
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Manager Panel</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${activePanel === 'hospitality' && hospSubTab === 'history' ? 'active' : ''}`}
                  id="tab-hosp-history"
                  onClick={() => {
                    setActivePanel('hospitality');
                    setHospSubTab('history');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>History</span>
                </button>
              </>
            )}

            {/* 2) RESTAURANT NAVS */}
            {activeDepartment === 'restaurant' && (
              <>
                <button
                  type="button"
                  className={`nav-tab-btn ${restaurantSubTab === 'tables' ? 'active' : ''}`}
                  id="tab-rest-tables"
                  onClick={() => {
                    setActivePanel('restaurant');
                    if (setRestaurantSubTab) setRestaurantSubTab('tables');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  <span>Live Tables</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${restaurantSubTab === 'settled' ? 'active' : ''}`}
                  id="tab-rest-settled"
                  onClick={() => {
                    setActivePanel('restaurant');
                    if (setRestaurantSubTab) setRestaurantSubTab('settled');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span>Settled Bills</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${restaurantSubTab === 'manager' ? 'active' : ''}`}
                  id="tab-rest-manager"
                  onClick={() => {
                    if (!isManagerUnlocked) {
                      openManagerLock('restaurant');
                    } else {
                      setActivePanel('restaurant');
                      if (setRestaurantSubTab) setRestaurantSubTab('manager');
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Manager Panel</span>
                </button>
              </>
            )}

            {/* 3) BAR LOUNGE NAVS */}
            {activeDepartment === 'bar' && (
              <>
                <button
                  type="button"
                  className={`nav-tab-btn ${barSubTab === 'tables' ? 'active' : ''}`}
                  id="tab-bar-tables"
                  onClick={() => {
                    setActivePanel('bar');
                    if (setBarSubTab) setBarSubTab('tables');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  <span>Live Tables</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${barSubTab === 'settled' ? 'active' : ''}`}
                  id="tab-bar-settled"
                  onClick={() => {
                    setActivePanel('bar');
                    if (setBarSubTab) setBarSubTab('settled');
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span>Settled Bills</span>
                </button>

                <button
                  type="button"
                  className={`nav-tab-btn ${barSubTab === 'manager' ? 'active' : ''}`}
                  id="tab-bar-manager"
                  onClick={() => {
                    if (!isManagerUnlocked) {
                      openManagerLock('bar');
                    } else {
                      setActivePanel('bar');
                      if (setBarSubTab) setBarSubTab('manager');
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Manager Panel</span>
                </button>
              </>
            )}
          </nav>
        </div>

        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Dark / Light Mode Switcher */}
          <button
            type="button"
            id="theme-toggle-btn"
            className={`theme-toggle-btn ${theme === 'dark' ? 'is-dark' : 'is-light'}`}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode (Ctrl+Shift+D)' : 'Switch to Dark Mode (Ctrl+Shift+D)'}
            aria-label="Toggle Theme"
          >
            <span className="theme-toggle-icon-box">
              {theme === 'dark' ? (
                <svg className="theme-icon moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg className="theme-icon sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              )}
            </span>
            <span className="theme-toggle-text">
              {theme === 'dark' ? 'Dark' : 'Light'}
            </span>
          </button>

          {/* Section-Aware Staff Little Badge with Icon */}
          <StaffLittleBadge
            section={
              activeDepartment === 'restaurant'
                ? 'restaurant'
                : activeDepartment === 'bar'
                ? 'bar'
                : activePanel === 'manage' || activePanel === 'expenses'
                ? 'manager'
                : 'hospitality'
            }
            id="header-user-badge"
          />

          <div className="live-clock" id="live-clock">
            <span className="live-pulse" />
            <span id="current-time-display">{currentTimeStr || '--:--:--'}</span>
          </div>
        </div>
      </header>
    </>
  );
}
