import React from 'react';

/**
 * CustomModal - Universal replacement for browser window.alert() and window.confirm()
 * Strictly styled with HCP universal design tokens.
 */
export default function CustomModal({ config, onClose }) {
  if (!config) return null;

  const {
    type = 'alert', // 'alert' | 'confirm'
    title = 'Notice',
    message = '',
    icon = '🔔',
    confirmText = 'OK',
    cancelText = 'Cancel',
    confirmColor = 'var(--apple-blue)',
    onConfirm,
    onCancel
  } = config;

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.60)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeInModal 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
      onClick={type === 'confirm' ? handleCancel : handleConfirm}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '320px',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1.5px solid var(--border-medium)',
          boxShadow: 'var(--shadow-modal)',
          padding: '22px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          animation: 'scaleInModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Icon Badge */}
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.6rem',
            marginBottom: '14px',
            boxShadow: 'var(--shadow-subtle)'
          }}
        >
          {icon}
        </div>

        {/* Modal Title */}
        <div
          style={{
            fontSize: '1.05rem',
            fontWeight: 850,
            color: 'var(--text-primary)',
            marginBottom: '8px',
            letterSpacing: '-0.02em',
            lineHeight: 1.25
          }}
        >
          {title}
        </div>

        {/* Modal Message */}
        <div
          style={{
            fontSize: '0.84rem',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            marginBottom: '20px',
            whiteSpace: 'pre-line'
          }}
        >
          {message}
        </div>

        {/* Actions Button Group */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            width: '100%',
            justifyContent: 'center'
          }}
        >
          {type === 'confirm' && (
            <button
              type="button"
              id="btn-custom-modal-cancel"
              onClick={handleCancel}
              style={{
                flex: 1,
                height: '42px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface-secondary)',
                border: '1.5px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                fontWeight: 750,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            id="btn-custom-modal-confirm"
            onClick={handleConfirm}
            style={{
              flex: 1,
              height: '42px',
              borderRadius: 'var(--radius-sm)',
              background: confirmColor,
              border: 'none',
              color: 'var(--text-on-accent)',
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-subtle)',
              transition: 'all 0.15s ease'
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
