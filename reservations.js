/* =============================================================================
   BUTTER & BLOOM — reservations.js
   -----------------------------------------------------------------------------
   Reservations page:
     · fills the info cards (opening hours, phone/email) from site settings
     · validates the reservation request (name, phone, date not in the past,
       party size between 1 and 40)
     · submits through BB.submitReservation and swaps the form for a success
       panel — never faking success when the request fails.

   Depends on the shared foundation (supabase.js + main.js).
   ============================================================================= */

(function initReservations(BB) {
  'use strict';

  const PARTY_MIN = 1;
  const PARTY_MAX = 40;

  /* Local (not UTC) yyyy-mm-dd for the date min + "not in the past" check. */
  function todayISO() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function humanDate(value) {
    const parsed = new Date(value + 'T00:00:00');
    if (isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* ---------------------------------------------------------------------------
     Field error display
     --------------------------------------------------------------------------- */
  function showError(element, errorElId, message) {
    const errorEl = document.getElementById(errorElId);
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    errorEl.classList.add('is-visible');
    if (element) {
      element.classList.add('is-invalid');
      element.setAttribute('aria-invalid', 'true');
    }
  }

  function clearError(element, errorElId) {
    const errorEl = document.getElementById(errorElId);
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
    errorEl.classList.remove('is-visible');
    if (element) {
      element.classList.remove('is-invalid');
      element.removeAttribute('aria-invalid');
    }
  }

  /* ---------------------------------------------------------------------------
     Settings-driven info cards
     --------------------------------------------------------------------------- */
  function renderInfoCards() {
    const settings = BB.settings;
    if (!settings) return;

    const hoursEl = document.getElementById('reservation-hours');
    if (hoursEl && Array.isArray(settings.opening_hours) && settings.opening_hours.length) {
      hoursEl.innerHTML = settings.opening_hours.map(function (row) {
        return (
          '<div class="hours-row">' +
            '<span class="hours-label">' + BB.escapeHtml(row.label) + '</span>' +
            '<span class="hours-value">' + BB.escapeHtml(row.hours) + '</span>' +
          '</div>'
        );
      }).join('');
    }

    const contactEl = document.getElementById('reservation-contact');
    if (contactEl) {
      let html = '';
      if (settings.phone) {
        html += '<p>Call us: <a href="tel:' + BB.escapeHtml(settings.phone) + '">' + BB.escapeHtml(settings.phone) + '</a></p>';
      }
      if (settings.email) {
        html += '<p>Or write: <a href="mailto:' + BB.escapeHtml(settings.email) + '">' + BB.escapeHtml(settings.email) + '</a></p>';
      }
      if (html) contactEl.innerHTML = html;
    }
  }

  /* ---------------------------------------------------------------------------
     Validation
     --------------------------------------------------------------------------- */
  function collectValidation(mark) {
    const problems = [];
    const today = todayISO();

    function check(element, errorElId, message, valid) {
      if (valid) {
        if (mark) clearError(element, errorElId);
        return;
      }
      problems.push({ element: element, errorElId: errorElId, message: message });
      if (mark) showError(element, errorElId, message);
    }

    const nameInput = document.getElementById('reservation-name');
    check(nameInput, 'reservation-name-error', 'Please tell us your name.', Boolean(nameInput.value.trim()));

    const phoneInput = document.getElementById('reservation-phone');
    check(phoneInput, 'reservation-phone-error', 'We need a phone number to confirm your reservation.', Boolean(phoneInput.value.trim()));

    const dateInput = document.getElementById('reservation-date');
    check(
      dateInput, 'reservation-date-error',
      dateInput.value && dateInput.value < today
        ? 'That date is in the past — please pick today or later.'
        : 'Please pick a date that is today or later.',
      Boolean(dateInput.value) && dateInput.value >= today
    );

    return problems;
  }

  /* ---------------------------------------------------------------------------
     Submit flow
     --------------------------------------------------------------------------- */
  const submitButton = document.getElementById('reservation-submit');
  const SUBMIT_LABEL = 'Send Reservation Request';
  let submitAttempted = false;

  function setSending(sending) {
    submitButton.disabled = sending;
    submitButton.innerHTML = sending
      ? '<span class="spinner" aria-hidden="true"></span> Sending request...'
      : SUBMIT_LABEL;
  }

  function getCheckedValue(name) {
    const checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : '';
  }

  function showSuccessPanel(reservation) {
    const section = document.getElementById('reservation-section');
    const dateValue = document.getElementById('reservation-date').value;
    const timeValue = document.getElementById('reservation-time').value;
    const partyValue = document.getElementById('reservation-party').value;

    let referenceHtml = '';
    if (reservation && reservation.id) {
      const shortId = String(reservation.id).replace(/-/g, '').slice(0, 8).toUpperCase();
      referenceHtml = '<p class="order-number-chip">Request #' + BB.escapeHtml(shortId) + '</p>';
    }

    let whenHtml = '';
    if (dateValue) {
      whenHtml = '<p>We are holding your note for <strong>' + BB.escapeHtml(humanDate(dateValue)) +
        (timeValue && timeValue !== 'Flexible' ? ' · ' + BB.escapeHtml(timeValue) : '') +
        '</strong>' + (partyValue ? ' — party of ' + BB.escapeHtml(String(partyValue)) : '') + '.</p>';
    }

    section.innerHTML =
      '<div class="container">' +
        '<div class="checkout-success" role="status" tabindex="-1">' +
          '<div class="success-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5"/></svg>' +
          '</div>' +
          '<h2>Reservation request sent</h2>' +
          referenceHtml +
          whenHtml +
          '<p class="summary-disclaimer" style="margin-top: 14px;">We will confirm availability by phone shortly. This is a request until confirmed.</p>' +
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
      if (problems[0].element) problems[0].element.focus();
      return;
    }

    /* Clamp the party size defensively — the input already constrains it. */
    const party = Math.max(PARTY_MIN, Math.min(PARTY_MAX, Number(document.getElementById('reservation-party').value) || PARTY_MIN));

    const payload = {
      name: document.getElementById('reservation-name').value.trim(),
      phone: document.getElementById('reservation-phone').value.trim(),
      email: document.getElementById('reservation-email').value.trim() || null,
      reservation_type: getCheckedValue('reservation-type') || 'table',
      party_size: party,
      requested_date: document.getElementById('reservation-date').value,
      requested_time: document.getElementById('reservation-time').value,
      notes: document.getElementById('reservation-notes').value.trim() || null,
    };

    const inlineError = document.getElementById('reservation-submit-error');
    inlineError.hidden = true;
    inlineError.innerHTML = '';
    setSending(true);

    try {
      const reservation = await BB.submitReservation(payload);
      showSuccessPanel(reservation);
    } catch (error) {
      BB.toast(error.message || 'We could not send your reservation. Please try again.', 'error');
      inlineError.innerHTML = BB.errorStateHtml(
        'Your reservation could not be sent: ' + (error.message || 'please try again in a moment.')
      );
      inlineError.hidden = false;
      setSending(false);
    }
  }

  /* ---------------------------------------------------------------------------
     Wiring + boot
     --------------------------------------------------------------------------- */
  function init() {
    renderInfoCards();

    /* Supabase not configured: show the setup notice instead of a form that
       could never submit (main.js fills the .needs-data slot). */
    if (!BB.configured) {
      const slot = document.getElementById('reservation-setup-slot');
      const panel = document.getElementById('reservation-form-panel');
      if (slot && !slot.innerHTML) slot.innerHTML = BB.setupNoticeHtml();
      if (slot) slot.hidden = false;
      if (panel) panel.hidden = true;
      return;
    }

    const form = document.getElementById('reservation-form');

    /* Dates in the past cannot be picked. */
    document.getElementById('reservation-date').min = todayISO();

    /* Keep the .is-active highlight on the reservation type cards. */
    const typeGroup = document.getElementById('reservation-type');
    typeGroup.addEventListener('change', function () {
      typeGroup.querySelectorAll('.radio-card').forEach(function (card) {
        card.classList.toggle('is-active', card.querySelector('input').checked);
      });
    });

    /* After a submit attempt, re-validate live so errors clear as the
       visitor fixes them. */
    const onActivity = function () {
      if (submitAttempted) collectValidation(true);
    };
    form.addEventListener('change', onActivity);
    form.addEventListener('input', onActivity);

    form.addEventListener('submit', handleSubmit);
  }

  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(init).catch(function (error) {
      console.warn('Reservations page failed to initialise:', error);
      init();
    });
  });
})(window.BB);
