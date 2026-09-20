import React, { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';

export default function ConfirmModal() {
  const { confirmState, handleConfirmOk, handleConfirmCancel } = useApp();
  const okBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (confirmState.isOpen) {
      setTimeout(() => {
        if (okBtnRef.current) {
          okBtnRef.current.focus();
        }
      }, 50);

      const handleKeyDown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (document.activeElement === cancelBtnRef.current) {
            handleConfirmCancel();
          } else {
            handleConfirmOk();
          }
        } else if (e.key === 'Escape' || (e.shiftKey && e.key === 'Enter')) {
          e.preventDefault();
          handleConfirmCancel();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (document.activeElement === okBtnRef.current) {
            cancelBtnRef.current?.focus();
          } else {
            okBtnRef.current?.focus();
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [confirmState.isOpen, handleConfirmOk, handleConfirmCancel]);

  if (!confirmState.isOpen) return null;

  return (
    <div className="modal-overlay custom-confirm-overlay active" id="custom-confirm-modal">
      <div className="modal-container custom-confirm-card">
        <div
          className={`custom-confirm-icon-wrapper ${confirmState.isDestructive ? 'danger' : ''}`}
          id="custom-confirm-icon-wrap"
        >
          <span id="custom-confirm-icon">{confirmState.icon}</span>
        </div>
        <h3 className="custom-confirm-title" id="custom-confirm-title">
          {confirmState.title}
        </h3>
        <p className="custom-confirm-message" id="custom-confirm-message">
          {confirmState.message}
        </p>
        <div className="custom-confirm-buttons">
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn-custom-cancel"
            id="btn-custom-confirm-cancel"
            onClick={handleConfirmCancel}
          >
            {confirmState.cancelText}
          </button>
          <button
            ref={okBtnRef}
            type="button"
            className={`btn-custom-ok ${confirmState.isDestructive ? 'danger' : ''}`}
            id="btn-custom-confirm-ok"
            onClick={handleConfirmOk}
          >
            {confirmState.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
