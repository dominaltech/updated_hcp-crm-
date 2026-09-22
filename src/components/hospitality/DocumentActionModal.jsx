import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  printGuestRegistrationA4,
  downloadGuestRegistrationPDF,
  printGuestPaymentSummary,
  downloadGuestPaymentSummaryPDF,
  printFinalBillA4,
  downloadFinalBillPDF
} from '../../services/printService';

export default function DocumentActionModal({
  isOpen,
  onClose,
  type = 'info', // 'checkin' | 'invoice' | 'info' | 'summary'
  data,
  onReprintRegForm
}) {
  const { showToast } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.key === '1' || e.key === 's' || e.key === 'S') && !isProcessing) {
        e.preventDefault();
        handleSave();
      } else if ((e.key === '2' || e.key === 'p' || e.key === 'P') && !isProcessing) {
        e.preventDefault();
        handlePrint();
      } else if (e.key === '3' && !isProcessing) {
        e.preventDefault();
        handleSaveAndPrint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProcessing, data, type]);

  if (!isOpen || !data) return null;

  const getDocTitle = (docType) => {
    switch (docType) {
      case 'checkin':
        return '📋 Check-In Form';
      case 'invoice':
        return '🧾 Tax Invoice';
      case 'summary':
        return '📄 Payment Summary';
      case 'info':
      default:
        return '💾 Info';
    }
  };

  const getInvoiceParams = (invData) => {
    if (!invData) return { room: null, calc: null, settlement: null };
    if (invData.room) {
      return {
        room: invData.room,
        calc: invData.calc || invData.room,
        settlement: invData.settlement || {
          settleAmt: 0,
          refundAmt: 0,
          settled_at: new Date(),
          invoiceNo: invData.room?.invoice_no,
          checked_out_by: 'Front Desk'
        }
      };
    }
    // Flat booking or room object
    const room = invData;
    const calc = {
      grossTariff: room.grossTariff || room.total_room_charge || room.room_rate,
      roomCharge: room.total_room_charge || room.room_rate,
      roomTariffNet: room.grossTariff || room.total_room_charge,
      tariffTax5Pct: room.tax_amount || room.total_tax || Math.round((room.total_room_charge || 0) * 0.05),
      foodTotal: room.food_total || 0,
      barTotal: room.bar_total || 0,
      hotelExtrasCharge: room.extra_bed_charge || 0,
      advancePaid: room.initial_paid || room.total_paid || 0,
      chargedDays: room.charged_days || 1,
      billableDays: room.charged_days || 1,
      discountPct: room.discount_pct || 0,
      discountAmount: room.discount_amount || 0
    };
    const settlement = {
      settleAmt: room.final_settle_amount || room.total_paid || 0,
      refundAmt: room.refund_amount || 0,
      settled_at: room.actual_checkout_time || room.checkout_time || new Date(),
      invoiceNo: room.invoice_no || (room.id ? `L${room.id}` : 'L1573'),
      checked_out_by: room.checked_out_by || 'Front Desk'
    };
    return { room, calc, settlement };
  };

  const handleSave = async () => {
    setIsProcessing(true);
    setProcessingMsg('Saving PDF to PC...');
    try {
      let ok = false;
      if (type === 'checkin') {
        ok = await downloadGuestRegistrationPDF(data, { includePhotos: false });
      } else if (type === 'summary') {
        ok = await downloadGuestPaymentSummaryPDF(data);
      } else if (type === 'invoice') {
        const { room, calc, settlement } = getInvoiceParams(data);
        ok = await downloadFinalBillPDF(room, calc, settlement);
      } else {
        ok = await downloadGuestRegistrationPDF(data, { includePhotos: true });
      }
      if (ok) {
        showToast(`✓ ${getDocTitle(type).replace(/^[^\w]+/, '')} PDF saved to PC!`, 'green', 3500);
      }
      onClose();
    } catch (err) {
      console.error('Save PDF error:', err);
      showToast('Failed to save PDF: ' + err.message, 'red', 3500);
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  const handlePrint = () => {
    try {
      if (type === 'checkin') {
        if (onReprintRegForm) {
          onReprintRegForm(data);
        } else {
          printGuestRegistrationA4(data, { includePhotos: false });
        }
      } else if (type === 'summary') {
        printGuestPaymentSummary(data);
      } else if (type === 'invoice') {
        const { room, calc, settlement } = getInvoiceParams(data);
        printFinalBillA4(room, calc, settlement);
      } else {
        printGuestRegistrationA4(data, { includePhotos: true });
      }
      onClose();
    } catch (err) {
      console.error('Print error:', err);
      showToast('Failed to open print preview: ' + err.message, 'red', 3000);
    }
  };

  const handleSaveAndPrint = async () => {
    setIsProcessing(true);
    setProcessingMsg('Saving PDF & opening print...');
    try {
      let ok = false;
      if (type === 'checkin') {
        ok = await downloadGuestRegistrationPDF(data, { includePhotos: false });
      } else if (type === 'summary') {
        ok = await downloadGuestPaymentSummaryPDF(data);
      } else if (type === 'invoice') {
        const { room, calc, settlement } = getInvoiceParams(data);
        ok = await downloadFinalBillPDF(room, calc, settlement);
      } else {
        ok = await downloadGuestRegistrationPDF(data, { includePhotos: true });
      }
      if (ok) {
        showToast(`✓ PDF Saved! Opening print dialog...`, 'green', 2500);
      }
      setTimeout(() => {
        if (type === 'checkin') {
          if (onReprintRegForm) onReprintRegForm(data);
          else printGuestRegistrationA4(data, { includePhotos: false });
        } else if (type === 'summary') {
          printGuestPaymentSummary(data);
        } else if (type === 'invoice') {
          const { room, calc, settlement } = getInvoiceParams(data);
          printFinalBillA4(room, calc, settlement);
        } else {
          printGuestRegistrationA4(data, { includePhotos: true });
        }
        onClose();
      }, 400);
    } catch (err) {
      console.error('Save & Print error:', err);
      showToast('Error during Save & Print: ' + err.message, 'red', 3500);
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
    }
  };

  return (
    <div className="modal-overlay active" style={{ zIndex: 11000 }} onClick={onClose}>
      <div
        className="modal-container doc-action-modal-card"
        style={{
          maxWidth: '450px',
          width: '92%',
          background: 'var(--bg-surface, #ffffff)',
          borderRadius: '16px',
          padding: '20px 22px 18px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid var(--border-color, #e2e8f0)',
          position: 'relative',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Loading Overlay */}
        {isProcessing && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 20,
              gap: '10px'
            }}
          >
            <div className="spinner" style={{ width: '34px', height: '34px', borderWidth: '3px' }}></div>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1e3a8a' }}>{processingMsg}</div>
          </div>
        )}

        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 850, color: 'var(--text-primary, #0f172a)' }}>
            {getDocTitle(type)}
          </h3>
          <button
            type="button"
            className="universal-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            style={{ margin: 0 }}
          >
            &times;
          </button>
        </div>

        {/* 3 Simple Action Cards: Save, Print, Save & Print */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '16px'
          }}
        >
          {/* 1. Save */}
          <button
            type="button"
            className="doc-action-btn-tile doc-action-tile-save"
            onClick={handleSave}
            disabled={isProcessing}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '16px 6px',
              borderRadius: '12px',
              border: '1.5px solid #86efac',
              background: 'linear-gradient(145deg, #f0fdf4 0%, #dcfce7 100%)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box'
            }}
          >
            <span style={{ fontSize: '2.1rem', lineHeight: 1 }}>💾</span>
            <span style={{ fontWeight: 850, fontSize: '0.98rem', color: '#15803d' }}>Save</span>
          </button>

          {/* 2. Print */}
          <button
            type="button"
            className="doc-action-btn-tile doc-action-tile-print"
            onClick={handlePrint}
            disabled={isProcessing}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '16px 6px',
              borderRadius: '12px',
              border: '1.5px solid #93c5fd',
              background: 'linear-gradient(145deg, #eff6ff 0%, #dbeafe 100%)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box'
            }}
          >
            <span style={{ fontSize: '2.1rem', lineHeight: 1 }}>🖨️</span>
            <span style={{ fontWeight: 850, fontSize: '0.98rem', color: '#1d4ed8' }}>Print</span>
          </button>

          {/* 3. Save & Print */}
          <button
            type="button"
            className="doc-action-btn-tile doc-action-tile-both"
            onClick={handleSaveAndPrint}
            disabled={isProcessing}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '16px 6px',
              borderRadius: '12px',
              border: '1.5px solid #d8b4fe',
              background: 'linear-gradient(145deg, #faf5ff 0%, #f3e8ff 100%)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxSizing: 'border-box'
            }}
          >
            <span style={{ fontSize: '2.1rem', lineHeight: 1 }}>⚡</span>
            <span style={{ fontWeight: 850, fontSize: '0.92rem', color: '#6d28d9', textAlign: 'center', whiteSpace: 'nowrap' }}>
              Save &amp; Print
            </span>
          </button>
        </div>

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '12px' }}>
          <button
            type="button"
            className="btn-custom-cancel"
            onClick={onClose}
            disabled={isProcessing}
            style={{ padding: '7px 18px', fontSize: '0.84rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
