import React from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

export default function CashierLogoutModal({ isOpen, onClose, onSwitchToLogin }) {
  const {
    currentUser,
    setCurrentUser,
    showToast,
    logoutTargetDepartment,
    getDepartmentStaff,
    logoutDepartmentStaff,
    openStaffLogin
  } = useApp();

  const targetDept = logoutTargetDepartment || (currentUser?.role || 'hospitality');
  const targetStaff = getDepartmentStaff ? getDepartmentStaff(targetDept) : currentUser;

  if (!isOpen || !targetStaff) return null;

  const initials = (targetStaff.full_name || targetStaff.username || 'C')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const handleLogout = async () => {
    try {
      await api.logoutShift({ username: targetStaff.username });
    } catch (e) {
      console.warn('Logout notification failed on backend:', e);
    }
    if (logoutDepartmentStaff) {
      logoutDepartmentStaff(targetDept);
    } else {
      api.clearAuthToken();
      setCurrentUser(null);
    }
    showToast('Logged out from cashier shift.', 'info', 4000);
    onClose();
    // Open login in mandatory lock mode: unable to click anywhere on app until someone logs in
    if (openStaffLogin) {
      openStaffLogin(targetDept, true);
    } else if (onSwitchToLogin) {
      onSwitchToLogin();
    }
  };

  return (
    <div
      className="modal-overlay active"
      id="modal-cashier-logout"
      onClick={(e) => {
        if (e.target.id === 'modal-cashier-logout') onClose();
      }}
      style={{
        zIndex: 10150,
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '80%',
          maxWidth: '680px',
          minHeight: '500px',
          borderRadius: '28px',
          overflow: 'hidden',
          boxShadow: '0 35px 80px rgba(0,0,0,0.4)',
          border: '2px solid #e2e8f0',
          background: '#ffffff',
          textAlign: 'center',
          position: 'relative',
          padding: '46px 36px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Subtle Close Button (Cancel) */}
        <button
          type="button"
          onClick={onClose}
          id="btn-close-cashier-logout"
          style={{
            position: 'absolute',
            right: '20px',
            top: '20px',
            background: '#f1f5f9',
            border: 'none',
            color: '#64748b',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: '1.35rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease'
          }}
          title="Cancel"
        >
          &times;
        </button>

        {/* 1. Profile Icon */}
        <div
          id="logout-cashier-avatar"
          style={{
            width: '96px',
            height: '96px',
            borderRadius: '30px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 950,
            fontSize: '2.6rem',
            boxShadow: '0 14px 30px rgba(2, 132, 199, 0.35)',
            marginBottom: '22px'
          }}
        >
          {initials}
        </div>

        {/* 2. Full Name (Bold & Bigger) */}
        <div
          id="logout-cashier-name"
          style={{
            fontSize: '2rem',
            fontWeight: 950,
            color: '#0f172a',
            letterSpacing: '-0.025em',
            lineHeight: 1.25,
            marginBottom: '10px'
          }}
        >
          {targetStaff.full_name || targetStaff.username}
        </div>

        {/* 3. Cashier ID (Bold & Bigger) */}
        <div
          id="logout-cashier-id"
          style={{
            fontSize: '1.22rem',
            fontWeight: 850,
            color: '#475569',
            marginBottom: '36px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>ID:</span>
          <code
            style={{
              fontSize: '1.25rem',
              fontWeight: 950,
              color: '#0f172a',
              background: '#f1f5f9',
              padding: '4px 14px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0'
            }}
          >
            {targetStaff.username}
          </code>
        </div>

        {/* 4. Logout Button (Bold & Bigger) */}
        <button
          type="button"
          id="btn-confirm-cashier-logout"
          onClick={handleLogout}
          style={{
            width: '100%',
            height: '58px',
            fontSize: '1.25rem',
            fontWeight: 950,
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            boxShadow: '0 8px 24px rgba(220, 38, 38, 0.4)',
            letterSpacing: '0.01em',
            transition: 'all 0.15s ease'
          }}
        >
          <span style={{ fontSize: '1.45rem' }}>🚪</span> Log Out
        </button>
      </div>
    </div>
  );
}
