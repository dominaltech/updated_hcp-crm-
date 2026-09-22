import React, { useState, useRef, useEffect } from 'react';
import { blockNonNumericKeys, sanitizePhoneInput, blockNumericKeys, sanitizeNameInput } from '../../../utils/inputEnhancements';

export default function Step4Details({ draft, updateDraft, onReanalyzeAI, onPreviewDoc }) {
  const [activeSide, setActiveSide] = useState('front');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);
  const docViewportRef = useRef(null);

  const activeImage = activeSide === 'front' ? draft.docFront : draft.docBack;

  // Non-passive wheel listener for smooth scroll wheel zoom on picture
  useEffect(() => {
    const el = docViewportRef.current;
    if (!el) return;

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const zoomStep = 0.22;
      const factor = e.deltaY < 0 ? zoomStep : -zoomStep;

      setZoom((prev) => {
        const next = Math.max(0.5, Math.min(4.5, Number((prev + factor).toFixed(2))));
        if (next <= 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const handleZoom = (delta) => {
    setZoom((prev) => {
      const next = Math.max(0.5, Math.min(4, Number((prev + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragDistanceRef.current = 0;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
    dragDistanceRef.current = dist;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Click to toggle zoom in/out
  const handleClickImage = () => {
    if (dragDistanceRef.current > 6) return;
    setZoom((prev) => {
      if (prev <= 1.2) return 2.2;
      setPan({ x: 0, y: 0 });
      return 1;
    });
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    setZoom((prev) => {
      if (prev > 1.2) {
        setPan({ x: 0, y: 0 });
        return 1;
      }
      return 2.5;
    });
  };

  // Calculate age from DOB
  let age = null;
  let isUnderAge = false;
  let ageBadge = null;
  if (draft.dob) {
    const birth = new Date(draft.dob);
    if (!isNaN(birth.getTime())) {
      const today = new Date();
      let calculatedAge = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        calculatedAge--;
      }
      age = calculatedAge;
      if (age < 18) {
        isUnderAge = true;
        ageBadge = `⚠️ Age: ${age} yrs (Under 18)`;
      } else {
        ageBadge = `Age: ${age} yrs`;
      }
    }
  }

  // Detect document type
  const isPassport = (draft.docType || '').toLowerCase().includes('passport');
  const isDrivingLicense = (draft.docType || '').toLowerCase().includes('licen') || (draft.docType || '').toLowerCase().includes('driving') || (draft.docType || '').toLowerCase().includes('dl');
  const isAadhaar = (draft.docType || '').toLowerCase().includes('aadha') || (draft.docType || '').toLowerCase().includes('adhar');
  const isVoterId = (draft.docType || '').toLowerCase().includes('voter') || (draft.docType || '').toLowerCase().includes('election');
  const docName = isPassport ? 'Passport' : isDrivingLicense ? 'Driving License' : isVoterId ? 'Voter ID' : isAadhaar ? 'Aadhaar Card' : (draft.docType || 'Document');

  // Dynamic doc ID label: e.g. Passport No, Driving License No, Aadhaar No
  const docIdLabel = isPassport
    ? 'Passport No'
    : isDrivingLicense
      ? 'Driving License No'
      : isVoterId
        ? 'Voter ID No'
        : isAadhaar
          ? 'Aadhaar No'
          : `${docName} No`;

  // Document ID Max Lengths & Sanitizer
  const maxDocLength = isAadhaar ? 12 : isPassport ? 9 : isDrivingLicense ? 16 : isVoterId ? 10 : 20;

  const sanitizeDocNumber = (val, docType) => {
    if (!val) return '';
    const dt = (docType || '').toLowerCase();
    if (dt.includes('aadha') || dt.includes('adhar')) {
      return val.replace(/\D/g, '').slice(0, 12);
    }
    if (dt.includes('passport')) {
      return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 9);
    }
    if (dt.includes('licen') || dt.includes('driving') || dt.includes('dl')) {
      return val.replace(/[^a-zA-Z0-9- ]/g, '').toUpperCase().slice(0, 16);
    }
    if (dt.includes('voter') || dt.includes('election')) {
      return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
    }
    return val.slice(0, 20);
  };

  // Calculate document expiry - ONLY for Passports! (Aadhaar cards do not expire)
  let isDocExpired = false;
  let expiryBadge = null;
  if (isPassport && draft.expiryDate) {
    const exp = new Date(draft.expiryDate);
    if (!isNaN(exp.getTime())) {
      const expEndOfDay = new Date(exp);
      expEndOfDay.setHours(23, 59, 59, 999);
      if (expEndOfDay < new Date()) {
        isDocExpired = true;
        expiryBadge = `⚠️ Expired`;
      } else {
        expiryBadge = `✓ Valid`;
      }
    }
  }

  const hasAlert = isUnderAge || (isPassport && isDocExpired);

  return (
    <div className="checkin-step-content" id="checkin-step-4" style={{ width: '100%', maxWidth: '100%', margin: 0 }}>
      <div
        className="step4-split-container"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          width: '100%',
          alignItems: 'stretch'
        }}
      >
        {/* LEFT COLUMN: DOCUMENT VIEWER WITH ZOOM/PAN */}
        <div
          className="step4-doc-viewer-card"
          style={{
            background: '#0f172a',
            borderRadius: '16px',
            border: '1.5px solid #334155',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            height: 'calc(100vh - 120px)',
            minHeight: '400px',
            boxSizing: 'border-box'
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  color: '#f8fafc',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}
              >
                📄 Scanned ID Document
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 750,
                  color: '#38bdf8',
                  background: 'rgba(56, 189, 248, 0.15)',
                  padding: '2px 8px',
                  borderRadius: '6px'
                }}
              >
                {activeSide === 'front' ? 'Front Side' : 'Back Side'}
              </span>
            </div>

            {draft.docBack && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className={`step4-tab-btn ${activeSide === 'front' ? 'active' : ''}`}
                  onClick={() => setActiveSide('front')}
                >
                  Front
                </button>
                <button
                  type="button"
                  className={`step4-tab-btn ${activeSide === 'back' ? 'active' : ''}`}
                  onClick={() => setActiveSide('back')}
                >
                  Back
                </button>
              </div>
            )}
          </div>

          {/* Viewport */}
          <div
            ref={docViewportRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#020617',
              borderRadius: '12px',
              overflow: 'hidden',
              userSelect: 'none',
              cursor: isDragging ? 'grabbing' : (zoom > 1.05 ? 'grab' : 'zoom-in')
            }}
          >
            {/* Zoom Toolbar */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(6px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '20px',
                padding: '3px 8px'
              }}
            >
              <button type="button" className="step4-zoom-btn" onClick={() => handleZoom(0.25)} title="Zoom In (+)">
                ➕
              </button>
              <button type="button" className="step4-zoom-btn" onClick={() => handleZoom(-0.25)} title="Zoom Out (-)">
                ➖
              </button>
              <button type="button" className="step4-zoom-btn" onClick={handleResetZoom} title="Reset Zoom">
                ↺
              </button>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 750,
                  color: '#38bdf8',
                  minWidth: '38px',
                  textAlign: 'center'
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              {onPreviewDoc && activeImage && (
                <button
                  type="button"
                  className="step4-zoom-btn"
                  onClick={() => onPreviewDoc(activeImage, `${activeSide === 'front' ? 'Front' : 'Back'} Scanned ID Document`)}
                  title="Open Fullscreen Lightbox (Zoom & Pan)"
                  style={{ color: '#38bdf8', fontWeight: 800 }}
                >
                  ⛶
                </button>
              )}
            </div>

            {/* Transform Container */}
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isDragging ? 'none' : 'transform 0.12s ease-out'
              }}
            >
              {activeImage ? (
                <img
                  src={activeImage}
                  alt="Scanned Document"
                  onClick={handleClickImage}
                  draggable="false"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    borderRadius: '8px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                    pointerEvents: 'auto',
                    cursor: isDragging ? 'grabbing' : (zoom > 1.05 ? 'grab' : 'zoom-in')
                  }}
                />
              ) : (
                <div style={{ color: '#94a3b8', textAlign: 'center' }}>
                  <span style={{ fontSize: '2.8rem', display: 'block', marginBottom: '8px' }}>📑</span>
                  <span>Manual Form Entry Mode</span>
                </div>
              )}
            </div>

            {/* Bottom Tip Overlay */}
            {activeImage && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(15, 23, 42, 0.75)',
                  backdropFilter: 'blur(4px)',
                  color: '#94a3b8',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '0.68rem',
                  fontWeight: 650,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  zIndex: 5
                }}
              >
                🖱️ Scroll wheel to zoom in / out • Click to toggle
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: EXTRACTED / VERIFIED CUSTOMER FORM */}
        <div
          className={`step4-form-card ${hasAlert ? 'form-alert-red' : ''}`}
          style={{
            background: hasAlert ? 'linear-gradient(180deg, rgba(239, 68, 68, 0.12) 0%, var(--bg-surface, #ffffff) 90px)' : 'var(--bg-surface, #ffffff)',
            borderRadius: '16px',
            border: hasAlert ? '2.5px solid #ef4444' : '1.5px solid var(--border-color, #e2e8f0)',
            padding: '12px 18px',
            boxShadow: hasAlert
              ? '0 0 0 4px rgba(239, 68, 68, 0.16), 0 8px 26px rgba(239, 68, 68, 0.22)'
              : '0 4px 20px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            height: 'calc(100vh - 120px)',
            minHeight: '400px',
            boxSizing: 'border-box',
            overflowY: 'auto',
            animation: hasAlert ? 'redPulseAlert 2s infinite ease-in-out' : 'none',
            transition: 'border-color 0.3s ease, box-shadow 0.3s ease'
          }}
        >
          {/* INTIMATION ALERT BANNER (Non-blocking, informs staff of expired passport / underage) */}
          {hasAlert && (
            <div
              className="step4-alert-intimation-banner"
              style={{
                background: '#fef2f2',
                border: '1.5px solid #f87171',
                borderRadius: '12px',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.12)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="alert-intimation-icon" style={{ fontSize: '1.15rem', lineHeight: 1 }}>
                    🚨
                  </span>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 900,
                      color: '#991b1b',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em'
                    }}
                  >
                    Verification Intimation Alert
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#166534',
                    background: '#dcfce7',
                    border: '1px solid #86efac',
                    padding: '2px 9px',
                    borderRadius: '9999px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  ✓ Able to Proceed
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '26px' }}>
                {isPassport && isDocExpired && (
                  <div style={{ fontSize: '0.78rem', fontWeight: 750, color: '#b91c1c' }}>
                    • <strong>Passport Expired:</strong> Document validity expired on {draft.expiryDate}. Please verify credentials.
                  </div>
                )}
                {isUnderAge && (
                  <div style={{ fontSize: '0.78rem', fontWeight: 750, color: '#b91c1c' }}>
                    • <strong>Underage Guest:</strong> Guest is {age} years old (below 18 years). Minor check-in policy applies.
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: '#4b5563', marginTop: '2px' }}>
                  ℹ️ <em>Intimation only for front-desk records. You may proceed with check-in.</em>
                </div>
              </div>
            </div>
          )}

          <div className="checkin-form-grid-2" style={{ gap: '8px 12px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                Guest Full Name *
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Guest Full Name"
                required
                value={draft.guestName || ''}
                onKeyDown={blockNumericKeys}
                onChange={(e) => updateDraft({ guestName: sanitizeNameInput(e.target.value) })}
                style={{ height: '36px', fontWeight: 750 }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                Mobile Number *
              </label>
              <input
                type="tel"
                className="form-input"
                placeholder="10-digit Mobile Number"
                maxLength={10}
                required
                value={draft.mobile || ''}
                onKeyDown={(e) => blockNonNumericKeys(e, 10)}
                onChange={(e) => updateDraft({ mobile: sanitizePhoneInput(e.target.value, 10) })}
                style={{ height: '36px', fontWeight: 750 }}
              />
            </div>
          </div>

          <div className="checkin-form-grid-2" style={{ gap: '8px 12px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                Email Address * (Mandatory)
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="guest@example.com"
                required
                value={draft.email || ''}
                onChange={(e) => updateDraft({ email: e.target.value })}
                style={{ height: '36px' }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', margin: 0 }}>
                  {docIdLabel} *
                </label>
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 750,
                    color: '#0369a1',
                    background: '#e0f2fe',
                    padding: '1px 6px',
                    borderRadius: '6px'
                  }}
                >
                  {isPassport ? 'Passport' : isDrivingLicense ? 'Driving License' : 'Govt ID'}
                </span>
              </div>
              <input
                type="text"
                className="form-input"
                placeholder={isPassport ? 'e.g. R9570989' : isDrivingLicense ? 'e.g. MH13 20180004523' : isAadhaar ? 'e.g. 4438 4267 7809' : 'Document ID Number'}
                maxLength={maxDocLength}
                value={draft.idNumber || draft.aadharNumber || ''}
                onChange={(e) => {
                  const cleaned = sanitizeDocNumber(e.target.value, draft.docType);
                  updateDraft({ idNumber: cleaned, aadharNumber: cleaned });
                }}
                style={{ height: '36px', fontWeight: 750, letterSpacing: '0.04em' }}
              />
            </div>
          </div>

          {/* DATE OF BIRTH & PASSPORT EXPIRY / ALTERNATE MOBILE (2-Column Grid) */}
          <div className="checkin-form-grid-2" style={{ gap: '8px 12px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 800, color: isUnderAge ? '#b91c1c' : '#475569', textTransform: 'uppercase', margin: 0 }}>
                  Date of Birth (DOB)
                </label>
                {ageBadge && (
                  <span
                    style={{
                      fontSize: '0.70rem',
                      fontWeight: 800,
                      color: isUnderAge ? '#b91c1c' : '#1d4ed8',
                      background: isUnderAge ? '#fee2e2' : '#eff6ff',
                      border: `1px solid ${isUnderAge ? '#f87171' : '#bfdbfe'}`,
                      padding: '1px 6px',
                      borderRadius: '8px'
                    }}
                  >
                    {ageBadge}
                  </span>
                )}
              </div>
              <input
                type="date"
                className="form-input"
                value={draft.dob || ''}
                onChange={(e) => updateDraft({ dob: e.target.value })}
                style={{
                  height: '36px',
                  fontWeight: 600,
                  width: '100%',
                  borderColor: isUnderAge ? '#ef4444' : undefined,
                  backgroundColor: isUnderAge ? '#fff5f5' : undefined
                }}
              />
            </div>

            {isPassport ? (
              <div className="form-group" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <label style={{ fontSize: '0.74rem', fontWeight: 800, color: isDocExpired ? '#b91c1c' : '#475569', textTransform: 'uppercase', margin: 0 }}>
                    Passport Expiry Date
                  </label>
                  {expiryBadge ? (
                    <span
                      style={{
                        fontSize: '0.70rem',
                        fontWeight: 800,
                        color: isDocExpired ? '#b91c1c' : '#166534',
                        background: isDocExpired ? '#fee2e2' : '#dcfce7',
                        border: `1px solid ${isDocExpired ? '#f87171' : '#86efac'}`,
                        padding: '1px 6px',
                        borderRadius: '8px'
                      }}
                    >
                      {expiryBadge}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        color: '#64748b',
                        background: '#f1f5f9',
                        padding: '1px 6px',
                        borderRadius: '6px'
                      }}
                    >
                      Optional / Passport
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  className="form-input"
                  value={draft.expiryDate || ''}
                  onChange={(e) => updateDraft({ expiryDate: e.target.value })}
                  style={{
                    height: '36px',
                    fontWeight: 600,
                    width: '100%',
                    borderColor: isDocExpired ? '#ef4444' : undefined,
                    backgroundColor: isDocExpired ? '#fff5f5' : undefined
                  }}
                />
              </div>
            ) : (
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                  Alternate Mobile (Optional)
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Optional 2nd Mobile"
                  maxLength={10}
                  value={draft.altMobile || ''}
                  onKeyDown={(e) => blockNonNumericKeys(e, 10)}
                  onChange={(e) => updateDraft({ altMobile: sanitizePhoneInput(e.target.value, 10) })}
                  style={{ height: '36px', fontWeight: 600 }}
                />
              </div>
            )}
          </div>

          <div className="checkin-form-grid-2" style={{ gap: '8px 12px' }}>
            {isPassport && (
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                  Alternate Mobile (Optional)
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Optional 2nd Mobile"
                  maxLength={10}
                  value={draft.altMobile || ''}
                  onKeyDown={(e) => blockNonNumericKeys(e, 10)}
                  onChange={(e) => updateDraft({ altMobile: sanitizePhoneInput(e.target.value, 10) })}
                  style={{ height: '36px', fontWeight: 600 }}
                />
              </div>
            )}
            <div className="form-group" style={{ margin: 0, gridColumn: isPassport ? 'auto' : '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', margin: 0 }}>
                  ID Verification Type *
                </label>
                <span style={{ fontSize: '0.70rem', color: '#166534', background: '#dcfce7', padding: '1px 6px', borderRadius: '4px', fontWeight: 750 }}>
                  ✓ Verified
                </span>
              </div>
              <select
                className="form-input"
                value={draft.docType || 'Aadhaar Card'}
                onChange={(e) => updateDraft({ docType: e.target.value })}
                style={{ height: '36px', fontWeight: 750, color: '#0369a1', background: '#f8fafc' }}
              >
                <option value="Aadhaar Card">🪪 Aadhaar Card</option>
                <option value="Passport">🛂 Passport</option>
                <option value="Driving License">🚗 Driving License</option>
                <option value="Voter ID">🗳️ Voter ID</option>
                <option value="PAN Card">📄 PAN Card</option>
                <option value="Government ID">🏛️ Other Govt ID</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ margin: 0, width: '100%' }}>
            <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
              Complete Residential Address *
            </label>
            <textarea
              className="form-input"
              placeholder="House/Flat No, Street, City, State, PIN Code"
              required
              value={draft.address || ''}
              onChange={(e) => updateDraft({ address: e.target.value })}
              style={{
                width: '100%',
                height: '46px',
                minHeight: '42px',
                resize: 'vertical',
                fontSize: '0.84rem',
                lineHeight: 1.3,
                padding: '6px 10px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* OPTIONAL CORPORATE COMPANY DETAILS (Hidden for BTC bookings since BTC has its own company selection) */}
          {draft.bookingSource !== 'BTC' && (
            <div
              className="corporate-company-details-card"
              style={{
                background: '#f8fafc',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '10px',
                padding: '8px 12px',
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.90rem' }}>🏢</span>
                  <label style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', margin: 0 }}>
                    Corporate Company Details (Optional)
                  </label>
                </div>
                <span
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    color: (draft.companyName || draft.gstNumber) ? '#166534' : '#64748b',
                    background: (draft.companyName || draft.gstNumber) ? '#dcfce7' : '#ffffff',
                    border: (draft.companyName || draft.gstNumber) ? '1px solid #86efac' : '1px solid #e2e8f0',
                    padding: '1px 6px',
                    borderRadius: '6px'
                  }}
                >
                  {(draft.companyName || draft.gstNumber) ? '✓ Will print on form' : 'Prints only if filled'}
                </span>
              </div>

              <div className="checkin-form-grid-2" style={{ gap: '6px 12px', margin: 0 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.70rem', fontWeight: 750, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                    Company Name
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Acme Corp / Tata / Self"
                    value={draft.companyName || draft.company_name || ''}
                    onChange={(e) => updateDraft({ companyName: e.target.value, company_name: e.target.value })}
                    style={{ height: '34px', fontSize: '0.84rem' }}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.70rem', fontWeight: 750, color: '#475569', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>
                    GST Number
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 27AAAAA0000A1Z5"
                    maxLength={15}
                    value={draft.gstNumber || draft.gst_number || ''}
                    onChange={(e) => updateDraft({ gstNumber: e.target.value.toUpperCase(), gst_number: e.target.value.toUpperCase() })}
                    style={{ height: '34px', fontSize: '0.84rem', textTransform: 'uppercase' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bottom Right Re-Analyze Logo Button */}
          {(draft.docFront || draft.docBack) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
              <button
                type="button"
                id="btn-reanalyze-ai"
                onClick={onReanalyzeAI}
                title="Re-Analyze ID with AI Vision"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                  border: '1.5px solid #93c5fd',
                  color: '#1d4ed8',
                  borderRadius: '10px',
                  padding: '6px 14px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(29, 78, 216, 0.12)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>✨</span>
                <span>Re-Analyze</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
