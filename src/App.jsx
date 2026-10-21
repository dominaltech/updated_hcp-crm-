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

function AppContent() {
  const { activePanel, showConfirm, showToast, confirmState, capacityModal } = useApp();
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
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    } else {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    };
  }, [isAnyModalOpen]);

  // Auto-Print Queue Poller - Solution B: Department-wise Routing
  // - Hospitality (Front Desk) NEVER triggers KOT or BOT printing popups
  // - Restaurant screen ONLY triggers Food KOT slips and restaurant pre-bills
  // - Bar screen ONLY triggers Drink BOT slips and bar pre-bills
  useEffect(() => {
    // Front desk, expenses, and management screens completely ignore kitchen/bar print queues
    if (activePanel !== 'restaurant' && activePanel !== 'bar') {
      return;
    }

    let isProcessing = false;
    const pollPrintQueue = async () => {
      if (isProcessing) return;
      try {
        isProcessing = true;
        const res = await api.getPendingPrintJobs({ dept: activePanel });
        if (res && res.success && Array.isArray(res.jobs) && res.jobs.length > 0) {
          for (const job of res.jobs) {
            try {
              if (activePanel === 'restaurant' && job.type === 'kot') {
                printKOTSlip(job.data?.kot || job.data, job.data?.tableNumber, job.data?.waiterName, job.data?.notes);
              } else if (activePanel === 'bar' && job.type === 'bot') {
                printBOTSlip(job.data?.bot || job.data, job.data?.tableNumber, job.data?.waiterName, job.data?.notes);
              } else if (job.type === 'prebill') {
                const jobDept = String(job.data?.department || (activePanel === 'bar' ? 'bar' : 'restaurant')).toLowerCase();
                if (jobDept === activePanel) {
                  printPreBillSlip(job.data?.table || { table_number: job.data?.tableNumber }, job.data?.items, job.data?.waiterName, job.data?.department);
                }
              }
            } catch (err) {
              console.error('[AutoPrint] Error processing print job:', job.id, err);
            } finally {
              await api.ackPrintJob(job.id).catch(() => {});
            }
          }
        }
      } catch (e) {
        // Silent catch for background polling
      } finally {
        isProcessing = false;
      }
    };

    const interval = setInterval(pollPrintQueue, 1500);
    return () => clearInterval(interval);
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
            roomId={activeFolioRoom.id}
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
