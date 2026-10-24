/* =============================================================================
   BUTTER & BLOOM — main.js
   -----------------------------------------------------------------------------
   Shared user-interface behavior used by every page:
     · loads site settings and fills the announcement bar / footer
     · header: mobile drawer, search overlay, cart & wishlist badges
     · shopping cart (localStorage) and wishlist
     · the reusable product card + its "add to cart" / wishlist handlers
     · toasts, confirm dialogs, setup notices for when Supabase is not yet
       connected, and small shared helpers.

   The data layer lives in supabase.js (window.BB). Page-specific scripts
   (home.js, shop.js, ...) run AFTER this file and can use everything on BB.
   ============================================================================= */

(function initSharedUI(BB) {
  'use strict';

  /* ---------------------------------------------------------------------------
     1. Tiny DOM + formatting helpers
     --------------------------------------------------------------------------- */
  BB.escapeHtml = function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const FALLBACK_SYMBOL = '$';
  const FALLBACK_CODE = 'USD';

  BB.currencySymbol = function currencySymbol() {
    return (BB.settings && BB.settings.currency_symbol) || FALLBACK_SYMBOL;
  };

  BB.currencyCode = function currencyCode() {
    return (BB.settings && BB.settings.currency_code) || FALLBACK_CODE;
  };

  /* Every price shown on the public site goes through this function so the
     currency stays configurable from the admin panel. */
  BB.formatPrice = function formatPrice(amount) {
    const value = Number(amount) || 0;
    const formatted = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return BB.currencySymbol() + formatted;
  };

  BB.confirmDialog = function confirmDialog(message) {
    return window.confirm(message);
  };

  /* ---------------------------------------------------------------------------
     2. Toasts
     --------------------------------------------------------------------------- */
  BB.toast = function toast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const element = document.createElement('div');
    element.className = 'toast toast-' + (type || 'info');
    element.setAttribute('role', 'status');
    element.textContent = message;
    container.appendChild(element);
    window.setTimeout(function () {
      element.classList.add('toast-hide');
      window.setTimeout(function () { element.remove(); }, 400);
    }, 3400);
  };

  /* ---------------------------------------------------------------------------
     3. Shopping cart (localStorage)
     ---------------------------------------------------------------------------
     The cart stores a light snapshot of each product (name/price/image) so it
     keeps working when offline. Cart & checkout pages revalidate prices and
     availability against Supabase — Supabase stays the source of truth.
  --------------------------------------------------------------------------- */
  const CART_KEY = 'bb_cart';

  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch (err) { return []; }
  }
  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateBadges();
  }

  /* A "line key" identifies one cart line: same product + same chosen options */
  function buildLineKey(productId, options) {
    const labels = (options || [])
      .map(function (opt) { return opt.label; })
      .sort()
      .join('|');
    return productId + '::' + labels;
  }

  BB.cart = {
    items: function () { return readCart(); },

    count: function () {
      return readCart().reduce(function (sum, item) { return sum + item.qty; }, 0);
    },

    subtotal: function () {
      return readCart().reduce(function (sum, item) {
        const optionsTotal = (item.options || []).reduce(function (s, opt) { return s + (Number(opt.priceDelta) || 0); }, 0);
        return sum + (item.price + optionsTotal) * item.qty;
      }, 0);
    },

    /* options: [{name, label, priceDelta}] */
    add: function add(payload) {
      const product = payload.product;
      const qty = Math.max(1, payload.qty || 1);
      const options = payload.options || [];

      if (!product || product.is_available === false) {
        BB.toast('Sorry, this item is currently sold out.', 'error');
        return false;
      }

      const items = readCart();
      const lineKey = buildLineKey(product.id, options);
      const existing = items.find(function (item) { return item.lineKey === lineKey; });

      if (existing) {
        existing.qty = Math.min(99, existing.qty + qty);
      } else {
        items.push({
          productId: product.id,
          slug: product.slug,
          name: product.name,
          price: Number(product.price) || 0,
          image: product.cover || '',
          qty: qty,
          options: options,
          lineKey: lineKey,
        });
      }
      writeCart(items);
      BB.toast(product.name + ' added to your cart', 'success');
      return true;
    },

    setQty: function setQty(lineKey, qty) {
      const items = readCart();
      const item = items.find(function (row) { return row.lineKey === lineKey; });
      if (!item) return;
      item.qty = Math.max(1, Math.min(99, qty));
      writeCart(items);
    },

    remove: function remove(lineKey) {
      writeCart(readCart().filter(function (item) { return item.lineKey !== lineKey; }));
    },

    clear: function clear() {
      writeCart([]);
    },

    /* Re-sync cart lines with live Supabase prices/availability.
       Returns a summary: {updated, removed:[names]} or null when offline. */
    refreshPrices: async function refreshPrices() {
      if (!BB.configured) return null;
      const items = readCart();
      if (!items.length) return { updated: 0, removed: [] };

      const ids = Array.from(new Set(items.map(function (item) { return item.productId; })));
      const live = await BB.getProductsByIds(ids);
      const liveById = {};
      live.forEach(function (product) { liveById[product.id] = product; });

      const removed = [];
      const kept = [];
      let updated = 0;

      items.forEach(function (item) {
        const product = liveById[item.productId];
        // Drop lines whose product is now unpublished, hidden or sold out.
        if (!product || !product.is_available) { removed.push(item.name); return; }
        if (product.price !== item.price) { item.price = product.price; updated += 1; }
        item.name = product.name;
        if (product.cover) item.image = product.cover;
        item.slug = product.slug;
        kept.push(item);
      });

      writeCart(kept);
      return { updated: updated, removed: removed };
    },
  };

  /* ---------------------------------------------------------------------------
     4. Wishlist (localStorage — list of product ids)
     --------------------------------------------------------------------------- */
  const WISHLIST_KEY = 'bb_wishlist';

  function readWishlist() {
    try { return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); }
    catch (err) { return []; }
  }
  function writeWishlist(ids) {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(ids));
    updateBadges();
  }

  BB.wishlist = {
    ids: function () { return readWishlist(); },
    has: function (id) { return readWishlist().indexOf(id) !== -1; },
    toggle: function toggle(id) {
      let ids = readWishlist();
      if (ids.indexOf(id) === -1) {
        ids.push(id);
        writeWishlist(ids);
        BB.toast('Saved to your wishlist', 'success');
        return true;
      }
      ids = ids.filter(function (row) { return row !== id; });
      writeWishlist(ids);
      BB.toast('Removed from your wishlist', 'info');
      return false;
    },
    count: function () { return readWishlist().length; },
  };

  /* ---------------------------------------------------------------------------
     5. Header badges, drawer & search overlay
     --------------------------------------------------------------------------- */
  function updateBadges() {
    const cartBadge = document.getElementById('cart-badge');
    const wishlistBadge = document.getElementById('wishlist-badge');
    const cartCount = BB.cart.count();
    const wishCount = BB.wishlist.count();
    if (cartBadge) {
      cartBadge.textContent = cartCount > 99 ? '99+' : String(cartCount);
      cartBadge.hidden = cartCount === 0;
    }
    if (wishlistBadge) {
      wishlistBadge.textContent = wishCount > 99 ? '99+' : String(wishCount);
      wishlistBadge.hidden = wishCount === 0;
    }
  }
  BB.updateBadges = updateBadges;

  function wireDrawer() {
    const drawer = document.getElementById('mobile-drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const toggle = document.getElementById('nav-toggle');
    const closeBtn = document.getElementById('drawer-close');
    if (!drawer || !backdrop || !toggle) return;

    function setDrawer(open) {
      drawer.classList.toggle('is-open', open);
      backdrop.classList.toggle('is-open', open);
      backdrop.hidden = !open;
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    }

    toggle.addEventListener('click', function () { setDrawer(!drawer.classList.contains('is-open')); });
    backdrop.addEventListener('click', function () { setDrawer(false); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setDrawer(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setDrawer(false);
    });
    // Close when a navigation link is clicked
    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { setDrawer(false); });
    });

    // Highlight the current page's link
    const page = location.pathname.split('/').pop() || 'index.html';
    drawer.querySelectorAll('a').forEach(function (link) {
      const target = link.getAttribute('href');
      if (target === page) link.classList.add('is-active');
    });
  }

  function wireSearch() {
    const overlay = document.getElementById('search-overlay');
    const toggle = document.getElementById('search-toggle');
    const closeBtn = document.getElementById('search-close');
    const input = document.getElementById('search-input');
    if (!overlay || !toggle) return;

    function setSearch(open) {
      overlay.classList.toggle('is-open', open);
      overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && input) window.setTimeout(function () { input.focus(); }, 120);
    }

    toggle.addEventListener('click', function () { setSearch(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setSearch(false); });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) setSearch(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setSearch(false);
    });
  }

  /* ---------------------------------------------------------------------------
     6. Product card renderer + delegated card actions
     --------------------------------------------------------------------------- */
  BB._productCache = new Map();

  const HEART_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5 C7 16.5 3.5 13.3 3.5 9.6 C3.5 7 5.6 5 8.1 5 C9.7 5 11.2 5.8 12 7.1 C12.8 5.8 14.3 5 15.9 5 C18.4 5 20.5 7 20.5 9.6 C20.5 13.3 17 16.5 12 20.5 Z"/></svg>';

  BB.renderProductCard = function renderProductCard(product) {
    BB._productCache.set(product.id, product);

    const name = BB.escapeHtml(product.name);
    const slug = BB.escapeHtml(product.slug);
    const shortDesc = BB.escapeHtml(product.short_description || '');
    const categoryName = product.categories ? BB.escapeHtml(product.categories.name) : '';
    const cover = product.cover || '';
    const alt = BB.escapeHtml((product.images && product.images[0] && product.images[0].alt) || product.name);
    const hasRequiredOptions = (product.options || []).some(function (option) { return option.is_required; });

    let badges = '';
    if (product.is_best_seller) badges += '<span class="badge badge-caramel">Best Seller</span>';
    if (product.is_new) badges += '<span class="badge badge-blush">New</span>';
    if (!product.is_available) badges += '<span class="badge badge-soft">Sold out</span>';

    const priceHtml = BB.formatPrice(product.price) +
      (product.compare_at_price ? ' <s>' + BB.formatPrice(product.compare_at_price) + '</s>' : '');

    let actionHtml;
    if (!product.is_available) {
      actionHtml = '<button class="btn btn-small" disabled>Sold out</button>';
    } else if (hasRequiredOptions) {
      actionHtml = '<a class="btn btn-small btn-outline" href="product.html?slug=' + slug + '">Choose options</a>';
    } else {
      actionHtml = '<button class="btn btn-small btn-primary add-to-cart" data-add-id="' + BB.escapeHtml(product.id) + '">Add</button>';
    }

    const wishActive = BB.wishlist.has(product.id) ? ' is-active' : '';

    return (
      '<article class="product-card">' +
        '<a class="card-media" href="product.html?slug=' + slug + '" aria-label="View ' + name + '">' +
          '<img src="' + BB.escapeHtml(cover) + '" alt="' + alt + '" loading="lazy">' +
          badges +
        '</a>' +
        '<button class="wishlist-toggle' + wishActive + '" data-wishlist-id="' + BB.escapeHtml(product.id) + '" ' +
          'aria-pressed="' + (wishActive ? 'true' : 'false') + '" aria-label="Save ' + name + ' to wishlist">' + HEART_SVG + '</button>' +
        '<div class="card-body">' +
          (categoryName ? '<p class="card-category">' + categoryName + '</p>' : '') +
          '<h3 class="card-title"><a href="product.html?slug=' + slug + '">' + name + '</a></h3>' +
          (shortDesc ? '<p class="card-desc">' + shortDesc + '</p>' : '') +
          '<div class="card-foot">' +
            '<span class="price">' + priceHtml + '</span>' +
            actionHtml +
          '</div>' +
        '</div>' +
      '</article>'
    );
  };

  /* Wire the whole document once: card buttons work anywhere on any page */
  function wireCardActions() {
    document.addEventListener('click', function (event) {
      const addButton = event.target.closest('.add-to-cart');
      if (addButton && !addButton.disabled) {
        const product = BB._productCache.get(addButton.getAttribute('data-add-id'));
        if (product) BB.cart.add({ product: product, qty: 1, options: [] });
        return;
      }

      const wishButton = event.target.closest('.wishlist-toggle');
      if (wishButton) {
        const productId = wishButton.getAttribute('data-wishlist-id');
        const isActive = BB.wishlist.toggle(productId);
        // Refresh every toggle for the same product on this page
        document.querySelectorAll('[data-wishlist-id="' + productId + '"]').forEach(function (element) {
          element.classList.toggle('is-active', isActive);
          element.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      }
    });
  }

  /* ---------------------------------------------------------------------------
     7. Shared render helpers for loading / empty / error / setup states
     --------------------------------------------------------------------------- */
  const EMPTY_ICON =
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21 L16.5 16.5"/></svg>';

  BB.setupNoticeHtml = function setupNoticeHtml() {
    return (
      '<div class="setup-notice">' +
        '<h3>Connect Supabase to bring this section to life</h3>' +
        '<p>This portfolio template reads all products, categories and settings from a free ' +
        'Supabase project. Paste your project URL and anon key into <code>supabase.js</code>, run ' +
        '<code>supabase-schema.sql</code> and <code>supabase-seed.sql</code>, and the full demo catalog ' +
        'will appear here. Step-by-step instructions are in the <code>README.md</code>.</p>' +
      '</div>'
    );
  };

  BB.errorStateHtml = function errorStateHtml(message) {
    return (
      '<div class="error-state">' +
        '<div class="empty-icon">' + EMPTY_ICON + '</div>' +
        '<h3>Something went wrong</h3>' +
        '<p>' + BB.escapeHtml(message || 'We could not load this section. Please try again in a moment.') + '</p>' +
      '</div>'
    );
  };

  BB.emptyStateHtml = function emptyStateHtml(title, text, ctaHtml) {
    return (
      '<div class="empty-state">' +
        '<div class="empty-icon">' + EMPTY_ICON + '</div>' +
        '<h3>' + BB.escapeHtml(title || 'Nothing here yet') + '</h3>' +
        '<p>' + BB.escapeHtml(text || '') + '</p>' +
        (ctaHtml || '') +
      '</div>'
    );
  };

  BB.skeletonGridHtml = function skeletonGridHtml(count) {
    let cards = '';
    const n = count || 8;
    for (let i = 0; i < n; i += 1) {
      cards += (
        '<div class="skeleton-card">' +
          '<div class="skeleton skeleton-img"></div>' +
          '<div class="skeleton skeleton-line"></div>' +
          '<div class="skeleton skeleton-line short"></div>' +
        '</div>'
      );
    }
    return '<div class="skeleton-grid">' + cards + '</div>';
  };

  /* Any element with class "needs-data" is replaced by the setup notice
     automatically when Supabase has not been configured yet.
     NOTE for page scripts: this runs once at boot. If YOUR script injects new
     ".needs-data" elements later (e.g. after an async fetch), call
     BB.mountSetupNotices() again yourself. */
  function mountSetupNotices() {
    if (BB.configured) return;
    document.querySelectorAll('.needs-data').forEach(function (element) {
      element.innerHTML = BB.setupNoticeHtml();
    });
  }
  BB.mountSetupNotices = mountSetupNotices;

  /* ---------------------------------------------------------------------------
     8. Settings-driven chrome: announcement bar, footer, drawer hours
     --------------------------------------------------------------------------- */
  function renderAnnouncement() {
    const bar = document.getElementById('announcement-bar');
    if (!bar) return;
    const settings = BB.settings;
    if (settings && settings.announcement_enabled && settings.announcement_text) {
      bar.textContent = settings.announcement_text;
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  function renderFooter() {
    const settings = BB.settings;
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    if (!settings) return;

    const hoursEl = document.getElementById('footer-hours');
    if (hoursEl && Array.isArray(settings.opening_hours)) {
      hoursEl.innerHTML = settings.opening_hours.map(function (row) {
        return '<div class="hours-row"><span>' + BB.escapeHtml(row.label) + '</span><span>' + BB.escapeHtml(row.hours) + '</span></div>';
      }).join('');
    }

    const contactEl = document.getElementById('footer-contact');
    if (contactEl) {
      let html = '';
      if (settings.address) html += '<p>' + BB.escapeHtml(settings.address) + '</p>';
      if (settings.phone) html += '<a href="tel:' + BB.escapeHtml(settings.phone) + '">' + BB.escapeHtml(settings.phone) + '</a>';
      if (settings.email) html += '<a href="mailto:' + BB.escapeHtml(settings.email) + '">' + BB.escapeHtml(settings.email) + '</a>';
      contactEl.innerHTML = html || '<p>Say hello — we would love to hear from you.</p>';
    }

    renderSocials('footer-socials', settings);
    renderSocials('drawer-socials', settings);

    const drawerHours = document.getElementById('drawer-hours');
    if (drawerHours && Array.isArray(settings.opening_hours)) {
      drawerHours.textContent = settings.opening_hours
        .map(function (row) { return row.label + '  ·  ' + row.hours; })
        .join('\n');
    }
  }

  function renderSocials(containerId, settings) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const links = [];
    if (settings.instagram_url) links.push(['instagram', settings.instagram_url]);
    if (settings.facebook_url) links.push(['facebook', settings.facebook_url]);
    if (settings.tiktok_url) links.push(['tiktok', settings.tiktok_url]);
    if (!links.length) { container.innerHTML = ''; return; }

    const ICONS = {
      instagram: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>',
      facebook: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14.5 8.5 H17 V5.5 H14.5 C12.6 5.5 11 7.1 11 9 V11 H8.5 V14 H11 V20.5 H14 V14 H16.6 L17 11 H14 V9.2 C14 8.8 14.2 8.5 14.5 8.5 Z"/></svg>',
      tiktok: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 4 V15.2 A3.8 3.8 0 1 1 9.6 11.5"/><path d="M14 5.5 C14.6 8 16.5 9.5 19 9.6"/></svg>',
    };
    container.innerHTML = links.map(function (pair) {
      return '<a href="' + BB.escapeHtml(pair[1]) + '" target="_blank" rel="noopener" aria-label="Butter and Bloom on ' + pair[0] + '">' + ICONS[pair[0]] + '</a>';
    }).join('');
  }

  /* ---------------------------------------------------------------------------
     9. Boot sequence
     --------------------------------------------------------------------------- */
  BB.ready = (async function boot() {
    // Paint cached settings immediately if we have them (avoids flicker)
    if (!BB.settings) BB.settings = readCachedSettingsSilently();
    function readCachedSettingsSilently() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || 'null'); } catch (err) { return null; }
    }

    // Load fresh settings from Supabase (when configured)
    try { await BB.getSettings(); } catch (err) { console.warn(err); }

    renderAnnouncement();
    renderFooter();
    updateBadges();
    wireDrawer();
    wireSearch();
    wireCardActions();
    mountSetupNotices();
  })();

  /* Re-render announcement/footer if a page script changes settings */
  BB.refreshChrome = async function refreshChrome() {
    await BB.getSettings();
    renderAnnouncement();
    renderFooter();
  };
})(window.BB);
