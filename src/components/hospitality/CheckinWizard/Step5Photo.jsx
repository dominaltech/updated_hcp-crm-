import React, { useRef, useEffect } from 'react';
import { useWebcam } from '../../../hooks/useWebcam';

export default function Step5Photo({ draft, updateDraft, onSkip, onPreviewDoc }) {
  const {
    videoRef,
    isActive,
    isMirrored,
    activeCameraLabel,
    devices,
    startStream,
    stopStream,
    cycleCamera,
    toggleMirror,
    captureFrame,
    error
  } = useWebcam();

  const fileInputRef = useRef(null);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    // Automatically start webcam once on mount if no photo captured yet
    if (!draft.guestPhoto && !hasMountedRef.current) {
      hasMountedRef.current = true;
      startStream();
    }
    return () => {
      stopStream();
    };
  }, []); // Run only once on mount

  const handleCapture = () => {
    // Capture matching the 460x260 viewfinder aspect ratio so live view and captured pic are 100% identical
    const photoDataUrl = captureFrame({ aspectRatio: 460 / 260, width: 920, height: 520 });
    if (photoDataUrl) {
      updateDraft({ guestPhoto: photoDataUrl });
      stopStream();
    }
  };

  const handleRetake = () => {
    updateDraft({ guestPhoto: null });
    hasMountedRef.current = true;
    startStream();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      updateDraft({ guestPhoto: event.target.result });
      stopStream();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="checkin-step-content" id="checkin-step-5" style={{ padding: 0 }}>
      <div
        className="scanner-hardware-box"
        id="scanner-box-photo"
        style={{
          maxWidth: '640px',
          width: '100%',
          margin: '0 auto',
          padding: '10px 16px',
          borderRadius: '16px',
          boxSizing: 'border-box'
        }}
      >
        {/* Compact Camera Viewfinder (Fits 100% without vertical scrolling) */}
        <div
          className="modern-camera-viewfinder"
          id="webcam-glass-bed-photo"
          style={{
            position: 'relative',
            maxWidth: '460px',
            width: '100%',
            height: '260px',
            margin: '0 auto',
            background: '#090d16',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
            border: '2px solid #1e293b'
          }}
        >
          {/* Live Video Feed */}
          <video
            ref={videoRef}
            className={`webcam-live-video ${!isMirrored ? 'unmirrored' : ''}`}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => {
              if (videoRef.current) {
                videoRef.current.play().catch((e) => console.warn('Video play notice:', e));
              }
            }}
            style={{
              display: !draft.guestPhoto && isActive ? 'block' : 'none',
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />

          {/* Official Face Alignment Guide Overlay */}
          {!draft.guestPhoto && isActive && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '120px',
                height: '160px',
                border: '2px dashed rgba(255, 255, 255, 0.45)',
                borderRadius: '50%',
                pointerEvents: 'none',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.12)',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                paddingBottom: '8px'
              }}
            >
              <span
                style={{
                  background: 'rgba(15, 23, 42, 0.75)',
                  color: '#e2e8f0',
                  fontSize: '0.70rem',
                  fontWeight: 750,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  letterSpacing: '0.02em',
                  backdropFilter: 'blur(4px)'
                }}
              >
                👤 Align Face
              </span>
            </div>
          )}

          {/* Active Camera Live Badge */}
          {!draft.guestPhoto && isActive && activeCameraLabel && (
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                background: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(8px)',
                color: '#f8fafc',
                padding: '4px 10px',
                borderRadius: '16px',
                fontSize: '0.74rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                zIndex: 10,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  display: 'inline-block',
                  boxShadow: '0 0 6px #22c55e'
                }}
              ></span>
              <span>📹 {activeCameraLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')}</span>
            </div>
          )}

          {/* Camera Inactive / Loading / Error Notice */}
          {!draft.guestPhoto && !isActive && (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: '16px' }}>
              <div style={{ fontSize: '2rem', marginBottom: '6px' }}>📷</div>
              <p style={{ margin: '0 0 10px 0', fontSize: '0.88rem', fontWeight: 650 }}>
                {error ? `Camera notice: ${error}` : 'Connecting to camera...'}
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => startStream()}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  fontWeight: 750,
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                🔄 Retry Camera
              </button>
            </div>
          )}

          {/* Photo Preview when captured (Matches live video 100% seamlessly) */}
          {draft.guestPhoto && (
            <div
              style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={() => onPreviewDoc && onPreviewDoc(draft.guestPhoto, 'Captured Guest Portrait')}
              title="Click to view full photo and zoom (Scroll to zoom)"
            >
              <img
                src={draft.guestPhoto}
                alt="Captured Guest Portrait"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  background: '#dcfce7',
                  color: '#15803d',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  border: '1px solid #86efac',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                }}
              >
                ✓ Live Portrait Captured
              </div>
            </div>
          )}
        </div>

        {/* Clean, Compact Controls Bar (Zero scroll needed) */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
          {!draft.guestPhoto ? (
            <>
              <button
                type="button"
                className="btn-scan-action"
                onClick={handleCapture}
                style={{
                  background: 'linear-gradient(135deg, #0071e3 0%, #1d4ed8 100%)',
                  color: '#fff',
                  padding: '8px 20px',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  borderRadius: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(0, 113, 227, 0.3)'
                }}
              >
                <span>📸</span> Take Guest Photo
              </button>

              {/* 1-Click Switch Camera Button (Cycles between Logi, DroidCam, Laptop Webcam) */}
              {devices.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={cycleCamera}
                  title={`Current: ${activeCameraLabel || 'Camera'}. Click to switch camera.`}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.8rem',
                    fontWeight: 750,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    border: '1px solid #bfdbfe'
                  }}
                >
                  <span>🔄</span> Switch Camera ({devices.length})
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={toggleMirror}
                title={isMirrored ? 'Turn off selfie mirror' : 'Turn on selfie mirror'}
                style={{
                  padding: '8px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 750,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <span>🪞</span> {isMirrored ? 'Unmirror' : 'Mirror'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRetake}
              style={{
                padding: '8px 18px',
                fontSize: '0.85rem',
                fontWeight: 750,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>🔄</span> Retake Photo
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            style={{
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 750,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>📁</span> Choose from PC
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
        </div>
      </div>
    </div>
  );
}
