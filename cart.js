/* =============================================================================
   BUTTER & BLOOM — cart.js
   -----------------------------------------------------------------------------
   Shopping cart page:
     · renders every cart line (thumb, options, qty stepper, line total, remove)
     · keeps the "Order Summary" card and the header badges in sync after
       every mutation
     · re-validates prices/availability against Supabase when it is configured
       (BB.cart.refreshPrices) and reports what changed via toasts
     · degrades gracefully without Supabase: local snapshot items stay
       editable, plus a setup notice explaining why prices are not live
   ============================================================================= */

(function initCartPage(BB) {
  'use strict';

  /* Maximum quantity per line — matches the clamp inside BB.cart.setQty */
  var MAX_QTY = 99;

  /* Cached DOM references (filled once the document is ready) */
  var listEl = null;          /* #cart-list           — the rows */
  var summaryEl = null;       /* #cart-summary        — right-hand card */
  var summaryRowsEl = null;   /* #summary-rows        — subtotal + notes */
  var continueEl = null;      /* #cart-continue       — "Continue shopping" */
  var clearBtn = null;        /* #clear-cart-btn      — empty the whole cart */

  document.addEventListener('DOMContentLoaded', function () {
    listEl = document.getElementById('cart-list');
    summaryEl = document.getElementById('cart-summary');
    summaryRowsEl = document.getElementById('summary-rows');
    continueEl = document.getElementById('cart-continue');
    clearBtn = document.getElementById('clear-cart-btn');

    /* Wait for shared chrome (settings, badges, drawer, footer) to be ready
       so BB.formatPrice already knows the configured currency symbol. */
    BB.ready.then(function () {
      wireRowActions();
      wireClearButton();
      renderCart();

      if (!BB.configured) return; /* offline snapshot mode — nothing to sync */
      refreshPricesFromLive();
    });
  });

  /* ---------------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------------- */
  function renderCart() {
    var items = BB.cart.items();

    /* Empty cart: friendly empty state, hide the summary card entirely */
    if (!items.length) {
      listEl.innerHTML = BB.emptyStateHtml(
        'Your cart is empty',
        'Warm croissants are waiting — add something delicious from the shop and it will appear here.',
        '<a class="btn btn-primary" href="shop.html">Browse the bakery</a>'
      );
      summaryEl.hidden = true;
      continueEl.hidden = true;
      BB.updateBadges();
      return;
    }

    summaryEl.hidden = false;
    continueEl.hidden = false;
    listEl.innerHTML = items.map(renderRow).join('');
    renderSummary(items);

    /* Keep the header badge in sync after every mutation */
    BB.updateBadges();

    /* Without Supabase the rows are local snapshots — say so above the list */
    if (!BB.configured) prependSetupNotice();
  }

  /* One .cart-row per cart line (contract class list from style.css) */
  function renderRow(item) {
    var safeName = BB.escapeHtml(item.name);
    var unit = unitPrice(item);
    var options = optionsText(item);

    return (
      '<article class="cart-row" data-line-key="' + BB.escapeHtml(item.lineKey) + '">' +
        '<div class="cart-thumb">' +
          (item.image
            ? '<img src="' + BB.escapeHtml(item.image) + '" alt="' + safeName + '" loading="lazy">'
            : '') +
        '</div>' +
        '<div class="cart-item-info">' +
          '<h3>' + safeName + '</h3>' +
          (options ? '<p class="cart-options">' + options + '</p>' : '') +
          '<p class="unit-price">' + BB.formatPrice(unit) + ' each</p>' +
        '</div>' +
        '<div class="cart-item-side">' +
          '<div class="qty-stepper" role="group" aria-label="Quantity for ' + safeName + '">' +
            '<button type="button" class="qty-decrease" aria-label="Decrease quantity of ' + safeName + '"' +
              (item.qty <= 1 ? ' disabled' : '') + '>&minus;</button>' +
            '<input type="text" value="' + item.qty + '" readonly aria-label="' + safeName + ' quantity">' +
            '<button type="button" class="qty-increase" aria-label="Increase quantity of ' + safeName + '"' +
              (item.qty >= MAX_QTY ? ' disabled' : '') + '>+</button>' +
          '</div>' +
          '<span class="cart-line-total">' + BB.formatPrice(unit * item.qty) + '</span>' +
          '<button type="button" class="cart-remove" data-remove-key="' + BB.escapeHtml(item.lineKey) + '" ' +
            'aria-label="Remove ' + safeName + ' from your cart">Remove</button>' +
        '</div>' +
      '</article>'
    );
  }

  /* Subtotal row + delivery notes. The fee itself is fixed at checkout,
     where the fulfillment type (pickup vs delivery) is known. */
  function renderSummary(items) {
    var subtotal = BB.cart.subtotal();
    var count = items.reduce(function (sum, item) { return sum + item.qty; }, 0);
    var settings = BB.settings || {};
    var freeOver = Number(settings.delivery_free_over) || 0;

    var html =
      '<div class="summary-row">' +
        '<span>Subtotal (' + count + (count === 1 ? ' item' : ' items') + ')</span>' +
        '<strong>' + BB.formatPrice(subtotal) + '</strong>' +
      '</div>' +
      '<p class="summary-note">Delivery fee is calculated at checkout.</p>';

    if (freeOver > 0) {
      html += '<p class="summary-note">Free local delivery on orders over ' + BB.formatPrice(freeOver) + '.</p>';
    }
    summaryRowsEl.innerHTML = html;
  }

  /* Snapshot explanation + generic "connect Supabase" notice, above the rows */
  function prependSetupNotice() {
    var note = document.createElement('div');
    note.innerHTML =
      '<p class="text-muted" style="margin:0 0 14px;font-size:0.9rem;">' +
        'Item names, prices and options below are snapshots saved in this browser. ' +
        'They are re-checked against the live menu as soon as Supabase is connected.' +
      '</p>' +
      BB.setupNoticeHtml();
    listEl.prepend(note);
  }

  /* ---------------------------------------------------------------------------
     Price + availability sync (only when Supabase is configured)
     --------------------------------------------------------------------------- */
  function refreshPricesFromLive() {
    BB.cart.refreshPrices().then(function (result) {
      if (!result) return; /* offline — nothing happened */

      var removedNames = result.removed || [];
      if (removedNames.length) {
        BB.toast('Removed unavailable items: ' + removedNames.join(', '), 'info');
      }
      if (result.updated > 0) {
        BB.toast('Prices updated to current menu', 'info');
      }
      if (removedNames.length || result.updated > 0) {
        renderCart(); /* reflect the corrections in list + summary */
      }
    }).catch(function (error) {
      /* Keep showing the stored snapshots rather than blocking the shopper */
      console.warn('[Butter & Bloom] Cart price refresh failed:', error);
      BB.toast('We could not verify prices against the live menu just now.', 'error');
    });
  }

  /* ---------------------------------------------------------------------------
     Interactions (event delegation — rows are re-rendered after each change)
     --------------------------------------------------------------------------- */
  function wireRowActions() {
    listEl.addEventListener('click', function (event) {
      var row = event.target.closest('.cart-row');
      if (!row) return;

      var lineKey = row.getAttribute('data-line-key');
      var item = BB.cart.items().find(function (candidate) {
        return candidate.lineKey === lineKey;
      });
      if (!item) return;

      if (event.target.closest('.qty-decrease')) {
        BB.cart.setQty(lineKey, item.qty - 1); /* clamped to 1 inside the cart API */
        renderCart();
      } else if (event.target.closest('.qty-increase')) {
        BB.cart.setQty(lineKey, item.qty + 1); /* clamped to 99 inside the cart API */
        renderCart();
      } else if (event.target.closest('.cart-remove')) {
        if (BB.confirmDialog('Remove ' + item.name + ' from your cart?')) {
          BB.cart.remove(lineKey);
          renderCart();
          BB.toast(item.name + ' removed from your cart', 'info');
        }
      }
    });
  }

  function wireClearButton() {
    clearBtn.addEventListener('click', function () {
      if (!BB.cart.items().length) return;
      if (!BB.confirmDialog('Remove all items from your cart?')) return;
      BB.cart.clear();
      renderCart();
      BB.toast('Your cart has been cleared', 'info');
    });
  }

  /* ---------------------------------------------------------------------------
     Small price helpers shared by the row renderer
     --------------------------------------------------------------------------- */

  /* Unit price = base price + the sum of the chosen option deltas */
  function unitPrice(item) {
    return (Number(item.price) || 0) + optionDelta(item);
  }

  function optionDelta(item) {
    return (item.options || []).reduce(function (sum, option) {
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
})(window.BB);
