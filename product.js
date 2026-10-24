/* =============================================================================
   BUTTER & BLOOM — product.js
   -----------------------------------------------------------------------------
   The product detail page:
     · reads ?slug= and loads the published product (BB.getProduct)
     · breadcrumb: Home / Shop All / Category / Product name
     · gallery with clickable thumbnails (main image + .is-active state)
     · option groups rendered as single-select chip rows ("radio behaviour"):
         - required groups start unselected and are validated on add
         - optional groups get a preselected "None" chip
     · live line total (unit price + chosen option deltas) x quantity
     · add to cart (shallow-cloned product carrying the adjusted unit price)
     · wishlist toggle synced with BB.wishlist
     · accordions: Description, Ingredients & Allergens, Portion & Storage
     · related products rail (BB.getRelatedProducts)
     · not-found + error + setup states
   ============================================================================= */

(function initProductPage(BB) {
  'use strict';

  /* Cached DOM references (filled in init) */
  var detailEl;
  var breadcrumbEl;
  var relatedSection;
  var relatedGrid;

  /* Page state */
  var product = null;                                   // loaded product row
  var selectedChoices = new Map();                      // group index -> choice index (-1 = "None")
  var qtyInput;                                         // quantity field of the buy row

  /* Reusable heart icon for the wishlist button (kept as SVG, never emoji) */
  var HEART_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5 C7 16.5 3.5 13.3 3.5 9.6 C3.5 7 5.6 5 8.1 5 C9.7 5 11.2 5.8 12 7.1 C12.8 5.8 14.3 5 15.9 5 C18.4 5 20.5 7 20.5 9.6 C20.5 13.3 17 16.5 12 20.5 Z"/></svg>';

  var CRUMB_SEP = '<span class="crumb-sep" aria-hidden="true">/</span>';

  /* ---------------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(function () {
      detailEl = document.getElementById('product-detail');
      breadcrumbEl = document.getElementById('breadcrumb');
      relatedSection = document.getElementById('related-section');
      relatedGrid = document.getElementById('related-grid');

      // When Supabase is not configured, main.js has already swapped the
      // .needs-data container for the setup notice — nothing more to do here.
      if (!BB.configured) return;

      var slug = new URLSearchParams(location.search).get('slug');
      if (!slug) { renderNotFound(); return; }

      BB.getProduct({ slug: slug })
        .then(function (loaded) {
          if (!loaded) { renderNotFound(); return; }
          product = loaded;
          renderProduct();
        })
        .catch(function (error) {
          detailEl.classList.remove('needs-data');
          detailEl.removeAttribute('aria-busy');
          detailEl.innerHTML = BB.errorStateHtml(error.message);
        });
    });
  });

  /* ---------------------------------------------------------------------------
     Not found — unknown slug, unlisted treat or a stale link
     --------------------------------------------------------------------------- */
  function renderNotFound() {
    detailEl.classList.remove('needs-data');
    detailEl.removeAttribute('aria-busy');
    detailEl.innerHTML = BB.emptyStateHtml(
      'This treat could not be found',
      'It may have sold out for the season, or the link is out of date. Our full range is waiting in the shop.',
      '<a class="btn btn-primary" href="shop.html">Back to shop</a>'
    );
  }

  /* ---------------------------------------------------------------------------
     Full product render
     --------------------------------------------------------------------------- */
  function renderProduct() {
    document.title = product.name + ' — Butter & Bloom Artisan Bakery';
    renderBreadcrumb();

    detailEl.classList.remove('needs-data');
    detailEl.removeAttribute('aria-busy');
    detailEl.innerHTML =
      '<div class="product-layout">' +
        renderGallery() +
        renderInfoPanel() +
      '</div>';

    wireProductEvents();
    loadRelatedProducts();
  }

  /* Breadcrumb: Home / Shop All / [Category] / Product name */
  function renderBreadcrumb() {
    var crumbs = '<a href="index.html">Home</a>' + CRUMB_SEP +
                 '<a href="shop.html">Shop All</a>';

    if (product.categories && product.categories.slug) {
      crumbs += CRUMB_SEP +
        '<a href="shop.html?category=' + BB.escapeHtml(product.categories.slug) + '">' +
        BB.escapeHtml(product.categories.name) + '</a>';
    }
    crumbs += CRUMB_SEP + '<span aria-current="page">' + BB.escapeHtml(product.name) + '</span>';
    breadcrumbEl.innerHTML = crumbs;
  }

  /* --------------------------- Gallery ------------------------------------ */
  function renderGallery() {
    var images = product.images || [];

    // No photos yet: a quiet blush panel instead of a broken image
    if (!images.length) {
      return (
        '<div class="product-gallery">' +
          '<div class="gallery-main" style="display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--muted);">' +
            'Photo coming soon' +
          '</div>' +
        '</div>'
      );
    }

    var thumbs = images.map(function (image, index) {
      return (
        '<button type="button" class="gallery-thumb' + (index === 0 ? ' is-active' : '') + '" ' +
          'data-image-index="' + index + '" aria-pressed="' + (index === 0 ? 'true' : 'false') + '" ' +
          'aria-label="Show photo ' + (index + 1) + ' of ' + images.length + '">' +
          '<img src="' + BB.escapeHtml(image.url) + '" alt="" loading="lazy">' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="product-gallery">' +
        '<div class="gallery-main">' +
          '<img id="gallery-main" src="' + BB.escapeHtml(images[0].url) + '" ' +
            'alt="' + BB.escapeHtml(images[0].alt || product.name) + '">' +
        '</div>' +
        '<div class="gallery-thumbs" id="gallery-thumbs" role="group" aria-label="Product photos">' +
          thumbs +
        '</div>' +
      '</div>'
    );
  }

  /* --------------------------- Info panel --------------------------------- */
  function renderInfoPanel() {
    var categoryLink = '';
    if (product.categories && product.categories.slug) {
      categoryLink = '<a class="card-category" href="shop.html?category=' +
        BB.escapeHtml(product.categories.slug) + '">' + BB.escapeHtml(product.categories.name) + '</a>';
    }

    var priceHtml = BB.formatPrice(product.price) +
      (product.compare_at_price ? ' <s>' + BB.escapeHtml(BB.formatPrice(product.compare_at_price)) + '</s>' : '');

    var availabilityNote = product.is_available
      ? '<p class="product-availability-note">Handcrafted fresh daily</p>'
      : '<p class="product-availability-note is-out">Currently sold out</p>';

    return (
      '<div class="product-info">' +
        categoryLink +
        '<h1 class="product-name">' + BB.escapeHtml(product.name) + '</h1>' +
        '<p class="product-price">' + priceHtml + '</p>' +
        (product.short_description ? '<p class="product-short">' + BB.escapeHtml(product.short_description) + '</p>' : '') +
        availabilityNote +
        '<div id="option-groups">' + renderOptionGroups() + '</div>' +
        renderBuyRow() +
        '<p class="line-total" id="line-total" aria-live="polite">Total: ' +
          BB.escapeHtml(BB.formatPrice(product.price)) + '</p>' +
        '<div class="product-wishlist-row">' +
          '<button type="button" class="btn btn-outline" id="wishlist-btn" aria-pressed="false">' +
            HEART_SVG + '<span id="wishlist-label">Save to wishlist</span>' +
          '</button>' +
        '</div>' +
        renderAccordions() +
      '</div>'
    );
  }

  /* --------------------------- Option groups ------------------------------ */
  function renderOptionGroups() {
    if (!product.options || !product.options.length) return '';

    return product.options.map(function (option, groupIndex) {
      // Required groups start unselected; optional groups start on "None" (-1)
      selectedChoices.set(groupIndex, option.is_required ? null : -1);

      var chips = '';
      if (!option.is_required) {
        chips += optionChipHtml(groupIndex, -1, 'None', 0, true);
      }
      (option.choices || []).forEach(function (choice, choiceIndex) {
        chips += optionChipHtml(groupIndex, choiceIndex, choice.label, Number(choice.price_delta) || 0, false);
      });

      return (
        '<div class="option-group" data-group="' + groupIndex + '">' +
          '<span class="option-label">' + BB.escapeHtml(option.name) +
            (option.is_required ? '<small class="option-required">*Required</small>' : '') +
          '</span>' +
          '<div class="option-chips" role="group" aria-label="' + BB.escapeHtml(option.name) + '">' + chips + '</div>' +
          '<p class="option-hint">Please choose an option to continue</p>' +
        '</div>'
      );
    }).join('');
  }

  function optionChipHtml(groupIndex, choiceIndex, label, priceDelta, isSelected) {
    // "Gold leaf accents (+$6.00)" — prices always via BB.formatPrice
    var text = BB.escapeHtml(label);
    if (priceDelta > 0) text += ' (+' + BB.escapeHtml(BB.formatPrice(priceDelta)) + ')';
    return (
      '<button type="button" class="chip' + (isSelected ? ' is-active' : '') + '" ' +
        'data-group="' + groupIndex + '" data-choice="' + choiceIndex + '" ' +
        'aria-pressed="' + (isSelected ? 'true' : 'false') + '">' + text + '</button>'
    );
  }

  /* --------------------------- Buy row ------------------------------------ */
  function renderBuyRow() {
    var addButton = product.is_available
      ? '<button type="button" class="btn btn-primary" id="add-to-cart-btn">Add to Cart</button>'
      : '<button type="button" class="btn btn-primary" id="add-to-cart-btn" disabled>Add to Cart</button>';

    return (
      '<div class="buy-row">' +
        '<div class="qty-stepper">' +
          '<button type="button" id="qty-minus" aria-label="Decrease quantity">&#8722;</button>' +
          '<input type="text" id="qty-input" value="1" readonly inputmode="numeric" aria-label="Quantity">' +
          '<button type="button" id="qty-plus" aria-label="Increase quantity">+</button>' +
        '</div>' +
        addButton +
      '</div>'
    );
  }

  /* --------------------------- Accordions --------------------------------- */
  function renderAccordions() {
    var html = '';

    // Description (only when the bakery wrote one — no filler text)
    if (product.description) {
      html += accordionHtml('Description', '<p>' + BB.escapeHtml(product.description) + '</p>', true);
    }

    // Ingredients & Allergens — graceful fallback when both are empty
    var ingredientsBody = '';
    if (product.ingredients) {
      ingredientsBody += '<p><strong>Ingredients:</strong> ' + BB.escapeHtml(product.ingredients) + '</p>';
    }
    if (product.allergens) {
      ingredientsBody += '<p><strong>Allergens:</strong> ' + BB.escapeHtml(product.allergens) + '</p>';
    }
    if (ingredientsBody) {
      html += accordionHtml('Ingredients &amp; Allergens', ingredientsBody, false);
    } else {
      html += accordionHtml('Ingredients &amp; Allergens',
        '<p>Ask us about ingredients — we are always happy to help.</p>', false);
    }

    // Portion & Storage
    if (product.servings_info) {
      html += accordionHtml('Portion &amp; Storage', '<p>' + BB.escapeHtml(product.servings_info) + '</p>', false);
    }

    return html;
  }

  function accordionHtml(title, bodyHtml, open) {
    return (
      '<details class="accordion"' + (open ? ' open' : '') + '>' +
        '<summary>' + title + '</summary>' +
        '<div class="accordion-body">' + bodyHtml + '</div>' +
      '</details>'
    );
  }

  /* ---------------------------------------------------------------------------
     Event wiring (gallery, options, quantity, add to cart, wishlist)
     --------------------------------------------------------------------------- */
  function wireProductEvents() {
    qtyInput = document.getElementById('qty-input');

    /* Gallery thumbnails: swap the main image + move the .is-active state */
    var thumbsWrap = document.getElementById('gallery-thumbs');
    if (thumbsWrap) {
      thumbsWrap.addEventListener('click', function (event) {
        var thumb = event.target.closest('.gallery-thumb');
        if (!thumb) return;
        var index = Number(thumb.getAttribute('data-image-index'));
        var image = (product.images || [])[index];
        if (!image) return;

        var mainImage = document.getElementById('gallery-main');
        if (mainImage) {
          mainImage.src = image.url;
          mainImage.alt = image.alt || product.name;
        }
        thumbsWrap.querySelectorAll('.gallery-thumb').forEach(function (button) {
          var isActive = button === thumb;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      });
    }

    /* Option chips: single selection per group ("radio" behaviour) */
    var optionGroups = document.getElementById('option-groups');
    if (optionGroups) {
      optionGroups.addEventListener('click', function (event) {
        var chip = event.target.closest('.chip');
        if (!chip) return;

        var groupIndex = Number(chip.getAttribute('data-group'));
        var choiceIndex = Number(chip.getAttribute('data-choice'));
        var option = product.options[groupIndex];
        if (!option) return;

        // Clicking the active chip of an OPTIONAL group reverts it to "None";
        // required groups always keep exactly one choice once selected.
        var next = (!option.is_required && selectedChoices.get(groupIndex) === choiceIndex) ? -1 : choiceIndex;
        selectedChoices.set(groupIndex, next);

        optionGroups.querySelectorAll('.chip[data-group="' + groupIndex + '"]').forEach(function (button) {
          var isActive = Number(button.getAttribute('data-choice')) === next;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        // A valid choice clears that group's validation hint
        var group = optionGroups.querySelector('.option-group[data-group="' + groupIndex + '"]');
        var hint = group ? group.querySelector('.option-hint') : null;
        if (hint) hint.classList.remove('is-visible');

        updateLineTotal();
      });
    }

    /* Quantity stepper (1..99) */
    document.getElementById('qty-minus').addEventListener('click', function () {
      var qty = readQty();
      qtyInput.value = String(Math.max(1, qty - 1));
      updateLineTotal();
    });
    document.getElementById('qty-plus').addEventListener('click', function () {
      var qty = readQty();
      qtyInput.value = String(Math.min(99, qty + 1));
      updateLineTotal();
    });

    /* Add to cart */
    var addButton = document.getElementById('add-to-cart-btn');
    if (addButton) {
      addButton.addEventListener('click', handleAddToCart);
    }

    /* Wishlist toggle */
    var wishlistButton = document.getElementById('wishlist-btn');
    if (wishlistButton) {
      syncWishlistButton();
      wishlistButton.addEventListener('click', function () {
        BB.wishlist.toggle(product.id); // toast comes from the shared layer
        syncWishlistButton();
      });
    }
  }

  function readQty() {
    var qty = parseInt(qtyInput.value, 10);
    if (isNaN(qty) || qty < 1) return 1;
    return Math.min(99, qty);
  }

  /* Sum of price deltas for every chosen (non-"None") option */
  function selectedPriceDelta() {
    var total = 0;
    (product.options || []).forEach(function (option, groupIndex) {
      var choiceIndex = selectedChoices.get(groupIndex);
      if (choiceIndex == null || choiceIndex === -1) return;
      var choice = (option.choices || [])[choiceIndex];
      if (choice) total += Number(choice.price_delta) || 0;
    });
    return total;
  }

  /* Live "Total: X" hint near the Add button */
  function updateLineTotal() {
    var lineTotal = document.getElementById('line-total');
    if (!lineTotal) return;
    var unitPrice = product.price + selectedPriceDelta();
    lineTotal.textContent = 'Total: ' + BB.formatPrice(unitPrice * readQty());
  }

  /* ---------------------------------------------------------------------------
     Add to cart
     --------------------------------------------------------------------------- */
  function handleAddToCart() {
    // 1. Every required option must have a choice
    var missingGroups = [];
    (product.options || []).forEach(function (option, groupIndex) {
      if (option.is_required && selectedChoices.get(groupIndex) == null) {
        missingGroups.push(groupIndex);
      }
    });

    if (missingGroups.length) {
      missingGroups.forEach(function (groupIndex) {
        var group = document.querySelector('.option-group[data-group="' + groupIndex + '"]');
        if (!group) return;
        var hint = group.querySelector('.option-hint');
        if (hint) hint.classList.add('is-visible');
        if (groupIndex === missingGroups[0]) {
          group.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      BB.toast('Please choose the required options first', 'error');
      return;
    }

    // 2. Selected options become cart line data [{name, label, priceDelta}]
    var chosenOptions = [];
    (product.options || []).forEach(function (option, groupIndex) {
      var choiceIndex = selectedChoices.get(groupIndex);
      if (choiceIndex == null || choiceIndex === -1) return;
      var choice = (option.choices || [])[choiceIndex];
      if (!choice) return;
      chosenOptions.push({
        name: option.name,
        label: choice.label,
        priceDelta: Number(choice.price_delta) || 0,
      });
    });

    // 3. Unit price = base price + option deltas. The cart reads is_available
    //    from the object we pass, so send a shallow clone with the adjusted price.
    var unitPrice = product.price + selectedPriceDelta();
    var cartProduct = Object.assign({}, product, { price: unitPrice });

    BB.cart.add({ product: cartProduct, qty: readQty(), options: chosenOptions });
    // Success toast + badge update are handled inside BB.cart.add — no redirect.
  }

  /* ---------------------------------------------------------------------------
     Wishlist button label + pressed state
     --------------------------------------------------------------------------- */
  function syncWishlistButton() {
    var button = document.getElementById('wishlist-btn');
    var label = document.getElementById('wishlist-label');
    if (!button || !label) return;
    var saved = BB.wishlist.has(product.id);
    button.classList.toggle('is-active', saved);
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    label.textContent = saved ? 'Saved to wishlist' : 'Save to wishlist';
  }

  /* ---------------------------------------------------------------------------
     Related products rail ("You may also love")
     --------------------------------------------------------------------------- */
  function loadRelatedProducts() {
    BB.getRelatedProducts(product, 4)
      .then(function (related) {
        if (!related.length) return; // keep the section hidden
        relatedGrid.innerHTML = related.map(BB.renderProductCard).join('');
        relatedSection.hidden = false;
      })
      .catch(function () {
        // Related products are a bonus — fail quietly, never block the page.
      });
  }
})(window.BB);
