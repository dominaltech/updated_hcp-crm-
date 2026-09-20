import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import ThemedSelect from '../common/ThemedSelect';

export default function RoomCleaningModal({ isOpen, room, onClose, onCleanSuccess }) {
  const [cleanerName, setCleanerName] = useState('');
  const [cleaners, setCleaners] = useState([]);
  const [isLoadingCleaners, setIsLoadingCleaners] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCleanerName('');
      setErrorNotice('');
      setIsLoadingCleaners(true);
      api.getCleaners()
        .then((res) => {
          if (res && Array.isArray(res.cleaners)) {
            setCleaners(res.cleaners);
            if (res.cleaners.length === 1) {
              setCleanerName(res.cleaners[0].name);
            }
          }
        })
        .catch((err) => {
          console.error('Error fetching cleaners list:', err);
        })
        .finally(() => setIsLoadingCleaners(false));
    }
  }, [isOpen]);

  if (!isOpen || !room) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = cleanerName.trim();
    if (!trimmed) {
      setErrorNotice('Please select a cleaner staff name.');
      return;
    }

    setIsSubmitting(true);
    setErrorNotice('');
    try {
      const data = await api.markRoomClean(room.id, {
        cleaner_name: trimmed
      });
      if (data && data.success) {
        setCleanerName('');
        onCleanSuccess && onCleanSuccess(data);
        onClose();
      } else {
        setErrorNotice(data?.error || 'Failed to update room status');
      }
    } catch (err) {
      setErrorNotice(err.message || 'Error communicating with server');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay active"
      id="modal-room-cleaning"
      style={{
        zIndex: 10090,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        position: 'fixed',
        inset: 0
      }}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: '460px',
          width: '90%',
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'visible', // allow dropdown menu to overflow gracefully if needed
          padding: 0
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.6rem' }}>🧹</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>
                Mark Room Clean &amp; Ready
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.82rem', opacity: 0.9 }}>
                Room #{room.room_number || room.roomNumber} ({room.room_type || room.roomType || 'Room'})
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            style={{
              color: '#ffffff',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            &times;
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {errorNotice && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                background: '#fef2f2',
                border: '1.5px solid #fca5a5',
                borderRadius: '10px',
                color: '#b91c1c',
                fontSize: '0.85rem',
                fontWeight: 700
              }}
            >
              ⚠️ {errorNotice}
            </div>
          )}

          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.88rem',
                fontWeight: 800,
                color: '#334155',
                marginBottom: '8px'
              }}
            >
              Cleaner Staff Name *
            </label>
            <ThemedSelect
              id="select-cleaner-staff"
              value={cleanerName}
              onChange={(val) => {
                setCleanerName(val);
                if (errorNotice) setErrorNotice('');
              }}
              colorTheme="emerald"
              placeholder={isLoadingCleaners ? 'Loading cleaner staff...' : '-- Select Cleaner Staff Name --'}
              required
              options={cleaners.map((c) => ({
                value: c.name,
                label: c.name,
                subtitle: c.phone || null,
                icon: '🧹'
              }))}
              emptyMessage={isLoadingCleaners ? 'Loading cleaner staff...' : 'No cleaner staff found. Please add in Manager Panel.'}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '10px 20px',
                fontSize: '0.9rem',
                fontWeight: 750,
                borderRadius: '10px',
                border: '1.5px solid #cbd5e1',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting || isLoadingCleaners}
              style={{
                padding: '10px 24px',
                fontSize: '0.95rem',
                fontWeight: 800,
                background: '#059669',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(5, 150, 105, 0.3)'
              }}
            >
              {isSubmitting ? 'Saving...' : '✓ Confirm Room Ready'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
