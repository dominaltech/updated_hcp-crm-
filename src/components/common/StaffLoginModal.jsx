import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

export default function StaffLoginModal({ isOpen, onClose, initialDepartment = null, isMandatory = false }) {
  const {
    currentUser,
    setCurrentUser,
    showToast,
    activePanel,
    loginTargetDepartment,
    loginDepartmentStaff,
    isLoginMandatory
  } = useApp();

  const mandatory = isMandatory || isLoginMandatory;

  const [staffList, setStaffList] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const passwordInputRef = useRef(null);

  // Strictly target the respected section: hospitality, restaurant, bar, or manager
  const targetRole = initialDepartment || loginTargetDepartment || (
    activePanel === 'restaurant' ? 'restaurant' :
    activePanel === 'bar' ? 'bar' :
    activePanel === 'manage' ? 'manager' : 'hospitality'
  );

  // Intercept and prevent Escape key when in mandatory locked mode
  useEffect(() => {
    if (!mandatory || !isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [mandatory, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setPassword('');
      setSelectedStaff(null);

      api.getPublicStaffList({ department: targetRole })
        .then((data) => {
          const list = Array.isArray(data) ? data : (data?.staff || []);
          setStaffList(list);

          // Strictly filter only staff belonging to this respected section
          const matching = list.filter((s) => (!s.status || s.status === 'active') && (
            targetRole === 'manager'
              ? (s.role === 'manager' || s.can_access_manager == 1 || s.can_access_manager === true)
              : (s.role === targetRole)
          ));

          if (matching.length === 1) {
            setSelectedStaff(matching[0]);
            setTimeout(() => {
              if (passwordInputRef.current) passwordInputRef.current.focus();
            }, 100);
          }
        })
        .catch((err) => {
          console.error('Error fetching staff list:', err);
          setErrorMsg('Could not load staff list from server');
        });
    }
  }, [isOpen, targetRole]);

  if (!isOpen) return null;

  // Filter ONLY staff belonging to this respected section
  const sectionStaff = staffList.filter((s) => (!s.status || s.status === 'active') && (
    targetRole === 'manager'
      ? (s.role === 'manager' || s.can_access_manager == 1 || s.can_access_manager === true)
      : (s.role === targetRole)
  ));

  const handleSelectStaff = (staff) => {
    setSelectedStaff(staff);
    setPassword('');
    setErrorMsg('');
    setTimeout(() => {
      if (passwordInputRef.current) {
        passwordInputRef.current.focus();
      }
    }, 50);
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedStaff) {
      setErrorMsg('Please select your staff card first');
      return;
    }
    if (!password) {
      setErrorMsg('Please enter your password');
      if (passwordInputRef.current) passwordInputRef.current.focus();
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await api.loginStaff({ username: selectedStaff.username, password });
      if (res && res.user) {
        const roleForShift = targetRole;

        if (loginDepartmentStaff) {
          loginDepartmentStaff(roleForShift, res.user, res.token);
        } else {
          if (res.token) api.setAuthToken(res.token);
          setCurrentUser(res.user);
        }
        showToast(`Welcome, ${res.user.full_name || res.user.username}! Shift unlocked.`, 'green', 4000);
        if (onClose) onClose(true);
      } else {
        setErrorMsg('Invalid login response from server');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Invalid password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Section-specific branding
  const getSectionBranding = () => {
    if (targetRole === 'restaurant') {
      return {
        name: 'Restaurant POS',
        title: '🍽️ Restaurant POS Shift',
        icon: '🍽️',
        gradient: 'linear-gradient(135deg, #b45309 0%, #ea580c 100%)',
        accentColor: '#d97706',
        cardBorderActive: '#f59e0b',
        cardBgActive: 'rgba(217, 119, 6, 0.14)'
      };
    }
    if (targetRole === 'bar') {
      return {
        name: 'Bar Lounge',
        title: '🍸 Bar Lounge POS Shift',
        icon: '🍸',
        gradient: 'linear-gradient(135deg, #6b21a8 0%, #9333ea 100%)',
        accentColor: '#7c3aed',
        cardBorderActive: '#a855f7',
        cardBgActive: 'rgba(147, 51, 234, 0.14)'
      };
    }
    if (targetRole === 'manager') {
      return {
        name: 'Management',
        title: '⚙️ Manager Authorization',
        icon: '⚙️',
        gradient: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)',
        accentColor: '#475569',
        cardBorderActive: '#94a3b8',
        cardBgActive: 'rgba(148, 163, 184, 0.16)'
      };
    }
    return {
      name: 'Front Desk',
      title: '🏨 Front Desk Shift',
      icon: '🏨',
      gradient: 'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)',
      accentColor: '#0284c7',
      cardBorderActive: '#38bdf8',
      cardBgActive: 'rgba(2, 132, 199, 0.14)'
    };
  };

  const sectionBranding = getSectionBranding();

  const selectedInitials = selectedStaff
    ? (selectedStaff.full_name || selectedStaff.username)
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '👤';

  return (
    <div
      className="modal-overlay active"
      id="modal-staff-login"
      onClick={(e) => {
        if (mandatory) {
          e.stopPropagation();
          return; // Block closing anywhere when login is mandatory
        }
        if (e.target.id === 'modal-staff-login') onClose();
      }}
      style={{
        zIndex: mandatory ? 100000 : 10100,
        position: 'fixed',
        inset: 0,
        backgroundColor: mandatory ? 'rgba(15, 23, 42, 0.94)' : 'rgba(0, 0, 0, 0.65)',
        backdropFilter: mandatory ? 'blur(16px)' : 'blur(4px)',
        WebkitBackdropFilter: mandatory ? 'blur(16px)' : 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        userSelect: 'none'
      }}
    >
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '80%',
          maxWidth: '1150px',
          minHeight: '620px',
          maxHeight: '90vh',
          borderRadius: '28px',
          overflow: 'hidden',
          boxShadow: mandatory ? '0 35px 100px rgba(0,0,0,0.75)' : '0 25px 65px rgba(0,0,0,0.35)',
          border: mandatory ? '3px solid #3b82f6' : '1.5px solid var(--border-color, #e2e8f0)',
          background: 'var(--bg-surface, #ffffff)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div
          style={{
            background: sectionBranding.gradient,
            color: '#ffffff',
            padding: '24px 32px 20px',
            textAlign: 'center',
            position: 'relative',
            flexShrink: 0
          }}
        >
          {/* Mandatory Lock Alert Banner */}
          {mandatory && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(239, 68, 68, 0.28)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                padding: '6px 16px',
                borderRadius: '20px',
                fontSize: '0.84rem',
                fontWeight: 900,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: '10px',
                color: '#ffffff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
            >
              🔒 System Locked • Mandatory Staff Login
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                background: 'rgba(255,255,255,0.22)',
                borderRadius: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '2rem',
                backdropFilter: 'blur(8px)',
                flexShrink: 0
              }}
            >
              {sectionBranding.icon}
            </div>
            <div style={{ textAlign: 'left' }}>
              <h2 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 950, letterSpacing: '-0.02em', color: '#ffffff' }}>
                {sectionBranding.title}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.94rem', opacity: 0.92, fontWeight: 500 }}>
                {mandatory
                  ? 'Select your staff account and enter password to unlock and access system'
                  : 'Select your name and enter password to start shift'}
              </p>
            </div>
          </div>

          {/* Close button only rendered when login is NOT mandatory */}
          {!mandatory && (
            <button
              type="button"
              onClick={onClose}
              id="btn-close-login-modal"
              style={{
                position: 'absolute',
                right: '20px',
                top: '20px',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#ffffff',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '1.3rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              title="Close"
            >
              &times;
            </button>
          )}
        </div>

        {/* Expansive 2-Column Body for 80% Width */}
        <div
          style={{
            padding: '30px 36px',
            background: 'var(--bg-surface, #ffffff)',
            display: 'flex',
            gap: '32px',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto'
          }}
        >
          {/* Left Column: Staff Cards Grid (Takes 62% width) */}
          <div style={{ flex: 1.25, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0 }}>
              <label
                style={{
                  fontSize: '0.88rem',
                  fontWeight: 900,
                  color: 'var(--text-primary, #1e293b)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}
              >
                1. Select Your Staff Name:
              </label>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary, #64748b)', background: 'var(--bg-surface-secondary, #f1f5f9)', padding: '4px 12px', borderRadius: '12px' }}>
                {sectionStaff.length} active account{sectionStaff.length !== 1 ? 's' : ''}
              </span>
            </div>

            {sectionStaff.length === 0 ? (
              <div
                style={{
                  padding: '40px 24px',
                  textAlign: 'center',
                  background: 'var(--bg-surface-secondary, #f8fafc)',
                  borderRadius: '18px',
                  border: '2px dashed var(--border-color, #cbd5e1)',
                  color: 'var(--text-secondary, #64748b)',
                  fontSize: '0.96rem',
                  margin: 'auto 0'
                }}
              >
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '10px' }}>👤</span>
                <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary, #0f172a)' }}>No staff accounts found for {sectionBranding.name}.</strong>
                <div style={{ fontSize: '0.88rem', marginTop: '8px', color: 'var(--text-secondary, #94a3b8)' }}>
                  Please add staff members in the {sectionBranding.name} Manager Panel.
                </div>
              </div>
            ) : (
              <div
                id="login-quick-staff-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '14px',
                  flex: 1,
                  maxHeight: '450px',
                  overflowY: 'auto',
                  paddingRight: '6px',
                  alignContent: 'start'
                }}
              >
                {sectionStaff.map((s) => {
                  const isSelected = selectedStaff?.username === s.username;
                  const isCurrent = currentUser?.username === s.username;
                  const initials = (s.full_name || s.username)
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                  return (
                    <div
                      key={s.id || s.username}
                      className={`quick-staff-card ${isSelected || isCurrent ? 'selected' : ''}`}
                      onClick={() => handleSelectStaff(s)}
                      style={{
                        cursor: 'pointer',
                        padding: '16px 16px',
                        borderRadius: '16px',
                        border: isSelected
                          ? `2.5px solid ${sectionBranding.cardBorderActive}`
                          : '1.5px solid var(--border-color, #e2e8f0)',
                        background: isSelected ? sectionBranding.cardBgActive : 'var(--bg-surface, #ffffff)',
                        boxShadow: isSelected
                          ? '0 6px 20px rgba(0,0,0,0.1)'
                          : '0 2px 6px rgba(0,0,0,0.03)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        transition: 'all 0.18s ease'
                      }}
                    >
                      <div
                        style={{
                          width: '50px',
                          height: '50px',
                          borderRadius: '14px',
                          background: isSelected ? sectionBranding.accentColor : 'var(--bg-surface-secondary, #f1f5f9)',
                          color: isSelected ? '#ffffff' : 'var(--text-primary, #334155)',
                          fontWeight: 950,
                          fontSize: '1.15rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                          transition: 'all 0.18s ease'
                        }}
                      >
                        {initials}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 900,
                            fontSize: '1.02rem',
                            color: 'var(--text-primary, #0f172a)',
                            lineHeight: 1.3,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {s.full_name}
                        </div>
                        <div
                          style={{
                            fontSize: '0.80rem',
                            color: isSelected ? sectionBranding.accentColor : 'var(--text-secondary, #64748b)',
                            fontWeight: 850,
                            marginTop: '3px'
                          }}
                        >
                          {isSelected ? '✓ Selected' : `ID: ${s.username}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Active Card & Login Form (Takes 38% width) */}
          <div
            style={{
              flex: 0.95,
              minWidth: '320px',
              borderLeft: '1.5px solid var(--border-color, #e2e8f0)',
              paddingLeft: '32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            <label
              style={{
                fontSize: '0.88rem',
                fontWeight: 900,
                color: 'var(--text-primary, #1e293b)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: '14px',
                display: 'block'
              }}
            >
              2. Enter Password to Unlock:
            </label>

            {/* Selected Staff Showcase Card */}
            {selectedStaff ? (
              <div
                style={{
                  padding: '16px 20px',
                  background: sectionBranding.cardBgActive,
                  border: `2px solid ${sectionBranding.cardBorderActive}`,
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginBottom: '20px',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.05)'
                }}
              >
                <div
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '16px',
                    background: sectionBranding.accentColor,
                    color: '#ffffff',
                    fontWeight: 950,
                    fontSize: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {selectedInitials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.80rem', color: 'var(--text-secondary, #64748b)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Active Selection
                  </div>
                  <div style={{ fontSize: '1.18rem', fontWeight: 950, color: 'var(--text-primary, #0f172a)', lineHeight: 1.25 }}>
                    {selectedStaff.full_name}
                  </div>
                  <code style={{ fontSize: '0.82rem', fontWeight: 850, color: sectionBranding.accentColor }}>
                    ID: {selectedStaff.username}
                  </code>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '24px 20px',
                  background: 'var(--bg-surface-secondary, #f8fafc)',
                  border: '1.5px dashed var(--border-color, #cbd5e1)',
                  borderRadius: '16px',
                  textAlign: 'center',
                  marginBottom: '20px',
                  color: 'var(--text-secondary, #64748b)'
                }}
              >
                <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: '6px' }}>👈</span>
                <strong style={{ fontSize: '0.94rem', color: 'var(--text-primary, #334155)' }}>Select your card on the left</strong>
                <div style={{ fontSize: '0.80rem', marginTop: '4px', color: 'var(--text-secondary, #94a3b8)' }}>
                  Click your name to enter your password
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.86rem', fontWeight: 850, color: 'var(--text-secondary, #334155)', marginBottom: '6px', display: 'block' }}>
                  Password *
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={passwordInputRef}
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    placeholder={selectedStaff ? `Password for ${selectedStaff.full_name.split(' ')[0]}` : 'Select card first'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                    style={{
                      height: '52px',
                      paddingRight: '48px',
                      borderRadius: '14px',
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      border: '2px solid var(--border-color, #cbd5e1)',
                      background: 'var(--bg-app, #ffffff)',
                      color: 'var(--text-primary, #0f172a)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-secondary, #64748b)',
                      fontSize: '1.3rem'
                    }}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '12px',
                    color: '#ef4444',
                    fontSize: '0.88rem',
                    fontWeight: 800
                  }}
                >
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !selectedStaff}
                className="btn-primary"
                style={{
                  height: '54px',
                  fontSize: '1.1rem',
                  fontWeight: 950,
                  borderRadius: '16px',
                  background: selectedStaff ? sectionBranding.gradient : 'var(--bg-surface-secondary, #94a3b8)',
                  marginTop: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  cursor: (isLoading || !selectedStaff) ? 'not-allowed' : 'pointer',
                  border: 'none',
                  color: '#ffffff',
                  boxShadow: selectedStaff ? '0 8px 24px rgba(0,0,0,0.22)' : 'none',
                  transition: 'all 0.2s ease',
                  letterSpacing: '0.01em'
                }}
              >
                {isLoading
                  ? 'Verifying & Unlocking...'
                  : selectedStaff
                  ? `Log In & Unlock as ${selectedStaff.full_name.split(' ')[0]}`
                  : 'Select Card First'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
