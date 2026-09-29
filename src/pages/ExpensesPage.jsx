import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { printPettyCashVoucher, printCashReceipt } from '../services/printService';
import DocumentScannerModal from '../components/common/DocumentScannerModal';
import ThemedDatePicker from '../components/common/ThemedDatePicker';
import ThemedSelect from '../components/common/ThemedSelect';
import ExpenseCategoriesMasterModal, {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_EXPENSE_OWNERS
} from '../components/common/ExpenseCategoriesMasterModal';

export const EXPENSE_CATEGORIES = DEFAULT_EXPENSE_CATEGORIES;

export default function ExpensesPage({ onPrintVoucher }) {
  const { showToast, showConfirm, currentUser, setActivePanel } = useApp();

  const [activeTab, setActiveTab] = useState('expenses'); // 'expenses' | 'refunds'
  const [expenses, setExpenses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Dynamic Categories & Owners from Admin Settings (Point 12)
  const [categoriesList, setCategoriesList] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [ownersList, setOwnersList] = useState(DEFAULT_EXPENSE_OWNERS);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  // Filters (Point 15: Manager panel filter by category and purpose from date to date)
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPurpose, setFilterPurpose] = useState('all');

  // Form draft (Points 12, 13, 16)
  const [formCategory, setFormCategory] = useState('owner');
  const [formCategoryOther, setFormCategoryOther] = useState('');
  const [formPurpose, setFormPurpose] = useState('Travel');
  const [formPurposeOther, setFormPurposeOther] = useState('');
  const [formOwnerName, setFormOwnerName] = useState('Jaijeet Gadekar');
  const [formOwnerPhone, setFormOwnerPhone] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formPaidTo, setFormPaidTo] = useState('Jaijeet Gadekar');
  const [formMode, setFormMode] = useState('cash'); // Cash, Cheque, Online
  const [formUtrNo, setFormUtrNo] = useState('');
  const [formDebitAc, setFormDebitAc] = useState('Owner: Jaijeet Gadekar');
  const [formChequeNo, setFormChequeNo] = useState('');
  const [formBankName, setFormBankName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formReceiptImg, setFormReceiptImg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Remainder Adjustment Modal State (Point 13)
  const [adjustingExpense, setAdjustingExpense] = useState(null);
  const [adjActualUsed, setAdjActualUsed] = useState('');
  const [adjBillScan, setAdjBillScan] = useState(null);
  const [isSubmittingAdj, setIsSubmittingAdj] = useState(false);

  // Live Camera Document/Bill Scanner State
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState('adj'); // 'adj' | 'new'
  const [adjFileName, setAdjFileName] = useState('');
  const [formReceiptName, setFormReceiptName] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isDraggingOverNew, setIsDraggingOverNew] = useState(false);
  const [viewingBillPhoto, setViewingBillPhoto] = useState(null);

  const handleScannerCapture = (dataUrl) => {
    if (scannerTarget === 'adj') {
      setAdjBillScan(dataUrl);
      setAdjFileName('Camera_Scan_' + new Date().toISOString().slice(0, 10) + '.jpg');
    } else {
      setFormReceiptImg(dataUrl);
      setFormReceiptName('Camera_Scan_' + new Date().toISOString().slice(0, 10) + '.jpg');
    }
  };

  const handleOpenWindowsScanner = () => {
    try {
      window.location.href = 'ms-scan:';
      showToast('Opening Windows Scanner app...', 'blue');
    } catch (err) {
      console.warn('Could not launch Windows Scanner:', err);
    }
  };

  // Clipboard paste listener: paste scanned images or documents directly with Ctrl+V
  useEffect(() => {
    const handlePaste = (e) => {
      if (!adjustingExpense && !isModalOpen) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1 || item.type.indexOf('pdf') !== -1) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (adjustingExpense) {
                setAdjFileName(file.name || `Pasted_Scan_${Date.now()}.png`);
                setAdjBillScan(ev.target.result);
                showToast('📋 Scanned bill pasted from clipboard!', 'green');
              } else if (isModalOpen) {
                setFormReceiptName(file.name || `Pasted_Scan_${Date.now()}.png`);
                setFormReceiptImg(ev.target.result);
                showToast('📋 Scanned bill pasted from clipboard!', 'green');
              }
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [adjustingExpense, isModalOpen, showToast]);

  const fileInputRef = useRef(null);
  const adjFileRef = useRef(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.getExpenseCategoriesConfig();
      if (res && res.success) {
        if (Array.isArray(res.categories) && res.categories.length > 0) {
          setCategoriesList(res.categories);
        }
        if (Array.isArray(res.owners) && res.owners.length > 0) {
          setOwnersList(res.owners);
          if (res.owners[0]?.phone && !formOwnerPhone) {
            setFormOwnerPhone(res.owners[0].phone);
          }
        }
      }
    } catch (err) {
      console.warn('Could not load categories config from server, using defaults:', err);
    }
  }, [formOwnerPhone]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const loadExpenses = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = {};
      if (filterFromDate) params.from_date = filterFromDate;
      if (filterToDate) params.to_date = filterToDate;
      if (filterCategory !== 'all') params.category = filterCategory;
      if (filterPurpose !== 'all') params.purpose = filterPurpose;

      const data = await api.getExpenses(params);
      const list = Array.isArray(data) ? data : (data?.expenses || []);
      setExpenses(list);
    } catch (err) {
      showToast('Error loading expenses: ' + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [filterFromDate, filterToDate, filterCategory, filterPurpose, showToast]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // When form category changes, reset purpose to first purpose of that category
  useEffect(() => {
    const catObj = categoriesList.find(c => c.id === formCategory);
    if (catObj && catObj.purposes && catObj.purposes.length > 0) {
      setFormPurpose(catObj.purposes[0]);
    } else {
      setFormPurpose('');
    }
    setFormPurposeOther('');
    setFormCategoryOther('');

    if (formCategory === 'refund') {
      setFormDebitAc('Guest Refund');
      setFormMode('cash');
    } else if (formCategory === 'owner') {
      setFormDebitAc(`Owner: ${formOwnerName}`);
      setFormMode('cash');
      const ownerObj = ownersList.find(o => o.name === formOwnerName) || ownersList[0];
      if (ownerObj) {
        setFormOwnerPhone(ownerObj.phone || '');
        if (!formPaidTo || formPaidTo === 'Jaijeet Gadekar' || formPaidTo === 'Respected Mahesh Sir') {
          setFormPaidTo(ownerObj.name);
        }
      }
    } else {
      setFormDebitAc(catObj ? catObj.name : 'Store Expenses');
      setFormMode('cash'); // Debit is only Cash Mode (Point 13)
    }
  }, [formCategory, formOwnerName, categoriesList, ownersList, formPaidTo]);

  // Split into Expenses vs Refunds
  const regularExpenses = expenses.filter((e) => e.category !== 'refund');
  const refundExpenses = expenses.filter((e) => e.category === 'refund');

  const handleOpenAddExpense = () => {
    const firstCat = categoriesList[0] || DEFAULT_EXPENSE_CATEGORIES[0];
    const firstPurpose = firstCat?.purposes?.[0] || 'Travel';
    const firstOwner = ownersList[0]?.name || 'Jaijeet Gadekar';
    const firstOwnerPhone = ownersList[0]?.phone || '';

    setFormCategory(firstCat.id);
    setFormCategoryOther('');
    setFormPurpose(firstPurpose);
    setFormPurposeOther('');
    setFormOwnerName(firstOwner);
    setFormOwnerPhone(firstOwnerPhone);
    setFormAmount('');
    setFormPaidTo(firstCat.id === 'owner' ? firstOwner : '');
    setFormMode('cash');
    setFormUtrNo('');
    setFormDebitAc(firstCat.id === 'owner' ? `Owner: ${firstOwner}` : firstCat.name);
    setFormChequeNo('');
    setFormBankName('');
    setFormDescription('');
    setFormReceiptImg(null);
    setIsModalOpen(true);
  };

  const handleOpenAddRefund = () => {
    setFormCategory('refund');
    setFormCategoryOther('');
    setFormPurpose('Early Checkout Refund');
    setFormPurposeOther('');
    setFormAmount('');
    setFormPaidTo('');
    setFormMode('cash');
    setFormUtrNo('');
    setFormDebitAc('Guest Refund');
    setFormChequeNo('');
    setFormBankName('');
    setFormDescription('Room stay / early checkout refund');
    setFormReceiptImg(null);
    setIsModalOpen(true);
  };

  const handleFileUpload = (e) => {
    const file = (e.target.files && e.target.files[0]) || (e.dataTransfer && e.dataTransfer.files[0]);
    if (!file) return;
    setFormReceiptName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFormReceiptImg(ev.target.result);
      showToast(`Scanned file "${file.name}" attached!`, 'green');
    };
    reader.readAsDataURL(file);
  };

  const handleAdjFileUpload = (e) => {
    const file = (e.target.files && e.target.files[0]) || (e.dataTransfer && e.dataTransfer.files[0]);
    if (!file) return;
    setAdjFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAdjBillScan(ev.target.result);
      showToast(`Scanned file "${file.name}" attached!`, 'green');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    const amt = Number(formAmount);
    if (!amt || amt <= 0) {
      showToast('Please enter a valid amount.', 'red');
      return;
    }
    if (!formPaidTo.trim()) {
      showToast('Please enter recipient / guest name.', 'red');
      return;
    }

    if (formMode === 'online' && !formUtrNo.trim()) {
      showToast('Online UTR Reference Number is mandatory.', 'red');
      return;
    }

    // Point 16: If cheque refund, compulsory cheque photo upload!
    if (formMode === 'cheque') {
      if (!formChequeNo.trim()) {
        showToast('Cheque Number is mandatory for Cheque refund.', 'red');
        return;
      }
      if (!formBankName.trim()) {
        showToast('Bank Name is mandatory for Cheque refund.', 'red');
        return;
      }
      if (formCategory === 'refund' && !formReceiptImg) {
        showToast('Mandatory: Please upload scanned copy / photo of the Cheque.', 'red');
        return;
      }
    }

    const effectiveCategory = formCategory === 'other'
      ? (formCategoryOther.trim() || 'Other Expenses')
      : formCategory;

    const effectivePurpose = formPurpose === 'Other'
      ? (formPurposeOther.trim() || 'General Purpose')
      : formPurpose;

    setIsSubmitting(true);
    try {
      const isCheque = formCategory === 'refund' && formMode === 'cheque';
      const payload = {
        category: formCategory,
        purpose_category: effectiveCategory,
        purpose_child: effectivePurpose,
        owner_name: formCategory === 'owner' ? formOwnerName : null,
        owner_phone: formCategory === 'owner' ? (formOwnerPhone ? formOwnerPhone.trim() : null) : null,
        amount: amt,
        original_amount: amt,
        paid_to: formPaidTo.trim(),
        payment_mode: formMode,
        utr_number: formMode === 'online' ? formUtrNo.trim() : null,
        debit_account: formDebitAc,
        purpose_details: `${effectivePurpose}${formDescription.trim() ? ` - ${formDescription.trim()}` : ''}`,
        description: `${effectivePurpose}${formDescription.trim() ? ` - ${formDescription.trim()}` : ''}`,
        cheque_no: isCheque ? formChequeNo.trim() : '',
        bank_name: isCheque ? formBankName.trim() : '',
        cheque_photo: isCheque ? formReceiptImg : null,
        receiptImage: formReceiptImg,
        cashier: currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier'
      };

      const res = await api.createExpense(payload);
      if (res && res.success) {
        showToast(
          formCategory === 'refund'
            ? `Guest refund recorded! Printing receipt (Receipt 1)...`
            : `Expense voucher recorded! Printing petty cash voucher (Receipt 2)...`,
          'green',
          3500
        );
        setIsModalOpen(false);
        loadExpenses();

        // Point 12: WhatsApp Alert to Owner if owner expense
        if (formCategory === 'owner') {
          let phone = (formOwnerPhone || '').trim();
          if (!phone) {
            const match = ownersList.find(o => o.name === formOwnerName);
            if (match?.phone) phone = match.phone.trim();
          }
          const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
          const targetPhone = cleanPhone ? (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone) : '';
          const voucherNo = res.voucher_number || res.voucher_no || res.voucherNo || 'DEB';
          const dateStr = new Date().toLocaleString('en-IN');
          const msg = `*HOTEL CITY PARK - DEBIT RECEIPT ALERT*\n\nNamaste ${formOwnerName},\nAn operational debit expense of *₹${amt.toLocaleString('en-IN')}* has been recorded under your account.\n\n• Voucher No: #${voucherNo}\n• Category: Owner Expenses\n• Purpose: ${effectivePurpose}\n• Paid To: ${formPaidTo.trim()}\n• Cashier: ${currentUser ? (currentUser.full_name || currentUser.username) : 'Front Desk'}\n• Date & Time: ${dateStr}\n${formDescription.trim() ? `• Details: ${formDescription.trim()}\n` : ''}\nHotel City Park Management System`;

          if (targetPhone) {
            window.open(`https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(msg)}`, '_blank');
          }
        }

        // Print corresponding document
        if (formCategory === 'refund') {
          printPettyCashVoucher({
            voucher_no: res.voucher_no || res.voucherNo || res.id || 'PCV-1',
            amount: amt,
            paid_to: formPaidTo.trim(),
            debit_account: 'Guest Refund',
            purpose_details: payload.purpose_details,
            payment_mode: formMode,
            cheque_no: isCheque ? formChequeNo.trim() : '',
            bank_name: isCheque ? formBankName.trim() : '',
            category: 'refund',
            created_at: new Date()
          });
        } else {
          printPettyCashVoucher({
            voucher_no: res.voucher_no || res.voucherNo || res.voucher_number || 'PCV-1',
            amount: amt,
            paid_to: formPaidTo.trim(),
            debit_account: formDebitAc,
            purpose_details: payload.purpose_details,
            payment_mode: 'cash',
            created_at: new Date()
          });
        }
      } else {
        showToast('Failed to record: ' + (res?.message || 'Server error'), 'red');
      }
    } catch (err) {
      showToast('Error recording entry: ' + err.message, 'red');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Point 13: Remainder Adjustment Handler
  const handleOpenAdjustment = (exp) => {
    setAdjustingExpense(exp);
    setAdjActualUsed(exp.actual_used_amount ? String(exp.actual_used_amount) : String(exp.amount));
    setAdjBillScan(exp.bill_scan_photo || null);
    setAdjFileName(exp.bill_scan_photo ? (exp.bill_scan_photo.startsWith('data:application/pdf') ? 'Scanned_Bill.pdf' : 'Scanned_Bill.jpg') : '');
  };

  const handleSaveAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustingExpense) return;

    const used = Number(adjActualUsed);
    const orig = Number(adjustingExpense.original_amount || adjustingExpense.amount);
    if (isNaN(used) || used < 0) {
      showToast('Please enter a valid actual used amount.', 'red');
      return;
    }
    if (used > orig) {
      showToast(`Actual used amount (₹${used}) cannot exceed original given amount (₹${orig}).`, 'red');
      return;
    }

    const ret = Math.max(0, orig - used);
    setIsSubmittingAdj(true);
    try {
      await api.adjustExpense(adjustingExpense.id, {
        actual_used_amount: used,
        returned_amount: ret,
        bill_scan_photo: adjBillScan,
        cashier: currentUser ? (currentUser.full_name || currentUser.username) : 'Cashier'
      });

      showToast(`Adjustment saved! ₹${ret.toLocaleString('en-IN')} returned to Cash Drawer.`, 'green');
      setAdjustingExpense(null);
      setAdjActualUsed('');
      setAdjBillScan(null);
      loadExpenses();
    } catch (err) {
      showToast('Error saving adjustment: ' + err.message, 'red');
    } finally {
      setIsSubmittingAdj(false);
    }
  };

  // Point 12: Owner WhatsApp Message
  const sendOwnerWhatsApp = (exp) => {
    const owner = exp.owner_name || 'Owner';
    const amt = Number(exp.amount || 0);
    const purpose = exp.purpose_child || exp.purpose_details || exp.description || 'Personal Drawing';
    const cashier = exp.cashier_name || exp.cashier || 'Front Desk';
    const dateStr = (exp.created_at ? new Date(exp.created_at) : new Date()).toLocaleString('en-IN', { hour12: true });
    const voucherNo = exp.voucher_number || exp.voucher_no || exp.id || 'DEB';
    const msg = `*HOTEL CITY PARK - DEBIT RECEIPT ALERT*\n\nNamaste ${owner},\nAn operational debit expense of *₹${amt.toLocaleString('en-IN')}* has been recorded under your account.\n\n• Voucher No: #${voucherNo}\n• Category: Owner Expenses\n• Purpose: ${purpose}\n• Paid To: ${exp.paid_to || owner}\n• Cashier: ${cashier}\n• Date & Time: ${dateStr}\n\nHotel City Park Management System`;

    let phone = (exp.owner_phone || '').trim();
    if (!phone) {
      const match = ownersList.find(o => o.name === exp.owner_name);
      if (match?.phone) phone = match.phone.trim();
    }
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    const targetPhone = cleanPhone ? (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone) : '';

    if (targetPhone) {
      window.open(`https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
    }
  };

  const handleDeleteExpense = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Record?',
      message: 'Are you sure you want to permanently delete this record?',
      icon: '🗑️',
      confirmText: 'Yes, Delete',
      isDestructive: true
    });
    if (!confirmed) return;

    try {
      await api.deleteExpense(id);
      showToast('Record deleted.', 'green');
      loadExpenses();
    } catch (err) {
      showToast('Error deleting record: ' + err.message, 'red');
    }
  };

  const categoryMap = {
    owner: 'Owner Expenses',
    store: 'Store Expenses',
    maintenance: 'Maintainance Expenses',
    repairs: 'Maintainance Expenses',
    operations: 'Daily Operations',
    staff: 'Staff Welfare',
    admin: 'Office & Admin',
    refund: 'Guest Refund',
    other: 'Other'
  };

  const resolvedCategoryMap = { ...categoryMap };
  categoriesList.forEach(c => {
    resolvedCategoryMap[c.id] = c.name;
  });

  const totalOriginalGiven = regularExpenses.reduce((sum, e) => sum + Number(e.original_amount ?? e.amount ?? 0), 0);
  const totalReturnedToDrawer = regularExpenses.reduce((sum, e) => sum + Number(e.returned_amount ?? 0), 0);
  const totalExpenseSum = regularExpenses.reduce((sum, e) => sum + Number(e.actual_used_amount ?? e.amount ?? 0), 0);
  const totalRefundSum = refundExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Available purposes for current filter category
  const activeFilterCatObj = categoriesList.find(c => c.id === filterCategory);
  const filterPurposesList = activeFilterCatObj ? activeFilterCatObj.purposes : [];

  return (
    <section className="panel-view active" id="view-expenses">
      {/* Top Standard Action Bar */}
      <div className="page-top-action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            className="universal-back-btn"
            id="btn-expenses-back"
            onClick={() => setActivePanel('hospitality')}
            title="Back to Front Desk / Hospitality"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 850, color: 'var(--text-primary)', margin: 0 }}>
              Petty Cash &amp; Operational Expenses
            </h2>
          </div>
        </div>

        <button
          type="button"
          className="universal-close-btn"
          onClick={() => setActivePanel('hospitality')}
          title="Close Expenses & Return to Front Desk"
        >
          &times;
        </button>
      </div>

      {/* Sub-Navigation Tabs: Expenses vs Refunds */}
      <div className="hospitality-subnav-bar" style={{ marginBottom: '16px' }}>
        <div className="hospitality-subnav-tabs">
          <button
            type="button"
            className={`hosp-subnav-btn ${activeTab === 'expenses' ? 'active' : ''}`}
            onClick={() => setActiveTab('expenses')}
          >
            <span className="subnav-icon">💸</span>
            <span>Operational Expenses ({regularExpenses.length})</span>
          </button>
          <button
            type="button"
            className={`hosp-subnav-btn ${activeTab === 'refunds' ? 'active' : ''}`}
            onClick={() => setActiveTab('refunds')}
          >
            <span className="subnav-icon">↩️</span>
            <span>Guest &amp; Booking Refunds ({refundExpenses.length})</span>
          </button>
        </div>
      </div>

      {/* Manager Panel Filter Bar (Point 15: Filter expenses by category & purpose from date to date) */}
      <div
        className="filter-bar"
        style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap',
          background: '#ffffff',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1.5px solid #cbd5e1',
          marginBottom: '16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569' }}>From:</span>
          <ThemedDatePicker
            value={filterFromDate}
            onChange={(e) => setFilterFromDate(e.target.value)}
            style={{ width: '150px', height: '36px', fontSize: '0.84rem' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569' }}>To:</span>
          <ThemedDatePicker
            value={filterToDate}
            onChange={(e) => setFilterToDate(e.target.value)}
            style={{ width: '150px', height: '36px', fontSize: '0.84rem' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '180px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569' }}>Category:</span>
          <ThemedSelect
            value={filterCategory}
            onChange={(val) => {
              setFilterCategory(val);
              setFilterPurpose('all');
            }}
            options={[
              { value: 'all', label: 'All Categories' },
              ...categoriesList.map(c => ({ value: c.id, label: c.name }))
            ]}
            colorTheme="blue"
            style={{ height: '36px', minWidth: '160px' }}
          />
        </div>

        {filterCategory !== 'all' && filterPurposesList.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '180px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569' }}>Purpose:</span>
            <ThemedSelect
              value={filterPurpose}
              onChange={(val) => setFilterPurpose(val)}
              options={[
                { value: 'all', label: 'All Purposes' },
                ...filterPurposesList.map(p => ({ value: p, label: p }))
              ]}
              colorTheme="blue"
              style={{ height: '36px', minWidth: '160px' }}
            />
          </div>
        )}

        {(filterFromDate || filterToDate || filterCategory !== 'all' || filterPurpose !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setFilterFromDate('');
              setFilterToDate('');
              setFilterCategory('all');
              setFilterPurpose('all');
            }}
            style={{ height: '36px', padding: '0 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 750, color: '#475569', cursor: 'pointer' }}
          >
            Reset Filters
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="filter-chip"
            onClick={() => setIsConfigModalOpen(true)}
            style={{
              height: '38px',
              padding: '0 14px',
              fontWeight: 800,
              background: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              color: '#334155',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Manage Debit Categories, Child Purposes & Owner WhatsApp Numbers"
          >
            <span>⚙️</span> Manage Categories &amp; Owners
          </button>

          <button
            type="button"
            className="btn-scan-action"
            onClick={activeTab === 'refunds' ? handleOpenAddRefund : handleOpenAddExpense}
            style={{
              height: '38px',
              padding: '0 18px',
              fontWeight: 800,
              background: activeTab === 'refunds' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>+</span> {activeTab === 'refunds' ? 'Record Guest Refund' : 'Record New Expense'}
          </button>
        </div>
      </div>

      {/* Reconciled Summary Stats Ribbon */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1.5px solid #cbd5e1',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>
              Total Amount Given
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 950, color: '#0f172a', marginTop: '2px' }}>
              {formatCurrency(totalOriginalGiven)}
            </div>
          </div>
          <span style={{ fontSize: '1.6rem' }}>💵</span>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1.5px solid #86efac',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 800, textTransform: 'uppercase' }}>
              Returned to Drawer
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 950, color: '#16a34a', marginTop: '2px' }}>
              + {formatCurrency(totalReturnedToDrawer)}
            </div>
          </div>
          <span style={{ fontSize: '1.6rem' }}>📥</span>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1.5px solid #fca5a5',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#991b1b', fontWeight: 800, textTransform: 'uppercase' }}>
              Net Realized Outflow
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 950, color: '#dc2626', marginTop: '2px' }}>
              - {formatCurrency(totalExpenseSum)}
            </div>
          </div>
          <span style={{ fontSize: '1.6rem' }}>💸</span>
        </div>
      </div>

      {/* SECTION 1: OPERATIONAL EXPENSES */}
      {activeTab === 'expenses' && (
        <div
          style={{
            overflowX: 'auto',
            background: '#ffffff',
            borderRadius: '14px',
            border: '1.5px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04)'
          }}
        >
          <table className="owner-rooms-table" style={{ margin: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Voucher No</th>
                <th style={{ width: '130px' }}>Date / Time</th>
                <th>Category &amp; Purpose</th>
                <th>Paid To</th>
                <th>Amount (₹)</th>
                <th>Actual Used / Remainder</th>
                <th>Debit A/c</th>
                <th>Cashier</th>
                <th style={{ width: '180px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {regularExpenses.map((exp) => {
                const origAmt = Number(exp.original_amount || exp.amount || 0);
                const usedAmt = exp.actual_used_amount !== null && exp.actual_used_amount !== undefined ? Number(exp.actual_used_amount) : null;
                const retAmt = exp.returned_amount !== null && exp.returned_amount !== undefined ? Number(exp.returned_amount) : 0;
                const isOwnerExp = exp.category === 'owner';

                return (
                  <tr key={exp.id}>
                    <td style={{ fontWeight: 800, color: '#dc2626' }}>
                      {exp.voucher_number || `PCV-${exp.id}`}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {formatDateTime(exp.created_at)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.74rem', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', width: 'fit-content' }}>
                          {resolvedCategoryMap[exp.category] || exp.purpose_category || exp.category}
                        </span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
                          {exp.purpose_child || exp.purpose_details || exp.description || '-'}
                        </span>
                        {isOwnerExp && exp.owner_name && (
                          <span style={{ fontSize: '0.72rem', color: '#047857', fontWeight: 800 }}>
                            👤 {exp.owner_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontWeight: 750 }}>{exp.paid_to || exp.payee}</td>
                    <td>
                      <strong style={{ color: '#dc2626', fontSize: '1.02rem' }}>
                        {formatCurrency(origAmt)}
                      </strong>
                    </td>
                    <td>
                      {usedAmt !== null ? (
                        <div style={{ fontSize: '0.78rem' }}>
                          <span style={{ color: '#0f172a', fontWeight: 750 }}>Used: {formatCurrency(usedAmt)}</span>
                          {retAmt > 0 && (
                            <span style={{ display: 'block', color: '#16a34a', fontWeight: 800 }}>
                              ✓ Ret: {formatCurrency(retAmt)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.76rem', color: '#64748b' }}>Pending audit</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {exp.debit_account || 'Petty Cash'}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {exp.cashier_name || exp.cashier || 'Cashier'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {exp.bill_scan_photo && (
                          <button
                            type="button"
                            className="filter-chip"
                            onClick={() => setViewingBillPhoto(exp.bill_scan_photo)}
                            style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8', borderColor: '#93c5fd' }}
                            title="View Attached Vendor Bill / Receipt Scan (PDF / Image)"
                          >
                            📄 Scan
                          </button>
                        )}
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleOpenAdjustment(exp)}
                          style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 800, background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}
                          title="Record Actual Used Amount & Return Remainder to Cash Drawer (Point 13)"
                        >
                          🔄 Remainder
                        </button>
                        {isOwnerExp && (
                          <button
                            type="button"
                            className="filter-chip"
                            onClick={() => sendOwnerWhatsApp(exp)}
                            style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 800, background: '#dcfce7', color: '#15803d', borderColor: '#86efac' }}
                            title="Send WhatsApp Alert to Owner (Point 12)"
                          >
                            💬 WA
                          </button>
                        )}
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => printPettyCashVoucher(exp)}
                          style={{ fontSize: '0.72rem', padding: '3px 8px', fontWeight: 750 }}
                          title="Print Petty Cash Voucher (2-on-A4)"
                        >
                          🖨️
                        </button>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleDeleteExpense(exp.id)}
                          style={{ fontSize: '0.72rem', padding: '3px 8px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                          title="Delete Voucher"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {regularExpenses.length === 0 && !isLoading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
              No expense vouchers recorded.
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: GUEST REFUNDS */}
      {activeTab === 'refunds' && (
        <div
          style={{
            overflowX: 'auto',
            background: '#ffffff',
            borderRadius: '14px',
            border: '1.5px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04)'
          }}
        >
          <table className="owner-rooms-table" style={{ margin: 0, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Receipt / Ref #</th>
                <th style={{ width: '140px' }}>Date / Time</th>
                <th>Guest / Payee Name</th>
                <th>Refund Amount (₹)</th>
                <th>Payment Mode</th>
                <th>Cashier</th>
                <th>Refund Reason / Details</th>
                <th style={{ width: '140px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {refundExpenses.map((ref) => (
                <tr key={ref.id}>
                  <td style={{ fontWeight: 800, color: '#b45309' }}>
                    {ref.voucher_number || `REF-${ref.id}`}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {formatDateTime(ref.created_at)}
                  </td>
                  <td style={{ fontWeight: 750 }}>{ref.paid_to || ref.payee}</td>
                  <td>
                    <strong style={{ color: '#b45309', fontSize: '1.02rem' }}>
                      {formatCurrency(ref.amount)}
                    </strong>
                  </td>
                  <td>
                    <span style={{ textTransform: 'uppercase', fontSize: '0.74rem', fontWeight: 800, background: ref.payment_mode === 'cheque' ? '#eff6ff' : '#f8fafc', color: ref.payment_mode === 'cheque' ? '#1d4ed8' : '#334155', padding: '2px 8px', borderRadius: '4px' }}>
                      {ref.payment_mode === 'cheque' ? `🏦 Cheque (${ref.cheque_no || '-'})` : '💵 Cash'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {ref.cashier_name || ref.cashier || 'Cashier'}
                  </td>
                  <td style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '240px' }}>
                    {ref.purpose_child || ref.purpose_details || ref.description || 'Guest stay refund'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() =>
                          printPettyCashVoucher({
                            id: ref.id,
                            voucher_no: ref.voucher_number || `REF-${ref.id}`,
                            amount: Number(ref.amount),
                            paid_to: ref.paid_to || ref.payee,
                            debit_account: 'Guest Refund',
                            purpose_details: ref.purpose_child || ref.purpose_details || ref.description || 'Guest stay refund',
                            payment_mode: ref.payment_mode || 'cash',
                            cheque_no: ref.cheque_no || '',
                            bank_name: ref.bank_name || '',
                            category: 'refund',
                            created_at: ref.created_at
                          })
                        }
                        style={{ fontSize: '0.74rem', padding: '4px 8px', fontWeight: 700, color: '#b45309', borderColor: '#fde68a', background: '#fffbeb' }}
                        title="Print Cash Voucher Slip (2-on-A4)"
                      >
                        🖨️ Voucher
                      </button>
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => handleDeleteExpense(ref.id)}
                        style={{ fontSize: '0.72rem', padding: '4px 8px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                        title="Delete Refund Record"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {refundExpenses.length === 0 && !isLoading && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
              No refund entries recorded.
            </div>
          )}
        </div>
      )}

      {/* Record Expense / Refund Modal */}
      {isModalOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="modal-container"
            style={{
              maxWidth: '820px',
              width: '95%',
              minHeight: formCategory === 'refund' ? '460px' : '540px',
              maxHeight: '92vh',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-color)',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div className="modal-header" style={{ padding: '16px 26px', borderBottom: '1px solid var(--border-color)', background: formCategory === 'refund' ? '#fffbeb' : '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>{formCategory === 'refund' ? '↩️' : '💸'}</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {formCategory === 'refund' ? 'Record Guest Refund' : 'Record Operational Expense'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {formCategory === 'refund' ? 'Cash or Cheque refund' : 'Operational expense (Cash-Only Drawer Payout)'}
                  </p>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="modal-body" style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: '15px', flex: 1, maxHeight: 'calc(92vh - 135px)', overflowY: 'auto' }}>
                {formCategory !== 'refund' ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
                      <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Category *</label>
                        <ThemedSelect
                          value={formCategory}
                          onChange={(val) => setFormCategory(val)}
                          options={categoriesList.filter(c => c.id !== 'refund').map(c => ({ value: c.id, label: c.name }))}
                          colorTheme="blue"
                          style={{ height: '42px', width: '100%' }}
                        />
                      </div>

                      <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Purpose (Child of Category) *</label>
                        <ThemedSelect
                          value={formPurpose}
                          onChange={(val) => setFormPurpose(val)}
                          options={(categoriesList.find(c => c.id === formCategory)?.purposes || ['Other']).map(p => ({ value: p, label: p }))}
                          colorTheme="blue"
                          style={{ height: '42px', width: '100%' }}
                        />
                      </div>
                    </div>

                    {(formCategory === 'other' || formPurpose === 'Other') && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
                        {formCategory === 'other' ? (
                          <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Custom Category Name *</label>
                            <input
                              type="text"
                              className="form-input"
                              required
                              placeholder="Type custom category name..."
                              value={formCategoryOther}
                              onChange={(e) => setFormCategoryOther(e.target.value)}
                              style={{ height: '42px', width: '100%', boxSizing: 'border-box' }}
                            />
                          </div>
                        ) : <div />}

                        {formPurpose === 'Other' ? (
                          <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Custom Purpose Details *</label>
                            <input
                              type="text"
                              className="form-input"
                              required
                              placeholder="Type custom purpose..."
                              value={formPurposeOther}
                              onChange={(e) => setFormPurposeOther(e.target.value)}
                              style={{ height: '42px', width: '100%', boxSizing: 'border-box' }}
                            />
                          </div>
                        ) : <div />}
                      </div>
                    )}

                    {/* Owner Selection & WhatsApp Phone (Point 12) */}
                    {formCategory === 'owner' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
                        <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#047857', marginBottom: '4px', display: 'block' }}>
                            Select Owner *
                          </label>
                          <ThemedSelect
                            value={formOwnerName}
                            onChange={(val) => {
                              setFormOwnerName(val);
                              const found = ownersList.find(o => o.name === val);
                              if (found && found.phone) {
                                setFormOwnerPhone(found.phone);
                              }
                              setFormDebitAc(`Owner: ${val}`);
                              setFormPaidTo(val);
                            }}
                            options={ownersList.map(o => ({ value: o.name, label: o.name }))}
                            colorTheme="emerald"
                            style={{ height: '42px', width: '100%' }}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#047857', marginBottom: '4px', display: 'block' }}>
                            Owner WhatsApp Mobile No 📱
                          </label>
                          <input
                            type="tel"
                            className="form-input"
                            placeholder="e.g. 9876543210"
                            value={formOwnerPhone}
                            onChange={(e) => setFormOwnerPhone(e.target.value)}
                            style={{ height: '42px', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: '12px 16px', background: 'rgba(245, 158, 11, 0.12)', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.88rem', color: '#b45309', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>↩️</span>
                    <span>Guest Refund Entry: Issued to guest from Front Desk.</span>
                  </div>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>
                    {formCategory === 'refund' ? 'Guest / Customer Name *' : 'Paid To / Vendor / Person Name *'}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={formCategory === 'refund' ? 'e.g. Rahul Sharma (Room 102)' : 'e.g. Electrician / Boy for grocery'}
                    value={formPaidTo}
                    onChange={(e) => setFormPaidTo(e.target.value)}
                    required
                    style={{ height: '42px', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: formMode === 'online' ? '1fr 1fr 1.3fr' : '1fr 1fr', gap: '16px', alignItems: 'start' }}>
                  <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Amount Given (₹) *</label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      className="form-input"
                      placeholder="e.g. 500"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      required
                      style={{ height: '42px', fontWeight: 800, color: '#ef4444', fontSize: '1.1rem', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px', display: 'block' }}>Payment Mode *</label>
                    <ThemedSelect
                      value={formMode}
                      onChange={(val) => setFormMode(val)}
                      options={[
                        { value: 'cash', label: '💵 Cash' },
                        { value: 'cheque', label: '🏦 Cheque' },
                        { value: 'online', label: '📱 UPI / Online' }
                      ]}
                      colorTheme="blue"
                      style={{ height: '42px', width: '100%' }}
                    />
                  </div>

                  {formMode === 'online' && (
                    <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1d4ed8', marginBottom: '4px', display: 'block' }}>
                        Online / UPI UTR Reference Number *
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 329481928419 (12-digit UTR)"
                        value={formUtrNo}
                        onChange={(e) => setFormUtrNo(e.target.value)}
                        required
                        style={{ height: '42px', fontWeight: 750, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                </div>

                {/* Point 16: Cheque Details + Compulsory Cheque Upload for Refund */}
                {formCategory === 'refund' && formMode === 'cheque' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#eff6ff', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid #93c5fd' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '0.76rem', fontWeight: 850, color: '#1e3a8a', display: 'block', marginBottom: '4px' }}>Cheque No *</label>
                        <input
                          type="text"
                          className="form-input"
                          required
                          placeholder="e.g. 004812"
                          value={formChequeNo}
                          onChange={(e) => setFormChequeNo(e.target.value)}
                          style={{ height: '38px', width: '100%', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.76rem', fontWeight: 850, color: '#1e3a8a', display: 'block', marginBottom: '4px' }}>Bank Name *</label>
                        <input
                          type="text"
                          className="form-input"
                          required
                          placeholder="e.g. HDFC Bank, Solapur"
                          value={formBankName}
                          onChange={(e) => setFormBankName(e.target.value)}
                          style={{ height: '38px', width: '100%', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.76rem', fontWeight: 850, color: formMode === 'cheque' ? '#b91c1c' : '#1e3a8a', display: 'block', marginBottom: '6px' }}>
                        {formMode === 'cheque' ? '📄 Cheque Scan / Photo * (Compulsory)' : '🖨️ Attach Vendor Bill / Receipt / Cash Memo Scan (Optional)'}
                      </label>

                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingOverNew(true);
                        }}
                        onDragLeave={() => setIsDraggingOverNew(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingOverNew(false);
                          handleFileUpload(e);
                        }}
                        style={{
                          border: isDraggingOverNew ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
                          background: isDraggingOverNew ? '#f0f9ff' : '#f8fafc',
                          borderRadius: '10px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                              padding: '6px 12px',
                              background: '#0284c7',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '7px',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}
                          >
                            <span>📁</span> Choose Scanned File (PDF / Image)
                          </button>

                          <button
                            type="button"
                            onClick={handleOpenWindowsScanner}
                            style={{
                              padding: '6px 10px',
                              background: '#ffffff',
                              color: '#0369a1',
                              border: '1.5px solid #7dd3fc',
                              borderRadius: '7px',
                              fontSize: '0.76rem',
                              fontWeight: 750,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}
                            title="Launch Windows Scan app for Canon / HP / Epson / Brother scanners"
                          >
                            <span>🖨️</span> Windows Scanner
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setScannerTarget('new');
                              setIsScannerOpen(true);
                            }}
                            style={{
                              padding: '6px 10px',
                              background: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #cbd5e1',
                              borderRadius: '7px',
                              fontSize: '0.76rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}
                          >
                            <span>📸</span> Camera
                          </button>
                        </div>

                        <input
                          type="file"
                          accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.bmp,.tiff"
                          required={formMode === 'cheque' && !formReceiptImg}
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          style={{ display: 'none' }}
                        />

                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          Drag &amp; drop from scanner folder, or <strong style={{ color: '#0369a1' }}>Ctrl+V to paste</strong>
                        </div>
                      </div>

                      {formReceiptImg && (
                        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px solid #0284c7' }}>
                          {formReceiptImg.startsWith('data:application/pdf') ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setViewingBillPhoto(formReceiptImg)}>
                              <span style={{ fontSize: '1.5rem' }}>📄</span>
                              <div>
                                <strong style={{ fontSize: '0.8rem', color: '#0f172a', display: 'block' }}>{formReceiptName || 'Scanned Document (PDF)'}</strong>
                                <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>✓ Scanned PDF Ready</span>
                              </div>
                            </div>
                          ) : (
                            <img
                              src={formReceiptImg}
                              alt="Preview"
                              style={{ maxHeight: '70px', borderRadius: '6px', border: '1px solid #cbd5e1', cursor: 'pointer' }}
                              onClick={() => setViewingBillPhoto(formReceiptImg)}
                            />
                          )}
                          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                            <button
                              type="button"
                              onClick={() => setViewingBillPhoto(formReceiptImg)}
                              style={{
                                padding: '4px 8px',
                                background: '#e0f2fe',
                                color: '#0369a1',
                                border: '1px solid #7dd3fc',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: 750,
                                cursor: 'pointer'
                              }}
                            >
                              👁️ View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFormReceiptImg(null);
                                setFormReceiptName('');
                                if (fileInputRef.current) fileInputRef.current.value = '';
                              }}
                              style={{
                                padding: '4px 8px',
                                background: '#fee2e2',
                                color: '#dc2626',
                                border: '1px solid #fca5a5',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: 750,
                                cursor: 'pointer'
                              }}
                            >
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 750, color: '#334155', marginBottom: '4px', display: 'block' }}>Notes / Remarks (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Additional context or notes..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    style={{ height: '42px', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '16px 26px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#fafafa', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ padding: '10px 22px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 700, color: '#475569', cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', border: 'none', borderRadius: '8px', fontWeight: 850, color: '#ffffff', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '0.92rem', boxShadow: '0 4px 10px rgba(2, 132, 199, 0.3)' }}
                >
                  {isSubmitting ? 'Recording...' : '💾 Save & Print Slip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Point 13: Remainder Return & Bill Adjustment Modal */}
      {adjustingExpense && (
        <div className="modal-overlay active" style={{ zIndex: 10060, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-container" style={{ maxWidth: '680px', width: '95%', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', border: '1.5px solid #cbd5e1', background: '#ffffff' }}>
            <div className="modal-header" style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>🔄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#fff' }}>Record Remainder Returned</h3>
                  <div style={{ fontSize: '0.74rem', color: '#e0f2fe' }}>
                    Voucher: {adjustingExpense.voucher_number || `PCV-${adjustingExpense.id}`}
                  </div>
                </div>
              </div>
              <button type="button" className="universal-close-btn" onClick={() => setAdjustingExpense(null)} style={{ color: '#fff' }}>
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment}>
              <div className="modal-body" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>Original Given Amount:</span>
                    <strong style={{ fontSize: '1.05rem', color: '#dc2626' }}>
                      {formatCurrency(Number(adjustingExpense.original_amount || adjustingExpense.amount))}
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#475569' }}>
                    Payee: <strong>{adjustingExpense.paid_to || '-'}</strong> • Purpose: <strong>{adjustingExpense.purpose_child || adjustingExpense.description || '-'}</strong>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#334155', marginBottom: '4px' }}>
                    Actual Used Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={Number(adjustingExpense.original_amount || adjustingExpense.amount)}
                    required
                    placeholder="e.g. 450"
                    value={adjActualUsed}
                    onChange={(e) => setAdjActualUsed(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', height: '42px', fontSize: '1.1rem', fontWeight: 850, padding: '0 12px', borderRadius: '8px', border: '2px solid #0284c7' }}
                  />
                </div>

                {/* Auto-calculated Remainder Box */}
                {(() => {
                  const orig = Number(adjustingExpense.original_amount || adjustingExpense.amount || 0);
                  const used = Number(adjActualUsed || 0);
                  const remainder = Math.max(0, orig - used);
                  return (
                    <div style={{ padding: '12px 14px', background: '#ecfdf5', borderRadius: '8px', border: '1.5px solid #86efac', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 750, display: 'block' }}>
                          Remainder to Credit back into Cash Inflow:
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#15803d' }}>
                          ₹{orig} given - ₹{used} used = ₹{remainder} returned
                        </span>
                      </div>
                      <strong style={{ fontSize: '1.3rem', color: '#15803d', fontWeight: 950 }}>
                        {formatCurrency(remainder)}
                      </strong>
                    </div>
                  );
                })()}

                <div>
                  <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                    🖨️ Attach Vendor Bill / Receipt from Scanner or Camera
                  </label>

                  {/* Drag-and-drop & multi-mode scanner zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(true);
                    }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(false);
                      handleAdjFileUpload(e);
                    }}
                    style={{
                      border: isDraggingOver ? '2px dashed #0284c7' : '2px dashed #94a3b8',
                      background: isDraggingOver ? '#f0f9ff' : '#f8fafc',
                      borderRadius: '12px',
                      padding: '16px 14px',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '10px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {/* Button 1: Browse Scanned File (Hardware Scanner PDF / Image) */}
                      <button
                        type="button"
                        onClick={() => adjFileRef.current?.click()}
                        style={{
                          padding: '8px 14px',
                          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)'
                        }}
                      >
                        <span>📁</span> Choose Scanned File (PDF / Image)
                      </button>

                      {/* Button 2: Open Windows Scanner Application */}
                      <button
                        type="button"
                        onClick={handleOpenWindowsScanner}
                        style={{
                          padding: '8px 12px',
                          background: '#ffffff',
                          color: '#0369a1',
                          border: '1.5px solid #7dd3fc',
                          borderRadius: '8px',
                          fontSize: '0.80rem',
                          fontWeight: 750,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                        title="Launch Windows built-in Scan app for Canon / HP / Epson / Brother scanners"
                      >
                        <span>🖨️</span> Open Windows Scanner
                      </button>

                      {/* Button 3: Scan with Camera */}
                      <button
                        type="button"
                        onClick={() => {
                          setScannerTarget('adj');
                          setIsScannerOpen(true);
                        }}
                        style={{
                          padding: '8px 12px',
                          background: '#f1f5f9',
                          color: '#475569',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          fontSize: '0.80rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span>📸</span> Scan with Camera
                      </button>
                    </div>

                    <input
                      type="file"
                      accept=".pdf,application/pdf,image/*,.png,.jpg,.jpeg,.bmp,.tiff"
                      ref={adjFileRef}
                      onChange={handleAdjFileUpload}
                      style={{ display: 'none' }}
                    />

                    <div style={{ fontSize: '0.74rem', color: '#64748b', lineHeight: 1.4 }}>
                      Drag &amp; drop file from your <strong>Flatbed Scanner (PDF/JPG)</strong>, or <strong style={{ color: '#0369a1' }}>press Ctrl+V to paste</strong>
                    </div>
                  </div>

                  {adjBillScan && (
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1.5px solid #0284c7' }}>
                      {adjBillScan.startsWith('data:application/pdf') ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => setViewingBillPhoto(adjBillScan)}>
                          <span style={{ fontSize: '1.8rem' }}>📄</span>
                          <div>
                            <strong style={{ fontSize: '0.85rem', color: '#0f172a', display: 'block' }}>{adjFileName || 'Scanned Document (PDF)'}</strong>
                            <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>✓ Scanned PDF Ready (Click to View)</span>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={adjBillScan}
                          alt="Bill scan preview"
                          style={{ maxHeight: '90px', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', cursor: 'pointer' }}
                          onClick={() => setViewingBillPhoto(adjBillScan)}
                          title="Click to view full scan"
                        />
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                        <button
                          type="button"
                          onClick={() => setViewingBillPhoto(adjBillScan)}
                          style={{
                            padding: '5px 10px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            border: '1px solid #7dd3fc',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 750,
                            cursor: 'pointer'
                          }}
                        >
                          👁️ View Scan
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAdjBillScan(null);
                            setAdjFileName('');
                            if (adjFileRef.current) adjFileRef.current.value = '';
                          }}
                          style={{
                            padding: '5px 10px',
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fca5a5',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 750,
                            cursor: 'pointer'
                          }}
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  disabled={isSubmittingAdj}
                  onClick={() => setAdjustingExpense(null)}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdj}
                  style={{ padding: '8px 22px', background: '#16a34a', border: 'none', borderRadius: '8px', fontWeight: 900, color: '#ffffff', cursor: 'pointer' }}
                >
                  {isSubmittingAdj ? 'Saving...' : '✓ Save Adjustment & Return Cash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Dynamic Categories & Owners Master Modal */}
      {isConfigModalOpen && (
        <ExpenseCategoriesMasterModal
          isOpen={isConfigModalOpen}
          onClose={() => setIsConfigModalOpen(false)}
          categories={categoriesList}
          owners={ownersList}
          onSaveSuccess={(newCats, newOwners) => {
            if (newCats) setCategoriesList(newCats);
            if (newOwners) setOwnersList(newOwners);
            loadConfig();
            loadExpenses();
          }}
        />
      )}

      {/* Live Camera Document/Bill Scanner Modal */}
      <DocumentScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onCapture={handleScannerCapture}
        title={scannerTarget === 'adj' ? '📸 Scan Vendor Bill / Receipt Photo' : '📸 Scan Bill, Receipt, or Cheque Photo'}
        subtitle="Align the bill or receipt clearly within frame and click Snap Photo"
      />

      {/* Scanned Document Lightbox View Modal */}
      {viewingBillPhoto && (
        <div
          className="modal-overlay active"
          onClick={() => setViewingBillPhoto(null)}
          style={{
            zIndex: 10100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            position: 'fixed',
            inset: 0,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '900px',
              width: '95%',
              maxHeight: '92vh',
              background: '#0f172a',
              borderRadius: '16px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ padding: '12px 18px', background: '#1e293b', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>📄</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 800 }}>Scanned Vendor Bill / Document</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const win = window.open();
                    if (win) {
                      win.document.write(`<iframe src="${viewingBillPhoto}" frameborder="0" style="border:0; top:0; left:0; width:100%; height:100%;" allowfullscreen></iframe>`);
                    }
                  }}
                  style={{
                    padding: '4px 10px',
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  ↗️ Open in New Tab
                </button>
                <button
                  type="button"
                  onClick={() => setViewingBillPhoto(null)}
                  style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}
                >
                  &times;
                </button>
              </div>
            </div>
            <div style={{ overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: '#090d16', minHeight: '300px' }}>
              {viewingBillPhoto.startsWith('data:application/pdf') ? (
                <iframe
                  src={viewingBillPhoto}
                  title="Scanned PDF Document"
                  style={{ width: '100%', height: '78vh', border: 'none', background: '#ffffff', borderRadius: '8px' }}
                />
              ) : (
                <img src={viewingBillPhoto} alt="Scanned Document Full View" style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: '8px' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
