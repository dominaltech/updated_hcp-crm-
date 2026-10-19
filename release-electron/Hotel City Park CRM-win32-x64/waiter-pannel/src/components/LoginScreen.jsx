import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Eagerly sync latest active tunnel from cloud in background
    if (typeof api.fetchCloudTunnelUrl === 'function') {
      api.fetchCloudTunnelUrl(true).catch(() => {});
    }
  }, []);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both ID and password');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await api.login(username.trim(), password.trim());
      if (res && res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setErrorMsg(res?.error || 'Invalid ID or password. Please try again.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Login failed. Please check connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100vw',
        background: 'var(--bg-app, #0f172a)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          background: 'var(--bg-surface, #1e293b)',
          border: '1px solid var(--border-medium, rgba(255, 255, 255, 0.1))',
          borderRadius: 'var(--radius-lg, 18px)',
          padding: '32px 24px',
          boxShadow: 'var(--shadow-card, 0 10px 30px rgba(0, 0, 0, 0.35))',
          boxSizing: 'border-box'
        }}
      >
        {/* Minimal Clean Header */}
        <div style={{ textAlign: 'center', marginBottom: '26px' }}>
          <h1
            style={{
              fontSize: '1.45rem',
              fontWeight: 900,
              color: 'var(--text-primary, #f8fafc)',
              letterSpacing: '-0.02em',
              margin: '0 0 6px'
            }}
          >
            Hotel City Park
          </h1>
          <p
            style={{
              fontSize: '0.84rem',
              color: 'var(--text-secondary, #94a3b8)',
              margin: 0,
              fontWeight: 600
            }}
          >
            Sign in to continue
          </p>
        </div>

        {/* Clean Login Form: Only ID, Password, and Sign In */}
        <form onSubmit={handleSubmit}>
          {/* Waiter ID / Username */}
          <div style={{ marginBottom: '18px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.76rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-secondary, #94a3b8)',
                marginBottom: '8px'
              }}
            >
              Waiter ID / Username
            </label>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter Waiter ID"
              disabled={isLoading}
              style={{
                width: '100%',
                height: '46px',
                padding: '0 14px',
                background: 'var(--bg-surface-secondary, rgba(255, 255, 255, 0.05))',
                border: '1.5px solid var(--border-medium, rgba(255, 255, 255, 0.12))',
                borderRadius: 'var(--radius-sm, 10px)',
                color: 'var(--text-primary, #f8fafc)',
                fontSize: '0.96rem',
                fontWeight: 650,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}
            >
              <label
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary, #94a3b8)',
                  margin: 0
                }}
              >
                Password / PIN
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--apple-blue, #38bdf8)',
                  fontSize: '0.74rem',
                  fontWeight: 750,
                  cursor: 'pointer'
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={isLoading}
              style={{
                width: '100%',
                height: '46px',
                padding: '0 14px',
                background: 'var(--bg-surface-secondary, rgba(255, 255, 255, 0.05))',
                border: '1.5px solid var(--border-medium, rgba(255, 255, 255, 0.12))',
                borderRadius: 'var(--radius-sm, 10px)',
                color: 'var(--text-primary, #f8fafc)',
                fontSize: '0.96rem',
                fontWeight: 650,
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-xs, 8px)',
                background: 'var(--apple-red-subtle, rgba(239, 68, 68, 0.15))',
                border: '1px solid var(--apple-red, #ef4444)',
                color: 'var(--apple-red, #f87171)',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: 'var(--radius-sm, 10px)',
              background: 'var(--apple-orange, #f59e0b)',
              color: 'var(--text-on-accent, #ffffff)',
              fontSize: '1rem',
              fontWeight: 850,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.75 : 1,
              boxShadow: 'var(--shadow-subtle, 0 2px 10px rgba(245, 158, 11, 0.3))',
              transition: 'all 0.2s ease'
            }}
          >
            {isLoading ? <span>Signing in...</span> : <span>Sign In</span>}
          </button>
        </form>
      </div>
    </div>
  );
}
