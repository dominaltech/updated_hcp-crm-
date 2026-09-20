import React, { useState, useRef, useEffect } from 'react';
import { compressImageFile, compressBase64Image } from '../../../utils/imageCompressor';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';

export default function Step3BackScan({ draft, updateDraft, onSkipBack, onPreviewDoc }) {
  const { showToast } = useApp();
  const [isScanning, setIsScanning] = useState(false);
  const [detectedScanner, setDetectedScanner] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [scanError, setScanError] = useState(null);
  const fileInputRef = useRef(null);

  // Auto-detect attached WIA/USB scanner on mount
  const checkScanner = async () => {
    setIsDetecting(true);
    try {
      const res = await api.getScannerDevices();
      if (res && res.devices && res.devices.length > 0) {
        setDetectedScanner(res.devices[0]);
      } else {
        setDetectedScanner(null);
      }
    } catch (e) {
      setDetectedScanner(null);
    } finally {
      setIsDetecting(false);
    }
  };

  useEffect(() => {
    checkScanner();
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      if (compressed) {
        updateDraft({ docBack: compressed });
        setScanError(null);
        showToast('✓ Back document uploaded successfully!', 'green');
      }
    } catch (err) {
      console.warn('Image upload compression error:', err);
      showToast('Failed to process uploaded image.', 'red');
    }
  };

  // Real optical hardware scan via Windows WIA bridge
  const handleHardwareScan = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      showToast('⚡ Communicating with scanner... Scanner carriage is reading back side.', 'info', 6000);
      const res = await api.scanHardwareDocument();
      if (res && res.success && res.image) {
        const compressed = await compressBase64Image(res.image);
        updateDraft({ docBack: compressed || res.image });
        if (res.device) setDetectedScanner(res.device);
        setScanError(null);
        showToast(`✓ Back of ${draft.docType} scanned successfully from ${res.device || detectedScanner || 'scanner'}!`, 'green', 4000);
      } else {
        throw new Error(res?.error || 'No scanned image returned from scanner.');
      }
    } catch (err) {
      console.error('Scan error:', err);
      const errMsg = err?.message || 'Scanner acquisition failed. Ensure scanner is turned on and USB is connected.';
      setScanError(errMsg);
      showToast(`Scanner Error: ${errMsg}`, 'red', 6000);
    } finally {
      setIsScanning(false);
    }
  };

  // Auto-grab latest scan from Windows Scans folder (if user pressed the physical button on scanner)
  const handleGrabLatest = async () => {
    try {
      const res = await api.getLatestScannedDocument();
      if (res && res.found && res.image) {
        const compressed = await compressBase64Image(res.image);
        updateDraft({ docBack: compressed || res.image });
        setScanError(null);
        showToast(`✓ Retrieved latest scan (${res.filename || 'Scans folder'})!`, 'green', 4000);
      } else {
        showToast('No recent scans found in Windows Scans folder. Click Scan to trigger direct scan.', 'info', 4000);
      }
    } catch (err) {
      showToast('Could not check Scans folder: ' + err.message, 'red');
    }
  };

  return (
    <div className="checkin-step-content" id="checkin-step-3">
      <h2 className="checkin-step-heading">
        Flip &amp; Place Back of <span className="chosen-doc-name">{draft.docType}</span>
      </h2>

      {/* Scanner Hardware Status Pill */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: detectedScanner ? '#f0fdf4' : '#f8fafc',
        border: detectedScanner ? '1.5px solid #86efac' : '1.5px solid #e2e8f0',
        padding: '6px 16px',
        borderRadius: '24px',
        marginBottom: '14px',
        fontSize: '0.82rem',
        fontWeight: 750,
        color: detectedScanner ? '#15803d' : '#64748b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.9rem' }}>{detectedScanner ? '🟢' : '⚪'}</span>
          <span>
            {detectedScanner
              ? `Hardware Scanner Connected: ${detectedScanner} (Ready)`
              : isDetecting
              ? 'Checking for connected hardware scanner...'
              : 'No hardware scanner detected yet'}
          </span>
        </div>
        <button
          type="button"
          onClick={checkScanner}
          disabled={isDetecting || isScanning}
          style={{
            background: 'none',
            border: 'none',
            color: '#0284c7',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title="Re-check scanner connection"
        >
          <span>🔄</span> {isDetecting ? 'Detecting...' : 'Refresh Scanner'}
        </button>
      </div>

      <div className="scanner-hardware-box" id="scanner-box-back">
        <div className="scanner-glass-bed" id="glass-bed-back">
          {isScanning && <div className="laser-beam scanning" id="laser-beam-back" />}
          {draft.docBack ? (
            <div
              className="scanned-doc-full-view"
              onClick={() => onPreviewDoc && onPreviewDoc(draft.docBack, `Back of ${draft.docType}`)}
              title="Click to zoom / view full size"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                position: 'relative',
                padding: '8px'
              }}
            >
              <img
                src={draft.docBack}
                alt={`Scanned Back ${draft.docType}`}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  height: 'auto',
                  objectFit: 'contain',
                  borderRadius: '10px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                  border: '2px solid rgba(255,255,255,0.2)'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  right: '16px',
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: '#ffffff',
                  backdropFilter: 'blur(8px)',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  border: '1px solid rgba(255,255,255,0.25)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}
              >
                <span>🔍</span> Click to Enlarge
              </div>
            </div>
          ) : (
            <div
              className="placed-document-card"
              id="doc-card-back"
              style={{ cursor: 'default' }}
            >
              <div className="doc-mini-header">
                <span>RESIDENTIAL DETAILS</span>
                <span>QR CODE</span>
              </div>
              <div className="doc-mini-body">
                <div className="doc-mini-lines">
                  <div className="doc-mini-line" />
                  <div className="doc-mini-line" />
                  <div className="doc-mini-line short" />
                </div>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    border: '1px dashed #718096',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.6rem'
                  }}
                >
                  QR
                </div>
              </div>
              <div className="doc-mini-header" style={{ border: 'none', padding: 0 }}>
                <span>BACK SIDE</span>
                <span
                  id="doc-back-status-pill"
                  style={{
                    color: isScanning ? '#38bdf8' : (detectedScanner ? '#16a34a' : '#64748b'),
                    fontWeight: 750
                  }}
                >
                  {isScanning ? '⚡ Hardware Scanning...' : (detectedScanner ? '🟢 Scanner Ready' : 'Ready to Scan')}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Status text */}
        <div
          id="scanner-status-back"
          className="scanner-status-text"
          style={{
            fontSize: '0.88rem',
            fontWeight: 650,
            textAlign: 'center',
            marginTop: '10px',
            color: scanError ? '#dc2626' : (isScanning ? '#0284c7' : 'var(--text-secondary)')
          }}
        >
          {isScanning
            ? '⚡ Scanning in progress... Scanner carriage lamp is reading document. Please wait.'
            : scanError
            ? `⚠️ ${scanError}`
            : draft.docBack
            ? '✓ Back document captured. Proceed to next step or rescan if needed.'
            : detectedScanner
            ? `Flip card on glass bed and click Scan, or Skip if single-sided.`
            : 'Flip card on scanner bed and click Scan, or Skip if single-sided.'}
        </div>

        {/* Action Controls */}
        <div
          className="scanner-controls"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            alignItems: 'center',
            marginTop: '14px'
          }}
        >
          <button
            type="button"
            className="btn-scan-action"
            id="btn-trigger-scan-back"
            disabled={isScanning}
            onClick={handleHardwareScan}
            style={{
              padding: '12px 28px',
              fontSize: '1rem',
              fontWeight: 800,
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 4px 14px rgba(0, 113, 227, 0.35)'
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
            {isScanning
              ? '⚡ SCANNING... PLEASE WAIT'
              : draft.docBack
              ? `🔄 RESCAN BACK DOCUMENT (${detectedScanner ? detectedScanner.replace(/Scan Drv.*/i, '').trim() : 'HP SCANNER'})`
              : `⚡ SCAN BACK DOCUMENT (${detectedScanner ? detectedScanner.replace(/Scan Drv.*/i, '').trim() : 'HP SCANNER'})`}
          </button>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={isScanning}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                fontWeight: 750
              }}
            >
              <span>📁</span> Choose Scanned File from PC
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleGrabLatest}
              disabled={isScanning}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                fontWeight: 750,
                color: '#0284c7'
              }}
              title="Detect last scan saved to Windows Scans folder"
            >
              <span>📥</span> Grab Recent PC Scan
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={onSkipBack}
              disabled={isScanning}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                fontWeight: 750,
                color: '#64748b'
              }}
            >
              <span>⏭️</span> Skip Back Scan (Single-Sided)
            </button>

            {draft.docBack && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => updateDraft({ docBack: null })}
                disabled={isScanning}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 750,
                  color: '#dc2626'
                }}
              >
                <span>🗑️</span> Clear Back Scan
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
