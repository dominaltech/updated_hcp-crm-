import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

export default function ManagerLockModal({ isOpen, onClose, targetDepartment = 'hospitality' }) {
  const { unlockManager } = useApp();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [managerList, setManagerList] = useState([]);
  const [selectedUsername, setSelectedUsername] = useState('admin');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  // Load only staff with manager panel authority for the target department
  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setErrorMsg('');
    setShowPassword(false);

    let isMounted = true;
    const dept = targetDepartment || 'hospitality';

    api.getPublicStaffList({ department: 'manager', manager_for: dept })
      .then((res) => {
        if (!isMounted) return;
        // Strictly filter staff:
        // 1. Hotel General Manager (Jaijeet sir / admin, role === 'manager')
        // 2. Staff belonging specifically to this department who have manager authority (can_access_manager === 1)
        // Never show restaurant/bar managers in hospitality, and vice-versa
        const list = (res?.staff || []).filter((u) => {
          if (u.status && u.status !== 'active') return false;
          if (u.role === 'manager') return true;
          const hasManagerAccess = u.can_access_manager == 1 || u.can_access_manager === true;
          return u.role === dept && hasManagerAccess;
        });

        setManagerList(list);
        if (list.length > 0) {
          const defaultUser = list.find((u) => u.username === 'admin') || list[0];
          setSelectedUsername(defaultUser.username);
        }
      })
      .catch(() => {});

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, targetDepartment]);

  // Handle Escape key to close and Enter key to submit
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        if (document.activeElement?.id === 'btn-cancel-manager-unlock') return;
        e.preventDefault();
        e.stopPropagation();
        handleSubmit(e);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, password, selectedUsername, targetDepartment, isSubmitting]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Please enter password');
      inputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await api.verifyManagerLock({
        password: password.trim(),
        username: selectedUsername || undefined,
        target_department: targetDepartment || 'hospitality'
      });

      if (res && res.success) {
        unlockManager(res.user, res.token);
      } else {
        setErrorMsg(res?.error || 'Incorrect password');
        inputRef.current?.focus();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Incorrect password');
      inputRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop-fixed"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-container"
        style={{
          background: 'var(--bg-surface, #ffffff)',
          borderRadius: '18px',
          border: '1px solid var(--border-color, #e2e8f0)',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.28)',
          width: '100%',
          maxWidth: '380px',
          padding: '22px 24px',
          boxSizing: 'border-box'
        }}
      >
        {/* Simple Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '18px'
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 800,
              color: 'var(--text-primary, #0f172a)'
            }}
          >
            Manager Panel
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'var(--bg-surface-secondary, #f1f5f9)',
              border: 'none',
              color: 'var(--text-secondary, #64748b)',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              fontSize: '1.2rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1
            }}
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {errorMsg && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                fontSize: '0.82rem',
                fontWeight: 600,
                border: '1px solid rgba(239, 68, 68, 0.25)'
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Name Dropdown */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: 'var(--text-secondary, #475569)',
                marginBottom: '6px'
              }}
            >
              Name
            </label>
            <select
              id="manager-lock-select-name"
              value={selectedUsername}
              onChange={(e) => {
                setSelectedUsername(e.target.value);
                setPassword('');
                setErrorMsg('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                borderRadius: '10px',
                border: '1.5px solid var(--border-color, #e2e8f0)',
                background: 'var(--bg-app, #f8fafc)',
                fontSize: '0.92rem',
                fontWeight: 600,
                color: 'var(--text-primary, #0f172a)',
                outline: 'none',
                boxSizing: 'border-box',
                cursor: 'pointer'
              }}
            >
              {managerList.map((m) => (
                <option key={m.id} value={m.username}>
                  {m.full_name && m.full_name !== m.username ? `${m.full_name} (${m.username})` : (m.full_name || m.username)}
                </option>
              ))}
            </select>
          </div>

          {/* Password Input */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 700,
                color: 'var(--text-secondary, #475569)',
                marginBottom: '6px'
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                ref={inputRef}
                id="manager-lock-input-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit(e);
                  }
                }}
                placeholder="Enter password"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 38px 0 12px',
                  borderRadius: '10px',
                  border: errorMsg ? '1.5px solid #ef4444' : '1.5px solid var(--border-color, #e2e8f0)',
                  background: 'var(--bg-app, #f8fafc)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  color: 'var(--text-primary, #0f172a)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  color: 'var(--text-secondary, #64748b)',
                  padding: '4px',
                  lineHeight: 1
                }}
                tabIndex={-1}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              id="btn-cancel-manager-unlock"
              style={{
                flex: 1,
                height: '42px',
                borderRadius: '10px',
                border: '1px solid var(--border-color, #e2e8f0)',
                background: 'var(--bg-surface-secondary, #f1f5f9)',
                color: 'var(--text-primary, #475569)',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="btn-submit-manager-unlock"
              style={{
                flex: 1.2,
                height: '42px',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--apple-blue, #0071e3)',
                color: '#ffffff',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: isSubmitting ? 'not-allowed' : 'pointer'
              }}
            >
              {isSubmitting ? 'Verifying...' : 'Open'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
