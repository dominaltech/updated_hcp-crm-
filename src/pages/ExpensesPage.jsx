import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { printPettyCashVoucher, printCashReceipt } from '../services/printService';

export default function ExpensesPage({ onPrintVoucher }) {
  const { showToast, showConfirm, currentUser, setActivePanel } = useApp();

  const [activeTab, setActiveTab] = useState('expenses'); // 'expenses' | 'refunds'
  const [expenses, setExpenses] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form draft
  const [formCategory, setFormCategory] = useState('store');
  const [formAmount, setFormAmount] = useState('');
  const [formPaidTo, setFormPaidTo] = useState('');
  const [formMode, setFormMode] = useState('cash');
  const [formDebitAc, setFormDebitAc] = useState('Petty Cash');
  const [formChequeNo, setFormChequeNo] = useState('');
  const [formBankName, setFormBankName] = useState('');
  const [formUtr, setFormUtr] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formReceiptImg, setFormReceiptImg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const loadExpenses = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getExpenses();
      const list = Array.isArray(data) ? data : (data?.expenses || []);
      setExpenses(list);
    } catch (err) {
      showToast('Error loading expenses: ' + err.message, 'red');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  // Split into Expenses vs Refunds
  const regularExpenses = expenses.filter((e) => e.category !== 'refund');
  const refundExpenses = expenses.filter((e) => e.category === 'refund');

  const filteredExpenses = regularExpenses.filter((e) => {
    if (selectedCategory === 'all') return true;
    return e.category === selectedCategory;
  });

  const handleOpenAddExpense = () => {
    setFormCategory('store');
    setFormAmount('');
    setFormPaidTo('');
    setFormMode('cash');
    setFormDebitAc('Store & Inventory');
    setFormChequeNo('');
    setFormBankName('');
    setFormUtr('');
    setFormDescription('');
    setFormReceiptImg(null);
    setIsModalOpen(true);
  };

  const handleOpenAddRefund = () => {
    setFormCategory('refund');
    setFormAmount('');
    setFormPaidTo('');
    setFormMode('cash');
    setFormDebitAc('Guest Refund');
    setFormChequeNo('');
    setFormBankName('');
    setFormUtr('');
    setFormDescription('Room stay / early checkout refund');
    setFormReceiptImg(null);
    setIsModalOpen(true);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFormReceiptImg(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitExpense = async (e) => {
    e.preventDefault();
    if (!formAmount || Number(formAmount) <= 0) {
      showToast('Please enter a valid amount.', 'red');
      return;
    }
    if (!formPaidTo.trim()) {
      showToast('Please enter recipient / guest name.', 'red');
      return;
    }
    if (!formMode) {
      showToast('Please select payment mode (Cash or Cheque).', 'red');
      return;
    }
    if (formMode === 'cheque') {
      if (!formChequeNo.trim()) {
        showToast('Cheque Number is mandatory for Cheque payments.', 'red');
        return;
      }
      if (!formBankName.trim()) {
        showToast('Bank Name is mandatory for Cheque payments.', 'red');
        return;
      }
    }
    if ((formMode === 'online' || formMode === 'upi') && !formUtr.trim()) {
      showToast('Online UTR Reference Number is mandatory.', 'red');
      return;
    }

    setIsSubmitting(true);
    try {
      const isCheque = formMode === 'cheque';
      const isUpi = formMode === 'online' || formMode === 'upi';
      const refNo = isCheque ? formChequeNo.trim() : (isUpi ? formUtr.trim() : '');
      const payload = {
        category: formCategory,
        amount: Number(formAmount),
        paid_to: formPaidTo.trim(),
        paidTo: formPaidTo.trim(),
        payment_mode: formMode,
        paymentMode: formMode,
        debit_account: formDebitAc,
        debitAccount: formDebitAc,
        purpose_details: formDescription.trim(),
        description: formDescription.trim(),
        cheque_no: refNo,
        chequeNo: refNo,
        utr_number: isUpi ? formUtr.trim() : '',
        bank_name: isCheque ? formBankName.trim() : '',
        bankName: isCheque ? formBankName.trim() : '',
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

        // Print corresponding document 2-on-A4
        if (formCategory === 'refund') {
          printPettyCashVoucher({
            voucher_no: res.voucher_no || res.voucherNo || res.id || 'PCV-1',
            amount: Number(formAmount),
            paid_to: formPaidTo.trim(),
            debit_account: 'Guest Refund',
            purpose_details: formDescription.trim() || 'Room Stay / Security Refund',
            payment_mode: formMode,
            cheque_no: isCheque ? formChequeNo.trim() : '',
            utr_number: isUpi ? formUtr.trim() : '',
            bank_name: isCheque ? formBankName.trim() : '',
            category: 'refund',
            created_at: new Date()
          });
        } else {
          printPettyCashVoucher({
            voucher_no: res.voucher_no || res.voucherNo || res.voucher_number || 'PCV-1',
            amount: Number(formAmount),
            paid_to: formPaidTo.trim(),
            debit_account: formDebitAc,
            purpose_details: formDescription.trim(),
            payment_mode: formMode,
            cheque_no: isCheque ? formChequeNo.trim() : '',
            utr_number: isUpi ? formUtr.trim() : '',
            bank_name: isCheque ? formBankName.trim() : '',
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
    owner: 'Owner Withdrawal',
    refund: 'Guest Refund',
    store: 'Store & Inventory',
    maintenance: 'Maintenance & Repair',
    other: 'Other Expenses'
  };

  const totalExpenseSum = regularExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const totalRefundSum = refundExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <section className="panel-view active" id="view-expenses">
      {/* Top Standard Action Bar with Universal Back & Close Buttons */}
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

      {/* SECTION 1: OPERATIONAL EXPENSES */}
      {activeTab === 'expenses' && (
        <>
          <div
            className="section-toolbar"
            style={{
              marginBottom: '16px',
              background: '#ffffff',
              padding: '16px 20px',
              borderRadius: '14px',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
            }}
          >
            <div className="toolbar-title">
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                💸 Petty Cash &amp; Operational Expenses
              </h2>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                Total Expenses: <strong style={{ color: '#dc2626' }}>{formatCurrency(totalExpenseSum)}</strong> • Prints Petty Cash Voucher (Receipt 2, 2-on-A4)
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="form-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{ height: '40px', width: '180px', fontWeight: 700 }}
              >
                <option value="all">All Expense Types</option>
                <option value="store">Store &amp; Inventory</option>
                <option value="maintenance">Maintenance &amp; Repair</option>
                <option value="owner">Owner Withdrawal</option>
                <option value="other">Other Expenses</option>
              </select>
              <button
                type="button"
                className="btn-scan-action"
                onClick={handleOpenAddExpense}
                style={{
                  height: '40px',
                  padding: '0 20px',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>+</span> Record New Expense
              </button>
            </div>
          </div>

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
                  <th style={{ width: '120px' }}>Voucher No</th>
                  <th style={{ width: '150px' }}>Date / Time</th>
                  <th>Category</th>
                  <th>Paid To</th>
                  <th>Amount (₹)</th>
                  <th>Debit A/c</th>
                  <th>Payment Mode</th>
                  <th>Cashier</th>
                  <th>Purpose / Description</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id}>
                    <td style={{ fontWeight: 800, color: '#dc2626' }}>
                      {exp.voucher_number || `PCV-${exp.id}`}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {formatDateTime(exp.created_at)}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 750,
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          padding: '2px 8px',
                          borderRadius: '6px'
                        }}
                      >
                        {categoryMap[exp.category] || exp.category}
                      </span>
                    </td>
                    <td style={{ fontWeight: 750 }}>{exp.paid_to || exp.payee}</td>
                    <td>
                      <strong style={{ color: '#dc2626', fontSize: '1rem' }}>
                        {formatCurrency(exp.amount)}
                      </strong>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {exp.debit_account || 'Petty Cash'}
                    </td>
                    <td>
                      <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 800 }}>
                        {exp.payment_mode || 'CASH'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {exp.cashier_name || exp.cashier || 'Cashier'}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '200px' }}>
                      {exp.description || exp.notes || '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => printPettyCashVoucher(exp)}
                          style={{ fontSize: '0.74rem', padding: '4px 8px', fontWeight: 700 }}
                          title="Print Petty Cash Voucher (2-on-A4)"
                        >
                          🖨️ Voucher
                        </button>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleDeleteExpense(exp.id)}
                          style={{ fontSize: '0.72rem', padding: '4px 8px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                          title="Delete Voucher"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredExpenses.length === 0 && !isLoading && (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                No expense vouchers recorded.
              </div>
            )}
          </div>
        </>
      )}

      {/* SECTION 2: GUEST REFUNDS */}
      {activeTab === 'refunds' && (
        <>
          <div
            className="section-toolbar"
            style={{
              marginBottom: '16px',
              background: '#ffffff',
              padding: '16px 20px',
              borderRadius: '14px',
              border: '1.5px solid #e2e8f0',
              boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
            }}
          >
            <div className="toolbar-title">
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                ↩️ Guest &amp; Booking Refunds
              </h2>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                Total Refunds: <strong style={{ color: '#b45309' }}>{formatCurrency(totalRefundSum)}</strong> • Prints Official Receipt (Receipt 1, 2-on-A4)
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn-scan-action"
                onClick={handleOpenAddRefund}
                style={{
                  height: '40px',
                  padding: '0 20px',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>+</span> Record New Refund
              </button>
            </div>
          </div>

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
                  <th style={{ width: '150px' }}>Date / Time</th>
                  <th>Guest / Payee Name</th>
                  <th>Refund Amount (₹)</th>
                  <th>Payment Mode</th>
                  <th>Cashier</th>
                  <th>Refund Reason / Details</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>Actions</th>
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
                      <strong style={{ color: '#b45309', fontSize: '1rem' }}>
                        {formatCurrency(ref.amount)}
                      </strong>
                    </td>
                    <td>
                      <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 800 }}>
                        {ref.payment_mode || 'CASH'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      {ref.cashier_name || ref.cashier || 'Cashier'}
                    </td>
                    <td style={{ fontSize: '0.82rem', color: '#475569', maxWidth: '240px' }}>
                      {ref.description || ref.notes || 'Guest stay refund'}
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
                              debit_account: ref.debit_account || 'Guest Refund',
                              purpose_details: ref.description || ref.notes || 'Guest stay refund',
                              payment_mode: ref.payment_mode || 'cash',
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
                          onClick={() =>
                            printCashReceipt({
                              receipt_no: ref.voucher_number || `REF-${ref.id}`,
                              receipt_date: ref.created_at,
                              guest_name: ref.paid_to || ref.payee,
                              amount: ref.amount,
                              payment_mode: ref.payment_mode,
                              particulars: `Guest Refund: ${ref.description || 'Stay Refund'}`
                            })
                          }
                          style={{ fontSize: '0.74rem', padding: '4px 8px', fontWeight: 700, color: '#0369a1', borderColor: '#bae6fd', background: '#f0f9ff' }}
                          title="Print Money Receipt Format (2-on-A4)"
                        >
                          🖨️ Receipt
                        </button>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={() => handleDeleteExpense(ref.id)}
                          style={{ fontSize: '0.72rem', padding: '4px 8px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                          title="Delete Refund"
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
                No guest refunds recorded yet.
              </div>
            )}
          </div>
        </>
      )}

      {/* Add Modal (Adapts between Expense and Refund) */}
      {isModalOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-container" style={{ maxWidth: '560px', width: '95%', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)' }}>
            <div className="modal-header" style={{ padding: '16px 22px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.5rem' }}>{formCategory === 'refund' ? '↩️' : '💸'}</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {formCategory === 'refund' ? 'Record Guest Refund' : 'Record Operational Expense'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {formCategory === 'refund'
                      ? 'Prints official Receipt (Receipt 1, 2-on-A4)'
                      : 'Prints Petty Cash Voucher (Receipt 2, 2-on-A4)'}
                  </p>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitExpense}>
              <div className="modal-body" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '72vh', overflowY: 'auto' }}>
                {formCategory !== 'refund' ? (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Category *</label>
                    <select
                      className="form-select"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      style={{ height: '40px', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                    >
                      <option value="store">Store &amp; Inventory</option>
                      <option value="maintenance">Maintenance &amp; Repair</option>
                      <option value="owner">Owner Withdrawal</option>
                      <option value="other">Other Expenses</option>
                    </select>
                  </div>
                ) : (
                  <div style={{ padding: '10px 14px', background: 'rgba(245, 158, 11, 0.12)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.85rem', color: '#f59e0b', fontWeight: 700 }}>
                    ↩️ Guest Refund Entry: This will be credited to guest accounts and printed on Receipt Format 1.
                  </div>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                    {formCategory === 'refund' ? 'Guest / Customer Name *' : 'Paid To / Vendor / Person Name *'}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={formCategory === 'refund' ? 'e.g. Rahul Sharma (Room 102)' : 'e.g. Hardware Store / Electrician'}
                    value={formPaidTo}
                    onChange={(e) => setFormPaidTo(e.target.value)}
                    required
                    style={{ height: '40px', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', alignItems: 'start' }}>
                  <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Amount (₹) *</label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      className="form-input"
                      placeholder="e.g. 500"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      required
                      style={{ height: '40px', fontWeight: 800, color: '#ef4444', fontSize: '1.05rem', width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px', display: 'block' }}>Payment Mode *</label>
                    <select
                      className="form-select"
                      value={formMode}
                      onChange={(e) => setFormMode(e.target.value)}
                      required
                      style={{ height: '40px', fontWeight: 750, width: '100%', boxSizing: 'border-box' }}
                    >
                      <option value="cash">💵 Cash</option>
                      <option value="cheque">🏦 Cheque</option>
                      <option value="online">📱 UPI / Online</option>
                      <option value="card">💳 Card / POS</option>
                    </select>
                  </div>
                </div>

                {formMode === 'cheque' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'var(--bg-surface-secondary)', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid var(--border-color)', boxSizing: 'border-box' }}>
                    <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                      <label style={{ fontSize: '0.76rem', fontWeight: 850, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Cheque Number * (Mandatory)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter 6-digit cheque number"
                        value={formChequeNo}
                        onChange={(e) => setFormChequeNo(e.target.value)}
                        required
                        style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                      <label style={{ fontSize: '0.76rem', fontWeight: 850, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Bank Name * (Mandatory)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. State Bank of India, Solapur"
                        value={formBankName}
                        onChange={(e) => setFormBankName(e.target.value)}
                        required
                        style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                )}

                {(formMode === 'online' || formMode === 'upi') && (
                  <div style={{ background: 'var(--bg-surface-secondary)', padding: '12px 14px', borderRadius: '10px', border: '1.5px solid var(--border-color)', boxSizing: 'border-box' }}>
                    <div className="form-group" style={{ margin: 0, minWidth: 0 }}>
                      <label style={{ fontSize: '0.76rem', fontWeight: 850, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Online / UPI UTR Reference Number *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter 12-digit UPI / UTR number (e.g. 423589123456)"
                        value={formUtr}
                        onChange={(e) => setFormUtr(e.target.value)}
                        required
                        style={{ height: '38px', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 700, width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Debit A/c</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formDebitAc}
                    onChange={(e) => setFormDebitAc(e.target.value)}
                    placeholder="e.g. Petty Cash / Store A/c"
                    style={{ height: '40px', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>
                    {formCategory === 'refund' ? 'Refund Reason / Description' : 'Purpose / Description'}
                  </label>
                  <textarea
                    className="form-input"
                    rows="2"
                    placeholder={formCategory === 'refund' ? 'e.g. Early checkout balance refund for 1 night' : 'e.g. Purchased cleaning detergents for housekeeping'}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    style={{ resize: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 750, color: 'var(--text-secondary)' }}>Bill / Bill Memo Photo (Optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    style={{ fontSize: '0.8rem' }}
                  />
                  {formReceiptImg && (
                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img
                        src={formReceiptImg}
                        alt="Receipt Preview"
                        style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setFormReceiptImg(null)}
                        style={{ fontSize: '0.72rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Remove Image
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer" style={{ padding: '14px 24px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-surface-secondary)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-scan-action"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 22px',
                    fontWeight: 800,
                    background: formCategory === 'refund' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)'
                  }}
                >
                  {isSubmitting ? 'Saving...' : formCategory === 'refund' ? 'Save & Print Receipt (2-on-A4)' : 'Save & Print Voucher (2-on-A4)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
