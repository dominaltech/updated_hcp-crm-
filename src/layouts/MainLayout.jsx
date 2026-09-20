import React from 'react';
import { useApp } from '../context/AppContext';
import Header from './Header';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmModal from '../components/common/ConfirmModal';
import StaffLoginModal from '../components/common/StaffLoginModal';
import CashierLogoutModal from '../components/common/CashierLogoutModal';
import ManagerLockModal from '../components/common/ManagerLockModal';

export default function MainLayout({ children }) {
  const {
    activePanel,
    isStaffLoginOpen,
    closeStaffLogin,
    isCashierLogoutOpen,
    closeCashierLogout,
    openStaffLogin,
    loginTargetDepartment,
    logoutTargetDepartment,
    isLoginMandatory,
    isManagerLockModalOpen,
    closeManagerLock,
    managerLockTargetDept
  } = useApp();

  const isPosPanel = activePanel === 'restaurant' || activePanel === 'bar';

  return (
    <>
      <Header />
      <main
        className={`app-container ${isPosPanel ? 'pos-container' : ''}`}
        style={
          isPosPanel
            ? {
                padding: '6px 14px',
                maxWidth: '100%',
                height: 'calc(100dvh - 66px)',
                maxHeight: 'calc(100dvh - 66px)',
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box'
              }
            : {}
        }
      >
        {children}
      </main>
      <ToastContainer />
      <ConfirmModal />

      {/* Global Staff Shift Modals - Accessible from any section */}
      <StaffLoginModal
        isOpen={isStaffLoginOpen}
        onClose={closeStaffLogin}
        initialDepartment={loginTargetDepartment}
        isMandatory={isLoginMandatory}
      />
      <CashierLogoutModal
        isOpen={isCashierLogoutOpen}
        onClose={closeCashierLogout}
        onSwitchToLogin={() => {
          const dept = logoutTargetDepartment || (isPosPanel ? activePanel : 'hospitality');
          closeCashierLogout();
          openStaffLogin(dept);
        }}
      />
      <ManagerLockModal
        isOpen={isManagerLockModalOpen}
        onClose={closeManagerLock}
        targetDepartment={managerLockTargetDept}
      />
    </>
  );
}
