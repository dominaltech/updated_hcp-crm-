import React, { useState, useEffect } from 'react';
import { useWebcam } from '../../hooks/useWebcam';

export default function DocumentScannerModal({
  isOpen,
  onClose,
  onCapture,
  title = 'Scan Vendor Bill / Receipt Photo',
  subtitle = 'Position the bill or receipt clearly within the frame and click Snap Photo'
}) {
  const webcam = useWebcam();
  const [capturedPhoto, setCapturedPhoto] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      webcam.startStream().catch((err) => {
        console.warn('[DocumentScannerModal] Camera start error:', err);
      });
    } else {
      webcam.stopStream();
      setCapturedPhoto(null);
    }
    return () => {
      webcam.stopStream();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const frame = webcam.captureFrame();
    if (frame) {
      setCapturedPhoto(frame);
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
  };

  const handleConfirm = () => {
    if (capturedPhoto && onCapture) {
      onCapture(capturedPhoto);
      webcam.stopStream();
      onClose();
    }
  };

  const handleClose = () => {
    webcam.stopStream();
    setCapturedPhoto(null);
    onClose();
  };

  return (
    <div
      className="modal-overlay active"
      style={{
        zIndex: 10090,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.78)',
        backdropFilter: 'blur(6px)',
        position: 'fixed',
        inset: 0
      }}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: '580px',
          width: '94%',
          background: '#ffffff',
          color: '#0f172a',
          borderRadius: '20px',
          border: '1.5px solid #cbd5e1',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 22px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                fontSize: '1.4rem',
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.2)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              📸
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#ffffff' }}>
                {title}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#bae6fd', fontWeight: 650 }}>
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            title="Close Scanner"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#ffffff',
              fontSize: '1.3rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '18px 22px', background: '#f8fafc' }}>
          {!capturedPhoto ? (
            <div>
              {/* Controls bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: webcam.isActive ? '#10b981' : '#f59e0b',
                      display: 'inline-block',
                      boxShadow: webcam.isActive ? '0 0 8px #10b981' : 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>
                    {webcam.isActive ? 'Scanner Ready' : (webcam.error ? 'Camera Error' : 'Connecting Camera...')}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {webcam.devices.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const idx = webcam.devices.findIndex(d => d.deviceId === webcam.selectedDeviceId);
                        const next = webcam.devices[(idx + 1) % webcam.devices.length];
                        if (next) webcam.selectDevice(next.deviceId);
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 750,
                        borderRadius: '8px',
                        background: '#e0f2fe',
                        color: '#0369a1',
                        border: '1px solid #7dd3fc',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      <span>🔄</span> Switch Camera ({webcam.devices.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => webcam.setIsMirrored(!webcam.isMirrored)}
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.78rem',
                      fontWeight: 750,
                      borderRadius: '8px',
                      background: webcam.isMirrored ? '#f1f5f9' : '#ffffff',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      cursor: 'pointer'
                    }}
                  >
                    🪞 {webcam.isMirrored ? 'Mirrored' : 'Normal'}
                  </button>
                </div>
              </div>

              {/* Viewfinder */}
              <div
                style={{
                  width: '100%',
                  height: '340px',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  background: '#090d16',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #0284c7',
                  boxShadow: '0 8px 24px rgba(2, 132, 199, 0.15)'
                }}
              >
                <video
                  ref={webcam.videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: webcam.isMirrored ? 'scaleX(-1)' : 'none'
                  }}
                />

                {/* Document alignment overlay frame */}
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '82%',
                    height: '84%',
                    border: '2px dashed rgba(56, 189, 248, 0.85)',
                    borderRadius: '12px',
                    pointerEvents: 'none',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    paddingBottom: '10px'
                  }}
                >
                  <span
                    style={{
                      background: 'rgba(15, 23, 42, 0.82)',
                      color: '#ffffff',
                      fontSize: '0.74rem',
                      fontWeight: 750,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      letterSpacing: '0.3px',
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}
                  >
                    📄 Align Bill / Receipt inside frame
                  </span>
                </div>

                {webcam.error && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(15, 23, 42, 0.92)',
                      color: '#ffffff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px',
                      textAlign: 'center'
                    }}
                  >
                    <span style={{ fontSize: '2rem', marginBottom: '8px' }}>⚠️</span>
                    <strong style={{ fontSize: '0.95rem', color: '#fca5a5' }}>
                      Camera Access Needed
                    </strong>
                    <p style={{ fontSize: '0.8rem', color: '#cbd5e1', margin: '6px 0 0' }}>
                      {webcam.error || 'Please grant camera permission in your browser or upload a saved photo instead.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Captured Photo Preview */}
              <div
                style={{
                  width: '100%',
                  height: '340px',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  background: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #10b981',
                  boxShadow: '0 8px 24px rgba(16, 185, 129, 0.15)',
                  position: 'relative'
                }}
              >
                <img
                  src={capturedPhoto}
                  alt="Scanned Document Preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: '12px',
                    left: '12px',
                    background: '#10b981',
                    color: '#ffffff',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 800
                  }}
                >
                  ✓ Scanned Preview
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 22px',
            background: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '9px 18px',
              borderRadius: '8px',
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #cbd5e1',
              fontWeight: 750,
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>

          {!capturedPhoto ? (
            <button
              type="button"
              onClick={handleSnap}
              disabled={!webcam.isActive}
              style={{
                padding: '9px 24px',
                borderRadius: '8px',
                background: webcam.isActive ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#94a3b8',
                color: '#ffffff',
                border: 'none',
                fontWeight: 900,
                fontSize: '0.92rem',
                cursor: webcam.isActive ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: webcam.isActive ? '0 4px 12px rgba(2, 132, 199, 0.3)' : 'none'
              }}
            >
              <span>📸</span> Snap Photo
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleRetake}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>🔄</span> Retake
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                style={{
                  padding: '9px 24px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 900,
                  fontSize: '0.92rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                }}
              >
                <span>✓</span> Use This Scan
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
