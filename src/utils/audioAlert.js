/**
 * Web Audio API Continuous Kitchen Order Alert Synthesizer
 * Plays an attention-grabbing, pleasant two-tone hospitality chime
 * continuously until staff accepts or dismisses the order popup.
 * Requires NO external sound files - 100% reliable in every browser & Electron.
 */

let audioCtx = null;
let beepInterval = null;
let isBeeping = false;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playSingleBeep(freq = 880, duration = 0.16, type = 'sine') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // Smooth envelope to avoid audio clicks
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('[AudioAlert] Beep error:', e);
  }
}

function playDoubleBeep() {
  playSingleBeep(880, 0.14, 'triangle'); // High chime
  setTimeout(() => {
    if (isBeeping) {
      playSingleBeep(1175, 0.22, 'sine'); // Second harmonic chime
    }
  }, 170);
}

export function startContinuousOrderAlert() {
  if (isBeeping) return;
  isBeeping = true;

  // Play immediately
  playDoubleBeep();

  // Then loop every 1.6 seconds until stopped
  beepInterval = setInterval(() => {
    if (!isBeeping) {
      if (beepInterval) clearInterval(beepInterval);
      return;
    }
    playDoubleBeep();
  }, 1600);
}

export function stopContinuousOrderAlert() {
  isBeeping = false;
  if (beepInterval) {
    clearInterval(beepInterval);
    beepInterval = null;
  }
}

export function isOrderAlertActive() {
  return isBeeping;
}
