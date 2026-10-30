import React from 'react';
import { useApp } from '../context/AppContext';
import Header from './Header';
import ToastContainer from '../components/common/ToastContainer';
import ConfirmModal from '../components/common/ConfirmModal';
import CustomAlertModal from '../components/common/CustomAlertModal';
import StaffLoginModal from '../components/common/StaffLoginModal';
import CashierLogoutModal from '../components/common/CashierLogoutModal';
import ManagerLockModal from '../components/common/ManagerLockModal';
import SectionSelectModal from '../components/common/SectionSelectModal';

import { useHospitality } from '../context/HospitalityContext';

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
    managerLockTargetDept,
    unlockedSection,
    isSectionSelectOpen,
    closeSectionSelect,
    unlockSection
  } = useApp();

  let hospSubTab = 'rooms';
  try {
    const hosp = useHospitality();
    if (hosp?.activeSubTab) hospSubTab = hosp.activeSubTab;
  } catch (e) { }

  const isPosPanel = activePanel === 'restaurant' || activePanel === 'bar';
  const isHospitalityGrid = activePanel === 'hospitality' && !hasActiveFolio && hospSubTab === 'rooms';
  const isHospitalityHistory = activePanel === 'hospitality' && !hasActiveFolio && hospSubTab === 'history';
  const isFolioActive = Boolean(hasActiveFolio);

  return (
    <>
      {!isFolioActive && <Header />}
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
            : isHospitalityHistory
            ? {
                padding: '6px 18px 40px',
                maxWidth: '100%',
                minHeight: 'calc(100dvh - 68px)',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box'
              }
            : isFolioActive
            ? {
                padding: '0 18px 60px',
                maxWidth: '100%',
                minHeight: '100dvh',
                overflow: 'visible',
                boxSizing: 'border-box'
              }
            : {}
        }
      >
        {children}
      </main>
      <ToastContainer />
      <ConfirmModal />
      <CustomAlertModal />

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

      {/* Section Startup & Access Control Modal */}
      <SectionSelectModal
        isOpen={isSectionSelectOpen}
        canCancel={Boolean(unlockedSection)}
        onClose={closeSectionSelect}
        initialSection={unlockedSection || (['restaurant', 'bar'].includes(activePanel) ? activePanel : 'hospitality')}
        onUnlocked={unlockSection}
      />
    </>
  );
}
