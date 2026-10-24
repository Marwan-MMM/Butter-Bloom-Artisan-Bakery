/* =============================================================================
   BUTTER & BLOOM — custom-cake.js
   -----------------------------------------------------------------------------
   The custom cake builder page:
     · renders the size + decoration chip groups (sizes come from site
       settings, with friendly built-in fallbacks)
     · keeps the sticky "Your Cake" summary and the price estimate in sync
       with every keystroke / change
     · validates the request client-side (required fields, date not in the
       past, reference image type + size) and submits it through
       BB.submitCakeRequest
     · swaps the whole builder for a success panel when the bakery has
       received the request — and never fakes success when something fails.

   Depends on the shared foundation (supabase.js + main.js): BB.settings,
   BB.formatPrice, BB.currencySymbol, BB.escapeHtml, BB.toast,
   BB.setupNoticeHtml, BB.errorStateHtml, BB.submitCakeRequest.
   ============================================================================= */

(function initCakeBuilder(BB) {
  'use strict';

  /* ---------------------------------------------------------------------------
     Constants
     --------------------------------------------------------------------------- */

  /* Used only when settings.custom_cake_sizes is missing or malformed. */
  const DEFAULT_SIZES = [
    { label: '6 inch — serves 8', price: 38 },
    { label: '8 inch — serves 14', price: 55 },
    { label: '10 inch — serves 22', price: 75 },
    { label: '12 inch — serves 32', price: 95 },
  ];

  const DECORATION_STYLES = ['Minimalist', 'Floral', 'Birthday fun', 'Themed', 'Wedding elegant', 'Custom creation'];

  /* Surcharge rows in settings.custom_cake_extras are matched to decoration
     styles by (normalized) label. "Written message" is the fixed row that
     applies once the message input has content. */
  const WRITTEN_MESSAGE_EXTRA = 'Written message';

  const MAX_MESSAGE_LENGTH = 40;
  const MAX_FILE_MB = 5;

  /* ---------------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------------- */

  /* Lowercase + strip everything that is not a letter or digit, so
     "Wedding elegant" matches a settings row labeled "Wedding". */
  function normalizeLabel(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /* Local (not UTC) yyyy-mm-dd for date min + "not in the past" checks. */
  function todayISO() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function getCheckedValue(name) {
    const checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : '';
  }

  function sizeList() {
    const fromSettings = BB.settings && BB.settings.custom_cake_sizes;
    if (Array.isArray(fromSettings) && fromSettings.length) {
      const cleaned = fromSettings
        .filter(function (row) { return row && row.label; })
        .map(function (row) { return { label: String(row.label), price: Number(row.price) || 0 }; });
      if (cleaned.length) return cleaned;
    }
    return DEFAULT_SIZES;
  }

  function extrasList() {
    const extras = BB.settings && BB.settings.custom_cake_extras;
    return Array.isArray(extras) ? extras : [];
  }

  /* Find the surcharge for a decoration style: exact normalized match first,
     then a prefix match in either direction ("Wedding" ~ "Wedding elegant").
     Anything else is free — the disclaimer makes clear it is an estimate. */
  function decorationSurcharge(styleLabel) {
    if (!styleLabel) return 0;
    const styleNorm = normalizeLabel(styleLabel);
    let match = extrasList().find(function (extra) { return normalizeLabel(extra.label) === styleNorm; });
    if (!match) {
      match = extrasList().find(function (extra) {
        const extraNorm = normalizeLabel(extra.label);
        if (extraNorm.length < 4 || styleNorm.length < 4) return false;
        return styleNorm.indexOf(extraNorm) === 0 || extraNorm.indexOf(styleNorm) === 0;
      });
    }
    return match ? (Number(match.price) || 0) : 0;
  }

  function writtenMessageSurcharge() {
    const match = extrasList().find(function (extra) {
      return normalizeLabel(extra.label) === normalizeLabel(WRITTEN_MESSAGE_EXTRA);
    });
    return match ? (Number(match.price) || 0) : 0;
  }

  /* ---------------------------------------------------------------------------
     Field error display (pairs with the .field-error / .is-invalid classes
     already provided by the foundation stylesheet)
     --------------------------------------------------------------------------- */
  function showError(element, errorEl, message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    errorEl.classList.add('is-visible');
    if (element && element.classList && element.type !== 'radio') {
      element.classList.add('is-invalid');
      element.setAttribute('aria-invalid', 'true');
    }
  }

  function clearError(element, errorEl) {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
    errorEl.classList.remove('is-visible');
    if (element && element.classList && element.type !== 'radio') {
      element.classList.remove('is-invalid');
      element.removeAttribute('aria-invalid');
    }
  }

  /* ---------------------------------------------------------------------------
     Chip groups (size + decoration style)
     --------------------------------------------------------------------------- */
  function renderChips(container, groupName, entries) {
    container.innerHTML = entries.map(function (entry) {
      const text = entry.priceHtml
        ? BB.escapeHtml(entry.label) + ' <span aria-hidden="true">—</span> ' + entry.priceHtml
        : BB.escapeHtml(entry.label);
      return (
        '<label class="chip">' +
          '<input type="radio" name="' + groupName + '" value="' + BB.escapeHtml(entry.label) + '"' +
          (entry.price != null ? ' data-price="' + entry.price + '"' : '') +
          '>' + text +
        '</label>'
      );
    }).join('');

    /* Keep the .is-active highlight in sync with the checked radio. */
    container.addEventListener('change', function () {
      container.querySelectorAll('.chip').forEach(function (chip) {
        chip.classList.toggle('is-active', chip.querySelector('input').checked);
      });
    });
  }

  /* ---------------------------------------------------------------------------
     Live summary + estimate
     --------------------------------------------------------------------------- */
  const summaryLinesEl = document.getElementById('summary-lines');
  const estimateEl = document.getElementById('estimate-price');
  let currentEstimate = 0;

  function summaryRow(label, value) {
    if (value) {
      return (
        '<div class="summary-line">' +
          '<span class="line-label">' + BB.escapeHtml(label) + '</span>' +
          '<span class="line-value">' + BB.escapeHtml(value) + '</span>' +
        '</div>'
      );
    }
    return (
      '<div class="summary-line empty">' +
        '<span class="line-label">' + BB.escapeHtml(label) + '</span>' +
        '<span class="line-value">not chosen yet</span>' +
      '</div>'
    );
  }

  function humanDate(value) {
    if (!value) return '';
    const parsed = new Date(value + 'T00:00:00');
    if (isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function updateSummary() {
    const sizeChecked = document.querySelector('input[name="cake-size"]:checked');
    const decoration = getCheckedValue('decoration-style');
    const fulfillment = getCheckedValue('cake-fulfillment');
    const fulfillmentText = fulfillment === 'delivery' ? 'Local delivery' : fulfillment === 'pickup' ? 'Pickup at the bakery' : '';
    const time = document.getElementById('cake-time').value;
    const date = document.getElementById('cake-date').value;
    const dateText = date ? humanDate(date) + (time && time !== 'Flexible' ? ' · ' + time : '') : '';

    const rows = [
      summaryRow('Cake type', document.getElementById('cake-type').value),
      summaryRow('Flavor', document.getElementById('cake-flavor').value),
      summaryRow('Size', sizeChecked ? sizeChecked.value : ''),
      summaryRow('Filling', document.getElementById('cake-filling').value === 'None' ? '' : document.getElementById('cake-filling').value),
      summaryRow('Frosting', document.getElementById('cake-frosting').value),
      summaryRow('Color', document.getElementById('cake-frosting-color').value.trim()),
      summaryRow('Decoration', decoration),
      summaryRow('Message', document.getElementById('cake-message').value.trim()),
      summaryRow('Handover', fulfillmentText),
      summaryRow('Date', dateText),
      summaryRow('Budget', document.getElementById('cake-budget').value),
    ];
    summaryLinesEl.innerHTML = rows.join('');
  }

  /* Estimate = size base price + decoration surcharge + written message fee. */
  function updateEstimate() {
    const sizeChecked = document.querySelector('input[name="cake-size"]:checked');
    const base = sizeChecked ? (Number(sizeChecked.getAttribute('data-price')) || 0) : 0;
    const decoration = decorationSurcharge(getCheckedValue('decoration-style'));
    const message = document.getElementById('cake-message').value.trim()
      ? writtenMessageSurcharge()
      : 0;
    currentEstimate = base + decoration + message;
    estimateEl.textContent = BB.formatPrice(currentEstimate);
  }

  /* ---------------------------------------------------------------------------
     Settings-driven details (sizes, budget labels, fulfillment, disclaimer)
     --------------------------------------------------------------------------- */
  function renderSizeChips() {
    const chips = sizeList().map(function (size) {
      return { label: size.label, price: size.price, priceHtml: BB.formatPrice(size.price) };
    });
    renderChips(document.getElementById('cake-size-chips'), 'cake-size', chips);
  }

  function renderDecorationChips() {
    renderChips(
      document.getElementById('cake-decoration-chips'),
      'decoration-style',
      DECORATION_STYLES.map(function (label) { return { label: label }; })
    );
  }

  function renderBudgetOptions() {
    const select = document.getElementById('cake-budget');
    const symbol = BB.currencySymbol();
    const ranges = [
      'Under ' + symbol + '50',
      symbol + '50 – ' + symbol + '80',
      symbol + '80 – ' + symbol + '120',
      symbol + '120 – ' + symbol + '200',
      symbol + '200 +',
    ];
    ranges.forEach(function (label) {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  /* Disable the fulfillment card(s) the bakery has switched off in settings. */
  function applyFulfillmentAvailability() {
    const settings = BB.settings || {};
    const cards = document.querySelectorAll('#cake-fulfillment .radio-card');
    let disabledSomething = false;

    cards.forEach(function (card) {
      const input = card.querySelector('input');
      const enabledFor = input.value === 'delivery' ? settings.delivery_enabled : settings.pickup_enabled;
      if (enabledFor === false) {
        card.classList.add('is-disabled');
        input.disabled = true;
        if (input.checked) input.checked = false;
        disabledSomething = true;
      }
    });

    /* If the pre-selected option became unavailable, fall back to the other. */
    if (!getCheckedValue('cake-fulfillment')) {
      const fallback = document.querySelector('#cake-fulfillment input:not(:disabled)');
      if (fallback) fallback.checked = true;
    }

    /* Sync the active highlight once, so a disabled pre-selected card does
       not keep a stale is-active class. */
    document.querySelectorAll('#cake-fulfillment .radio-card').forEach(function (card) {
      card.classList.toggle('is-active', card.querySelector('input').checked);
    });

    const hint = document.getElementById('cake-fulfillment-hint');
    if (hint) hint.hidden = !disabledSomething;
  }

  /* Keep the .is-active highlight on fulfillment radio cards. */
  function wireFulfillmentCards() {
    const group = document.getElementById('cake-fulfillment');
    group.addEventListener('change', function () {
      group.querySelectorAll('.radio-card').forEach(function (card) {
        card.classList.toggle('is-active', card.querySelector('input').checked);
      });
    });
  }

  /* ---------------------------------------------------------------------------
     Reference image validation (type + size, client-side convenience check)
     --------------------------------------------------------------------------- */
  const referenceInput = document.getElementById('cake-reference');

  function referenceProblem(file) {
    if (!file) return null;
    if (!file.type || file.type.indexOf('image/') !== 0) return 'Please choose an image file (JPG, PNG or WebP).';
    if (file.size > MAX_FILE_MB * 1024 * 1024) return 'That image is over 5 MB — please choose a smaller one.';
    return null;
  }

  function handleReferenceChange() {
    const errorEl = document.getElementById('cake-reference-error');
    const nameEl = document.getElementById('cake-reference-name');
    const file = referenceInput.files && referenceInput.files[0];
    const problem = referenceProblem(file);

    clearError(referenceInput, errorEl);

    if (problem) {
      /* Reject loudly but gently: explain, clear the input, keep the form usable. */
      BB.toast(problem, 'error');
      showError(referenceInput, errorEl, problem);
      referenceInput.value = '';
      nameEl.hidden = true;
      nameEl.textContent = '';
      return;
    }

    if (file) {
      nameEl.textContent = 'Attached: ' + file.name;
      nameEl.hidden = false;
    } else {
      nameEl.hidden = true;
      nameEl.textContent = '';
    }
  }

  /* ---------------------------------------------------------------------------
     Validation (returns the list of problems; marks fields when asked)
     --------------------------------------------------------------------------- */
  function collectValidation(mark) {
    const problems = [];

    function check(element, errorElId, message, valid) {
      const errorEl = document.getElementById(errorElId);
      if (valid) {
        if (mark) clearError(element, errorEl);
        return;
      }
      problems.push({ element: element, errorEl: errorEl, message: message });
      if (mark) showError(element, errorEl, message);
    }

    const today = todayISO();

    check(
      document.getElementById('cake-flavor'), 'cake-flavor-error',
      'Please choose a flavor.',
      Boolean(document.getElementById('cake-flavor').value)
    );

    const sizeChecked = document.querySelector('input[name="cake-size"]:checked');
    /* Focus target: any input of the group (radios are keyboard-focusable
       even when unchecked, and get no is-invalid styling). */
    const sizeFocus = document.querySelector('input[name="cake-size"]');
    check(
      sizeFocus, 'cake-size-error',
      'Please choose a size.',
      Boolean(sizeChecked)
    );

    const decorationChecked = document.querySelector('input[name="decoration-style"]:checked');
    const decorationFocus = document.querySelector('input[name="decoration-style"]');
    check(
      decorationFocus, 'cake-decoration-error',
      'Please choose a decoration style.',
      Boolean(decorationChecked)
    );

    const dateInput = document.getElementById('cake-date');
    check(
      dateInput, 'cake-date-error',
      dateInput.value && dateInput.value < today
        ? 'That date is in the past — please pick today or later.'
        : 'Please pick a date that is today or later.',
      Boolean(dateInput.value) && dateInput.value >= today
    );

    const nameInput = document.getElementById('cake-name');
    check(
      nameInput, 'cake-name-error',
      'Please tell us your name.',
      Boolean(nameInput.value.trim())
    );

    const phoneInput = document.getElementById('cake-phone');
    check(
      phoneInput, 'cake-phone-error',
      'We need a phone number to confirm your request.',
      Boolean(phoneInput.value.trim())
    );

    /* The reference file is optional, but a bad one must not reach the bakery. */
    const file = referenceInput.files && referenceInput.files[0];
    const fileProblem = referenceProblem(file);
    check(
      referenceInput, 'cake-reference-error',
      fileProblem || '',
      !fileProblem
    );

    return problems;
  }

  /* ---------------------------------------------------------------------------
     Submit flow
     --------------------------------------------------------------------------- */
  const submitButton = document.getElementById('cake-submit');
  const SUBMIT_LABEL = 'Send Request to the Bakery';
  let submitAttempted = false;

  function setSending(sending) {
    submitButton.disabled = sending;
    submitButton.innerHTML = sending
      ? '<span class="spinner" aria-hidden="true"></span> Sending request...'
      : SUBMIT_LABEL;
  }

  function showSuccessPanel(request) {
    const section = document.getElementById('cake-builder-section');
    const dateValue = document.getElementById('cake-date').value;
    const timeValue = document.getElementById('cake-time').value;

    /* Short, honest reference: the Supabase row id when we got one. */
    let referenceHtml = '';
    if (request && request.id) {
      const shortId = String(request.id).replace(/-/g, '').slice(0, 8).toUpperCase();
      referenceHtml = '<p class="order-number-chip">Request #' + BB.escapeHtml(shortId) + '</p>';
    }

    let whenHtml = '';
    if (dateValue) {
      whenHtml = '<p>Your request for <strong>' + BB.escapeHtml(humanDate(dateValue)) +
        (timeValue && timeValue !== 'Flexible' ? ' · ' + BB.escapeHtml(timeValue) : '') +
        '</strong> is now with our bakers.</p>';
    }

    section.innerHTML =
      '<div class="container">' +
        '<div class="checkout-success" role="status" tabindex="-1">' +
          '<div class="success-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5"/></svg>' +
          '</div>' +
          '<h2>Request received!</h2>' +
          referenceHtml +
          whenHtml +
          '<p class="text-muted">Thank you for designing with us — we are already reading your notes.</p>' +
          '<p class="summary-disclaimer" style="margin-top: 14px;">This is a request, not a confirmed order — our bakers will call you to confirm design, final price and availability. No payment has been taken.</p>' +
          '<div class="notfound-actions">' +
            '<a class="btn btn-primary" href="index.html">Back to home</a>' +
            '<a class="btn btn-outline" href="shop.html">Browse the shop</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    section.querySelector('.checkout-success').focus();
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    submitAttempted = true;

    const problems = collectValidation(true);
    if (problems.length) {
      BB.toast('Please complete the highlighted fields', 'error');
      /* Focus the first problem (always a real element: chip groups pass
         their first radio as the focus target). */
      if (problems[0].element) problems[0].element.focus();
      return;
    }

    const file = referenceInput.files && referenceInput.files[0];
    const payload = {
      customer_name: document.getElementById('cake-name').value.trim(),
      phone: document.getElementById('cake-phone').value.trim(),
      email: document.getElementById('cake-email').value.trim() || null,
      cake_type: document.getElementById('cake-type').value,
      flavor: document.getElementById('cake-flavor').value,
      size_label: getCheckedValue('cake-size'),
      filling: document.getElementById('cake-filling').value,
      frosting_type: document.getElementById('cake-frosting').value,
      frosting_color: document.getElementById('cake-frosting-color').value.trim() || null,
      decoration_style: getCheckedValue('decoration-style'),
      message_on_cake: document.getElementById('cake-message').value.trim() || null,
      fulfillment_type: getCheckedValue('cake-fulfillment'),
      requested_date: document.getElementById('cake-date').value,
      preferred_time: document.getElementById('cake-time').value,
      budget_range: document.getElementById('cake-budget').value || null,
      allergies: document.getElementById('cake-allergies').value.trim() || null,
      special_instructions: document.getElementById('cake-instructions').value.trim() || null,
      referenceFile: file || null,
      estimated_price: currentEstimate,
    };

    const inlineError = document.getElementById('cake-submit-error');
    inlineError.hidden = true;
    inlineError.innerHTML = '';
    setSending(true);

    try {
      const request = await BB.submitCakeRequest(payload);
      showSuccessPanel(request);
    } catch (error) {
      /* Real failure — say so in a toast AND inline, then hand control back. */
      BB.toast(error.message || 'We could not send your request. Please try again.', 'error');
      inlineError.innerHTML = BB.errorStateHtml(
        'Your request could not be sent: ' + (error.message || 'please try again in a moment.')
      );
      inlineError.hidden = false;
      setSending(false);
    }
  }

  /* ---------------------------------------------------------------------------
     Wiring + boot
     --------------------------------------------------------------------------- */
  function init() {
    /* Supabase not configured: show the setup notice (filled by main.js into
       the .needs-data slot) instead of a form that could never submit. */
    if (!BB.configured) {
      const slot = document.getElementById('cake-setup-slot');
      const layout = document.getElementById('cake-layout');
      if (slot && !slot.innerHTML) slot.innerHTML = BB.setupNoticeHtml();
      if (slot) slot.hidden = false;
      if (layout) layout.hidden = true;
      return;
    }

    const form = document.getElementById('cake-form');

    /* Settings-driven pieces */
    renderSizeChips();
    renderDecorationChips();
    renderBudgetOptions();
    applyFulfillmentAvailability();
    wireFulfillmentCards();

    /* Disclaimer text from settings, with the friendly fallback. */
    const disclaimerEl = document.getElementById('cake-disclaimer');
    if (disclaimerEl) {
      disclaimerEl.textContent = (BB.settings && BB.settings.custom_cake_note) ||
        'Custom cake prices are estimates. Final pricing and availability are confirmed by our bakers after reviewing your request.';
    }

    /* Dates in the past cannot be picked. */
    document.getElementById('cake-date').min = todayISO();

    /* Live message counter */
    const messageInput = document.getElementById('cake-message');
    const counter = document.getElementById('cake-message-counter');
    messageInput.addEventListener('input', function () {
      const length = messageInput.value.length;
      counter.textContent = length + ' / ' + MAX_MESSAGE_LENGTH;
      counter.classList.toggle('is-over', length > MAX_MESSAGE_LENGTH);
    });

    /* Reference image checks as soon as a file is chosen */
    referenceInput.addEventListener('change', handleReferenceChange);

    /* The summary + estimate follow every change and keystroke. */
    const onActivity = function () {
      updateSummary();
      updateEstimate();
      if (submitAttempted) collectValidation(true);
    };
    form.addEventListener('change', onActivity);
    form.addEventListener('input', onActivity);

    form.addEventListener('submit', handleSubmit);

    /* Paint the initial (mostly empty) summary. */
    updateSummary();
    updateEstimate();
  }

  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(init).catch(function (error) {
      console.warn('Cake builder failed to initialise:', error);
      init();
    });
  });
})(window.BB);
