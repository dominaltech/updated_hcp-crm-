import React, { useState } from 'react';
import { api, getBaseUrl, CLOUD_TUNNEL_URL, LOCAL_WIFI_IP } from '../api/client';

export default function LoginScreen({ onLoginSuccess, theme, onToggleTheme }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverHost, setServerHost] = useState(() => localStorage.getItem('hcp_waiter_server_host') || '');

  const isDark = theme === 'dark';

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both username and password');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await api.login(username.trim(), password.trim());
      if (res && res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setErrorMsg(res?.error || 'Invalid credentials. Please try again.');
      }
    } catch (err) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const currentBase = getBaseUrl();
      if (isHttps && currentBase.startsWith('http://')) {
        setErrorMsg('Mixed Content: This HTTPS page cannot connect to HTTP server. Use Cloud HTTPS URL below.');
      } else {
        setErrorMsg(err.message || 'Login failed. Check server connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (u, p) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg('');
  };

  const handleApplyPreset = (host) => {
    setServerHost(host);
    if (host.trim()) {
      localStorage.setItem('hcp_waiter_server_host', host.trim());
    } else {
      localStorage.removeItem('hcp_waiter_server_host');
    }
    setErrorMsg('');
  };

  const handleSaveServerHost = () => {
    if (serverHost.trim()) {
      localStorage.setItem('hcp_waiter_server_host', serverHost.trim());
    } else {
      localStorage.removeItem('hcp_waiter_server_host');
    }
    setErrorMsg('');
    setShowServerConfig(false);
  };

  return (
    <div
      style={{
        height: '100dvh',
        width: '100vw',
        background: 'var(--bg-app)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
        position: 'relative'
      }}
    >
      {/* Top Floating Theme Switcher */}
      {onToggleTheme && (
        <button
          type="button"
          onClick={onToggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.05rem',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-subtle)',
            zIndex: 10
          }}
        >
          {isDark ? '☀️' : '🌙'}
        </button>
      )}

      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-lg)',
          padding: '30px 22px',
          boxShadow: 'var(--shadow-card)',
          position: 'relative'
        }}
      >
        {/* Branding Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '58px',
              height: '58px',
              margin: '0 auto 12px',
              background: 'var(--apple-orange-subtle)',
              border: '1.5px solid var(--apple-orange)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              boxShadow: 'var(--shadow-subtle)'
            }}
          >
            🍽️
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            Hotel City Park
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
            Waiter Order Panel (Restaurant &amp; Bar)
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit}>
          {/* Username Input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              👤 Waiter ID / Username
            </label>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. waiter1 or ramesh"
              style={{
                width: '100%',
                height: '44px',
                padding: '0 14px',
                background: 'var(--bg-surface-secondary)',
                border: '1.5px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.96rem',
                fontWeight: 650,
                outline: 'none'
              }}
            />
          </div>

          {/* Password Input */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', margin: 0 }}>
                🔑 Password / PIN
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ background: 'none', color: 'var(--apple-blue)', fontSize: '0.74rem', fontWeight: 750 }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                style={{
                  width: '100%',
                  height: '44px',
                  padding: '0 42px 0 14px',
                  background: 'var(--bg-surface-secondary)',
                  border: '1.5px solid var(--border-medium)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.96rem',
                  fontWeight: 650,
                  outline: 'none'
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.5,
                  fontSize: '1rem'
                }}
              >
                🔒
              </span>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--apple-red-subtle)',
                border: '1px solid var(--apple-red)',
                color: 'var(--apple-red)',
                fontSize: '0.80rem',
                fontWeight: 700,
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              height: '48px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--apple-orange)',
              color: 'var(--text-on-accent)',
              fontSize: '0.98rem',
              fontWeight: 850,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: 'var(--shadow-subtle)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1
            }}
          >
            {isLoading ? (
              <span>⏳ Signing in...</span>
            ) : (
              <>
                <span>Sign In to Waiter Panel</span>
                <span style={{ fontSize: '1.05rem' }}>→</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Demo Logins Bar */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-light)', textAlign: 'center' }}>
          <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.04em', marginBottom: '8px' }}>
            Quick 1-Click Fill
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleQuickLogin('res-cap-3', '3')}
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--apple-orange-subtle)',
                border: '1.5px solid var(--apple-orange)',
                color: 'var(--text-primary)',
                fontSize: '0.72rem',
                fontWeight: 750
              }}
            >
              ⭐ Captain 3
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('waiter1', '1234')}
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.72rem',
                fontWeight: 700
              }}
            >
              Waiter 1
            </button>
            <button
              type="button"
              onClick={() => handleQuickLogin('admin', '1234')}
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                fontSize: '0.72rem',
                fontWeight: 700
              }}
            >
              Admin Master
            </button>
          </div>

          {/* Optional Server IP Config Toggle */}
          <div style={{ marginTop: '14px' }}>
            <button
              type="button"
              onClick={() => setShowServerConfig(!showServerConfig)}
              style={{ background: 'none', color: 'var(--text-secondary)', fontSize: '0.70rem', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {showServerConfig ? '▲ Close Server Settings' : '⚙️ Server Connection Settings'}
            </button>

            {showServerConfig && (
              <div style={{ marginTop: '8px', textAlign: 'left', padding: '12px', background: 'var(--bg-surface-secondary)', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-medium)' }}>
                <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', marginBottom: '8px', wordBreak: 'break-all' }}>
                  <strong>Active Target:</strong> <code style={{ color: 'var(--apple-blue)' }}>{getBaseUrl()}</code>
                </div>

                <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Quick Presets:
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(CLOUD_TUNNEL_URL)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      borderRadius: 'var(--radius-xs)',
                      background: 'var(--apple-green-subtle)',
                      border: '1px solid var(--apple-green)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    ☁️ Cloud HTTPS
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(`http://${LOCAL_WIFI_IP}:3000`)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer'
                    }}
                  >
                    📶 Hotel Wi-Fi
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    🔄 Auto-Detect
                  </button>
                </div>

                <label style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Custom Server URL:
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={serverHost}
                    onChange={(e) => setServerHost(e.target.value)}
                    placeholder="https://... or http://..."
                    style={{
                      flex: 1,
                      height: '34px',
                      padding: '0 8px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--text-primary)',
                      fontSize: '0.78rem'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveServerHost}
                    style={{
                      padding: '0 12px',
                      height: '34px',
                      background: 'var(--apple-blue)',
                      color: 'var(--text-on-accent)',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '0.72rem',
                      fontWeight: 750,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
