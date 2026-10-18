import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

export default function SectionSelectModal({
  isOpen,
  canCancel = false,
  onClose,
  initialSection = null,
  onUnlocked
}) {
  const { theme } = useApp();
  const [selectedSection, setSelectedSection] = useState(initialSection || 'hospitality');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setErrorMsg('');
      setShowPassword(false);
      if (initialSection) {
        setSelectedSection(initialSection);
      }
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(t);
    }
  }, [isOpen, initialSection]);

  // Handle Enter to submit, Escape to cancel if allowed
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && canCancel && onClose) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleUnlock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedSection, password, canCancel, onClose]);

  if (!isOpen) return null;

  const handleUnlock = async () => {
    if (!selectedSection) {
      setErrorMsg('Please select a section.');
      return;
    }
    if (!password.trim()) {
      setErrorMsg(`Please enter the password for ${getSectionTitle(selectedSection)}.`);
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await api.verifySectionPassword(selectedSection, password.trim());
      if (res && res.success) {
        if (onUnlocked) {
          onUnlocked(selectedSection);
        }
      } else {
        setErrorMsg(res?.error || 'Incorrect section password. Please try again.');
        inputRef.current?.focus();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Verification failed. Please check connection and try again.');
      inputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const getSectionTitle = (sec) => {
    switch (sec) {
      case 'hospitality':
        return 'Hospitality (Front Desk)';
      case 'restaurant':
        return 'Restaurant POS';
      case 'bar':
        return 'Bar Lounge POS';
      default:
        return 'Section';
    }
  };

  const sections = [
    {
      id: 'hospitality',
      icon: '🏨',
      name: 'Hospitality',
      subtitle: 'Front Desk & Rooms',
      desc: 'Guest Check-Ins, Live Rooms, Advance Folios & Reception Billing',
      accent: '#2563eb',
      lightBg: 'rgba(37, 99, 235, 0.08)'
    },
    {
      id: 'restaurant',
      icon: '🍽️',
      name: 'Restaurant POS',
      subtitle: 'Dining & Kitchen',
      desc: 'Live Tables, Food Menus, KOT Prints, Takeaways & Food Billing',
      accent: '#ea580c',
      lightBg: 'rgba(234, 88, 12, 0.08)'
    },
    {
      id: 'bar',
      icon: '🍸',
      name: 'Bar Lounge POS',
      subtitle: 'Bar & Liquors',
      desc: 'Bar Counter, Table Orders, Beverages, Liquor Stock & Billing',
      accent: '#7c3aed',
      lightBg: 'rgba(124, 58, 237, 0.08)'
    }
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        background: 'rgba(10, 15, 29, 0.82)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeInModal 0.2s ease-out'
      }}
    >
      <div
        className="folio-card"
        style={{
          width: '100%',
          maxWidth: '680px',
          background: 'var(--bg-surface, #ffffff)',
          color: 'var(--text-primary, #0f172a)',
          borderRadius: '24px',
          padding: '32px 36px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border-color, rgba(255, 255, 255, 0.1))',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Subtle Decorative Gradient Bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '6px',
            background: 'linear-gradient(90deg, #2563eb 0%, #ea580c 50%, #7c3aed 100%)'
          }}
        />

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px', marginTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <img
              src="/HCP_New_Logo_Png_witought-name-removebg.png"
              alt="Hotel City Park"
              style={{ width: '42px', height: '42px', objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <h1 style={{ fontSize: '1.45rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
              Hotel City Park CRM
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
            Select Operational Department &amp; Enter Section Password
          </p>
        </div>

        {/* Section Cards Selection */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '24px'
          }}
        >
          {sections.map((sec) => {
            const isSelected = selectedSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                id={`btn-select-section-${sec.id}`}
                onClick={() => {
                  setSelectedSection(sec.id);
                  setErrorMsg('');
                  inputRef.current?.focus();
                }}
                style={{
                  background: isSelected ? sec.lightBg : 'var(--bg-surface-secondary, #f8fafc)',
                  border: isSelected ? `2.5px solid ${sec.accent}` : '1.5px solid var(--border-color, #e2e8f0)',
                  borderRadius: '16px',
                  padding: '16px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: isSelected ? `0 8px 24px -4px ${sec.accent}33` : '0 2px 6px rgba(0,0,0,0.03)',
                  transition: 'all 0.18s ease'
                }}
              >
                <span style={{ fontSize: '2.2rem', marginBottom: '8px', lineHeight: 1 }}>{sec.icon}</span>
                <span style={{ fontSize: '0.96rem', fontWeight: 850, color: isSelected ? sec.accent : 'var(--text-primary, #0f172a)' }}>
                  {sec.name}
                </span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary, #64748b)', marginTop: '4px', fontWeight: 600, lineHeight: 1.3 }}>
                  {sec.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Password Prompt for Selected Section */}
        <div
          style={{
            background: 'var(--bg-surface-secondary, #f8fafc)',
            border: '1.5px solid var(--border-color, #e2e8f0)',
            borderRadius: '16px',
            padding: '20px 22px',
            marginBottom: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <label
              htmlFor="section-password-input"
              style={{
                fontSize: '0.86rem',
                fontWeight: 800,
                color: 'var(--text-primary, #0f172a)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                margin: 0
              }}
            >
              <span>🔑</span> Enter {getSectionTitle(selectedSection)} Password:
            </label>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #64748b)', fontWeight: 600 }}>
              (Default: 1234)
            </span>
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              id="section-password-input"
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter section password..."
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              style={{
                width: '100%',
                height: '48px',
                fontSize: '1.05rem',
                fontWeight: 750,
                padding: '0 48px 0 16px',
                borderRadius: '12px',
                border: errorMsg ? '2px solid #ef4444' : '1.5px solid var(--border-color, #cbd5e1)',
                background: 'var(--bg-surface, #ffffff)',
                color: 'var(--text-primary, #0f172a)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <button
              type="button"
              id="btn-toggle-section-pwd-visibility"
              onClick={() => setShowPassword(!showPassword)}
              title={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: '12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.15rem',
                color: 'var(--text-secondary, #64748b)',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {showPassword ? '👁️' : '🔒'}
            </button>
          </div>

          {errorMsg && (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>⚠️</span> {errorMsg}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {canCancel && onClose && (
            <button
              type="button"
              id="btn-cancel-section-switch"
              onClick={onClose}
              disabled={isLoading}
              style={{
                height: '46px',
                padding: '0 20px',
                borderRadius: '12px',
                background: 'var(--bg-surface-secondary, #e2e8f0)',
                color: 'var(--text-primary, #334155)',
                border: 'none',
                fontSize: '0.90rem',
                fontWeight: 750,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            id="btn-confirm-section-unlock"
            onClick={handleUnlock}
            disabled={isLoading}
            style={{
              flex: canCancel ? '0 0 auto' : '1',
              height: '46px',
              padding: '0 28px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.96rem',
              fontWeight: 850,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
              transition: 'all 0.15s ease'
            }}
          >
            <span>{isLoading ? '⏳' : '🔓'}</span>
            <span>{isLoading ? 'Verifying...' : `Unlock & Enter ${getSectionTitle(selectedSection)}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
