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
import CheckinWizardModal from './components/hospitality/CheckinWizard/CheckinWizardModal';
import RoomVisitorsModal from './components/hospitality/RoomVisitorsModal';
import CapacityModal from './components/common/CapacityModal';
import PrintTemplatesContainer from './components/common/PrintTemplatesContainer';
import {
  printGuestRegistrationA4,
  printAdvanceMoneyReceipt,
  printPettyCashVoucher,
  printDailyClosingReport,
  printKOTSlip,
  printBOTSlip,
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

  // Room Visitors Modal State
  const [visitorsRoom, setVisitorsRoom] = useState(null);

  // Clean, reactive modal scroll lock without MutationObserver or infinite loops
  const isAnyModalOpen = Boolean(
    checkinRoom ||
    visitorsRoom ||
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

  const handleCheckinSuccess = async (bookingData) => {
    if (typeof refreshRooms === 'function') {
      refreshRooms();
    } else if (typeof loadRooms === 'function') {
      loadRooms();
    }
    setCheckinRoom(null);
    setCheckinAdditionalRooms([]);

    // Advance money receipt prompt if payment collected
    const totalAdvance = bookingData.initial_paid || bookingData.total_paid || bookingData.totalPaid || 0;
    const bookingId = bookingData.id || bookingData.booking_id || bookingData.bookingId;

    if (totalAdvance > 0 && bookingId) {
      setTimeout(async () => {
        const wantPrint = await showConfirm({
          title: 'Print Money Receipt',
          message: `Advance payment of ₹${totalAdvance} collected. Would you like to print the Official Money Receipt (2-per-A4 sheet)?`,
          icon: '🖨️',
          confirmText: 'Print Money Receipt',
          cancelText: 'Skip'
        });
        if (wantPrint) {
          try {
            const res = await api.get(`/receipts/advance/${bookingId}`);
            if (res && res.receipt) {
              printAdvanceMoneyReceipt(res.receipt);
            }
          } catch (e) {
            console.warn('Error fetching advance receipt for print:', e);
          }
        }
      }, 1200);
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

  return (
    <MainLayout>
      {/* Hospitality Panel */}
      {activePanel === 'hospitality' && (
        activeFolioRoom ? (
          <RoomFolioPage
            roomId={activeFolioRoom.id}
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
          onPrintBillSlip={(bill) => printThermalBillSlip(bill, 'HOTEL CITY PARK - RESTAURANT')}
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
