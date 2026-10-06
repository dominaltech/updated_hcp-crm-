import React from 'react';
import { useApp } from '../context/AppContext';
import Header from './Header';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmModal from '../components/common/ConfirmModal';
import StaffLoginModal from '../components/common/StaffLoginModal';
import CashierLogoutModal from '../components/common/CashierLogoutModal';
import ManagerLockModal from '../components/common/ManagerLockModal';

export default function MainLayout({ children, hasActiveFolio = false }) {
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
  const isHospitalityGrid = activePanel === 'hospitality' && !hasActiveFolio;
  const isFolioActive = Boolean(hasActiveFolio);

  return (
    <>
      <Header />
      <main
        className={`app-container ${isPosPanel ? 'pos-container' : ''} ${isHospitalityGrid ? 'hospitality-container' : ''} ${isFolioActive ? 'folio-active-container' : ''}`}
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
            : isHospitalityGrid
            ? {
                padding: '2px 18px 2px',
                maxWidth: '100%',
                height: 'calc(100dvh - 68px)',
                maxHeight: 'calc(100dvh - 68px)',
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box'
              }
            : isFolioActive
            ? {
                padding: '2px 18px 60px',
                maxWidth: '100%',
                minHeight: 'calc(100dvh - 68px)',
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
