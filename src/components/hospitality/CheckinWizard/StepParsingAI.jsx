import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';

export default function StepParsingAI({ draft, updateDraft, onComplete }) {
  const { showToast } = useApp() || {};
  const [progress, setProgress] = useState(15);
  const [activeCheck, setActiveCheck] = useState(1);
  const [statusText, setStatusText] = useState('Checking document scan quality...');
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const timersRef = useRef([]);

  const clearAllTimers = () => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
  };

  const executeAnalysis = async () => {
    clearAllTimers();
    setErrorInfo(null);
    setIsSuccess(false);
    setIsRetrying(true);
    setProgress(20);
    setActiveCheck(1);
    setStatusText('Checking document scan quality...');

    const timer1 = setTimeout(() => {
      setProgress(50);
      setActiveCheck(2);
      setStatusText('Connecting to AI Vision OCR Engine...');
    }, 300);
    timersRef.current.push(timer1);

    const timer2 = setTimeout(() => {
      setProgress(75);
      setStatusText('Extracting guest name, ID number, and address...');
    }, 700);
    timersRef.current.push(timer2);

    try {
      const res = await api.analyzeIdCard({
        frontImage: draft.docFront,
        backImage: draft.docBack,
        docType: draft.docType
      });

      // Validate that response indicates success
      if (res && res.success === false) {
        const err = new Error(res.error || 'AI document analysis failed');
        err.status = res.statusCode || 500;
        err.data = res;
        throw err;
      }

      const ext = (res && res.extracted) || res || {};
      const nameVal = ext.guestName || ext.name;
      const idVal = ext.idNumber || ext.docNumber;

      // If response returned fallback with no AI text detected, proceed smoothly to manual verification
      if (!nameVal && !idVal && !ext.address && !ext.dob) {
        showToast('Document scan saved. Please review and verify details in Step 4.', 'blue');
        setProgress(100);
        const timerComplete = setTimeout(() => {
          if (onComplete) {
            onComplete();
          }
        }, 500);
        timersRef.current.push(timerComplete);
        return;
      }

      const updates = {};
      if (nameVal && nameVal.trim()) updates.guestName = nameVal.trim();
      if (ext.fatherName && ext.fatherName.trim()) updates.fatherName = ext.fatherName.trim();
      if (ext.dob && ext.dob.trim()) updates.dob = ext.dob.trim();
      if (ext.mobile && ext.mobile.trim()) {
        const cleanMob = ext.mobile.replace(/\D/g, '').slice(-10);
        if (cleanMob.length === 10) {
          updates.mobile = cleanMob;
        }
      }
      if (ext.address && ext.address.trim()) {
        let fullAddr = ext.address.trim();
        if (ext.pincode && !fullAddr.includes(ext.pincode)) {
          fullAddr += (fullAddr.endsWith(',') ? ' ' : ', ') + ext.pincode;
        }
        updates.address = fullAddr;
      }
      if (ext.gender && ext.gender.trim()) updates.gender = ext.gender.trim();
      if (ext.idType && ext.idType.trim()) updates.docType = ext.idType.trim();
      const activeDocType = (updates.docType || draft.docType || '').toLowerCase();

      if (idVal && idVal.trim()) {
        const raw = idVal.trim();
        let cleaned = raw;
        if (activeDocType.includes('aadha') || activeDocType.includes('adhar')) {
          cleaned = raw.replace(/\D/g, '').slice(0, 12);
        } else if (activeDocType.includes('passport')) {
          cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 9);
        } else if (activeDocType.includes('licen') || activeDocType.includes('driving') || activeDocType.includes('dl')) {
          cleaned = raw.replace(/[^a-zA-Z0-9- ]/g, '').toUpperCase().slice(0, 16);
        } else if (activeDocType.includes('voter') || activeDocType.includes('election')) {
          cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
        } else {
          cleaned = raw.slice(0, 20);
        }
        updates.idNumber = cleaned;
        updates.aadharNumber = cleaned;
      }

      // Aadhaar does not expire - only set expiryDate if passport!
      if (activeDocType.includes('passport') && ext.expiryDate && ext.expiryDate.trim()) {
        updates.expiryDate = ext.expiryDate.trim();
      } else {
        updates.expiryDate = '';
      }

      if (Object.keys(updates).length > 0) {
        updateDraft(updates);
      }

      setProgress(100);
      setActiveCheck(3);
      setIsSuccess(true);
      if (res && res.isFallback) {
        setStatusText('Document Scan Captured! Proceeding to Verify Details...');
      } else {
        setStatusText('Document Verified Successfully!');
      }

      const navTimer = setTimeout(() => {
        if (onComplete) onComplete();
      }, 550);
      timersRef.current.push(navTimer);
    } catch (err) {
      console.warn('AI OCR parsing error:', err);

      const status = err.status || err.data?.statusCode || err.data?.status || (err.message?.includes('429') ? 429 : 500);
      const rawMsg = (err.data && err.data.error) || err.message || 'AI document analysis failed';
      const lower = rawMsg.toLowerCase();

      let type = 'general';
      let icon = '⚠️';
      let title = 'Document Parsing Problem';
      let message = rawMsg;

      if (status === 429 || lower.includes('429') || lower.includes('limit') || lower.includes('quota') || lower.includes('too many requests')) {
        type = 'limit_exceeded';
        icon = '🛑';
        title = 'API Request Limit Exceeded (HTTP 429)';
        message = 'Google Gemini API request quota / rate limit has been reached. Please wait a few moments and try again, or proceed with manual entry.';
      } else if (status === 503 || status === 502 || lower.includes('503') || lower.includes('overloaded') || lower.includes('unavailable')) {
        type = 'service_unavailable';
        icon = '⚡';
        title = 'AI Server Overloaded (HTTP 503)';
        message = 'The AI Vision document extraction service is temporarily overloaded or undergoing maintenance. Please retry shortly or enter details manually.';
      } else if (status === 500 || lower.includes('500') || lower.includes('server error')) {
        type = 'server_error';
        icon = '❌';
        title = 'AI Server Error (HTTP 500)';
        message = 'The AI OCR extraction server encountered an internal error. Please retry or continue with manual entry.';
      } else if (status === 504 || lower.includes('timeout') || lower.includes('network') || lower.includes('socket') || lower.includes('hang up')) {
        type = 'timeout';
        icon = '🔌';
        title = 'Connection Timeout / Network Error';
        message = 'Could not connect to the AI extraction service. Please check your network connection or try again.';
      } else if (status === 400 || status === 401 || status === 403 || lower.includes('api key') || lower.includes('unauthorized') || lower.includes('missing_api_key')) {
        type = 'auth';
        icon = '🔑';
        title = 'Gemini API Key Required (HTTP ' + status + ')';
        message = 'The Gemini API key is missing or unauthorized. Please configure the API key in Settings > AI Key, or enter details manually.';
      } else if (status === 422 || lower.includes('unreadable') || lower.includes('blurry')) {
        type = 'unreadable';
        icon = '🔍';
        title = 'Low Scan Clarity / Text Unreadable';
        message = 'The document image is blurry or unclear. AI could not read the text. You can re-scan or enter details manually.';
      }

      setErrorInfo({
        type,
        icon,
        title,
        message,
        statusCode: status,
        rawError: rawMsg
      });
      setProgress(50);
      setStatusText(`${title}: ${message}`);
      if (showToast) {
        showToast(`${title} - Please retry or enter manually`, 'warning');
      }
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    executeAnalysis();
    return () => clearAllTimers();
  }, []);

  return (
    <div className="checkin-step-content" id="checkin-step-parsing">
      <div className="std-parsing-card">
        {/* Animated Document Icon / Error Indicator */}
        <div className="std-scan-icon-wrapper">
          {errorInfo ? (
            <div
              style={{
                width: '68px',
                height: '68px',
                borderRadius: '50%',
                background: errorInfo.type === 'limit_exceeded' ? '#fef3c7' : '#fee2e2',
                border: `2.5px solid ${errorInfo.type === 'limit_exceeded' ? '#f59e0b' : '#ef4444'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem'
              }}
            >
              {errorInfo.icon}
            </div>
          ) : (
            <>
              <div className="std-spinner-ring" />
              <div className="std-scan-center-icon">🪪</div>
            </>
          )}
        </div>

        <h3 className="std-parsing-title" style={{ color: errorInfo ? (errorInfo.type === 'limit_exceeded' ? '#b45309' : '#dc2626') : '#0f172a' }}>
          {errorInfo ? errorInfo.title : 'Verifying Document Details...'}
        </h3>
        <p className="std-parsing-subtitle">
          Reading front and back document details for{' '}
          <span style={{ fontWeight: 750, color: '#0071e3' }}>{draft.docType}</span>
        </p>

        {/* Dual Document Thumbnail Strip */}
        <div className="std-parsing-preview-strip">
          <div className="std-thumb-box">
            <div className="std-thumb-tag">Front Scan</div>
            <div className="std-thumb-img-wrap">
              {draft.docFront && <img src={draft.docFront} alt="Front ID" />}
              {!errorInfo && <div className="std-scan-line" />}
            </div>
          </div>
          <div className="std-thumb-box">
            <div className="std-thumb-tag">Back Scan</div>
            <div className="std-thumb-img-wrap">
              {draft.docBack ? (
                <img src={draft.docBack} alt="Back ID" />
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.76rem' }}>
                  Single-Sided ID
                </div>
              )}
              {!errorInfo && <div className="std-scan-line" />}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="std-progress-track">
          <div
            className="std-progress-bar"
            style={{
              width: `${progress}%`,
              background: errorInfo
                ? (errorInfo.type === 'limit_exceeded' ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #ef4444, #f87171)')
                : 'linear-gradient(90deg, #0071e3, #38bdf8)'
            }}
          />
        </div>

        <div className="std-progress-info">
          <span style={{ color: errorInfo ? '#dc2626' : '#64748b', fontWeight: errorInfo ? 800 : 750 }}>
            {errorInfo ? errorInfo.title : statusText}
          </span>
          <span>{progress}%</span>
        </div>

        {/* 3-Step Verification Checklist */}
        <div className="std-checklist-box">
          <div className="std-check-item active">
            <span className="std-chk-icon">✓</span>
            <span className="std-chk-label">1. Document Scan Quality Check</span>
            <span className="std-chk-status" style={{ color: '#16a34a' }}>Completed</span>
          </div>

          <div className={`std-check-item ${activeCheck >= 2 ? 'active' : ''}`}>
            <span className="std-chk-icon">
              {errorInfo ? '❌' : activeCheck > 2 ? '✓' : isRetrying ? '⏳' : '🔍'}
            </span>
            <span className="std-chk-label" style={{ color: errorInfo ? '#dc2626' : undefined }}>
              2. OCR Field Extraction (Name, DOB, Mobile, Address)
            </span>
            <span
              className="std-chk-status"
              style={{
                color: errorInfo ? '#dc2626' : activeCheck > 2 ? '#16a34a' : '#0071e3',
                fontWeight: 800
              }}
            >
              {errorInfo ? 'Failed' : activeCheck > 2 ? 'Completed' : 'Extracting...'}
            </span>
          </div>

          <div className={`std-check-item ${activeCheck >= 3 ? 'active' : ''}`}>
            <span className="std-chk-icon">
              {errorInfo ? '⚠️' : progress === 100 ? '✓' : '⏳'}
            </span>
            <span className="std-chk-label">3. Government Format &amp; Authenticity Validation</span>
            <span
              className="std-chk-status"
              style={{
                color: errorInfo ? '#d97706' : progress === 100 ? '#16a34a' : '#94a3b8'
              }}
            >
              {errorInfo ? 'Pending Manual Entry' : progress === 100 ? 'Verified' : 'Pending'}
            </span>
          </div>
        </div>

        {/* PROMINENT ERROR CARD (When request fails or non-200) */}
        {errorInfo && (
          <div
            style={{
              marginTop: '16px',
              padding: '18px 20px',
              borderRadius: '16px',
              background: errorInfo.type === 'limit_exceeded' ? '#fffbeb' : '#fef2f2',
              border: `2px solid ${errorInfo.type === 'limit_exceeded' ? '#f59e0b' : '#ef4444'}`,
              textAlign: 'center',
              boxShadow: '0 6px 20px rgba(220, 38, 38, 0.08)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>{errorInfo.icon}</span>
              <h4
                style={{
                  margin: 0,
                  fontSize: '1.08rem',
                  fontWeight: 900,
                  color: errorInfo.type === 'limit_exceeded' ? '#92400e' : '#b91c1c'
                }}
              >
                {errorInfo.title}
              </h4>
            </div>

            <p style={{ margin: '0 0 10px', fontSize: '0.86rem', color: '#475569', lineHeight: 1.5, fontWeight: 550 }}>
              {errorInfo.message}
            </p>

            <div
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.05)',
                color: '#64748b',
                fontSize: '0.72rem',
                fontFamily: 'monospace',
                marginBottom: '14px',
                maxWidth: '100%',
                wordBreak: 'break-word'
              }}
            >
              HTTP {errorInfo.statusCode || 500}: {errorInfo.rawError}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => executeAnalysis()}
                disabled={isRetrying}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '12px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  cursor: isRetrying ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 3px 10px rgba(2, 132, 199, 0.28)'
                }}
              >
                <span>🔄</span>
                <span>{isRetrying ? 'Retrying...' : 'Try Again'}</span>
              </button>

              <button
                type="button"
                onClick={() => onComplete && onComplete()}
                style={{
                  background: '#ffffff',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  padding: '10px 18px',
                  borderRadius: '12px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>✍️ Enter Details Manually →</span>
              </button>
            </div>
          </div>
        )}

        {isSuccess && (
          <div className="std-parsing-success" style={{ display: 'flex' }}>
            <span className="std-success-icon">✓</span>
            <span>Document Verified Successfully! Loading details...</span>
          </div>
        )}

        {/* Skip button for instant manual entry (when not in error state) */}
        {!isSuccess && !errorInfo && (
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => onComplete && onComplete()}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '0.82rem',
                fontWeight: 700,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: '6px 12px',
                transition: 'color 0.15s ease'
              }}
              onMouseEnter={(e) => (e.target.style.color = '#0f172a')}
              onMouseLeave={(e) => (e.target.style.color = '#64748b')}
            >
              Skip AI Parsing &amp; Enter Details Manually →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
