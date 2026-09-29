/**
 * Universal 6-Key Keyboard Navigation & Modal Context Isolation Engine
 * Supported Keys: Enter, Shift+Enter, Up, Down, Left, Right + Esc, Tab trapping
 *
 * Guarantees:
 * 1. Scope Isolation: Keystrokes inside a popup/modal operate ONLY on that popup,
 *    never leaking or triggering buttons on the background/previous page.
 * 2. Popup Scroll: ArrowUp and ArrowDown smoothly scroll the popup's content.
 * 3. Page Navigation: Consistent navigation across room cards, table cards, menu cards,
 *    form inputs, and category/filter tabs.
 */

// Helper to find the topmost visible modal/popup in the document
export function getActiveModal() {
  if (typeof document === 'undefined') return null;

  const selector = [
    '[role="dialog"]',
    '.modal-overlay',
    '.modal-overlay.active',
    '.modal-backdrop',
    '.modal-backdrop-fixed',
    '.custom-confirm-overlay',
    '#custom-confirm-modal',
    '#rest-settle-modal',
    '#checkin-modal-overlay',
    '#folio-settlement-modal-overlay',
    '#image-lightbox-modal',
    '.app-modal-overlay',
    '.dialog-overlay'
  ].join(', ');

  const standardOverlays = Array.from(document.querySelectorAll(selector)).filter((el) => {
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity || '1') > 0 &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    );
  });

  // Also check for any high z-index fixed containers (modals without standard class names)
  const fixedOverlays = Array.from(document.querySelectorAll('body > div, #root > div')).filter((el) => {
    const style = window.getComputedStyle(el);
    const z = parseInt(style.zIndex, 10) || 0;
    return (
      (style.position === 'fixed' || style.position === 'absolute') &&
      z >= 100 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      el.offsetWidth > 100 &&
      el.offsetHeight > 100
    );
  });

  const combined = Array.from(new Set([...standardOverlays, ...fixedOverlays]));
  if (combined.length === 0) return null;

  // Return the one with highest z-index or the last one in the DOM
  combined.sort((a, b) => {
    const za = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
    const zb = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
    return zb - za;
  });

  return combined[0];
}

// Find scrollable container inside a modal or view
function getScrollableContainer(container) {
  if (!container) return window;

  const candidates = Array.from(
    container.querySelectorAll('.modal-body, .modal-container, .checkin-modal-scrollable, .menu-items-grid, [style*="overflow"], [class*="scroll"]')
  );

  for (const el of candidates) {
    if (el.scrollHeight > el.clientHeight + 8 && window.getComputedStyle(el).overflowY !== 'hidden') {
      return el;
    }
  }

  if (container.scrollHeight > container.clientHeight + 8) {
    return container;
  }

  return container.querySelector('.modal-body') || container;
}

// Get navigable focusable elements within a root container
function getFocusableElements(root) {
  if (!root) return [];
  const selector = [
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'button:not([disabled])',
    '[tabindex="0"]:not([disabled])',
    '.room-card',
    '.table-card-dotted',
    '.menu-item-card'
  ].join(', ');

  return Array.from(root.querySelectorAll(selector)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  });
}

// Find 2D grid position of elements for intuitive Up/Down/Left/Right arrow navigation
function navigateGrid(items, currentEl, direction) {
  if (!items || items.length === 0) return null;
  const currentIndex = items.indexOf(currentEl);
  if (currentIndex === -1) return items[0];

  const currentRect = currentEl.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;

  let bestTarget = null;
  let bestDistance = Infinity;

  items.forEach((item) => {
    if (item === currentEl) return;
    const rect = item.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = centerX - currentCenterX;
    const dy = centerY - currentCenterY;

    let isCandidate = false;
    let dist = Infinity;

    if (direction === 'right' && dx > 8) {
      isCandidate = true;
      dist = dx + Math.abs(dy) * 2;
    } else if (direction === 'left' && dx < -8) {
      isCandidate = true;
      dist = Math.abs(dx) + Math.abs(dy) * 2;
    } else if (direction === 'down' && dy > 8) {
      isCandidate = true;
      dist = dy + Math.abs(dx) * 1.5;
    } else if (direction === 'up' && dy < -8) {
      isCandidate = true;
      dist = Math.abs(dy) + Math.abs(dx) * 1.5;
    }

    if (isCandidate && dist < bestDistance) {
      bestDistance = dist;
      bestTarget = item;
    }
  });

  return bestTarget;
}

// Helper to detect if currently focused element is an input with an active autocomplete dropdown
function isAutocompleteActive(activeEl, activeModal) {
  // Check if activeModal or document has an open autocomplete dropdown
  const hasDropdownVisible = Boolean(
    activeModal?.querySelector('.autocomplete-dropdown:not([style*="display: none"]), .btc-suggestion-item') ||
    document.querySelector('.autocomplete-dropdown:not([style*="display: none"]), .btc-suggestion-item')
  );

  if (!hasDropdownVisible) return false;

  // If dropdown is visible, check if focus is within autocomplete or on body/unfocused
  if (!activeEl || activeEl === document.body) return true;

  if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
    return true;
  }

  if (activeEl.closest?.('[data-autocomplete-container], .autocomplete-container, .autocomplete-dropdown')) {
    return true;
  }

  return false;
}

export function initGlobalKeyboardNavigation() {
  if (typeof window === 'undefined') return;

  window.addEventListener(
    'keydown',
    (e) => {
      const activeModal = getActiveModal();
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');

      // =========================================================================
      // CASE 1: MODAL IS OPEN ("buoon s should work on current page not previous page")
      // =========================================================================
      if (activeModal) {
        // If an autocomplete dropdown is active, let the input handle ArrowDown, ArrowUp, Enter, Escape!
        if (isAutocompleteActive(activeEl, activeModal)) {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'NumpadEnter', 'Escape', 'Tab'].includes(e.key)) {
            // Direct failsafe for Enter: click the currently highlighted item immediately
            if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
              const highlighted = activeModal.querySelector('.btc-suggestion-item.active-highlight, .btc-suggestion-item');
              if (highlighted) {
                e.preventDefault();
                highlighted.click();
                return;
              }
            }
            // Do NOT call e.stopPropagation() or preventDefault! Allow event to reach the input's onKeyDown!
            return;
          }
        }

        // Prevent background listeners on previous pages from receiving this event
        e.stopPropagation();

        const scrollContainer = getScrollableContainer(activeModal);
        const modalFocusables = getFocusableElements(activeModal);

        // --- UP / DOWN: SCROLL THE POPUP ("if popup is opening should scroll") ---
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // If active element is an input with an active autocomplete dropdown, let input handle navigation!
          if (isAutocompleteActive(activeEl, activeModal)) {
            return;
          }

          // In native select or textarea with multiple lines, allow standard behavior
          if (activeEl && activeEl.tagName === 'SELECT') return;
          if (activeEl && activeEl.tagName === 'TEXTAREA') return;

          // If focused in a form input, navigate between form fields
          if (isInputFocused && modalFocusables.length > 0) {
            const inputs = modalFocusables.filter((el) =>
              ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
            );
            const idx = inputs.indexOf(activeEl);

            if (e.key === 'ArrowDown') {
              if (idx !== -1 && idx < inputs.length - 1) {
                e.preventDefault();
                inputs[idx + 1].focus();
                inputs[idx + 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
              }
            } else if (e.key === 'ArrowUp') {
              if (idx > 0) {
                e.preventDefault();
                inputs[idx - 1].focus();
                inputs[idx - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
              }
            }
          }

          // Otherwise, scroll the popup smoothly
          e.preventDefault();
          const scrollDelta = e.key === 'ArrowDown' ? 140 : -140;
          if (scrollContainer) {
            scrollContainer.scrollBy({ top: scrollDelta, behavior: 'smooth' });
          }
          return;
        }

        // --- ENTER: FORM ADVANCE OR CONFIRM / SUBMIT ---
        if (e.key === 'Enter' && !e.shiftKey) {
          // If active element is an input with an active autocomplete dropdown, let input select the item!
          if (isAutocompleteActive(activeEl, activeModal)) {
            const highlighted = activeModal.querySelector('.btc-suggestion-item.active-highlight, .btc-suggestion-item');
            if (highlighted) {
              e.preventDefault();
              highlighted.click();
            }
            return;
          }

          // If a button is focused, trigger it
          if (activeEl && activeEl.tagName === 'BUTTON') {
            e.preventDefault();
            activeEl.click();
            return;
          }

          // If in an input/select
          if (isInputFocused && modalFocusables.length > 0) {
            const form = activeEl.closest('form');
            const submitBtn =
              form?.querySelector('button[type="submit"], #btn-submit-manager-unlock, #btn-submit-modal, .btn-primary, .btn-save') ||
              activeModal.querySelector('button[type="submit"], #btn-submit-manager-unlock, .btn-custom-ok, .pos-btn-settle, .btn-primary, #btn-side-checkin-next, #btn-dining-settle-submit, .btn-save');

            // Find only inputs/selects to navigate between (never jump focus to buttons like Cancel!)
            const inputs = modalFocusables.filter((el) =>
              ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
            );
            const inputIdx = inputs.indexOf(activeEl);

            // If input is a password field or the last input in the form/modal, SUBMIT immediately!
            if (activeEl.type === 'password' || inputIdx === -1 || inputIdx === inputs.length - 1) {
              if (submitBtn) {
                e.preventDefault();
                submitBtn.click();
                return;
              }
              if (form) {
                e.preventDefault();
                if (typeof form.requestSubmit === 'function') {
                  form.requestSubmit();
                } else {
                  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
                return;
              }
            }

            // Otherwise advance to the next input field
            if (inputIdx !== -1 && inputIdx < inputs.length - 1) {
              const nextInput = inputs[inputIdx + 1];
              e.preventDefault();
              nextInput.focus();
              nextInput.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              return;
            }

            // If submit button exists, trigger it
            if (submitBtn) {
              e.preventDefault();
              submitBtn.click();
              return;
            }
          }

          // If no element focused inside modal, focus first input or primary button
          if (!activeModal.contains(activeEl)) {
            const first = modalFocusables[0];
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
          return;
        }

        // --- SHIFT + ENTER: FORM BACKWARD OR CANCEL / CLOSE ---
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          // In check-in wizard or multi-stage modals, prioritize stepping back one stage
          const wizardBackBtn = activeModal.querySelector('#btn-checkin-top-back, #btn-side-checkin-prev');
          if (wizardBackBtn) {
            wizardBackBtn.click();
            return;
          }

          if (isInputFocused && modalFocusables.length > 0) {
            const currentIdx = modalFocusables.indexOf(activeEl);
            if (currentIdx > 0) {
              const prevFocusable = modalFocusables[currentIdx - 1];
              prevFocusable.focus();
              prevFocusable.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              return;
            }
          }

          // Trigger cancel / close button if at the start
          const cancelBtn = activeModal.querySelector(
            '.btn-custom-cancel, .universal-back-btn, .modal-close-btn, #btn-dining-settle-back'
          );
          if (cancelBtn) {
            cancelBtn.click();
          }
          return;
        }

        // --- LEFT / RIGHT: SWITCH BUTTON OPTIONS / PILLS / TABS IN MODAL ---
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          // If in a text input and text is not at boundary, permit text editing
          if (isInputFocused && activeEl.tagName === 'INPUT' && (activeEl.type === 'text' || !activeEl.type)) {
            const len = activeEl.value?.length || 0;
            if (activeEl.selectionStart !== activeEl.selectionEnd) return;
            if (e.key === 'ArrowLeft' && activeEl.selectionStart > 0) return;
            if (e.key === 'ArrowRight' && activeEl.selectionStart < len) return;
          }

          // Find option buttons / pills / radio groups / tabs in the modal
          const tabs = Array.from(
            activeModal.querySelectorAll(
              '[role="tab"], .pill-tab, .payment-mode-pill, button.step-tab, .tab-btn, .modern-channel-card, .channel-card, .doc-option-card, .ota-chip, .meal-plan-card, .filter-chip, .btn-custom-cancel, .btn-custom-ok'
            )
          ).filter((el) => window.getComputedStyle(el).display !== 'none' && !el.disabled);

          if (tabs.length > 1) {
            e.preventDefault();
            let curr = tabs.indexOf(activeEl);
            if (curr === -1) {
              // Try to find the currently active tab
              curr = tabs.findIndex(t => t.classList.contains('active') || t.classList.contains('selected') || t.getAttribute('aria-selected') === 'true');
            }
            if (curr === -1) curr = 0;
            const nextIdx =
              e.key === 'ArrowRight'
                ? (curr + 1) % tabs.length
                : (curr - 1 + tabs.length) % tabs.length;
            tabs[nextIdx].focus();
            tabs[nextIdx].click();
            return;
          }
        }

        // --- ESCAPE: STEP BACK ONE STAGE IN WIZARD OR CLOSE TOPMOST MODAL ---
        if (e.key === 'Escape') {
          // If in an active autocomplete dropdown, let input dismiss dropdown without closing modal!
          if (isAutocompleteActive(activeEl, activeModal)) {
            return;
          }

          e.preventDefault();
          // Check for active image lightbox first
          const lightboxClose = document.querySelector('#image-lightbox-modal .modal-close-btn, .lightbox-close-btn');
          if (lightboxClose) {
            lightboxClose.click();
            return;
          }

          // In checkin wizard, prioritize stepping back one stage (#btn-checkin-top-back or #btn-side-checkin-prev)
          const wizardBackBtn = activeModal.querySelector('#btn-checkin-top-back, #btn-side-checkin-prev');
          if (wizardBackBtn) {
            wizardBackBtn.click();
            return;
          }

          const closeBtn = activeModal.querySelector(
            '.universal-back-btn, .modal-close-btn, .universal-close-btn, .btn-custom-cancel'
          );
          if (closeBtn) {
            closeBtn.click();
          }
          return;
        }

        // --- TAB TRAPPING INSIDE MODAL (Common Sense Enhancement) ---
        if (e.key === 'Tab' && modalFocusables.length > 0) {
          const first = modalFocusables[0];
          const last = modalFocusables[modalFocusables.length - 1];

          if (e.shiftKey) {
            if (activeEl === first || !activeModal.contains(activeEl)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (activeEl === last || !activeModal.contains(activeEl)) {
              e.preventDefault();
              first.focus();
            }
          }
          return;
        }

        return; // Finished modal handling
      }

      // =========================================================================
      // CASE 2: NO MODAL OPEN (PAGE-LEVEL 6-KEY NAVIGATION)
      // =========================================================================

      // --- SHIFT + ENTER: UNIVERSAL BACK TO MAIN VIEW ---
      if (e.key === 'Enter' && e.shiftKey) {
        // Table Session back to Floor
        const sessionBackBtn = document.querySelector('#btn-session-back, .universal-back-btn');
        if (sessionBackBtn) {
          e.preventDefault();
          sessionBackBtn.click();
          return;
        }

        // Folio back to Hospitality Rooms
        const folioBackBtn = document.querySelector('#btn-folio-back');
        if (folioBackBtn) {
          e.preventDefault();
          folioBackBtn.click();
          return;
        }

        // History back to Rooms
        const hospBackRooms = document.querySelector('#btn-hosp-back-rooms');
        if (hospBackRooms) {
          e.preventDefault();
          hospBackRooms.click();
          return;
        }
      }

      // --- ENTER: SELECT FOCUSED CARD / TRIGGER PRIMARY ACTION ---
      if (e.key === 'Enter' && !e.shiftKey) {
        // Room Card
        if (activeEl && activeEl.classList?.contains('room-card')) {
          e.preventDefault();
          activeEl.click();
          return;
        }

        // Table Card
        if (activeEl && activeEl.classList?.contains('table-card-dotted')) {
          e.preventDefault();
          activeEl.click();
          return;
        }

        // Menu Item Card
        if (activeEl && activeEl.classList?.contains('menu-item-card')) {
          e.preventDefault();
          activeEl.click();
          return;
        }

        // Form inputs: advance to next input
        if (isInputFocused && activeEl.tagName !== 'TEXTAREA') {
          const form = activeEl.closest('form') || activeEl.closest('.form-container') || document.body;
          const focusables = getFocusableElements(form).filter((el) =>
            ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)
          );
          const idx = focusables.indexOf(activeEl);
          if (idx !== -1 && idx < focusables.length - 1) {
            e.preventDefault();
            focusables[idx + 1].focus();
            focusables[idx + 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
        }
      }

      // --- ARROW KEYS: GRID NAVIGATION (ROOMS, TABLES, DISHES) ---
      const isCardFocused =
        activeEl &&
        (activeEl.classList?.contains('room-card') ||
          activeEl.classList?.contains('table-card-dotted') ||
          activeEl.classList?.contains('menu-item-card'));

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const direction = e.key.replace('Arrow', '').toLowerCase();

        // 1. If focused on a card grid
        if (isCardFocused) {
          const cardClass = activeEl.classList.contains('room-card')
            ? '.room-card'
            : activeEl.classList.contains('table-card-dotted')
            ? '.table-card-dotted'
            : '.menu-item-card';

          const allCards = Array.from(document.querySelectorAll(cardClass)).filter(
            (c) => window.getComputedStyle(c).display !== 'none'
          );

          const nextCard = navigateGrid(allCards, activeEl, direction);
          if (nextCard) {
            e.preventDefault();
            nextCard.focus();
            nextCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
        }

        // 2. If navigating filter tabs / categories horizontally
        if (!isInputFocused && (direction === 'left' || direction === 'right')) {
          const tabs = Array.from(
            document.querySelectorAll(
              '.filter-tab-pill, .pos-cat-btn, .hosp-filter-btn, .nav-subtab-btn, button.manage-tab-btn'
            )
          ).filter((t) => window.getComputedStyle(t).display !== 'none');

          if (tabs.length > 1 && tabs.includes(activeEl)) {
            e.preventDefault();
            const curr = tabs.indexOf(activeEl);
            const nextIdx =
              direction === 'right'
                ? (curr + 1) % tabs.length
                : (curr - 1 + tabs.length) % tabs.length;
            tabs[nextIdx].focus();
            tabs[nextIdx].click();
            return;
          }
        }

        // 3. Page Smooth Scrolling on Up / Down when not in input
        if (!isInputFocused && (direction === 'up' || direction === 'down')) {
          const scrollable =
            document.querySelector('#restaurant-session-menu-grid') ||
            document.querySelector('#view-hospitality') ||
            document.querySelector('#view-restaurant') ||
            window;

          e.preventDefault();
          const delta = direction === 'down' ? 140 : -140;
          if (scrollable && scrollable.scrollBy) {
            scrollable.scrollBy({ top: delta, behavior: 'smooth' });
          } else {
            window.scrollBy({ top: delta, behavior: 'smooth' });
          }
        }
      }
    },
    true // Capture phase: intercepts early to enforce modal boundaries
  );
}
