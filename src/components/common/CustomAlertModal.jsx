import React, { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';

export default function CustomAlertModal() {
  const { alertState, handleAlertOk, theme } = useApp();
  const okBtnRef = useRef(null);

  const isDark = theme === 'dark' || (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark');

  useEffect(() => {
    if (alertState.isOpen) {
      setTimeout(() => {
        if (okBtnRef.current) {
          okBtnRef.current.focus();
        }
      }, 50);

      const handleKeyDown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
          e.preventDefault();
          handleAlertOk();
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [alertState.isOpen, handleAlertOk]);

  if (!alertState.isOpen) return null;

  const isDanger = alertState.type === 'danger';
  const isSuccess = alertState.type === 'success';

  return (
    <div
      className="modal-overlay custom-confirm-overlay active custom-alert-overlay"
      id="custom-alert-modal"
      data-theme={isDark ? 'dark' : 'light'}
      style={{
        zIndex: 999999,
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 25, 28, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleAlertOk();
      }}
    >
      <div
        className="modal-container custom-confirm-card"
        style={{
          maxWidth: '460px',
          width: '92%',
          background: isDark ? '#10282D' : '#FFFFFF',
          border: `1.5px solid ${isDark ? '#24464D' : '#E2E8F0'}`,
          borderRadius: '18px',
          boxShadow: isDark
            ? '0 25px 60px rgba(0, 0, 0, 0.6), 0 0 25px rgba(226, 178, 94, 0.15)'
            : '0 20px 50px rgba(0, 0, 0, 0.18)',
          padding: '28px 24px',
          textAlign: 'center',
          color: isDark ? '#F8FAFC' : '#0F172A',
          animation: 'modalSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Animated Icon Badge */}
        <div
          className={`custom-confirm-icon-wrapper ${isDanger ? 'danger' : isSuccess ? 'success' : 'warning'}`}
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: isDanger
              ? (isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2')
              : isSuccess
              ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#DCFCE7')
              : (isDark ? 'rgba(226, 178, 94, 0.2)' : '#FEF3C7'),
            border: `2px solid ${isDanger ? '#EF4444' : isSuccess ? '#10B981' : '#E2B25E'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            margin: '0 auto 16px',
            boxShadow: isDanger
              ? '0 0 20px rgba(239, 68, 68, 0.25)'
              : '0 0 20px rgba(226, 178, 94, 0.25)'
          }}
        >
          <span>{alertState.icon || '⚠️'}</span>
        </div>

        {/* Title */}
        <h3
          style={{
            fontSize: '1.30rem',
            fontWeight: 850,
            color: isDanger ? '#EF4444' : isSuccess ? '#10B981' : (isDark ? '#E2B25E' : '#B45309'),
            margin: '0 0 10px',
            letterSpacing: '0.2px'
          }}
        >
          {alertState.title || 'Notice'}
        </h3>

        {/* Message */}
        <p
          style={{
            fontSize: '0.94rem',
            color: isDark ? '#CBD5E1' : '#475569',
            lineHeight: 1.55,
            margin: '0 0 24px',
            wordBreak: 'break-word',
            whiteSpace: 'pre-line'
          }}
        >
          {alertState.message}
        </p>

        {/* OK Button */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            ref={okBtnRef}
            type="button"
            id="btn-custom-alert-ok"
            onClick={handleAlertOk}
            style={{
              minWidth: '130px',
              padding: '11px 32px',
              borderRadius: '12px',
              background: isDanger
                ? 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)'
                : 'linear-gradient(135deg, #E2B25E 0%, #D4A045 100%)',
              color: isDanger ? '#FFFFFF' : '#0A191C',
              border: 'none',
              fontSize: '0.95rem',
              fontWeight: 850,
              cursor: 'pointer',
              boxShadow: isDanger
                ? '0 4px 14px rgba(239, 68, 68, 0.35)'
                : '0 4px 14px rgba(226, 178, 94, 0.35)',
              transition: 'transform 0.15s ease, filter 0.15s ease'
            }}
          >
            {alertState.buttonText || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
