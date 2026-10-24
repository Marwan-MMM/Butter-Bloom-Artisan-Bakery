/* =============================================================================
   BUTTER & BLOOM — checkout.js
   -----------------------------------------------------------------------------
   Checkout page:
     · order review list + subtotal / delivery fee / total in the summary card
     · contact fields, pickup vs delivery radio cards (respecting settings),
       delivery address, requested date (min = today) + time slots, notes
     · inline validation (no native popups — shared .field-error styling)
     · minimum order amount check from settings (blocks submission)
     · submit -> BB.saveOrder(...) -> success panel with the saved order
       number + optional WhatsApp convenience button
     · never fakes success: storage/API errors show a toast + inline error
   ============================================================================= */

(function initCheckoutPage(BB) {
  'use strict';

  /* Cached DOM references (filled once the document is ready) */
  var layout = null;          /* #checkout-layout     — the two-column grid */
  var formPanel = null;       /* #checkout-panel      — left column wrapper */
  var summaryCard = null;     /* #checkout-summary    — right column card */
  var form = null;            /* #checkout-form */
  var errorSlot = null;       /* #checkout-error      — inline API errors */
  var placeOrderBtn = null;   /* #place-order-btn */
  var reviewListEl = null;    /* #order-review */

  /* Simple guard so a submit can never fire after the form was replaced
     by the empty-cart or setup states. */
  var formActive = false;

  document.addEventListener('DOMContentLoaded', function () {
    layout = document.getElementById('checkout-layout');
    formPanel = document.getElementById('checkout-panel');
    summaryCard = document.getElementById('checkout-summary');
    form = document.getElementById('checkout-form');
    errorSlot = document.getElementById('checkout-error');
    placeOrderBtn = document.getElementById('place-order-btn');
    reviewListEl = document.getElementById('order-review');

    /* Wait for shared chrome (settings, badges, drawer, footer) to be ready
       so BB.formatPrice already knows the configured currency symbol. */
    BB.ready.then(function () {
      initDateBounds();
      fillTimeSlots();
      applyFulfillmentSettings();
      wireFulfillmentChanges();

      /* Empty cart -> there is nothing to check out */
      if (!BB.cart.items().length) {
        replaceWithEmptyCart();
        return;
      }

      /* Without Supabase the order cannot be received or validated —
         show the setup notice but keep the cart intact. */
      if (!BB.configured) {
        showSetupNotice();
        return;
      }

      formActive = true;
      renderCheckoutSummary();
      form.addEventListener('submit', onSubmit);
    });
  });

  /* ---------------------------------------------------------------------------
     Setup of the static-ish controls
     --------------------------------------------------------------------------- */

  /* Requested date cannot be in the past */
  function initDateBounds() {
    var dateInput = document.getElementById('req-date');
    if (dateInput) dateInput.min = todayIso();
  }

  /* Time select: "Flexible" + hourly slots 09:00-18:00 */
  function fillTimeSlots() {
    var select = document.getElementById('req-time');
    if (!select) return;
    var html = '<option value="Flexible">Flexible (any time)</option>';
    for (var hour = 9; hour <= 18; hour += 1) {
      var label = (hour < 10 ? '0' + hour : String(hour)) + ':00';
      html += '<option value="' + label + '">' + label + '</option>';
    }
    select.innerHTML = html;
  }

  /* Preselect pickup/delivery per settings; disable what the bakery turned off */
  function applyFulfillmentSettings() {
    var settings = BB.settings || {};
    var pickupEnabled = settings.pickup_enabled !== false;   /* default: on */
    var deliveryEnabled = settings.delivery_enabled !== false; /* default: on */

    var pickupInput = document.getElementById('fulfillment-pickup');
    var deliveryInput = document.getElementById('fulfillment-delivery');

    if (!pickupEnabled) disableFulfillmentCard('fulfillment-card-pickup', pickupInput);
    if (!deliveryEnabled) disableFulfillmentCard('fulfillment-card-delivery', deliveryInput);

    /* Only one option available? Select it automatically. Otherwise default
       to pickup (delivery costs a fee the shopper should opt into). */
    if (pickupEnabled) pickupInput.checked = true;
    else if (deliveryEnabled) deliveryInput.checked = true;

    syncFulfillmentCards();
    toggleDeliveryFields();
  }

  function disableFulfillmentCard(cardId, input) {
    var card = document.getElementById(cardId);
    if (card) card.classList.add('is-disabled');
    if (input) input.disabled = true;
  }

  /* Keep the .is-active highlight + delivery address visibility in sync */
  function wireFulfillmentChanges() {
    ['fulfillment-pickup', 'fulfillment-delivery'].forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', function () {
        syncFulfillmentCards();
        toggleDeliveryFields();
        renderCheckoutSummary(); /* the delivery fee changes the total */
      });
    });
  }

  function syncFulfillmentCards() {
    var pickupInput = document.getElementById('fulfillment-pickup');
    var deliveryInput = document.getElementById('fulfillment-delivery');
    document.getElementById('fulfillment-card-pickup')
      .classList.toggle('is-active', Boolean(pickupInput && pickupInput.checked));
    document.getElementById('fulfillment-card-delivery')
      .classList.toggle('is-active', Boolean(deliveryInput && deliveryInput.checked));
  }

  function toggleDeliveryFields() {
    var deliveryInput = document.getElementById('fulfillment-delivery');
    var fields = document.getElementById('delivery-fields');
    if (fields) fields.hidden = !(deliveryInput && deliveryInput.checked);
  }

  /* ---------------------------------------------------------------------------
     Summary card (review list + totals + min order warning)
     --------------------------------------------------------------------------- */
  function renderCheckoutSummary() {
    var items = BB.cart.items();
    var subtotal = round2(BB.cart.subtotal());
    var fulfillment = checkedFulfillment() || 'pickup';
    var fee = computeDeliveryFee(subtotal, fulfillment);

    reviewListEl.innerHTML = items.map(renderReviewLine).join('');

    document.getElementById('summary-subtotal').textContent = BB.formatPrice(subtotal);

    var feeLabel = document.getElementById('summary-fee-label');
    var feeValue = document.getElementById('summary-fee');
    if (fulfillment === 'delivery') {
      feeLabel.textContent = 'Delivery fee';
      feeValue.textContent = fee === 0 ? 'Free' : BB.formatPrice(fee);
    } else {
      feeLabel.textContent = 'Pickup — no fee';
      feeValue.textContent = '—';
    }

    document.getElementById('summary-total').textContent = BB.formatPrice(round2(subtotal + fee));
    updateMinOrderWarning(subtotal);
  }

  function renderReviewLine(item) {
    var unit = unitPrice(item);
    var options = optionsText(item);
    return (
      '<li class="review-line">' +
        '<div class="review-info">' +
          '<span class="review-name">' + BB.escapeHtml(item.name) + ' × ' + item.qty + '</span>' +
          (options ? '<span class="review-options">' + BB.escapeHtml(options) + '</span>' : '') +
        '</div>' +
        '<span class="review-total">' + BB.formatPrice(unit * item.qty) + '</span>' +
      '</li>'
    );
  }

  /* Red note + disabled submit while the subtotal is below the minimum */
  function updateMinOrderWarning(subtotal) {
    var warning = document.getElementById('min-order-warning');
    var settings = BB.settings || {};
    var minimum = Number(settings.min_order_amount) || 0;

    if (minimum > 0 && subtotal < minimum) {
      warning.textContent = 'Our minimum order amount is ' + BB.formatPrice(minimum) +
        ' — add ' + BB.formatPrice(round2(minimum - subtotal)) + ' more to place your order.';
      warning.classList.add('is-visible');
      placeOrderBtn.disabled = true;
    } else {
      warning.textContent = '';
      warning.classList.remove('is-visible');
      placeOrderBtn.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------------
     Validation
     --------------------------------------------------------------------------- */
  function onSubmit(event) {
    event.preventDefault();
    if (!formActive) return;

    clearErrorSlot();
    clearFieldErrors();

    var fulfillment = checkedFulfillment();

    /* Defensive: both fulfillment options disabled by settings */
    if (!fulfillment) {
      showErrorState('The bakery has not enabled pickup or delivery right now — please contact us to place an order.');
      return;
    }

    var errors = validateForm(fulfillment);
    if (errors.length) {
      displayFieldErrors(errors);
      return;
    }

    /* The cart could have been emptied in another tab while this page was open */
    var items = BB.cart.items();
    if (!items.length) {
      replaceWithEmptyCart();
      return;
    }

    placeOrder(items, fulfillment);
  }

  /* Returns a list of [inputId, message] pairs for every invalid field */
  function validateForm(fulfillment) {
    var errors = [];

    if (!valueOf('cust-name')) {
      errors.push(['cust-name', 'Please enter your full name.']);
    }

    var phoneDigits = valueOf('cust-phone').replace(/[^0-9]/g, '');
    if (!phoneDigits) {
      errors.push(['cust-phone', 'Please enter your phone number.']);
    } else if (phoneDigits.length < 6) {
      errors.push(['cust-phone', 'Please enter a phone number with at least 6 digits.']);
    }

    var email = valueOf('cust-email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push(['cust-email', 'That email address does not look right.']);
    }

    /* Address is only required while the delivery option is visible */
    if (fulfillment === 'delivery' && !valueOf('cust-address')) {
      errors.push(['cust-address', 'Please enter the address we should deliver to.']);
    }

    var date = valueOf('req-date');
    if (!date) {
      errors.push(['req-date', 'Please choose a requested date.']);
    } else if (date < todayIso()) {
      errors.push(['req-date', 'Please choose a date from today onwards.']);
    }

    return errors;
  }

  /* input.is-invalid + visible .field-error under each bad field */
  function displayFieldErrors(errors) {
    errors.forEach(function (pair) {
      var field = document.getElementById(pair[0]);
      var message = document.getElementById(pair[0] + '-error');
      if (field) field.classList.add('is-invalid');
      if (message) {
        message.textContent = pair[1];
        message.classList.add('is-visible');
      }
    });
    var first = document.getElementById(errors[0][0]);
    if (first) first.focus();
  }

  function clearFieldErrors() {
    form.querySelectorAll('.is-invalid').forEach(function (element) {
      element.classList.remove('is-invalid');
    });
    form.querySelectorAll('.field-error.is-visible').forEach(function (element) {
      element.classList.remove('is-visible');
    });
  }

  /* ---------------------------------------------------------------------------
     Submit -> BB.saveOrder
     --------------------------------------------------------------------------- */
  function placeOrder(items, fulfillment) {
    setPlacingOrder(true);

    BB.saveOrder(buildOrderPayload(items, fulfillment)).then(function (savedOrder) {
      /* The order is stored — empty the cart and celebrate (for real) */
      BB.cart.clear();
      renderSuccessPanel(savedOrder);
    }).catch(function (error) {
      console.warn('[Butter & Bloom] Order could not be saved:', error);
      setPlacingOrder(false);
      var message = (error && error.message) || 'We could not place your order. Please try again in a moment.';
      BB.toast(message, 'error');
      showErrorState(message);
    });
  }

  function buildOrderPayload(items, fulfillment) {
    var subtotal = round2(BB.cart.subtotal());
    var fee = computeDeliveryFee(subtotal, fulfillment);

    return {
      customer_name: valueOf('cust-name').trim(),
      phone: valueOf('cust-phone').trim(),
      email: valueOf('cust-email').trim() || null,
      fulfillment_type: fulfillment,
      delivery_address: fulfillment === 'delivery' ? valueOf('cust-address').trim() : null,
      requested_date: valueOf('req-date'),        /* yyyy-mm-dd from the date input */
      requested_time: valueOf('req-time') || null,
      notes: valueOf('cust-notes').trim() || null,
      subtotal: subtotal,
      delivery_fee: fee,
      total: round2(subtotal + fee),
      items: items.map(function (item) {
        var unit = unitPrice(item);
        return {
          product_id: item.productId,
          product_name: item.name,
          unit_price: round2(unit),
          quantity: item.qty,
          selected_options: item.options || [],   /* [{name, label, priceDelta}] */
          line_total: round2(unit * item.qty),
        };
      }),
    };
  }

  /* Spinner + "Placing order..." while the request is in flight */
  function setPlacingOrder(loading) {
    placeOrderBtn.disabled = loading;
    placeOrderBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
    placeOrderBtn.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span>Placing order...'
      : 'Place Order';
  }

  /* Inline .error-state above the form (shared helper from main.js) */
  function showErrorState(message) {
    errorSlot.innerHTML = BB.errorStateHtml(message);
    errorSlot.hidden = false;
    errorSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearErrorSlot() {
    errorSlot.hidden = true;
    errorSlot.innerHTML = '';
  }

  /* ---------------------------------------------------------------------------
     Success panel — replaces the entire page content
     --------------------------------------------------------------------------- */
  function renderSuccessPanel(order) {
    var settings = BB.settings || {};
    var isDelivery = order.fulfillment_type === 'delivery';
    var dateText = formatDate(order.requested_date);
    var timeText = formatTime(order.requested_time);

    /* Fulfillment summary line */
    var details;
    if (isDelivery) {
      details = 'Local delivery to <strong>' + BB.escapeHtml(order.delivery_address || '') + '</strong> on ' +
        BB.escapeHtml(dateText) + ' at ' + BB.escapeHtml(timeText) + '.';
    } else {
      details = 'Pickup at the bakery on ' + BB.escapeHtml(dateText) + ' at ' + BB.escapeHtml(timeText) + '.' +
        (settings.address ? ' Find us at ' + BB.escapeHtml(settings.address) + '.' : '');
    }

    /* Optional WhatsApp convenience button — NEVER presented as proof of
       receipt; only the bakery's phone call confirms the order. */
    var whatsappHtml = '';
    var whatsappNumber = String(settings.whatsapp_number || '').replace(/[^0-9]/g, '');
    if (whatsappNumber) {
      var summary = 'Hello Butter & Bloom! I just placed order ' + order.order_number +
        ' (' + order.customer_name + ', ' + dateText + ' ' + timeText + ', ' +
        BB.formatPrice(order.total) + '). Please confirm.';
      whatsappHtml =
        '<a class="btn btn-primary" target="_blank" rel="noopener" ' +
          'href="https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(summary) + '">' +
          'Confirm on WhatsApp' +
        '</a>' +
        '<p class="summary-note">WhatsApp is an optional convenience for you — only our phone call confirms your order.</p>';
    }

    var main = document.getElementById('main');
    main.innerHTML =
      '<section class="section" aria-label="Order confirmation">' +
        '<div class="container">' +
          '<div class="checkout-success" role="status">' +
            '<div class="success-icon">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 L10 18 L19.5 6.5"/></svg>' +
            '</div>' +
            '<h2>Thank you, ' + BB.escapeHtml(order.customer_name) + '!</h2>' +
            '<p>Your order has been received.</p>' +
            '<span class="order-number-chip">Order ' + BB.escapeHtml(order.order_number) + '</span>' +
            '<p class="success-details">' + details + '</p>' +
            '<p class="success-disclaimer">No payment has been taken — our team will call you to confirm availability and arrange payment on pickup or delivery.</p>' +
            '<div class="success-actions">' + whatsappHtml +
              '<a class="btn btn-outline" href="index.html">Back to the bakery</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------------------
     Page states that replace the form
     --------------------------------------------------------------------------- */
  function replaceWithEmptyCart() {
    formActive = false;
    formPanel.innerHTML = BB.emptyStateHtml(
      'Your cart is empty',
      'There is nothing to check out yet — warm croissants are waiting in the shop.',
      '<a class="btn btn-primary" href="shop.html">Browse the bakery</a>'
    );
    summaryCard.hidden = true; /* an empty review card would be noise */
  }

  function showSetupNotice() {
    formActive = false;
    formPanel.innerHTML =
      '<p class="text-muted" style="margin:0 0 14px;font-size:0.9rem;">' +
        'Checkout needs a Supabase connection so we can receive and confirm your order. ' +
        'Your cart stays safely stored in this browser.' +
      '</p>' +
      BB.setupNoticeHtml();
  }

  /* ---------------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------------- */
  function valueOf(id) {
    var field = document.getElementById(id);
    return field ? field.value : '';
  }

  function checkedFulfillment() {
    var checked = form.querySelector('input[name="fulfillment"]:checked');
    return checked ? checked.value : null;
  }

  /* Unit price = base price + the sum of the chosen option deltas */
  function unitPrice(item) {
    return (Number(item.price) || 0) + (item.options || []).reduce(function (sum, option) {
      return sum + (Number(option.priceDelta) || 0);
    }, 0);
  }

  /* "Label (+2.00), Label" — the delta is omitted when the choice is free */
  function optionsText(item) {
    return (item.options || []).map(function (option) {
      var delta = Number(option.priceDelta) || 0;
      if (delta > 0) return option.label + ' (+' + BB.formatPrice(delta) + ')';
      if (delta < 0) return option.label + ' (-' + BB.formatPrice(Math.abs(delta)) + ')';
      return option.label;
    }).join(', ');
  }

  /* Delivery fee from settings: 0 for pickup, free above the threshold */
  function computeDeliveryFee(subtotal, fulfillment) {
    if (fulfillment !== 'delivery') return 0;
    var settings = BB.settings || {};
    var freeOver = Number(settings.delivery_free_over) || 0;
    if (freeOver > 0 && subtotal >= freeOver) return 0;
    return round2(Number(settings.delivery_fee) || 0);
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function todayIso() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatTime(value) {
    if (!value || value === 'Flexible') return 'a flexible time';
    return value;
  }
})(window.BB);
