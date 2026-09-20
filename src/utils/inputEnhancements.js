/**
 * Global Input Enhancements:
 * 1. Scrolling up/down over number inputs does NOT change their values.
 * 2. Any input field automatically selects all content on focus so typing replaces it.
 * 3. Pressing Backspace on selected text or on '0' completely clears the field (even '0').
 */

export function initGlobalInputEnhancements() {
  if (typeof window === 'undefined') return;

  // 1. Prevent mouse wheel scrolling from changing number input values
  window.addEventListener(
    'wheel',
    (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type === 'number') {
        active.blur();
      }
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
        e.target.blur();
      }
    },
    { passive: true }
  );

  // Helper to trigger React-compatible input change
  const setInputValueNative = (input, val) => {
    const proto = window.HTMLInputElement?.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, val);
    } else {
      input.value = val;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // 2. Auto-select text on focus so user can immediately type or erase
  let justFocusedElement = null;

  document.addEventListener(
    'focus',
    (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;

      const nonSelectable = ['checkbox', 'radio', 'file', 'image', 'range', 'submit', 'button', 'reset', 'color'];
      if (el.tagName === 'INPUT' && nonSelectable.includes(el.type)) return;

      justFocusedElement = el;
      el.dataset.justFocused = 'true';

      setTimeout(() => {
        if (document.activeElement === el) {
          try {
            el.select();
          } catch (_) {}
        }
      }, 30);
    },
    true
  );

  // Handle click / mouseup so selection isn't immediately dismissed on mouse release
  document.addEventListener(
    'mouseup',
    (e) => {
      const el = e.target;
      if (el && el === justFocusedElement && el.dataset?.justFocused === 'true') {
        delete el.dataset.justFocused;
        justFocusedElement = null;
        setTimeout(() => {
          try {
            el.select();
          } catch (_) {}
        }, 10);
      }
    },
    true
  );

  // 3. When Backspace or Delete is pressed:
  // If the field is selected or its value is '0', erase it completely (empty string, not reverting to 0)
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;

      const el = e.target;
      if (!el || el.tagName !== 'INPUT') return;

      const val = String(el.value || '');

      // Check if value is zero or if text is selected
      let isAllSelected = false;
      try {
        if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
          isAllSelected = el.selectionStart === 0 && el.selectionEnd === val.length;
        }
      } catch (_) {
        // For input type="number" where selectionStart is disallowed by browser:
        isAllSelected = el.dataset?.justFocused === 'true';
      }

      const isZero = val === '0' || val === '0.0' || val === '0.00' || val === '00';

      if (isZero || isAllSelected || (el.type === 'number' && val.length <= 1)) {
        e.preventDefault();
        delete el.dataset.justFocused;
        setInputValueNative(el, '');
      }
    },
    true
  );
}
