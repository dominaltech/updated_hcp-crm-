import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('User Requests: Check-In Date & Time Editable & Imminent Checkout Red Blink Card Height', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Imminent checkout room card pulses red with blink animation and increased height', () => {
    const cssCode = fs.readFileSync(path.join(rootDir, 'public/styles.css'), 'utf8');

    // Height calibrated to prevent congested look while preventing last card overflow
    expect(cssCode).toContain('height: clamp(90px, 11.5vh, 102px) !important;');
    expect(cssCode).toContain('min-height: 88px !important;');
    expect(cssCode).toContain('max-height: 104px !important;');

    // Red blink animation on the entire card
    expect(cssCode).toContain('.room-card.checkout-imminent {');
    expect(cssCode).toContain('border: 2px solid #ef4444 !important;');
    expect(cssCode).toContain('background: #fef2f2 !important;');
    expect(cssCode).toContain('animation: redishBlinkPulse 1.8s infinite ease-in-out !important;');

    // Dark theme checkout-imminent red pulse animation
    expect(cssCode).toContain('[data-theme="dark"] .room-card.checkout-imminent');
    expect(cssCode).toContain('animation: redishBlinkPulseDark 1.8s infinite ease-in-out !important;');
  });

  it('2. Check-In Date & Time in Step 6 Stay uses spacious 1.2fr 1.8fr columns and is securely locked', () => {
    const step6Code = fs.readFileSync(path.join(rootDir, 'src/components/hospitality/CheckinWizard/Step6Stay.jsx'), 'utf8');

    // Spacious layout matching Expected Checkout
    expect(step6Code).toContain("gridTemplateColumns: '1.2fr 1.8fr'");

    // Check-in date & time securely locked
    expect(step6Code).toContain('🕒 Check-In Date &amp; Time');
    expect(step6Code).toContain('disabled={true}');
    expect(step6Code).toContain("cursor: 'not-allowed'");
  });

  it('3. UnifiedTimeInput supports direct typing without blocking or resetting overrides', () => {
    const timeInputCode = fs.readFileSync(path.join(rootDir, 'src/components/common/UnifiedTimeInput.jsx'), 'utf8');

    // Resets periodOverride on external value change
    expect(timeInputCode).toContain('setPeriodOverride(null);');
    expect(timeInputCode).toContain('setTypedHour(null);');
    expect(timeInputCode).toContain('setTypedMinute(null);');

    // Has typedHour and typedMinute for natural typing
    expect(timeInputCode).toContain('const [typedHour, setTypedHour] = useState(null);');
    expect(timeInputCode).toContain('const [typedMinute, setTypedMinute] = useState(null);');
    expect(timeInputCode).toContain('onFocus={(e) => {');
    expect(timeInputCode).toContain('e.target.select();');
  });
});
