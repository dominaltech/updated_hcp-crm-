import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Checks whether a camera device label is a virtual webcam driver.
 */
/**
 * Checks whether a camera device label is a virtual webcam driver or idle app bridge.
 */
export function isVirtualCamera(label = '') {
  const l = (label || '').toLowerCase();
  return (
    l.includes('droidcam') ||
    l.includes('obs virtual') ||
    l.includes('obs-camera') ||
    l.includes('vmix') ||
    l.includes('manycam') ||
    l.includes('epoccam') ||
    l.includes('iriun') ||
    l.includes('screen') ||
    l.includes('virtual')
  );
}

/**
 * Selects the best camera available.
 * Prioritizes real physical webcams (Logitech C270, external USB cams) over virtual drivers (DroidCam).
 */
export function selectBestCamera(videoDevs = [], preferredId = '', isExplicitChoice = false) {
  if (!videoDevs || videoDevs.length === 0) return null;

  // 1. Respect user's explicit manual selection if still connected
  if (isExplicitChoice && preferredId) {
    const matched = videoDevs.find((d) => d.deviceId === preferredId);
    if (matched) return matched;
  }

  // 2. Prioritize real physical external webcam (Logi C270, Logitech, etc.)
  const logiCam = videoDevs.find((d) => {
    const l = (d.label || '').toLowerCase();
    return l.includes('logi') || l.includes('c270') || l.includes('logitech');
  });
  if (logiCam) return logiCam;

  // 3. Prioritize any physical non-virtual USB camera (e.g. laptop webcam USB2.0 HD UVC WebCam)
  const physicalUsbCam = videoDevs.find((d) => {
    const l = (d.label || '').toLowerCase();
    return !isVirtualCamera(l) && (l.includes('usb') || l.includes('uvc') || l.includes('webcam') || l.includes('camera'));
  });
  if (physicalUsbCam) return physicalUsbCam;

  // 4. Any other non-virtual camera
  const anyRealCam = videoDevs.find((d) => !isVirtualCamera(d.label || ''));
  if (anyRealCam) return anyRealCam;

  // 5. Fallback: DroidCam / Virtual driver if no physical cameras are available
  const droidCam = videoDevs.find((d) => (d.label || '').toLowerCase().includes('droidcam'));
  if (droidCam) return droidCam;

  return videoDevs[0] || null;
}

export function useWebcam() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isStartingRef = useRef(false);
  const pendingSwitchRef = useRef(null);
  const devicesRef = useRef([]);

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    try {
      const isManual = localStorage.getItem('user_manually_selected_camera') === 'true';
      const savedId = localStorage.getItem('preferred_camera_device_id');
      if (isManual && savedId) return savedId;
      // Purge any stale auto-saved device IDs
      localStorage.removeItem('preferred_camera_device_id');
      return '';
    } catch (e) {
      return '';
    }
  });
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;

  const [activeCameraLabel, setActiveCameraLabel] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [isMirrored, setIsMirrored] = useState(() => {
    try {
      return localStorage.getItem('webcam_mirror_mode') !== 'off';
    } catch (e) {
      return true;
    }
  });
  const [error, setError] = useState(null);

  // Stop active stream cleanly
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActiveCameraLabel('');
    setIsActive(false);
  }, []);

  // Device enumerator
  const updateDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const allDevs = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = allDevs.filter((d) => d.kind === 'videoinput');
      devicesRef.current = videoDevs;
      setDevices(videoDevs);
      return videoDevs;
    } catch (e) {
      console.warn('[useWebcam] Error enumerating cameras:', e);
      return [];
    }
  }, []);

  // Start video stream
  const startStream = useCallback(async (deviceIdOverride = null, isExplicit = false) => {
    if (isStartingRef.current) {
      if (deviceIdOverride) {
        pendingSwitchRef.current = { deviceId: deviceIdOverride, isExplicit };
      }
      return;
    }
    isStartingRef.current = true;

    try {
      // 1. Release prior stream
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
        } catch (e) {}
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setError(null);

      // Windows DirectShow pause to prevent NotReadableError
      await new Promise((r) => setTimeout(r, 60));

      // 2. Get devices list
      let currentDevs = devicesRef.current;
      if (!currentDevs || currentDevs.length === 0 || currentDevs.every((d) => !d.label)) {
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          currentDevs = all.filter((d) => d.kind === 'videoinput');
          devicesRef.current = currentDevs;
          setDevices(currentDevs);
        } catch (e) {}
      }

      // 3. Select target camera
      const isManualChoice = isExplicit || localStorage.getItem('user_manually_selected_camera') === 'true';
      const bestDev = selectBestCamera(
        currentDevs,
        deviceIdOverride || selectedDeviceIdRef.current,
        isManualChoice
      );
      const targetId = deviceIdOverride || bestDev?.deviceId || null;

      // 4. Request camera stream
      let stream = null;
      if (targetId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: targetId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch (errExact) {
          console.warn('[useWebcam] Exact device constraint failed, trying ideal constraint:', errExact);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { ideal: targetId },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              },
              audio: false
            });
          } catch (errIdeal) {
            console.warn('[useWebcam] Device-specific stream failed, falling back to default:', errIdeal);
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      }

      // 5. Fresh device enumeration after permission grant
      let freshDevs = [];
      try {
        const allFresh = await navigator.mediaDevices.enumerateDevices();
        freshDevs = allFresh.filter((d) => d.kind === 'videoinput');
        devicesRef.current = freshDevs;
        setDevices(freshDevs);
      } catch (e) {}

      // 6. If initial stream picked a virtual camera (like DroidCam) but a real physical Logitech webcam is available, auto-switch to Logitech
      const initialTrack = stream.getVideoTracks()[0];
      const initialTrackLabel = (initialTrack?.label || '').toLowerCase();
      if (!isExplicit && isVirtualCamera(initialTrackLabel) && freshDevs.length > 0) {
        const physicalCam = freshDevs.find((d) => {
          const l = (d.label || '').toLowerCase();
          return l.includes('logi') || l.includes('c270') || l.includes('logitech');
        });
        if (physicalCam && physicalCam.deviceId !== targetId) {
          console.log(`[useWebcam] Auto-switching from virtual (${initialTrackLabel}) to physical webcam: ${physicalCam.label}`);
          try {
            initialTrack.stop();
            await new Promise((r) => setTimeout(r, 60));
            const logiStream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: physicalCam.deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              },
              audio: false
            });
            stream = logiStream;
          } catch (autoSwitchErr) {
            console.warn('[useWebcam] Auto-switch to physical webcam failed:', autoSwitchErr);
          }
        }
      }

      streamRef.current = stream;

      // 7. Attach stream to video element
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        if (track) {
          const label = track.label || '';
          setActiveCameraLabel(label);
          const devId = track.getSettings()?.deviceId || targetId;
          if (devId) {
            selectedDeviceIdRef.current = devId;
            setSelectedDeviceId(devId);
          }
        }
        try {
          const p = videoRef.current.play();
          if (p !== undefined) {
            await p;
          }
        } catch (playErr) {
          if (playErr.name !== 'AbortError') {
            console.warn('[useWebcam] Play notice:', playErr);
          }
        }
      }

      setIsActive(true);
    } catch (err) {
      console.error('[useWebcam] Camera stream error:', err);
      setError(err.message || 'Could not access camera');
      setIsActive(false);
    } finally {
      isStartingRef.current = false;

      // Process any pending switch requested while starting
      if (pendingSwitchRef.current) {
        const next = pendingSwitchRef.current;
        pendingSwitchRef.current = null;
        startStream(next.deviceId, next.isExplicit);
      }
    }
  }, []);

  // Switch to specific camera
  const switchCamera = useCallback(
    (deviceId) => {
      setSelectedDeviceId(deviceId);
      selectedDeviceIdRef.current = deviceId;
      try {
        localStorage.setItem('preferred_camera_device_id', deviceId);
        localStorage.setItem('user_manually_selected_camera', 'true');
      } catch (e) {}
      startStream(deviceId, true);
    },
    [startStream]
  );

  // 1-Click Cycle/Toggle to Next Camera (Logi <-> DroidCam <-> Laptop Webcam)
  const cycleCamera = useCallback(() => {
    const currentDevs = devicesRef.current.length > 0 ? devicesRef.current : devices;
    if (!currentDevs || currentDevs.length <= 1) return;

    const currentId = selectedDeviceIdRef.current;
    let currentIndex = currentDevs.findIndex((d) => d.deviceId === currentId);
    if (currentIndex === -1 && activeCameraLabel) {
      currentIndex = currentDevs.findIndex((d) => d.label === activeCameraLabel);
    }
    const nextIndex = (currentIndex + 1) % currentDevs.length;
    const nextDev = currentDevs[nextIndex];
    if (nextDev) {
      console.log(`[useWebcam] Switching camera to (${nextIndex + 1}/${currentDevs.length}): ${nextDev.label}`);
      switchCamera(nextDev.deviceId);
    }
  }, [devices, activeCameraLabel, switchCamera]);

  const toggleMirror = useCallback(() => {
    setIsMirrored((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('webcam_mirror_mode', next ? 'on' : 'off');
      } catch (e) {}
      return next;
    });
  }, []);

  const captureFrame = useCallback(
    (canvasOptions = {}) => {
      if (!videoRef.current || !isActive) return null;
      const video = videoRef.current;
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Calculate target aspect ratio (defaults to 4:3 for standard portrait, or specified ratio)
      const targetAspect =
        canvasOptions.aspectRatio ||
        (canvasOptions.width && canvasOptions.height ? canvasOptions.width / canvasOptions.height : 4 / 3);
      const videoAspect = vw / vh;

      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;

      if (videoAspect > targetAspect) {
        // Video is wider than viewfinder: crop sides equally so center matches visible feed
        sw = vh * targetAspect;
        sx = (vw - sw) / 2;
      } else if (videoAspect < targetAspect) {
        // Video is taller than viewfinder: crop top/bottom equally
        sh = vw / targetAspect;
        sy = (vh - sh) / 2;
      }

      const outWidth = canvasOptions.width || 960;
      const outHeight = canvasOptions.height || Math.round(outWidth / targetAspect);

      const canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext('2d');

      if (isMirrored) {
        ctx.translate(outWidth, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
      return canvas.toDataURL('image/jpeg', 0.95);
    },
    [isActive, isMirrored]
  );

  useEffect(() => {
    updateDeviceList();
  }, [updateDeviceList]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return {
    videoRef,
    isActive,
    isMirrored,
    activeCameraLabel,
    devices,
    selectedDeviceId,
    error,
    startStream,
    stopStream,
    switchCamera,
    cycleCamera,
    toggleMirror,
    captureFrame
  };
}
