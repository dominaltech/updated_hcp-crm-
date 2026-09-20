import React from 'react';
import { useApp } from '../../context/AppContext';

export default function ToastContainer() {
  const { toast, hideToast } = useApp();

  return (
    <div id="custom-top-alert-container" className="custom-top-alert-container">
      {toast && (
        <div
          className={`top-red-alert ${toast.colorClass} ${toast.visible ? 'show' : 'hide'}`}
        >
          <div className="top-alert-icon">{toast.icon}</div>
          <div className="top-alert-msg">{toast.message}</div>
          <button
            type="button"
            className="top-alert-close"
            aria-label="Close alert"
            onClick={hideToast}
          >
            &times;
          </button>
          <div
            className="top-alert-progress"
            style={{ animationDuration: `${toast.duration}ms` }}
          />
        </div>
      )}
    </div>
  );
}
