/**
 * Global Input Enhancements & Strict Validation:
 * 1. Scrolling up/down over number inputs does NOT change their values.
 * 2. Any input field automatically selects all content on focus so typing replaces it.
 * 3. Pressing Backspace on selected text or on '0' completely clears the field (even '0').
 * 4. Phone/Mobile inputs:
 *    - Strictly blocks all alphabets, symbols, spaces, and punctuation on typing (unable to type alphabets).
 *    - Strictly enforces maximum 10 digits (cannot type extra numbers beyond 10 digits).
 *    - Cleans pasted text to 10 digits max.
 * 5. Name inputs (guest, visitor, staff, cleaner, contact person):
 *    - Strictly blocks all numbers 0-9 on typing (unable to type numbers).
 *    - Cleans pasted text by stripping any numbers.
 */

// Helper to trigger React-compatible input change event
export const setInputValueNative = (input, val) => {
  if (!input) return;
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

/**
 * Checks whether an HTML input represents a phone/mobile number field.
 */
export const isPhoneInput = (el) => {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.type === 'tel') return true;

  const dataInputType = (el.dataset?.inputType || '').toLowerCase();
  if (['phone', 'tel', 'mobile'].includes(dataInputType)) return true;

  const name = (el.name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const placeholder = (el.placeholder || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

  return (
    name.includes('phone') || name.includes('mobile') ||
    id.includes('phone') || id.includes('mobile') ||
    placeholder.includes('phone') || placeholder.includes('mobile') ||
    ariaLabel.includes('phone') || ariaLabel.includes('mobile')
  );
};

/**
 * Checks whether an HTML input represents a person name field (guest, visitor, cleaner, staff, contact person).
 * Explicitly excludes usernames, company names, dishes, categories, files, search.
 */
export const isPersonNameInput = (el) => {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.type !== 'text') return false;

  const dataInputType = (el.dataset?.inputType || '').toLowerCase();
  if (['name', 'person-name', 'guest-name', 'visitor-name'].includes(dataInputType)) return true;

  const name = (el.name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const placeholder = (el.placeholder || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

  // Exclude non-person names
  if (
    name.includes('user') || id.includes('user') || placeholder.includes('user') ||
    name.includes('company') || id.includes('company') || placeholder.includes('company') ||
    name.includes('dish') || name.includes('menu') || name.includes('category') || name.includes('cat_') ||
    name.includes('search') || id.includes('search') || placeholder.includes('search') ||
    name.includes('file') || id.includes('file') ||
    name.includes('token') || id.includes('token') ||
    name.includes('table') || id.includes('table') ||
    name.includes('rate') || id.includes('rate')
  ) {
    return false;
  }

  return (
    name.includes('guest') || id.includes('guest') || placeholder.includes('guest') ||
    name.includes('visitor') || id.includes('visitor') || placeholder.includes('visitor') ||
    name.includes('cleaner') || id.includes('cleaner') || placeholder.includes('cleaner') ||
    name.includes('staff') || id.includes('staff') || placeholder.includes('staff') ||
    name.includes('contact_person') || id.includes('contact_person') || placeholder.includes('contact person') ||
    name.includes('full_name') || name.includes('fullname') || placeholder.includes('full name') ||
    placeholder.includes('employee name') || placeholder.includes('rahul') || placeholder.includes('aamir') ||
    ariaLabel.includes('name')
  );
};

/**
 * OnKeyDown handler to block non-numeric keys and prevent typing extra numbers beyond maxDigits.
 */
export const blockNonNumericKeys = (e, maxDigits = 10) => {
  // Allow navigation and control keys
  if ([
    'Backspace', 'Tab', 'Enter', 'Delete', 'Escape',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End'
  ].includes(e.key)) {
    return;
  }

  // Allow keyboard shortcuts (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z, etc.)
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }

  // Allow function keys (F1 - F12)
  if (e.key && e.key.length > 1) {
    return;
  }

  // Block any non-digit character (letters, spaces, symbols)
  if (!/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    return;
  }

  // Block extra digits if already reached maxDigits (unless user highlighted text to replace)
  const el = e.target;
  if (el) {
    const val = String(el.value || '');
    const digitsOnly = val.replace(/\D/g, '');
    const hasSelection = typeof el.selectionStart === 'number' && el.selectionStart !== el.selectionEnd;
    if (digitsOnly.length >= maxDigits && !hasSelection) {
      e.preventDefault();
    }
  }
};

/**
 * Strips non-digits and truncates to maxDigits (default 10).
 */
export const sanitizePhoneInput = (val, maxDigits = 10) => {
  return String(val || '').replace(/\D/g, '').slice(0, maxDigits);
};

/**
 * OnKeyDown handler to block numeric keys (0-9) from being typed into name fields.
 */
export const blockNumericKeys = (e) => {
  // Allow navigation and control keys
  if ([
    'Backspace', 'Tab', 'Enter', 'Delete', 'Escape',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End'
  ].includes(e.key)) {
    return;
  }

  // Allow keyboard shortcuts
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }

  // Allow function keys
  if (e.key && e.key.length > 1) {
    return;
  }

  // Block digits 0-9
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
  }
};

/**
 * Strips all digits 0-9 from a string.
 */
export const sanitizeNameInput = (val) => {
  return String(val || '').replace(/[0-9]/g, '');
};

/**
 * Global Initializer
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

  // 2. Auto-select text on focus so user can immediately type or erase
  let justFocusedElement = null;

  document.addEventListener(
    'focus',
    (e) => {
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;

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

  // 3. Global Keydown Handler:
  // - Clear '0' or selected text on Backspace/Delete
  // - Enforce phone number restrictions (no alphabets, max 10 digits)
  // - Enforce person name restrictions (no numbers 0-9)
  document.addEventListener(
    'keydown',
    (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'INPUT') return;

      // 3A. Clear zero or selected text on Backspace/Delete
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const val = String(el.value || '');
        let isAllSelected = false;
        try {
          if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
            isAllSelected = el.selectionStart === 0 && el.selectionEnd === val.length;
          }
        } catch (_) {
          isAllSelected = el.dataset?.justFocused === 'true';
        }

        const isZero = val === '0' || val === '0.0' || val === '0.00' || val === '00';
        if (isZero || isAllSelected || (el.type === 'number' && val.length <= 1)) {
          e.preventDefault();
          delete el.dataset.justFocused;
          setInputValueNative(el, '');
          return;
        }
      }

      // 3B. Strict Phone Input Rule: No alphabets, max 10 digits
      if (isPhoneInput(el)) {
        blockNonNumericKeys(e, 10);
        return;
      }

      // 3C. Strict Name Input Rule: No numbers
      if (isPersonNameInput(el)) {
        blockNumericKeys(e);
        return;
      }
    },
    true
  );

  // 4. Global Input & Paste Sanitizer:
  // Catch any pasted or autofilled values and sanitize immediately
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'INPUT') return;

      // Phone Input Paste / Autofill Sanitization
      if (isPhoneInput(el)) {
        const currentVal = el.value || '';
        const cleaned = sanitizePhoneInput(currentVal, 10);
        if (currentVal !== cleaned) {
          setInputValueNative(el, cleaned);
        }
        return;
      }

      // Person Name Input Paste / Autofill Sanitization
      if (isPersonNameInput(el)) {
        const currentVal = el.value || '';
        const cleaned = sanitizeNameInput(currentVal);
        if (currentVal !== cleaned) {
          setInputValueNative(el, cleaned);
        }
        return;
      }
    },
    true
  );
}
