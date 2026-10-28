import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { HospitalityProvider, useHospitality } from './context/HospitalityContext';
import MainLayout from './layouts/MainLayout';
import HospitalityPage from './pages/HospitalityPage';
import RoomFolioPage from './pages/RoomFolioPage';
import RestaurantPage from './pages/RestaurantPage';
import BarPage from './pages/BarPage';
import ExpensesPage from './pages/ExpensesPage';
import ManagePage from './pages/ManagePage';
import GuestOrderPage from './pages/GuestOrderPage';
import CheckinWizardModal from './components/hospitality/CheckinWizard/CheckinWizardModal';
import CheckinSplitReceiptsModal from './components/hospitality/CheckinSplitReceiptsModal';
import RoomVisitorsModal from './components/hospitality/RoomVisitorsModal';
import CapacityModal from './components/common/CapacityModal';
import FnBCashHandoverModal from './components/restaurant/FnBCashHandoverModal';
import PrintTemplatesContainer from './components/common/PrintTemplatesContainer';
import {
  printGuestRegistrationA4,
  printPettyCashVoucher,
  printDailyClosingReport,
  printKOTSlip,
  printBOTSlip,
  printPreBillSlip,
  printThermalBillSlip
} from './services/printService';
import { api } from './services/api';
import { socketClient } from './services/socketClient';

function AppContent() {
  const { activePanel, showConfirm, showToast, confirmState, capacityModal, isFnbCashHandoverOpen, setIsFnbCashHandoverOpen, currentUser } = useApp();
  const { rooms, loadRooms, refreshRooms } = useHospitality();

  // Active Folio State (when inspecting a room stay)
  const [activeFolioRoom, setActiveFolioRoom] = useState(null);

  // Checkin Wizard Modal State
  const [checkinRoom, setCheckinRoom] = useState(null);
  const [checkinAdditionalRooms, setCheckinAdditionalRooms] = useState([]);
  const [splitReceiptsData, setSplitReceiptsData] = useState(null);

  // Room Visitors Modal State
  const [visitorsRoom, setVisitorsRoom] = useState(null);

  // Clean, reactive modal scroll lock without MutationObserver or infinite loops
  const isAnyModalOpen = Boolean(
    checkinRoom ||
    visitorsRoom ||
    splitReceiptsData ||
    (confirmState && confirmState.isOpen) ||
    (capacityModal && capacityModal.isOpen)
  );

  useEffect(() => {
    if (isAnyModalOpen) {
      const scrollY = window.scrollY;
      if (!document.body.dataset.scrollY) {
        document.body.dataset.scrollY = String(scrollY);
      }
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    } else {
      const savedScrollY = parseInt(document.body.dataset.scrollY || '0', 10);
      delete document.body.dataset.scrollY;
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
      if (savedScrollY > 0) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: savedScrollY, behavior: 'instant' });
        });
      }
    }
    return () => {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    };
  }, [isAnyModalOpen]);

  // Instant WebSocket Print Dispatcher + Quiet Heartbeat Fallback
  useEffect(() => {
    if (activePanel !== 'restaurant' && activePanel !== 'bar') {
      return;
    }

    const processSingleJob = async (job) => {
      if (!job || job.printed) return;
      try {
        const jobDept = String(job.data?.department || (job.type === 'kot' ? 'restaurant' : job.type === 'bot' ? 'bar' : '')).toLowerCase();
        
        // Prevent cross-department printing between dedicated restaurant and bar counters
        if (jobDept) {
          if (activePanel === 'restaurant' && jobDept !== 'restaurant') return;
          if (activePanel === 'bar' && jobDept !== 'bar') return;
        }

        if (activePanel === 'restaurant' && job.type === 'kot') {
          printKOTSlip(job.data?.kot || job.data, job.data?.tableNumber, job.data?.waiterName, job.data?.notes);
        } else if (activePanel === 'bar' && job.type === 'bot') {
          printBOTSlip(job.data?.bot || job.data, job.data?.tableNumber, job.data?.waiterName, job.data?.notes);
        } else if (job.type === 'prebill') {
          printPreBillSlip(job.data?.table || { table_number: job.data?.tableNumber }, job.data?.items, job.data?.waiterName, job.data?.department);
        } else if (job.type === 'bill' || job.type === 'settle' || job.type === 'receipt') {
          const ord = job.data?.order || job.data;
          const isBar = String(job.data?.department || ord?.department || activePanel).toLowerCase() === 'bar';
          printThermalBillSlip(ord, isBar ? 'HOTEL CITY PARK - BAR & LOUNGE' : 'Restaurant Bill/Cheque');
        }
      } catch (err) {
        console.error('[AutoPrint] Error processing print job:', job.id, err);
      } finally {
        if (job.id) await api.ackPrintJob(job.id).catch(() => {});
      }
    };

    // 1. Instant push arrival via WebSocket (<10ms)
    const unsubWs = socketClient.on('PRINT_JOB', (job) => {
      processSingleJob(job);
    });

    // 2. Quiet fallback poller (every 15s instead of 1.5s, no database strain)
    let isProcessing = false;
    const pollPrintQueue = async () => {
      if (isProcessing) return;
      try {
        isProcessing = true;
        const res = await api.getPendingPrintJobs({ dept: activePanel });
        if (res && res.success && Array.isArray(res.jobs) && res.jobs.length > 0) {
          for (const job of res.jobs) {
            await processSingleJob(job);
          }
        }
      } catch (e) {
      } finally {
        isProcessing = false;
      }
    };

    const interval = setInterval(pollPrintQueue, 15000);
    return () => {
      unsubWs();
      clearInterval(interval);
    };
  }, [activePanel]);

  // Handlers for Hospitality Page
  const handleStartCheckin = (primaryRoom, additionalRooms = []) => {
    setCheckinRoom(primaryRoom);
    setCheckinAdditionalRooms(additionalRooms);
  };

  const handleOpenFolio = (room) => {
    setActiveFolioRoom(room);
  };

  const handleOpenVisitors = (room) => {
    setVisitorsRoom(room);
  };

  const handleCheckinSuccess = async (bookingData, splitReceipts) => {
    if (typeof refreshRooms === 'function') {
      refreshRooms();
    } else if (typeof loadRooms === 'function') {
      loadRooms();
    }
    setCheckinRoom(null);
    setCheckinAdditionalRooms([]);

    if (splitReceipts && Array.isArray(splitReceipts.receipts) && splitReceipts.receipts.length >= 1) {
      setSplitReceiptsData(splitReceipts);
    }
  };

  const handleReprintRegForm = (folio) => {
    if (!folio) return;
    const r = folio.room || folio;
    const summary = folio.summary || {};
    printGuestRegistrationA4({
      ...r,
      ...folio,
      room: r,
      summary,
      isOccupiedStay: true,
      stayStatus: 'OCCUPIED'
    }, { includePhotos: false });
  };

  const handleCheckoutDone = () => {
    setActiveFolioRoom(null);
    if (typeof refreshRooms === 'function') {
      refreshRooms();
    } else if (typeof loadRooms === 'function') {
      loadRooms();
    }
  };

  const isGuestDiningPath = (typeof window !== 'undefined') && (
    window.location.pathname.startsWith('/guest-order') ||
    window.location.pathname.startsWith('/dine') ||
    new URLSearchParams(window.location.search).has('token')
  );

  if (isGuestDiningPath) {
    return <GuestOrderPage />;
  }

  return (
    <MainLayout hasActiveFolio={Boolean(activeFolioRoom)}>
      {/* Hospitality Panel */}
      {activePanel === 'hospitality' && (
        activeFolioRoom ? (
          <RoomFolioPage
            key={activeFolioRoom.room_number || activeFolioRoom.id}
            roomId={activeFolioRoom.room_number || activeFolioRoom.id}
            initialRoom={activeFolioRoom}
            onBack={() => setActiveFolioRoom(null)}
            onReprintRegForm={handleReprintRegForm}
            onOpenVisitors={() => setVisitorsRoom(activeFolioRoom)}
            onCheckoutDone={handleCheckoutDone}
          />
        ) : (
          <HospitalityPage
            onStartCheckin={handleStartCheckin}
            onOpenFolio={handleOpenFolio}
            onOpenVisitors={handleOpenVisitors}
          />
        )
      )}

      {/* Restaurant Panel */}
      {activePanel === 'restaurant' && (
        <RestaurantPage
          onPrintKOTSlip={(kotData) => printKOTSlip(kotData?.kot || kotData, kotData?.tableNumber, kotData?.waiterName)}
          onPrintBillSlip={(bill) => printThermalBillSlip(bill, 'Restaurant Bill/Cheque')}
        />
      )}

      {/* Bar Lounge Panel */}
      {activePanel === 'bar' && (
        <BarPage
          onPrintBOTSlip={(botData) => printBOTSlip(botData?.bot || botData, botData?.tableNumber, botData?.waiterName)}
          onPrintBillSlip={(bill) => printThermalBillSlip(bill, 'HOTEL CITY PARK - BAR & LOUNGE')}
        />
      )}

      {/* Expenses Panel */}
      {activePanel === 'expenses' && (
        <ExpensesPage
          onPrintVoucher={(voucher) => printPettyCashVoucher(voucher)}
        />
      )}

      {/* Management & Analytics Panel */}
      {activePanel === 'manage' && (
        <ManagePage
          onPrintClosingReport={(data) => printDailyClosingReport(data)}
        />
      )}

      {/* Checkin Wizard Modal */}
      {checkinRoom && (
        <CheckinWizardModal
          isOpen={Boolean(checkinRoom)}
          room={checkinRoom}
          additionalRooms={checkinAdditionalRooms}
          onClose={() => {
            setCheckinRoom(null);
            setCheckinAdditionalRooms([]);
          }}
          onCheckinSuccess={handleCheckinSuccess}
        />
      )}

      {/* Checkin Split Payment Receipts Modal */}
      {splitReceiptsData && (
        <CheckinSplitReceiptsModal
          isOpen={Boolean(splitReceiptsData)}
          data={splitReceiptsData}
          onClose={() => setSplitReceiptsData(null)}
        />
      )}

      {/* Room Visitors Modal */}
      <RoomVisitorsModal
        isOpen={Boolean(visitorsRoom)}
        room={visitorsRoom}
        onClose={() => setVisitorsRoom(null)}
        onVisitorUpdated={refreshRooms}
      />

      {/* Capacity Warning Modal */}
      <CapacityModal />

      {/* F&B Cash Handover Statement Modal & 2-Copy A4 Print */}
      <FnBCashHandoverModal
        isOpen={isFnbCashHandoverOpen}
        onClose={() => setIsFnbCashHandoverOpen(false)}
        currentUser={currentUser}
      />
    </MainLayout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HospitalityProvider>
        {/* Interactive Screen UI */}
        <div id="hotel-app-screen" className="hotel-app-screen">
          <AppContent />
        </div>
        {/* Isolated Print Containers (Instant Print Preview without App DOM recalculation) */}
        <div id="hotel-app-print" className="hotel-app-print">
          <PrintTemplatesContainer />
        </div>
      </HospitalityProvider>
    </AppProvider>
  );
}
