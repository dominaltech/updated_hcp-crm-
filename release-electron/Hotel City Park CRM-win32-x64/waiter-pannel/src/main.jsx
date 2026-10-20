import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Waiter Panel Caught Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#090d16', color: '#f8fafc', textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '1.20rem', fontWeight: 900, marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', maxWidth: '360px', marginBottom: '20px', lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected error occurred in the waiter panel.'}
          </p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('hcp_cloud_waiter_pkg');
              window.location.reload();
            }}
            style={{
              padding: '12px 24px',
              borderRadius: '12px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.90rem',
              cursor: 'pointer'
            }}
          >
            🔄 Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
