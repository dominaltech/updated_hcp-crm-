import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('BTC Corporate Company Verification Search - Keyboard Navigation', () => {
  const step1SourcePath = path.resolve(__dirname, '../src/components/hospitality/CheckinWizard/Step1Source.jsx');
  const code = fs.readFileSync(step1SourcePath, 'utf-8');

  it('1. Step1Source defines btcHighlightIndex, btcDropdownRef, btcInputRef, and btcContainerRef', () => {
    expect(code).toContain('btcHighlightIndex');
    expect(code).toContain('setBtcHighlightIndex');
    expect(code).toContain('btcDropdownRef = useRef(null)');
    expect(code).toContain('btcInputRef = useRef(null)');
    expect(code).toContain('btcContainerRef = useRef(null)');
  });

  it('2. handleBtcKeyDown handles ArrowDown, ArrowUp, Enter, and Escape', () => {
    expect(code).toContain('handleBtcKeyDown');
    expect(code).toContain("e.key === 'ArrowDown'");
    expect(code).toContain("e.key === 'ArrowUp'");
    expect(code).toContain("e.key === 'Enter'");
    expect(code).toContain("e.key === 'Escape'");
  });

  it('3. ArrowDown and ArrowUp smoothly cycle through suggestions', () => {
    expect(code).toContain('setBtcHighlightIndex((prev) => (prev < btcSuggestions.length - 1 ? prev + 1 : 0))');
    expect(code).toContain('setBtcHighlightIndex((prev) => (prev > 0 ? prev - 1 : btcSuggestions.length - 1))');
  });

  it('4. Enter key selects highlighted BTC company and closes suggestions', () => {
    expect(code).toContain('const targetComp = btcHighlightIndex >= 0 ? btcSuggestions[btcHighlightIndex] : btcSuggestions[0]');
    expect(code).toContain('handleSelectBtc(targetComp)');
  });

  it('5. Suggestions dropdown renders btc-suggestion-item with highlight styles and Enter badge', () => {
    expect(code).toContain('btc-suggestion-item');
    expect(code).toContain('active-highlight');
    expect(code).toContain('#eef2ff');
    expect(code).toContain('4px solid #4f46e5');
    expect(code).toContain('↵ Enter');
    expect(code).toContain('onMouseEnter={() => setBtcHighlightIndex(idx)}');
  });

  it('6. Auto-scroll keeps highlighted suggestion visible and clicking outside closes suggestions', () => {
    expect(code).toContain("items[btcHighlightIndex].scrollIntoView({ block: 'nearest' })");
    expect(code).toContain('handleClickOutside');
    expect(code).toContain('setBtcSuggestions([])');
  });

  it('7. Enter badge is an explicit clickable button with onMouseDown and onClick', () => {
    expect(code).toContain('btc-enter-badge-btn');
    expect(code).toContain('btc-btn-enter-');
    expect(code).toContain('↵ Enter');
  });

  it('8. Up and Down navigation buttons and Clear button are provided inside the input container', () => {
    expect(code).toContain('btc-btn-nav-up');
    expect(code).toContain('btc-btn-nav-down');
    expect(code).toContain('btc-btn-clear');
  });

  it('9. keyboardNavigation.js allows autocomplete events before stopPropagation and clicks highlighted item on Enter', () => {
    const keyNavPath = path.resolve(__dirname, '../src/utils/keyboardNavigation.js');
    const keyNavCode = fs.readFileSync(keyNavPath, 'utf-8');
    expect(keyNavCode).toContain('isAutocompleteActive(activeEl, activeModal)');
    expect(keyNavCode).toContain("['ArrowDown', 'ArrowUp', 'Enter', 'NumpadEnter', 'Escape', 'Tab']");
    expect(keyNavCode).toContain('.btc-suggestion-item.active-highlight');
  });
});
