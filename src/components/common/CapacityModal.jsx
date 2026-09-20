import React from 'react';
import { useApp } from '../../context/AppContext';

export default function CapacityModal() {
  const { capacityModal, closeCapacityModal } = useApp();

  if (!capacityModal || !capacityModal.isOpen) return null;

  return (
    <div className="modal-overlay active" style={{ zIndex: 10090, display: 'flex', opacity: 1, visibility: 'visible' }}>
      <div className="modal-container" style={{ maxWidth: '440px', width: '90%', padding: '24px', textAlign: 'center', borderRadius: '18px', background: '#ffffff', border: '1.5px solid #fde047', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>⚠️</div>
        <h3 style={{ margin: '0 0 10px', fontSize: '1.2rem', fontWeight: 800, color: '#854d0e' }}>
          Room Capacity Exceeded
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.88rem', color: '#475569', lineHeight: 1.5 }}>
          {capacityModal.message || 'The guest count exceeds the maximum recommended capacity for this room.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {capacityModal.onAddRooms && (
            <button
              type="button"
              className="btn-primary"
              style={{ background: '#0284c7', border: 'none', padding: '10px 16px', fontWeight: 750, borderRadius: '8px' }}
              onClick={() => {
                capacityModal.onAddRooms();
                closeCapacityModal();
              }}
            >
              ➕ Select Additional Room(s)
            </button>
          )}
          {capacityModal.onProceedSingle && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '9px 16px', fontWeight: 700, borderRadius: '8px' }}
              onClick={() => {
                capacityModal.onProceedSingle();
                closeCapacityModal();
              }}
            >
              Continue With Current Room
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '8px 16px', color: '#64748b', borderColor: '#cbd5e1' }}
            onClick={closeCapacityModal}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
