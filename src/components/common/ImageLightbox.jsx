import React, { useState, useRef, useEffect } from 'react';

export default function ImageLightbox({ isOpen, title = 'Document Preview', imageUrl, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragDistanceRef = useRef(0);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Non-passive mouse wheel listener for smooth scroll-to-zoom
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !isOpen) return;

    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Scroll UP (negative deltaY) zooms IN, Scroll DOWN (positive deltaY) zooms OUT
      const zoomStep = 0.22;
      const factor = e.deltaY < 0 ? zoomStep : -zoomStep;

      setZoom((prev) => {
        const next = Math.max(0.4, Math.min(6, Number((prev + factor).toFixed(2))));
        if (next <= 1) {
          setPan({ x: 0, y: 0 });
        }
        return next;
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen]);

  if (!isOpen || !imageUrl) return null;

  const handleZoom = (delta) => {
    setZoom((prev) => {
      const next = Math.max(0.4, Math.min(6, Number((prev + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Only main mouse button
    setIsDragging(true);
    dragDistanceRef.current = 0;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const dist = Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y);
    dragDistanceRef.current = dist;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Click on picture toggles zoom between 100% and 200%
  const handleClickImage = () => {
    if (dragDistanceRef.current > 6) return; // User was dragging to pan
    setZoom((prev) => {
      if (prev <= 1.2) {
        return 2.2;
      }
      setPan({ x: 0, y: 0 });
      return 1;
    });
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    setZoom((prev) => {
      if (prev > 1.2) {
        setPan({ x: 0, y: 0 });
        return 1;
      }
      return 2.8;
    });
  };

  return (
    <div className="modal-overlay image-lightbox-overlay active" id="image-lightbox-modal">
      <div className="lightbox-container">
        <div className="lightbox-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>🔍</span>
            <h4 id="lightbox-image-title" style={{ margin: 0 }}>
              {title}
            </h4>
          </div>

          <div className="lightbox-zoom-toolbar">
            <button
              type="button"
              className="lightbox-tool-btn"
              onClick={() => handleZoom(-0.25)}
              title="Zoom Out (-)"
            >
              <span>➖</span> Zoom Out
            </button>
            <span className="lightbox-zoom-badge" id="lightbox-zoom-pct">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="lightbox-tool-btn"
              onClick={() => handleZoom(0.25)}
              title="Zoom In (+)"
            >
              <span>➕</span> Zoom In
            </button>
            <button
              type="button"
              className="lightbox-tool-btn"
              onClick={handleReset}
              title="Reset to Fit (100%)"
            >
              <span>🔄</span> Fit
            </button>
            <button
              type="button"
              className="lightbox-tool-btn"
              onClick={handleRotate}
              title="Rotate 90°"
            >
              <span>↻</span> Rotate
            </button>
          </div>

          <button
            type="button"
            className="modal-close-btn lightbox-close-btn"
            id="btn-close-lightbox"
            onClick={onClose}
            title="Close Preview (Esc)"
          >
            &times;
          </button>
        </div>

        <div
          ref={bodyRef}
          className="lightbox-body"
          id="lightbox-body-scroll"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          style={{
            cursor: isDragging ? 'grabbing' : (zoom > 1.05 ? 'grab' : 'zoom-in'),
            userSelect: 'none',
            position: 'relative'
          }}
        >
          <div className="lightbox-viewport" id="lightbox-viewport">
            <img
              id="lightbox-preview-img"
              src={imageUrl}
              alt="Full Size Preview"
              draggable="false"
              onClick={handleClickImage}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                transition: isDragging ? 'none' : 'transform 0.14s ease-out',
                cursor: isDragging ? 'grabbing' : (zoom > 1.05 ? 'grab' : 'zoom-in')
              }}
            />
          </div>

          {/* User Experience Intimation Badge: Scroll Wheel to Zoom */}
          <div
            style={{
              position: 'absolute',
              bottom: '14px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: '24px',
              padding: '6px 16px',
              color: '#f1f5f9',
              fontSize: '0.74rem',
              fontWeight: 700,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              letterSpacing: '0.02em',
              zIndex: 30
            }}
          >
            <span>🖱️ Scroll wheel to zoom in / out</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.35)' }}>•</span>
            <span>Click to toggle zoom</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.35)' }}>•</span>
            <span>Drag to pan</span>
          </div>
        </div>
      </div>
    </div>
  );
}
