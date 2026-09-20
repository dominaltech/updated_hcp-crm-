import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useWebcam } from '../../hooks/useWebcam';
import ImageLightbox from '../common/ImageLightbox';

export default function RoomVisitorsModal({ isOpen, onClose, room, onVisitorUpdated }) {
  const { showToast, showConfirm } = useApp();
  const [activeTab, setActiveTab] = useState('add'); // 'add' | 'list'
  const [visitors, setVisitors] = useState([]);
  const [loadingVisitors, setLoadingVisitors] = useState(false);

  // Form fields
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [relation, setRelation] = useState('Friend');
  const [customRelation, setCustomRelation] = useState('');
  const [purpose, setPurpose] = useState('');
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [breakfastStatus, setBreakfastStatus] = useState('pending'); // 'paid' | 'pending'
  const [breakfastAmount, setBreakfastAmount] = useState(250);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [rawPhoto, setRawPhoto] = useState(null);
  const [saving, setSaving] = useState(false);

  // Lightbox State for Click-to-Zoom
  const [lightboxImg, setLightboxImg] = useState(null);
  const [lightboxTitle, setLightboxTitle] = useState('Visitor Photo');

  // Webcam Modal state
  const [isWebcamOpen, setIsWebcamOpen] = useState(false);
  const webcam = useWebcam();

  // Photo Editor Modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorAngle, setEditorAngle] = useState(0);
  const [editorZoom, setEditorZoom] = useState(1);
  const [editorRotateDeg, setEditorRotateDeg] = useState(0);
  const [editorFlipH, setEditorFlipH] = useState(false);
  const [editorPan, setEditorPan] = useState({ x: 0, y: 0 });
  const editorImgRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const fileInputRef = useRef(null);

  const roomId = room?.id;
  const roomNumber = room?.room_number || room?.number || '';

  // Load visitors when modal opens or active room changes
  const loadVisitors = useCallback(async () => {
    if (!roomId) return;
    setLoadingVisitors(true);
    try {
      const res = await api.hospitality.getVisitors(roomId);
      if (res && res.visitors) {
        setVisitors(res.visitors);
      } else {
        setVisitors([]);
      }
    } catch (err) {
      console.error('Error loading visitors:', err);
    } finally {
      setLoadingVisitors(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (isOpen && roomId) {
      loadVisitors();
      setActiveTab('add');
      resetForm();
    }
  }, [isOpen, roomId, loadVisitors]);

  const resetForm = () => {
    setVisitorName('');
    setVisitorPhone('');
    setRelation('Friend');
    setCustomRelation('');
    setPurpose('');
    setHasBreakfast(false);
    setBreakfastStatus('pending');
    setBreakfastAmount(250);
    setPhotoPreview(null);
    setRawPhoto(null);
  };

  // Switch webcam on/off
  const openWebcam = async () => {
    setIsWebcamOpen(true);
    await webcam.startStream();
  };

  const closeWebcam = () => {
    webcam.stopStream();
    setIsWebcamOpen(false);
  };

  const snapWebcamPhoto = () => {
    const snap = webcam.captureFrame();
    if (snap) {
      closeWebcam();
      openEditor(snap);
    } else {
      showToast('Could not capture frame from camera', 'warning');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      openEditor(event.target.result);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  // Open photo editor
  const openEditor = (imgDataUrl) => {
    setRawPhoto(imgDataUrl);
    setEditorAngle(0);
    setEditorZoom(1);
    setEditorRotateDeg(0);
    setEditorFlipH(false);
    setEditorPan({ x: 0, y: 0 });

    const img = new Image();
    img.onload = () => {
      editorImgRef.current = img;
      setIsEditorOpen(true);
    };
    img.src = imgDataUrl;
  };

  // Draw editor canvas
  const drawEditorCanvas = useCallback(() => {
    const canvas = editorCanvasRef.current;
    const img = editorImgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();

    ctx.translate(cw / 2 + editorPan.x, ch / 2 + editorPan.y);
    const totalRad = ((editorRotateDeg + editorAngle) * Math.PI) / 180;
    ctx.rotate(totalRad);

    const scaleX = (editorFlipH ? -1 : 1) * editorZoom;
    const scaleY = editorZoom;
    ctx.scale(scaleX, scaleY);

    const imgW = img.width;
    const imgH = img.height;
    const baseScale = Math.max(cw / imgW, ch / imgH);
    const drawW = imgW * baseScale;
    const drawH = imgH * baseScale;

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }, [editorPan, editorRotateDeg, editorAngle, editorFlipH, editorZoom]);

  useEffect(() => {
    if (isEditorOpen) {
      drawEditorCanvas();
    }
  }, [isEditorOpen, drawEditorCanvas]);

  // Editor interaction listeners
  const handleEditorMouseDown = (e) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - editorPan.x, y: e.clientY - editorPan.y };
  };

  const handleEditorMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    setEditorPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    });
  };

  const handleEditorMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleEditorWheel = (e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.05 : -0.05;
    setEditorZoom((prev) => Math.max(0.5, Math.min(3.0, Math.round((prev + zoomDelta) * 100) / 100)));
  };

  const applyEditorCrop = () => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = 400;
    outCanvas.height = 400;
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(canvas, 0, 0, 400, 400);

    const croppedData = outCanvas.toDataURL('image/jpeg', 0.92);
    setPhotoPreview(croppedData);
    setIsEditorOpen(false);
    showToast('✓ Visitor photo adjusted & cropped successfully!', 'success', 3500);
  };

  // Submit new visitor
  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!roomId) {
      showToast('Error: No active room selected.', 'error');
      return;
    }

    const trimmedName = visitorName.trim();
    const trimmedPhone = visitorPhone.trim();
    const customRel = customRelation.trim();

    if (!trimmedName) {
      showToast('Please enter the Visitor Full Name.', 'warning');
      return;
    }

    if (!trimmedPhone || trimmedPhone.length < 10) {
      showToast('Please enter a valid 10-digit mobile number.', 'warning');
      return;
    }

    if (!photoPreview && !rawPhoto) {
      showToast('Visitor live photo is strictly mandatory. Please capture photo via webcam or choose photo from PC.', 'warning');
      return;
    }

    if (relation === 'Custom' && !customRel) {
      showToast('Please enter the custom relation name.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        visitor_name: trimmedName,
        phone: trimmedPhone,
        relation: relation === 'Custom' ? customRel : relation,
        custom_relation: customRel,
        purpose: purpose.trim(),
        visitor_photo: photoPreview || rawPhoto || '',
        has_breakfast: hasBreakfast ? 1 : 0,
        breakfast_status: breakfastStatus,
        breakfast_amount: Number(breakfastAmount) || 250
      };

      const res = await api.hospitality.addVisitor(roomId, payload);
      if (res && res.success) {
        showToast(`✓ Visitor ${trimmedName} logged for Room ${roomNumber}!`, 'success', 4000);
        resetForm();
        await loadVisitors();
        setActiveTab('list');
        if (onVisitorUpdated) onVisitorUpdated();
      } else {
        showToast('Error logging visitor: ' + (res?.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      console.error('Error logging visitor:', err);
      showToast('Failed to save visitor record: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Checkout visitor
  const handleCheckoutVisitor = async (visitorId) => {
    try {
      const res = await api.hospitality.checkoutVisitor(visitorId);
      if (res && res.success) {
        showToast('✓ Visitor marked as departed.', 'info', 3000);
        await loadVisitors();
        if (onVisitorUpdated) onVisitorUpdated();
      } else {
        showToast('Error checking out visitor: ' + (res?.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showToast('Failed to checkout visitor: ' + err.message, 'error');
    }
  };

  // Delete visitor
  const handleDeleteVisitor = (visitorId) => {
    showConfirm('Are you sure you want to delete this visitor log entry?', async () => {
      try {
        const res = await api.hospitality.deleteVisitor(visitorId);
        if (res && res.success) {
          showToast('✓ Visitor record deleted.', 'info', 3000);
          await loadVisitors();
          if (onVisitorUpdated) onVisitorUpdated();
        } else {
          showToast('Error deleting visitor: ' + (res?.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showToast('Failed to delete visitor: ' + err.message, 'error');
      }
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay active" style={{ zIndex: 10075, display: 'flex', opacity: 1, visibility: 'visible', position: 'fixed', inset: 0, width: '100%', height: '100%', padding: 0, margin: 0 }}>
        <div className="modal-container" style={{ width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%', borderRadius: 0, margin: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-app, #f8fafc)' }}>
          
          {/* Modal Header with Universal Top-Left Back & Top-Right Close Buttons */}
          <div className="modal-header" style={{ padding: '16px 36px', background: 'linear-gradient(135deg, #065f46 0%, #047857 100%)', color: '#ffffff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                type="button"
                className="universal-back-btn light-theme-btn"
                id="btn-visitors-top-back"
                onClick={onClose}
                title="Back / Close Visitors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '1.8rem', padding: '8px', background: 'rgba(255,255,255,0.15)', borderRadius: '12px' }}>👥</span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.02em' }}>
                    Guest Visitors — <span>Room {roomNumber}</span>
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: '0.85rem', fontWeight: 600, color: '#a7f3d0' }}>
                    Log, photograph, crop &amp; verify visitors meeting in-house guests.
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="universal-close-btn modal-close-btn"
              onClick={onClose}
              style={{
                color: '#ffffff',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                cursor: 'pointer'
              }}
              title="Close Visitors"
            >
              &times;
            </button>
          </div>

          {/* Tab Switcher */}
          <div style={{ display: 'flex', gap: '12px', padding: '16px 40px 0', background: '#ffffff', borderBottom: '1.5px solid #e2e8f0', flexShrink: 0 }}>
            <button
              type="button"
              className={`visitor-tab-btn ${activeTab === 'add' ? 'active' : ''}`}
              onClick={() => setActiveTab('add')}
              style={{ padding: '12px 24px', fontSize: '1.05rem', fontWeight: 800, borderRadius: '10px 10px 0 0' }}
            >
              ➕ Log New Visitor
            </button>
            <button
              type="button"
              className={`visitor-tab-btn ${activeTab === 'list' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('list');
                loadVisitors();
              }}
              style={{ padding: '12px 24px', fontSize: '1.05rem', fontWeight: 800, borderRadius: '10px 10px 0 0' }}
            >
              📋 Visitors History (<span>{visitors.length}</span>)
            </button>
          </div>

          {/* Modal Body */}
          <div className="modal-body" style={{ padding: '36px 48px', overflowY: 'auto', flex: 1, background: 'var(--bg-app, #f8fafc)' }}>
            {activeTab === 'add' ? (
              /* VIEW 1: ADD VISITOR FORM */
              <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '36px', alignItems: 'flex-start' }}>
                
                {/* Left: Visitor Photo Capture Box */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', background: '#ffffff', border: '2px dashed #cbd5e1', borderRadius: '18px', padding: '24px', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)' }}>
                  <div style={{ width: '180px', height: '180px', borderRadius: '20px', overflow: 'hidden', border: '3.5px solid #059669', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '18px', position: 'relative' }}>
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Visitor Preview"
                        onClick={() => {
                          setLightboxImg(photoPreview);
                          setLightboxTitle('Visitor Photo Preview');
                        }}
                        title="Click to zoom / scroll photo"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                      />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#64748b' }}>
                        <span style={{ fontSize: '3rem' }}>📷</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 800, marginTop: '6px', color: '#dc2626' }}>Live Photo * (Mandatory)</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={openWebcam}
                      style={{ fontSize: '0.82rem', padding: '8px 12px', fontWeight: 750, background: '#059669', border: 'none', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <span>🎥</span> Live Webcam
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                      style={{ fontSize: '0.8rem', padding: '7px 10px', fontWeight: 700, borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                    >
                      <span>📁</span> Upload Photo
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />

                    {rawPhoto && (
                      <button
                        type="button"
                        onClick={() => openEditor(rawPhoto)}
                        style={{ fontSize: '0.78rem', padding: '6px 10px', fontWeight: 750, color: '#0284c7', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      >
                        <span>✂️</span> Crop / Adjust Angle
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: Visitor Details Form */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase' }}>
                      Visitor Full Name *
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Rahul Sharma"
                      value={visitorName}
                      onChange={(e) => setVisitorName(e.target.value)}
                      required
                      style={{ height: '42px', fontWeight: 700 }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase' }}>
                      Mobile Number * (10 Digits)
                    </label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="10-digit Mobile Number"
                      maxLength={10}
                      inputMode="numeric"
                      value={visitorPhone}
                      onChange={(e) => setVisitorPhone(e.target.value.replace(/\D/g, ''))}
                      required
                      style={{ height: '42px', fontWeight: 700 }}
                    />
                  </div>

                  {/* Relation Chips */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>
                      Relation with Guest *
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {[
                        { key: 'Friend', label: '🤝 Friend' },
                        { key: 'Family', label: '👨‍👩‍👧 Family / Relative' },
                        { key: 'Business Associate', label: '💼 Business Associate' },
                        { key: 'Colleague', label: '👔 Colleague' },
                        { key: 'Delivery / Service', label: '📦 Delivery / Service' },
                        { key: 'Custom', label: '✨ Other / Custom' }
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`visitor-relation-chip ${relation === item.key ? 'active' : ''}`}
                          onClick={() => setRelation(item.key)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {relation === 'Custom' && (
                      <div style={{ marginTop: '8px' }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Enter custom relation (e.g. Architect, Personal Assistant, Gym Trainer)"
                          value={customRelation}
                          onChange={(e) => setCustomRelation(e.target.value)}
                          style={{ height: '40px' }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase' }}>
                      Purpose of Visit
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Business discussion / Personal meet / Document handover"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      style={{ height: '42px' }}
                    />
                  </div>

                  {/* Visitor Breakfast Option */}
                  <div style={{ padding: '14px 16px', background: '#f8fafc', borderRadius: '12px', border: '1.5px solid #e2e8f0', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <label style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={hasBreakfast}
                          onChange={(e) => setHasBreakfast(e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#059669', cursor: 'pointer' }}
                        />
                        <span>🍳 Visitor Breakfast Plan (₹{breakfastAmount})</span>
                      </label>

                      {hasBreakfast && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 750, color: '#64748b' }}>Status:</span>
                          <button
                            type="button"
                            onClick={() => setBreakfastStatus('paid')}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '8px',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              border: breakfastStatus === 'paid' ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                              cursor: 'pointer',
                              background: breakfastStatus === 'paid' ? '#16a34a' : '#ffffff',
                              color: breakfastStatus === 'paid' ? '#ffffff' : '#475569'
                            }}
                          >
                            ✓ Paid
                          </button>
                          <button
                            type="button"
                            onClick={() => setBreakfastStatus('pending')}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '8px',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              border: breakfastStatus === 'pending' ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                              cursor: 'pointer',
                              background: breakfastStatus === 'pending' ? '#d97706' : '#ffffff',
                              color: breakfastStatus === 'pending' ? '#ffffff' : '#475569'
                            }}
                          >
                            ⏳ Pending
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            ) : (
              /* VIEW 2: VISITORS HISTORY LIST */
              <div>
                {visitors.length === 0 && !loadingVisitors && (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                    <span style={{ fontSize: '3rem' }}>👥</span>
                    <h4 style={{ margin: '8px 0 4px', fontSize: '1.1rem', color: '#1e293b' }}>No Visitors Logged Yet</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>Click "Log New Visitor" above to register someone visiting this room.</p>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {visitors.map((v) => {
                    const isInRoom = v.status === 'IN_ROOM';
                    const inTimeStr = v.checkin_time
                      ? new Date(v.checkin_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                      : '--';
                    const inDateStr = v.checkin_time ? new Date(v.checkin_time).toLocaleDateString() : '';
                    const outTimeStr = v.checkout_time
                      ? new Date(v.checkout_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
                      : null;

                    return (
                      <div key={v.id} className="visitor-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                          {v.visitor_photo ? (
                            <img
                              src={v.visitor_photo}
                              alt={v.visitor_name}
                              className="visitor-card-thumb"
                              onClick={() => {
                                setLightboxImg(v.visitor_photo);
                                setLightboxTitle(`${v.visitor_name} - Visitor Photo`);
                              }}
                              title="Click to zoom / scroll photo"
                              style={{ cursor: 'pointer' }}
                            />
                          ) : (
                            <div className="visitor-card-thumb-placeholder">👤</div>
                          )}
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                                {v.visitor_name}
                              </h4>
                              <span style={{ fontSize: '0.72rem', fontWeight: 800, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '10px' }}>
                                {v.relation || 'Friend'}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 800,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  ...(isInRoom
                                    ? { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }
                                    : { background: '#f1f5f9', color: '#64748b' })
                                }}
                              >
                                {isInRoom ? '🟢 In Room' : '⚪ Departed'}
                              </span>

                              {/* Clear Visitor Breakfast Status (Paid or Pending) */}
                              {Boolean(v.has_breakfast) && (
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 800,
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    ...(v.breakfast_status === 'paid'
                                      ? { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }
                                      : { background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' })
                                  }}
                                >
                                  🍳 Breakfast: {v.breakfast_status === 'paid' ? 'PAID' : 'PENDING'} (₹{v.breakfast_amount || 250})
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: '3px' }}>
                              📞 <strong>{v.phone || 'N/A'}</strong>
                              {v.purpose && <span> • <em>"{v.purpose}"</em></span>}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '3px' }}>
                              ⏱️ In: <strong>{inDateStr} {inTimeStr}</strong>
                              {outTimeStr && <span> • Out: <strong>{outTimeStr}</strong></span>}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isInRoom ? (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleCheckoutVisitor(v.id)}
                              style={{ background: '#0284c7', border: 'none', fontSize: '0.78rem', fontWeight: 750, padding: '6px 12px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <span>🚪</span> Mark Departed
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.78rem', color: '#166534', fontWeight: 750, background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '4px 10px', borderRadius: '8px' }}>
                              ✓ Completed
                            </span>
                          )}
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleDeleteVisitor(v.id)}
                            style={{ background: '#fff1f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.78rem', fontWeight: 750, padding: '6px 10px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                            title="Delete Visitor Record"
                          >
                            <span>🗑️</span> Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          {activeTab === 'add' && (
            <div className="modal-footer" style={{ padding: '20px 48px', background: '#ffffff', borderTop: '1.5px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '16px', flexShrink: 0 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={saving}
                style={{ padding: '14px 32px', fontSize: '1.1rem', fontWeight: 800, borderRadius: '12px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmit}
                disabled={saving}
                style={{ background: '#059669', border: 'none', fontWeight: 900, fontSize: '1.15rem', padding: '14px 40px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 16px rgba(5, 150, 105, 0.35)' }}
              >
                <span>✓</span> {saving ? 'Saving...' : 'Save & Log Visitor'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: VISITOR LIVE WEBCAM CAPTURE */}
      {isWebcamOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10085, display: 'flex', opacity: 1, visibility: 'visible' }}>
          <div className="modal-container" style={{ maxWidth: '520px', width: '92%', textAlign: 'center', padding: '22px', background: '#0f172a', color: '#fff', borderRadius: '18px', border: '1.5px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc' }}>
                🎥 Capture Visitor Live Photo
              </h3>
              <button type="button" className="modal-close-btn" onClick={closeWebcam} style={{ color: '#ffffff' }}>
                &times;
              </button>
            </div>

            {/* Camera Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
              {webcam.devices.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={webcam.cycleCamera}
                  title={`Current: ${webcam.activeCameraLabel || 'Camera'}. Click to switch camera.`}
                  style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 750, borderRadius: '8px', background: '#0284c7', color: '#ffffff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                >
                  <span>🔄</span> Switch Camera ({webcam.devices.length})
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={webcam.toggleMirror}
                style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 750, borderRadius: '8px', background: '#334155', color: '#f8fafc', border: '1px solid #64748b', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
              >
                <span>🪞</span> Mirror Camera
              </button>
            </div>

            <div style={{ width: '100%', height: '320px', borderRadius: '14px', overflow: 'hidden', background: '#020617', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #38bdf8', marginBottom: '16px' }}>
              {webcam.isActive && webcam.activeCameraLabel && (
                <div
                  style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    background: 'rgba(15, 23, 42, 0.8)',
                    backdropFilter: 'blur(8px)',
                    color: '#f8fafc',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    zIndex: 10,
                    border: '1px solid rgba(255, 255, 255, 0.15)'
                  }}
                >
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: '#22c55e',
                      display: 'inline-block'
                    }}
                  ></span>
                  <span>📹 {webcam.activeCameraLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')}</span>
                </div>
              )}
              <video
                ref={webcam.videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: webcam.isMirrored ? 'scaleX(-1)' : 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeWebcam}
                style={{ background: 'transparent', color: '#94a3b8', borderColor: '#334155' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={snapWebcamPhoto}
                style={{ background: '#059669', border: 'none', fontWeight: 800, padding: '10px 24px', fontSize: '0.92rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <span>📸</span> Snap Photo Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: INTERACTIVE VISITOR PHOTO CROPPER & ANGLE STRAIGHTENER */}
      {isEditorOpen && (
        <div className="modal-overlay active" style={{ zIndex: 10090, display: 'flex', opacity: 1, visibility: 'visible' }}>
          <div className="modal-container" style={{ maxWidth: '720px', width: '95%', maxHeight: '94vh', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#ffffff', border: '1.5px solid #334155' }}>
            
            {/* Editor Header */}
            <div className="modal-header" style={{ padding: '14px 20px', background: '#020617', borderBottom: '1px solid #1e293b', color: '#ffffff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.3rem' }}>✂️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>Adjust & Straighten Visitor Photo</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: '#94a3b8' }}>Adjust angle, tilt, zoom and crop face cleanly before saving.</p>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setIsEditorOpen(false)} style={{ color: '#ffffff' }}>
                &times;
              </button>
            </div>

            {/* Editor Canvas Workspace */}
            <div
              className="modal-body"
              style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#020617', flex: 1, minHeight: '320px', maxHeight: '420px', overflow: 'hidden', position: 'relative' }}
              onMouseMove={handleEditorMouseMove}
              onMouseUp={handleEditorMouseUp}
            >
              <div
                style={{ position: 'relative', width: '340px', height: '340px', borderRadius: '14px', overflow: 'hidden', border: '2px solid #38bdf8', boxShadow: '0 8px 30px rgba(0,0,0,0.6)', background: '#0f172a', cursor: 'grab' }}
                onMouseDown={handleEditorMouseDown}
                onWheel={handleEditorWheel}
              >
                <canvas ref={editorCanvasRef} width={340} height={340} style={{ width: '100%', height: '100%', display: 'block' }} />
                
                {/* Cropping circular/square guide overlay */}
                <div style={{ position: 'absolute', inset: 0, border: '2px dashed rgba(56, 189, 248, 0.6)', borderRadius: '14px', pointerEvents: 'none', boxShadow: 'inset 0 0 0 9999px rgba(2, 6, 23, 0.4)' }}>
                  <div style={{ position: 'absolute', top: '8px', left: '8px', fontSize: '0.68rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(15, 23, 42, 0.8)', padding: '2px 6px', borderRadius: '4px' }}>
                    Crop Frame
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '8px' }}>
                🖱️ Drag canvas to pan/reposition • Use sliders below to straighten & zoom
              </div>
            </div>

            {/* Controls Toolbar */}
            <div style={{ padding: '16px 20px', background: '#0f172a', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              {/* Angle / Tilt Straightener Slider */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '140px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#f8fafc' }}>📐 Straighten:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#38bdf8', minWidth: '44px' }}>{editorAngle.toFixed(1)}°</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, maxWidth: '360px' }}>
                  <button
                    type="button"
                    className="btn-editor-tool btn-stepper-round"
                    onClick={() => setEditorAngle((prev) => Math.max(-45, Math.min(45, Math.round((prev - 0.5) * 10) / 10)))}
                    title="Tilt Left -0.5°"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="-45"
                    max="45"
                    step="0.5"
                    value={editorAngle}
                    style={{ flex: 1, accentColor: '#38bdf8' }}
                    onChange={(e) => setEditorAngle(parseFloat(e.target.value) || 0)}
                  />
                  <button
                    type="button"
                    className="btn-editor-tool btn-stepper-round"
                    onClick={() => setEditorAngle((prev) => Math.max(-45, Math.min(45, Math.round((prev + 0.5) * 10) / 10)))}
                    title="Tilt Right +0.5°"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="btn-editor-tool"
                    onClick={() => setEditorAngle(0)}
                    title="Reset to 0°"
                    style={{ marginLeft: '4px', padding: '5px 8px' }}
                  >
                    0°
                  </button>
                </div>
              </div>

              {/* Zoom & Rotate / Flip */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '140px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 750, color: '#f8fafc' }}>🔍 Zoom:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#38bdf8', minWidth: '40px' }}>{editorZoom.toFixed(1)}x</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, maxWidth: '240px' }}>
                  <button
                    type="button"
                    className="btn-editor-tool btn-stepper-round"
                    onClick={() => setEditorZoom((prev) => Math.max(0.5, Math.min(3.0, Math.round((prev - 0.1) * 100) / 100)))}
                    title="Zoom Out"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.05"
                    value={editorZoom}
                    style={{ flex: 1, accentColor: '#38bdf8' }}
                    onChange={(e) => setEditorZoom(parseFloat(e.target.value) || 1)}
                  />
                  <button
                    type="button"
                    className="btn-editor-tool btn-stepper-round"
                    onClick={() => setEditorZoom((prev) => Math.max(0.5, Math.min(3.0, Math.round((prev + 0.1) * 100) / 100)))}
                    title="Zoom In"
                  >
                    +
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-editor-tool"
                    onClick={() => setEditorRotateDeg((prev) => (prev + 90) % 360)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span>⟳</span> Rotate 90°
                  </button>
                  <button
                    type="button"
                    className="btn-editor-tool"
                    onClick={() => setEditorFlipH((prev) => !prev)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span>⇄</span> Flip
                  </button>
                </div>
              </div>
            </div>

            {/* Editor Footer */}
            <div style={{ padding: '14px 20px', background: '#020617', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsEditorOpen(false)}
                style={{ background: 'transparent', color: '#94a3b8', borderColor: '#334155' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyEditorCrop}
                style={{ background: '#059669', border: 'none', fontWeight: 800, padding: '10px 22px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <span>✓</span> Apply & Save Crop
              </button>
            </div>

          </div>
        </div>
      )}
      {/* Full Size Image Lightbox with Mouse Wheel Scroll to Zoom */}
      <ImageLightbox
        isOpen={Boolean(lightboxImg)}
        title={lightboxTitle}
        imageUrl={lightboxImg}
        onClose={() => setLightboxImg(null)}
      />
    </>
  );
}
