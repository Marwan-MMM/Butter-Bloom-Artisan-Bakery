/* =============================================================================
   BUTTER & BLOOM — contact.js
   -----------------------------------------------------------------------------
   Contact page:
     · fills the info cards (address + directions link, phone/email, hours)
       from site settings
     · live character counter on the message field
     · validates name / email / message and submits through BB.submitContact
     · swaps the form for an inline success panel — never faking success
       when the send fails.

   Depends on the shared foundation (supabase.js + main.js).
   ============================================================================= */

(function initContact(BB) {
  'use strict';

  const MESSAGE_MAX = 800;

  /* Loose but practical email shape: something@something.something */
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* ---------------------------------------------------------------------------
     Field error display
     --------------------------------------------------------------------------- */
  function showError(element, errorElId, message) {
    const errorEl = document.getElementById(errorElId);
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    errorEl.classList.add('is-visible');
    element.classList.add('is-invalid');
    element.setAttribute('aria-invalid', 'true');
  }

  function clearError(element, errorElId) {
    const errorEl = document.getElementById(errorElId);
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.hidden = true;
    errorEl.classList.remove('is-visible');
    element.classList.remove('is-invalid');
    element.removeAttribute('aria-invalid');
  }

  /* ---------------------------------------------------------------------------
     Settings-driven info cards
     --------------------------------------------------------------------------- */
  function renderInfoCards() {
    const settings = BB.settings;
    if (!settings) return;

    /* Visit card: address plus a real "Get directions" link (Google Maps
       search URL) only when an address is configured. */
    const addressEl = document.getElementById('contact-address');
    if (addressEl) {
      let html = '';
      if (settings.address) {
        html += '<p>' + BB.escapeHtml(settings.address) + '</p>';
        const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(settings.address);
        html += '<p style="margin-top: 10px;"><a href="' + BB.escapeHtml(mapsUrl) + '" target="_blank" rel="noopener">Get directions</a></p>';
      } else {
        html += '<p class="text-muted">Address details are managed in the admin panel.</p>';
      }
      addressEl.innerHTML = html;
    }

    /* Call or write card */
    const channelsEl = document.getElementById('contact-channels');
    if (channelsEl) {
      let html = '';
      if (settings.phone) {
        html += '<p>Phone: <a href="tel:' + BB.escapeHtml(settings.phone) + '">' + BB.escapeHtml(settings.phone) + '</a></p>';
      }
      if (settings.email) {
        html += '<p>Email: <a href="mailto:' + BB.escapeHtml(settings.email) + '">' + BB.escapeHtml(settings.email) + '</a></p>';
      }
      if (html) channelsEl.innerHTML = html;
    }

    /* Hours card */
    const hoursEl = document.getElementById('contact-hours');
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
  }

  /* ---------------------------------------------------------------------------
     Validation
     --------------------------------------------------------------------------- */
  function collectValidation(mark) {
    const problems = [];

    function check(element, errorElId, message, valid) {
      if (valid) {
        if (mark) clearError(element, errorElId);
        return;
      }
      problems.push({ element: element, errorElId: errorElId, message: message });
      if (mark) showError(element, errorElId, message);
    }

    const nameInput = document.getElementById('contact-name');
    check(nameInput, 'contact-name-error', 'Please tell us your name.', Boolean(nameInput.value.trim()));

    const emailInput = document.getElementById('contact-email');
    check(
      emailInput, 'contact-email-error',
      'Please enter a valid email address so we can reply.',
      EMAIL_PATTERN.test(emailInput.value.trim())
    );

    const messageInput = document.getElementById('contact-message');
    check(messageInput, 'contact-message-error', 'Please write a short message first.', Boolean(messageInput.value.trim()));

    return problems;
  }

  /* ---------------------------------------------------------------------------
     Submit flow
     --------------------------------------------------------------------------- */
  const submitButton = document.getElementById('contact-submit');
  const SUBMIT_LABEL = 'Send Message';
  let submitAttempted = false;

  function setSending(sending) {
    submitButton.disabled = sending;
    submitButton.innerHTML = sending
      ? '<span class="spinner" aria-hidden="true"></span> Sending message...'
      : SUBMIT_LABEL;
  }

  function showSuccessPanel() {
    const section = document.getElementById('contact-section');

    section.innerHTML =
      '<div class="container">' +
        '<div class="checkout-success" role="status" tabindex="-1">' +
          '<div class="success-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 L9.5 17.5 L19.5 6.5"/></svg>' +
          '</div>' +
          '<h2>Message sent</h2>' +
          '<p>Thank you for writing to us — your note is in our inbox.</p>' +
          '<p class="summary-disclaimer" style="margin-top: 14px;">We usually reply within one business day.</p>' +
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

    const payload = {
      name: document.getElementById('contact-name').value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      phone: document.getElementById('contact-phone').value.trim() || null,
      subject: document.getElementById('contact-subject').value,
      message: document.getElementById('contact-message').value.trim(),
    };

    const inlineError = document.getElementById('contact-submit-error');
    inlineError.hidden = true;
    inlineError.innerHTML = '';
    setSending(true);

    try {
      await BB.submitContact(payload);
      showSuccessPanel();
    } catch (error) {
      BB.toast(error.message || 'We could not send your message. Please try again.', 'error');
      inlineError.innerHTML = BB.errorStateHtml(
        'Your message could not be sent: ' + (error.message || 'please try again in a moment.')
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
      const slot = document.getElementById('contact-setup-slot');
      const panel = document.getElementById('contact-form-panel');
      if (slot && !slot.innerHTML) slot.innerHTML = BB.setupNoticeHtml();
      if (slot) slot.hidden = false;
      if (panel) panel.hidden = true;
      return;
    }

    const form = document.getElementById('contact-form');

    /* Live character counter on the message field */
    const messageInput = document.getElementById('contact-message');
    const counter = document.getElementById('contact-message-counter');
    messageInput.addEventListener('input', function () {
      counter.textContent = messageInput.value.length + ' / ' + MESSAGE_MAX;
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
      console.warn('Contact page failed to initialise:', error);
      init();
    });
  });
})(window.BB);
