/* =============================================================================
   BUTTER & BLOOM — admin.js (admin panel CORE)
   -----------------------------------------------------------------------------
   Responsibilities (admin-operations.js, loaded after this file, adds the
   orders / cake requests / reservations / messages / settings / demo tabs):

     1. window.AdminUI      — shared admin helpers (modals, formatting, badges,
                              busy buttons, error panels) used by BOTH files.
     2. window.AdminPanels  — the tab/panel registry. Each tab registers a
                              loader; activating a tab always (re)runs its
                              loader, so re-clicking a tab refreshes its data.
     3. Auth flow           — sign in / sign out / session restore, with the
                              login card shown first and the shell hidden.
     4. Dashboard           — stat cards + recent orders + quick actions.
     5. Products            — filterable table + the full product editor modal
                              (details, flags, collections, images, options).
     6. Categories/Collections — simple CRUD tables + editor modal.

   Conventions: everything user-generated goes through BB.escapeHtml; every
   price through BB.formatPrice; every destructive action through
   BB.confirmDialog; no fake success — errors always surface as toasts or
   inline states.
   ============================================================================= */

(function initAdminCore(BB) {
  'use strict';

  /* ===========================================================================
     1. SHARED HELPERS (window.AdminUI) — also used by admin-operations.js
     =========================================================================== */

  function esc(value) {
    return BB.escapeHtml(value);
  }

  /* Date-only strings ("2025-03-14") are parsed as LOCAL dates to avoid the
     UTC off-by-one day some timezones would produce with new Date(string). */
  function fmtDate(value) {
    if (value === null || value === undefined || value === '') return '—';
    const str = String(value);
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const parts = str.split('-').map(Number);
      date = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      date = new Date(str);
    }
    if (isNaN(date.getTime())) return str;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(value) {
    if (value === null || value === undefined || value === '') return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
           date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* "Vanilla Bean Cake!" -> "vanilla-bean-cake" */
  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  const X_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  /* One modal at a time. Returns the backdrop element (the .modal lives
     inside it). opts.onClose fires on EVERY close path (X, Escape, backdrop
     click, programmatic) so callers can clean up after themselves. */
  let activeModal = null;

  function openModal(innerHtml, opts) {
    closeModal();
    const options = opts || {};
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = innerHtml;
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    activeModal = { element: backdrop, onClose: options.onClose || null };

    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) closeModal();
    });
    backdrop.querySelectorAll('[data-close-modal]').forEach(function (element) {
      element.addEventListener('click', function () { closeModal(); });
    });

    const firstField = backdrop.querySelector('input:not([type="hidden"]), textarea, select');
    const closeBtn = backdrop.querySelector('[data-close-modal]');
    if (firstField) firstField.focus();
    else if (closeBtn) closeBtn.focus();
    return backdrop;
  }

  function closeModal() {
    if (!activeModal) return;
    const current = activeModal;
    activeModal = null;
    current.element.remove();
    document.body.style.overflow = '';
    if (typeof current.onClose === 'function') {
      try { current.onClose(); } catch (err) { console.error(err); }
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeModal();
  });

  /* Turn a button into its busy state (spinner + label) and back. */
  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      if (button.getAttribute('data-busy') !== '1') {
        button.setAttribute('data-busy', '1');
        button.setAttribute('data-label', button.textContent);
      }
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + esc(busyLabel || '');
    } else {
      const label = button.getAttribute('data-label');
      button.disabled = false;
      if (label !== null) button.textContent = label;
      button.removeAttribute('data-busy');
      button.removeAttribute('data-label');
    }
  }

  /* Status -> badge maps shared by both admin files. */
  const ORDER_STATUS_BADGES = {
    pending:   ['Pending',   'badge-blush'],
    confirmed: ['Confirmed', 'badge-caramel'],
    preparing: ['Preparing', 'badge-caramel'],
    ready:     ['Ready',     'badge-blush'],
    completed: ['Completed', 'badge-success'],
    cancelled: ['Cancelled', 'badge-danger'],
  };
  const REQUEST_STATUS_BADGES = {
    pending:   ['Pending',   'badge-blush'],
    accepted:  ['Accepted',  'badge-success'],
    rejected:  ['Rejected',  'badge-soft'],
    completed: ['Completed', 'badge-caramel'],
    cancelled: ['Cancelled', 'badge-danger'],
  };

  function statusBadge(map, status) {
    const entry = map[status] || [String(status || '—'), 'badge-soft'];
    return '<span class="badge ' + entry[1] + '">' + esc(entry[0]) + '</span>';
  }

  /* Error panel with an optional "Try again" button. */
  function renderError(container, err, retry) {
    if (!container) return;
    const message = err && err.message ? err.message : 'Something went wrong. Please try again.';
    container.innerHTML = BB.errorStateHtml(message);
    const box = container.querySelector('.error-state');
    if (box && typeof retry === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = 'Try again';
      button.addEventListener('click', retry);
      box.appendChild(button);
    }
  }

  /* Loading placeholders that match the real layouts. */
  function skeletonTable(cols, rows) {
    const colCount = cols || 5;
    const rowCount = rows || 5;
    let head = '';
    for (let c = 0; c < colCount; c += 1) head += '<th><span class="visually-hidden">Loading</span></th>';
    let bodyRows = '';
    for (let r = 0; r < rowCount; r += 1) {
      let cells = '';
      for (let c = 0; c < colCount; c += 1) cells += '<td><div class="skeleton skeleton-cell"></div></td>';
      bodyRows += '<tr>' + cells + '</tr>';
    }
    return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + '</tbody></table></div>';
  }

  function skeletonCards(count) {
    const n = count || 4;
    let tiles = '';
    for (let i = 0; i < n; i += 1) {
      tiles +=
        '<div class="request-card">' +
          '<div class="skeleton skeleton-cell tall"></div>' +
          '<div class="skeleton skeleton-cell"></div>' +
          '<div class="skeleton skeleton-cell short"></div>' +
        '</div>';
    }
    return '<div class="request-cards">' + tiles + '</div>';
  }

  function skeletonLines(count) {
    const n = count || 3;
    let lines = '';
    for (let i = 0; i < n; i += 1) lines += '<div class="skeleton skeleton-line-row"></div>';
    return lines;
  }

  window.AdminUI = {
    esc: esc,
    fmt: function (amount) { return BB.formatPrice(amount); },
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    slugify: slugify,
    X_SVG: X_SVG,
    openModal: openModal,
    closeModal: closeModal,
    setButtonBusy: setButtonBusy,
    statusBadge: statusBadge,
    ORDER_STATUS_BADGES: ORDER_STATUS_BADGES,
    REQUEST_STATUS_BADGES: REQUEST_STATUS_BADGES,
    renderError: renderError,
    skeletonTable: skeletonTable,
    skeletonCards: skeletonCards,
    skeletonLines: skeletonLines,
  };

  /* ===========================================================================
     2. TAB / PANEL REGISTRY (window.AdminPanels)
     ---------------------------------------------------------------------------
     admin.js registers: dashboard, products, categories, collections.
     admin-operations.js registers: orders, cakes, reservations, messages,
     settings, demo. Activation is lazy — a panel's loader runs every time the
     tab becomes active, so data is always fresh.
     =========================================================================== */

  const TAB_NAMES = ['dashboard', 'products', 'orders', 'cakes', 'reservations', 'messages', 'categories', 'collections', 'settings', 'demo'];

  function activatePanel(name) {
    if (TAB_NAMES.indexOf(name) === -1) name = 'dashboard';

    document.querySelectorAll('.admin-tab').forEach(function (tab) {
      const isActive = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.admin-panel').forEach(function (panel) {
      panel.classList.toggle('is-active', panel.id === 'panel-' + name);
    });

    AdminPanels.active = name;
    const loader = AdminPanels.loaders[name];
    if (typeof loader === 'function') {
      /* Loaders handle their own errors — but never let one break the shell. */
      try {
        const result = loader();
        if (result && typeof result.catch === 'function') {
          result.catch(function (err) { console.error('[' + name + '] loader failed:', err); });
        }
      } catch (err) {
        console.error('[' + name + '] loader failed:', err);
      }
    }
  }

  /* Same behaviour as clicking a tab: re-click (or same-hash click) refreshes. */
  function gotoPanel(name) {
    if (AdminPanels.active === name) activatePanel(name);
    else location.hash = name; /* hashchange listener does the activation */
  }

  function activateFromHash() {
    activatePanel(location.hash.replace('#', ''));
  }

  window.AdminPanels = {
    loaders: {},
    active: null,
    register: function (name, loader) { this.loaders[name] = loader; },
    activate: activatePanel,
    goto: gotoPanel,
  };

  /* ===========================================================================
     3. AUTH FLOW
     =========================================================================== */

  function byId(id) { return document.getElementById(id); }

  let shellShown = false;

  function showLoginError(message) {
    const box = byId('login-error');
    box.textContent = message;
    box.hidden = false;
    box.classList.add('is-visible');
  }

  function clearLoginError() {
    const box = byId('login-error');
    box.textContent = '';
    box.hidden = true;
    box.classList.remove('is-visible');
  }

  function showLogin() {
    shellShown = false;
    byId('admin-shell').classList.remove('is-visible');
    byId('admin-login').hidden = false;
    byId('admin-user').textContent = '';
    byId('login-password').value = '';
    AdminUI.setButtonBusy(byId('logout-btn'), false);
    AdminUI.setButtonBusy(byId('login-submit'), false);
    AdminPanels.active = null; /* panels reload (with fresh data) on next sign-in */
  }

  function showShell(user) {
    if (shellShown) return; /* auth events can double-fire — stay idempotent */
    shellShown = true;
    byId('admin-login').hidden = true;
    byId('admin-shell').classList.add('is-visible');
    byId('admin-user').textContent = user && user.email ? user.email : '';
    activateFromHash(); /* deep link (#products) or dashboard */
  }

  function wireAuth() {
    byId('login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const email = byId('login-email').value.trim();
      const password = byId('login-password').value;
      clearLoginError();
      if (!email || !password) {
        showLoginError('Enter your email and password.');
        return;
      }
      const button = byId('login-submit');
      AdminUI.setButtonBusy(button, true, 'Signing in...');
      try {
        const { data, error } = await BB.sb.auth.signInWithPassword({ email: email, password: password });
        if (error) throw error;
        showShell(data.user);
      } catch (err) {
        showLoginError(err && err.message ? err.message : 'Sign in failed. Please try again.');
        BB.toast(err && err.message ? err.message : 'Sign in failed', 'error');
      } finally {
        AdminUI.setButtonBusy(button, false);
      }
    });

    byId('logout-btn').addEventListener('click', async function (event) {
      const button = event.currentTarget;
      AdminUI.setButtonBusy(button, true, 'Logging out...');
      try {
        await BB.sb.auth.signOut(); /* onAuthStateChange below flips to the login card */
      } catch (err) {
        AdminUI.setButtonBusy(button, false);
        BB.toast(err && err.message ? err.message : 'Could not sign out.', 'error');
      }
    });

    /* React to sessions ending elsewhere (e.g. password change in another tab).
       Only possible when a Supabase client exists (BB.configured). */
    if (BB.configured && BB.sb) {
      BB.sb.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT') {
          showLogin();
          BB.toast('Signed out', 'info');
        } else if (event === 'SIGNED_IN' && session && session.user && !shellShown) {
          showShell(session.user);
        }
      });
    }
  }

  function wireTabs() {
    document.querySelectorAll('.admin-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { gotoPanel(tab.getAttribute('data-tab')); });
    });
    window.addEventListener('hashchange', activateFromHash);
  }

  /* ===========================================================================
     4. DASHBOARD
     =========================================================================== */

  const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

  async function loadDashboard() {
    const body = byId('dashboard-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML =
      '<div class="stat-cards">' +
        '<div class="skeleton skeleton-stat"></div>' +
        '<div class="skeleton skeleton-stat"></div>' +
        '<div class="skeleton skeleton-stat"></div>' +
        '<div class="skeleton skeleton-stat"></div>' +
      '</div>' + AdminUI.skeletonLines(4);

    try {
      const results = await Promise.all([
        BB.getAllProductsAdmin(),
        BB.getOrdersAdmin('all'),
        BB.getCakeRequestsAdmin('all'),
        BB.getMessagesAdmin(),
      ]);
      const products = results[0];
      const orders = results[1];
      const cakes = results[2];
      const messages = results[3];

      const openOrders = orders.filter(function (o) { return OPEN_ORDER_STATUSES.indexOf(o.status) !== -1; }).length;
      const pendingCakes = cakes.filter(function (c) { return c.status === 'pending'; }).length;
      const unreadMessages = messages.filter(function (m) { return !m.is_read; }).length;

      const recent = orders.slice(0, 5);
      const recentRows = recent.map(function (order) {
        return (
          '<tr>' +
            '<td class="cell-strong">' + esc(order.order_number) + '</td>' +
            '<td>' + esc(order.customer_name) + '</td>' +
            '<td>' + AdminUI.fmt(order.total) + '</td>' +
            '<td>' + AdminUI.statusBadge(AdminUI.ORDER_STATUS_BADGES, order.status) + '</td>' +
            '<td class="cell-muted">' + AdminUI.fmtDateTime(order.created_at) + '</td>' +
          '</tr>'
        );
      }).join('');

      body.innerHTML =
        '<div class="stat-cards">' +
          statCard(String(products.length), 'Products') +
          statCard(String(openOrders), 'Open orders') +
          statCard(String(pendingCakes), 'Pending cake requests') +
          statCard(String(unreadMessages), 'Unread messages') +
        '</div>' +
        '<div class="dashboard-actions">' +
          '<button type="button" class="btn btn-outline" data-goto="products">Manage products</button>' +
          '<button type="button" class="btn btn-outline" data-goto="orders">Process orders</button>' +
          '<button type="button" class="btn btn-outline" data-goto="cakes">Review cake requests</button>' +
          '<button type="button" class="btn btn-outline" data-goto="messages">Read messages</button>' +
        '</div>' +
        '<h3>Recent orders</h3>' +
        (recent.length
          ? '<div class="admin-table-wrap"><table class="admin-table">' +
              '<thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>' +
              '<tbody>' + recentRows + '</tbody></table></div>'
          : BB.emptyStateHtml('No orders yet', 'Customer orders will appear here as soon as the first one comes in.'));

      body.querySelectorAll('[data-goto]').forEach(function (button) {
        button.addEventListener('click', function () { AdminPanels.goto(button.getAttribute('data-goto')); });
      });
    } catch (err) {
      AdminUI.renderError(body, err, loadDashboard);
      BB.toast(err && err.message ? err.message : 'Could not load the dashboard.', 'error');
    }
  }

  function statCard(number, label) {
    return (
      '<div class="stat-card-admin">' +
        '<div class="stat-num">' + esc(number) + '</div>' +
        '<div class="stat-label">' + esc(label) + '</div>' +
      '</div>'
    );
  }

  /* ===========================================================================
     5. PRODUCTS
     =========================================================================== */

  const productState = {
    products: [],
    categories: [],  /* ALL categories (active + inactive) for filters and the editor */
    collections: [], /* ALL collections for the seasonal chips */
  };

  /* BB.getCategories()/getCollections() only return ACTIVE rows (they serve the
     public site). The admin must also see inactive rows — the authenticated
     RLS policies allow it — so we query the tables directly here. */
  async function fetchAdminRows(table) {
    const { data, error } = await BB.sb.from(table).select('*').order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function loadProductsTab() {
    const body = byId('products-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonTable(8, 6);
    try {
      const catsAndCols = await Promise.all([fetchAdminRows('categories'), fetchAdminRows('collections')]);
      productState.categories = catsAndCols[0];
      productState.collections = catsAndCols[1];
      fillCategoryFilter();
      productState.products = await BB.getAllProductsAdmin();
      renderProducts();
    } catch (err) {
      AdminUI.renderError(body, err, loadProductsTab);
      BB.toast(err && err.message ? err.message : 'Could not load products.', 'error');
    }
  }

  function fillCategoryFilter() {
    const select = byId('product-category-filter');
    const previous = select.value;
    select.innerHTML = '<option value="all">All categories</option>' + productState.categories.map(function (category) {
      return '<option value="' + esc(category.id) + '">' + esc(category.name) + '</option>';
    }).join('');
    if (previous && previous !== 'all') select.value = previous; /* keep the current choice */
    if (select.value !== previous) select.value = 'all';
  }

  /* Status shown in the table column:
     !is_published -> Draft | is_published && !is_visible -> Hidden | else Live */
  function productStatus(product) {
    if (!product.is_published) return ['Draft', 'badge-soft'];
    if (!product.is_visible) return ['Hidden', 'badge-blush'];
    return ['Live', 'badge-success'];
  }

  function productFlagsHtml(product) {
    let dots = '';
    if (product.is_featured) dots += '<span class="flag-dot on-featured" title="Featured"></span>';
    if (product.is_best_seller) dots += '<span class="flag-dot on-best" title="Best seller"></span>';
    if (product.is_new) dots += '<span class="flag-dot on-new" title="New"></span>';
    if (!product.is_available) dots += '<span class="flag-dot on-unavailable" title="Unavailable"></span>';
    const demoBadge = product.is_demo ? ' <span class="badge badge-demo">Demo</span>' : '';
    return '<span class="flag-dots">' + (dots || '<span class="cell-muted">—</span>') + '</span>' + demoBadge;
  }

  function renderProducts() {
    const body = byId('products-body');
    const term = byId('product-search').value.trim().toLowerCase();
    const category = byId('product-category-filter').value;
    const status = byId('product-status-filter').value;

    const list = productState.products.filter(function (product) {
      if (term && String(product.name || '').toLowerCase().indexOf(term) === -1) return false;
      if (category !== 'all' && String(product.category_id || '') !== category) return false;
      if (status === 'demo' && !product.is_demo) return false;
      if (status === 'draft' && product.is_published) return false;
      if (status === 'hidden' && !(product.is_published && !product.is_visible)) return false;
      if (status === 'published' && !(product.is_published && product.is_visible)) return false;
      return true;
    });

    if (!list.length) {
      body.innerHTML = BB.emptyStateHtml(
        productState.products.length ? 'No products match your filters' : 'No products yet',
        productState.products.length
          ? 'Try a different search, category or status filter.'
          : 'Add your first product with the "+ Add Product" button above.',
      );
      return;
    }

    const rows = list.map(function (product) {
      const status = productStatus(product);
      const thumb = product.cover
        ? '<img class="thumb-cell" src="' + esc(product.cover) + '" alt="' + esc(product.name) + '" loading="lazy">'
        : '<span class="thumb-cell thumb-empty" aria-hidden="true"></span>';
      const id = esc(product.id);
      return (
        '<tr>' +
          '<td>' + thumb + '</td>' +
          '<td><div class="cell-strong">' + esc(product.name) + '</div><div class="cell-muted">' + esc(product.slug) + '</div></td>' +
          '<td>' + (product.categories ? esc(product.categories.name) : '<span class="cell-muted">—</span>') + '</td>' +
          '<td>' + AdminUI.fmt(product.price) + '</td>' +
          '<td>' + productFlagsHtml(product) + '</td>' +
          '<td><span class="badge ' + status[1] + '">' + status[0] + '</span></td>' +
          '<td class="cell-muted">' + AdminUI.fmtDate(product.updated_at || product.created_at) + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-outline" data-action="edit" data-id="' + id + '">Edit</button>' +
            '<button type="button" class="btn btn-outline" data-action="toggle-publish" data-id="' + id + '">' + (product.is_published ? 'Unpublish' : 'Publish') + '</button>' +
            '<button type="button" class="btn btn-outline" data-action="toggle-visible" data-id="' + id + '">' + (product.is_visible ? 'Hide' : 'Show') + '</button>' +
            '<button type="button" class="btn btn-danger" data-action="delete" data-id="' + id + '">Delete</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>Image</th><th>Product</th><th>Category</th><th>Price</th><th>Flags</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  function wireProductsToolbar() {
    byId('product-search').addEventListener('input', renderProducts);
    byId('product-category-filter').addEventListener('change', renderProducts);
    byId('product-status-filter').addEventListener('change', renderProducts);
    byId('add-product-btn').addEventListener('click', function () { openProductEditor(null); });

    /* One delegated handler covers every row button, including re-rendered rows. */
    byId('products-body').addEventListener('click', function (event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const product = productState.products.find(function (p) { return p.id === button.getAttribute('data-id'); });
      if (!product) return;
      const action = button.getAttribute('data-action');
      if (action === 'edit') openProductEditor(product.id);
      else if (action === 'toggle-publish') toggleProductFlag(product, 'is_published', button);
      else if (action === 'toggle-visible') toggleProductFlag(product, 'is_visible', button);
      else if (action === 'delete') deleteProductRow(product, button);
    });
  }

  async function toggleProductFlag(product, field, button) {
    const patch = {};
    patch[field] = !product[field];
    AdminUI.setButtonBusy(button, true, '...');
    try {
      await BB.updateProduct(product.id, patch);
      const verb = field === 'is_published'
        ? (patch[field] ? 'published' : 'unpublished')
        : (patch[field] ? 'shown on the site' : 'hidden from the site');
      BB.toast('Product ' + verb + '.', 'success');
      await loadProductsTab(); /* refetch keeps every column honest */
    } catch (err) {
      AdminUI.setButtonBusy(button, false);
      BB.toast(err && err.message ? err.message : 'Could not update the product.', 'error');
    }
  }

  async function deleteProductRow(product, button) {
    const confirmed = BB.confirmDialog('Permanently delete "' + product.name + '"? This cannot be undone.');
    if (!confirmed) return;
    AdminUI.setButtonBusy(button, true, '...');
    try {
      /* Collect the image URLs first so their storage files can be cleaned up
         after the row is gone (the helper skips files still used elsewhere). */
      let imageUrls = [];
      try {
        const fresh = await BB.getProductByIdAdmin(product.id);
        imageUrls = ((fresh && fresh.images) || []).map(function (image) { return image.url; });
      } catch (lookupErr) { /* deletion proceeds even if the lookup failed */ }

      await BB.deleteProduct(product.id);
      await BB.deleteStorageObjectsIfUnused(imageUrls);
      BB.toast('Product deleted.', 'success');
      await loadProductsTab();
    } catch (err) {
      AdminUI.setButtonBusy(button, false);
      BB.toast(err && err.message ? err.message : 'Could not delete the product.', 'error');
    }
  }

  /* ---------------------------------------------------------------------------
     5.1 Product editor modal — the heart of the admin panel.
     Images queue in memory for NEW products; setProductImages() REPLACES the
     whole saved image set on save (documented in supabase.js). Removed and
     replaced files are cleaned from Storage after a successful save via
     deleteStorageObjectsIfUnused (it never deletes files still referenced).
     -------------------------------------------------------------------------- */

  function baseName(fileName) {
    return String(fileName || 'image').replace(/\.[^.]+$/, '');
  }

  function validateImageFile(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      throw new Error('Please choose an image file (JPG, PNG or WebP).');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error('Image is too large. Maximum size is 8 MB.');
    }
  }

  /* product_options.choices (jsonb) -> [{name, is_required, choices:[{label, price_delta}], choicesRaw}] */
  function normalizeOptions(options) {
    return (options || []).map(function (option) {
      const choices = (option.choices || []).map(function (choice) {
        return { label: String(choice.label || ''), price_delta: Number(choice.price_delta) || 0 };
      });
      return {
        name: option.name || '',
        is_required: Boolean(option.is_required),
        choices: choices,
        choicesRaw: choices.map(function (choice) {
          return choice.price_delta ? choice.label + ' | ' + choice.price_delta : choice.label;
        }).join('\n'),
      };
    });
  }

  /* Textarea content -> [{label, price_delta}] — invalid lines are ignored. */
  function parseChoices(text) {
    const out = [];
    String(text || '').split('\n').forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      const parts = trimmed.split('|');
      const label = parts[0].trim();
      if (!label) return; /* e.g. a line starting with "|" */
      let priceDelta = 0;
      if (parts.length > 1) {
        const parsed = Number(parts[1].trim());
        if (!isNaN(parsed)) priceDelta = parsed; /* omitted or invalid -> 0 */
      }
      out.push({ label: label, price_delta: priceDelta });
    });
    return out;
  }

  async function openProductEditor(productId) {
    try {
      /* Make sure the category + collection lists exist (e.g. the admin hit
         "+ Add Product" before the products tab finished loading). */
      if (!productState.categories.length || !productState.collections.length) {
        const catsAndCols = await Promise.all([fetchAdminRows('categories'), fetchAdminRows('collections')]);
        productState.categories = catsAndCols[0];
        productState.collections = catsAndCols[1];
        fillCategoryFilter();
      }
      let product = null;
      if (productId) {
        product = await BB.getProductByIdAdmin(productId); /* fresh images + options */
        if (!product) {
          BB.toast('This product could not be found — it may have been deleted.', 'error');
          await loadProductsTab();
          return;
        }
      }
      renderProductEditor(product);
    } catch (err) {
      BB.toast(err && err.message ? err.message : 'Could not open the product editor.', 'error');
    }
  }

  function renderProductEditor(product) {
    const isNew = !product;
    const images = (isNew ? [] : (product.images || [])).map(function (image) {
      return { url: image.url, alt: image.alt || '' };
    });
    const options = normalizeOptions(isNew ? [] : product.options);
    const selectedCollections = ((product && product.seasonal_collections) || []).slice();

    const deletedUrls = [];     /* URLs removed/replaced during this edit — cleaned after save */
    const sessionUploads = [];  /* every URL uploaded while this modal is open — cleaned on cancel */
    const originalImagesJson = JSON.stringify(images);
    const originalOptions = normalizeOptions(isNew ? [] : product.options);
    let slugTouched = !isNew;   /* auto-suggest the slug from the name until the admin edits it */

    const title = isNew ? 'New Product' : 'Edit Product';
    const backdrop = AdminUI.openModal(
      '<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">' +
        '<div class="modal-head">' +
          '<h3 id="product-editor-title">' + title + '</h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close product editor">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<form id="product-form" novalidate>' +

            '<section class="admin-form-section">' +
              '<h4>Details</h4>' +
              '<div class="form-grid">' +
                '<div class="form-field span-2">' +
                  '<label for="pf-name">Name <span class="optional">(required)</span></label>' +
                  '<input type="text" id="pf-name" value="' + esc(isNew ? '' : product.name) + '">' +
                '</div>' +
                '<div class="form-field span-2">' +
                  '<label for="pf-slug">Slug <span class="optional">(required — used in the public URL)</span></label>' +
                  '<input type="text" id="pf-slug" value="' + esc(isNew ? '' : product.slug) + '">' +
                  '<p class="field-hint">Lowercase letters, numbers and dashes. Suggested automatically from the name.</p>' +
                '</div>' +
                '<div class="form-field span-2">' +
                  '<label for="pf-short">Short description <span class="optional">(max 140 characters)</span></label>' +
                  '<input type="text" id="pf-short" maxlength="140" value="' + esc(isNew ? '' : product.short_description || '') + '">' +
                  '<p class="field-hint" id="pf-short-count"></p>' +
                '</div>' +
                '<div class="form-field span-2">' +
                  '<label for="pf-desc">Description <span class="optional">(optional)</span></label>' +
                  '<textarea id="pf-desc">' + esc(isNew ? '' : product.description || '') + '</textarea>' +
                '</div>' +
                '<div class="form-field">' +
                  '<label for="pf-category">Category <span class="optional">(required)</span></label>' +
                  '<select id="pf-category">' +
                    '<option value="">— none —</option>' +
                    productState.categories.map(function (category) {
                      const selected = !isNew && product.category_id === category.id ? ' selected' : '';
                      return '<option value="' + esc(category.id) + '"' + selected + '>' + esc(category.name) + '</option>';
                    }).join('') +
                  '</select>' +
                '</div>' +
                '<div class="form-field">' +
                  '<label for="pf-price">Price <span class="optional">(required)</span></label>' +
                  '<input type="number" id="pf-price" step="0.01" min="0" value="' + (isNew ? '' : esc(product.price)) + '">' +
                '</div>' +
                '<div class="form-field">' +
                  '<label for="pf-compare">Compare-at price <span class="optional">(optional — shows as a crossed-out price)</span></label>' +
                  '<input type="number" id="pf-compare" step="0.01" min="0" value="' + (isNew || product.compare_at_price == null ? '' : esc(product.compare_at_price)) + '">' +
                '</div>' +
              '</div>' +
            '</section>' +

            '<section class="admin-form-section">' +
              '<h4>Flags</h4>' +
              '<div class="form-grid">' +
                checkbox('pf-available', 'Available (in stock)', isNew ? true : product.is_available) +
                checkbox('pf-published', 'Published', isNew ? true : product.is_published) +
                checkbox('pf-visible', 'Visible on the site', isNew ? true : product.is_visible) +
                checkbox('pf-featured', 'Featured', isNew ? false : product.is_featured) +
                checkbox('pf-best', 'Best seller', isNew ? false : product.is_best_seller) +
                checkbox('pf-new', 'New', isNew ? false : product.is_new) +
              '</div>' +
            '</section>' +

            '<section class="admin-form-section">' +
              '<h4>Seasonal collections</h4>' +
              '<div class="chip-select" id="pf-collections">' +
                productState.collections.map(function (collection) {
                  const active = selectedCollections.indexOf(collection.slug) !== -1 ? ' is-active' : '';
                  return '<button type="button" class="chip' + active + '" data-slug="' + esc(collection.slug) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' + esc(collection.name) + '</button>';
                }).join('') +
              '</div>' +
              '<p class="field-hint">Tap to include this product in a seasonal collection.</p>' +
            '</section>' +

            '<section class="admin-form-section">' +
              '<h4>Ingredients &amp; storage</h4>' +
              '<div class="form-field"><label for="pf-ingredients">Ingredients <span class="optional">(optional)</span></label><textarea id="pf-ingredients">' + esc(isNew ? '' : product.ingredients || '') + '</textarea></div>' +
              '<div class="form-field"><label for="pf-allergens">Allergens <span class="optional">(optional)</span></label><textarea id="pf-allergens">' + esc(isNew ? '' : product.allergens || '') + '</textarea></div>' +
              '<div class="form-field"><label for="pf-servings">Servings &amp; storage <span class="optional">(optional)</span></label><textarea id="pf-servings">' + esc(isNew ? '' : product.servings_info || '') + '</textarea></div>' +
            '</section>' +

            '<section class="admin-form-section">' +
              '<h4>Images</h4>' +
              '<div class="image-manager" id="pf-images"></div>' +
              '<p class="field-hint">The first image is the cover shown across the site. Saving replaces the saved image set with what you see here.</p>' +
            '</section>' +

            '<section class="admin-form-section">' +
              '<h4>Options</h4>' +
              '<div id="pf-options"></div>' +
              '<button type="button" class="btn btn-outline btn-small" id="pf-add-option">+ Add option</button>' +
            '</section>' +

          '</form>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-outline" data-close-modal>Cancel</button>' +
          '<button type="submit" form="product-form" class="btn btn-primary" id="pf-save">Save Product</button>' +
        '</div>' +
      '</div>',
      {
        onClose: function onEditorClosed() {
          /* Modal closed without saving: remove files uploaded during this
             session. deleteStorageObjectsIfUnused skips URLs that ended up
             referenced by any product image row (e.g. after a save), so this
             is always safe. */
          if (sessionUploads.length) {
            BB.deleteStorageObjectsIfUnused(sessionUploads).catch(function () { /* best effort */ });
          }
        },
      },
    );

    const root = backdrop.querySelector('.modal');

    function val(selector) { const el = root.querySelector(selector); return el ? el.value : ''; }
    function checked(selector) { const el = root.querySelector(selector); return el ? el.checked : false; }

    function checkbox(id, label, isChecked) {
      return (
        '<div class="checkbox-row">' +
          '<input type="checkbox" id="' + id + '"' + (isChecked ? ' checked' : '') + '>' +
          '<label for="' + id + '">' + esc(label) + '</label>' +
        '</div>'
      );
    }

    /* --- name -> slug auto-suggest + short description counter ------------- */
    const slugInput = root.querySelector('#pf-slug');
    root.querySelector('#pf-name').addEventListener('input', function () {
      if (!slugTouched) slugInput.value = AdminUI.slugify(this.value);
    });
    slugInput.addEventListener('input', function () { slugTouched = true; });

    const shortInput = root.querySelector('#pf-short');
    const shortCount = root.querySelector('#pf-short-count');
    function updateShortCount() { shortCount.textContent = shortInput.value.length + ' / 140'; }
    shortInput.addEventListener('input', updateShortCount);
    updateShortCount();

    /* --- seasonal collection chips ------------------------------------------ */
    root.querySelector('#pf-collections').addEventListener('click', function (event) {
      const chip = event.target.closest('button[data-slug]');
      if (!chip) return;
      const slug = chip.getAttribute('data-slug');
      const index = selectedCollections.indexOf(slug);
      if (index === -1) selectedCollections.push(slug);
      else selectedCollections.splice(index, 1);
      chip.classList.toggle('is-active');
      chip.setAttribute('aria-pressed', chip.classList.contains('is-active') ? 'true' : 'false');
    });

    /* --- image manager ------------------------------------------------------- */
    const imagesWrap = root.querySelector('#pf-images');

    function renderImages() {
      let html = '';
      images.forEach(function (image, index) {
        html +=
          '<div class="image-tile' + (index === 0 ? ' is-cover' : '') + '" data-index="' + index + '">' +
            (index === 0 ? '<span class="cover-tag">Cover</span>' : '') +
            '<img src="' + esc(image.url) + '" alt="' + esc(image.alt || 'Product image') + '">' +
            '<input type="text" class="alt-input" data-alt-index="' + index + '" value="' + esc(image.alt) + '" placeholder="Alt text" aria-label="Alt text for image ' + (index + 1) + '">' +
            '<div class="tile-actions">' +
              '<button type="button" data-img="cover" data-index="' + index + '" aria-label="Set image ' + (index + 1) + ' as cover">Cover</button>' +
              '<button type="button" data-img="up" data-index="' + index + '" aria-label="Move image ' + (index + 1) + ' up"' + (index === 0 ? ' disabled' : '') + '>Up</button>' +
              '<button type="button" data-img="down" data-index="' + index + '" aria-label="Move image ' + (index + 1) + ' down"' + (index === images.length - 1 ? ' disabled' : '') + '>Down</button>' +
              '<label aria-label="Replace image ' + (index + 1) + '">Replace<input type="file" accept="image/*" data-replace-index="' + index + '"></label>' +
              '<button type="button" data-img="remove" data-index="' + index + '" aria-label="Remove image ' + (index + 1) + '">Remove</button>' +
            '</div>' +
          '</div>';
      });
      html += '<label class="upload-tile">+ Upload images<input type="file" id="pf-image-upload" accept="image/*" multiple aria-label="Upload product images"></label>';
      imagesWrap.innerHTML = html;
    }

    /* The FIRST image is always the cover — "Cover" moves a tile to the front,
       which guarantees exactly one cover in product_images.is_cover. */
    imagesWrap.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-img]');
      if (!button || button.disabled) return;
      const index = Number(button.getAttribute('data-index'));
      const action = button.getAttribute('data-img');

      if (action === 'cover') {
        const moved = images.splice(index, 1)[0];
        images.unshift(moved);
        renderImages();
      } else if (action === 'up' && index > 0) {
        const previous = images[index - 1];
        images[index - 1] = images[index];
        images[index] = previous;
        renderImages();
      } else if (action === 'down' && index < images.length - 1) {
        const next = images[index + 1];
        images[index + 1] = images[index];
        images[index] = next;
        renderImages();
      } else if (action === 'remove') {
        if (!BB.confirmDialog('Remove this image from the product? The change applies when you save.')) return;
        deletedUrls.push(images[index].url);
        images.splice(index, 1);
        renderImages();
      }
    });

    imagesWrap.addEventListener('input', function (event) {
      const input = event.target.closest('input[data-alt-index]');
      if (!input) return;
      const index = Number(input.getAttribute('data-alt-index'));
      if (images[index]) images[index].alt = input.value;
    });

    async function handleReplace(index, file) {
      const tile = imagesWrap.querySelector('.image-tile[data-index="' + index + '"]');
      try {
        validateImageFile(file);
        if (tile) tile.innerHTML = '<div class="tile-uploading">Uploading...</div>';
        const newUrl = await BB.uploadImage(file, 'products');
        const oldUrl = images[index] ? images[index].url : null;
        if (oldUrl && oldUrl !== newUrl) deletedUrls.push(oldUrl);
        images[index] = { url: newUrl, alt: images[index] ? images[index].alt : baseName(file.name) };
        sessionUploads.push(newUrl);
      } catch (err) {
        BB.toast(err && err.message ? err.message : 'Upload failed.', 'error');
      }
      renderImages();
    }

    async function handleUploads(fileList) {
      const files = Array.prototype.slice.call(fileList || []);
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        /* Per-file progress state: a dashed placeholder tile while uploading. */
        const placeholder = document.createElement('div');
        placeholder.className = 'tile-uploading';
        placeholder.textContent = 'Uploading ' + file.name + '...';
        imagesWrap.appendChild(placeholder);
        try {
          validateImageFile(file);
          const url = await BB.uploadImage(file, 'products');
          images.push({ url: url, alt: baseName(file.name) });
          sessionUploads.push(url);
        } catch (err) {
          BB.toast((file.name ? file.name + ': ' : '') + (err && err.message ? err.message : 'Upload failed.'), 'error');
        } finally {
          placeholder.remove();
        }
      }
      renderImages();
    }

    imagesWrap.addEventListener('change', function (event) {
      const input = event.target;
      if (input.matches('[data-replace-index]')) {
        if (input.files && input.files[0]) handleReplace(Number(input.getAttribute('data-replace-index')), input.files[0]);
      } else if (input.id === 'pf-image-upload') {
        handleUploads(input.files);
      }
    });

    renderImages();

    /* --- options manager ------------------------------------------------------ */
    const optionsWrap = root.querySelector('#pf-options');

    function renderOptions() {
      if (!options.length) {
        optionsWrap.innerHTML = '<p class="field-hint">No options yet — add one if this product has choices like messages or extras.</p>';
        return;
      }
      optionsWrap.innerHTML = options.map(function (option, index) {
        return (
          '<div class="option-row" data-opt="' + index + '">' +
            '<div class="option-row-grid">' +
              '<div class="form-field">' +
                '<label for="pf-opt-name-' + index + '">Option name</label>' +
                '<input type="text" id="pf-opt-name-' + index + '" data-opt-field="name" data-opt-index="' + index + '" value="' + esc(option.name) + '" placeholder="e.g. Add a written message">' +
              '</div>' +
              '<div class="checkbox-row">' +
                '<input type="checkbox" id="pf-opt-req-' + index + '" data-opt-field="required" data-opt-index="' + index + '"' + (option.is_required ? ' checked' : '') + '>' +
                '<label for="pf-opt-req-' + index + '">Required</label>' +
              '</div>' +
            '</div>' +
            '<textarea data-opt-field="choices" data-opt-index="' + index + '" placeholder="one per line: Label | 1.50" aria-label="Choices for option ' + (index + 1) + '">' + esc(option.choicesRaw) + '</textarea>' +
            '<div class="option-row-foot">' +
              '<span class="field-hint">One choice per line: Label | 1.50 — price optional, defaults to 0.</span>' +
              '<button type="button" class="btn btn-small btn-outline" data-opt-remove="' + index + '" aria-label="Remove option ' + (index + 1) + '">Remove option</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    function syncOptionsFromDom() {
      optionsWrap.querySelectorAll('[data-opt-field]').forEach(function (field) {
        const index = Number(field.getAttribute('data-opt-index'));
        if (!options[index]) return;
        const kind = field.getAttribute('data-opt-field');
        if (kind === 'name') options[index].name = field.value;
        else if (kind === 'choices') options[index].choicesRaw = field.value;
        else if (kind === 'required') options[index].is_required = field.checked;
      });
    }

    optionsWrap.addEventListener('input', function (event) {
      if (event.target.closest('[data-opt-field]')) syncOptionsFromDom();
    });
    optionsWrap.addEventListener('change', function (event) {
      if (event.target.closest('[data-opt-field]')) syncOptionsFromDom();
    });
    optionsWrap.addEventListener('click', function (event) {
      const remove = event.target.closest('button[data-opt-remove]');
      if (!remove) return;
      syncOptionsFromDom();
      options.splice(Number(remove.getAttribute('data-opt-remove')), 1);
      renderOptions();
    });

    root.querySelector('#pf-add-option').addEventListener('click', function () {
      syncOptionsFromDom();
      options.push({ name: '', is_required: false, choices: [], choicesRaw: '' });
      renderOptions();
      const nameInput = optionsWrap.querySelector('input[data-opt-field="name"][data-opt-index="' + (options.length - 1) + '"]');
      if (nameInput) nameInput.focus();
    });

    renderOptions();

    /* --- save ------------------------------------------------------------------ */
    root.querySelector('#product-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      syncOptionsFromDom();

      /* validation ----------------------------------------------------------- */
      root.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });

      const name = val('#pf-name').trim();
      const slug = AdminUI.slugify(val('#pf-slug'));
      const priceRaw = val('#pf-price').trim();
      const price = Number(priceRaw);
      const compareRaw = val('#pf-compare').trim();
      const compare = compareRaw === '' ? null : Number(compareRaw);
      const categoryId = val('#pf-category') || null;

      const invalidFields = [];
      if (!name) invalidFields.push('#pf-name');
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalidFields.push('#pf-slug');
      if (priceRaw === '' || isNaN(price) || price < 0) invalidFields.push('#pf-price');
      if (compareRaw !== '' && (isNaN(compare) || compare < 0)) invalidFields.push('#pf-compare');
      if (!categoryId) invalidFields.push('#pf-category');

      /* option rows: empty rows are ignored, rows without choices are skipped
         with a message after save, rows with choices but no name block the save */
      let optionError = null;
      const parsedOptions = [];
      const skippedOptions = [];
      options.forEach(function (option, index) {
        const optionName = (option.name || '').trim();
        const choices = parseChoices(option.choicesRaw);
        if (!optionName && choices.length === 0) return; /* untouched empty row */
        if (!optionName) { optionError = 'Every option needs a name (option ' + (index + 1) + ').'; return; }
        if (!choices.length) { skippedOptions.push(optionName); return; }
        parsedOptions.push({ name: optionName, choices: choices, is_required: Boolean(option.is_required) });
      });

      if (invalidFields.length || optionError) {
        invalidFields.forEach(function (selector) { root.querySelector(selector).classList.add('is-invalid'); });
        const first = invalidFields.length ? root.querySelector(invalidFields[0]) : null;
        if (first) first.focus();
        BB.toast(optionError || 'Please fix the highlighted fields.', 'error');
        return;
      }

      const row = {
        name: name,
        slug: slug,
        short_description: val('#pf-short').trim() || null,
        description: val('#pf-desc').trim() || null,
        category_id: categoryId,
        price: price,
        compare_at_price: compare,
        is_available: checked('#pf-available'),
        is_published: checked('#pf-published'),
        is_visible: checked('#pf-visible'),
        is_featured: checked('#pf-featured'),
        is_best_seller: checked('#pf-best'),
        is_new: checked('#pf-new'),
        seasonal_collections: selectedCollections.slice(),
        ingredients: val('#pf-ingredients').trim() || null,
        allergens: val('#pf-allergens').trim() || null,
        servings_info: val('#pf-servings').trim() || null,
      };

      const saveButton = root.querySelector('#pf-save');
      AdminUI.setButtonBusy(saveButton, true, 'Saving...');
      try {
        if (isNew) {
          /* New product: create the row first, then attach images + options. */
          const created = await BB.createProduct(row);
          if (images.length) await BB.setProductImages(created.id, images);
          if (parsedOptions.length) await BB.setProductOptions(created.id, parsedOptions);
        } else {
          await BB.updateProduct(product.id, row);
          /* setProductImages/setProductOptions REPLACE the complete saved set
             (delete + reinsert inside supabase.js) — simple and predictable. */
          if (JSON.stringify(images) !== originalImagesJson) {
            await BB.setProductImages(product.id, images);
          }
          if (JSON.stringify(parsedOptions) !== JSON.stringify(originalOptions.map(function (option) {
            return { name: option.name, choices: option.choices, is_required: option.is_required };
          }))) {
            await BB.setProductOptions(product.id, parsedOptions);
          }
        }

        /* Storage cleanup for images removed/replaced during this edit. Runs
           AFTER the save so the helper sees the final references. */
        if (deletedUrls.length) {
          BB.deleteStorageObjectsIfUnused(deletedUrls).catch(function () { /* best effort */ });
        }

        AdminUI.closeModal();
        if (skippedOptions.length) {
          BB.toast('Skipped option(s) without choices: ' + skippedOptions.join(', '), 'info');
        }
        BB.toast('Product saved — it now appears on the public site (if published & visible).', 'success');
        await loadProductsTab();
      } catch (err) {
        /* Never fake success: keep the modal open, restore the button, show
           the real error. */
        AdminUI.setButtonBusy(saveButton, false);
        BB.toast(err && err.message ? err.message : 'Could not save the product.', 'error');
      }
    });
  }

  AdminPanels.register('products', loadProductsTab);
  AdminPanels.register('dashboard', loadDashboard);

  /* ===========================================================================
     6. CATEGORIES & COLLECTIONS (shared generic editor)
     =========================================================================== */

  const taxonomyState = {
    categories: [],
    collections: [],
  };

  const TAXONOMY = {
    categories: {
      label: 'Category',
      table: 'categories',
      bodyId: 'categories-body',
      addBtnId: 'add-category-btn',
      uploadFolder: 'categories',
      upsert: function (row) { return BB.upsertCategory(row); },
      remove: function (id) { return BB.deleteCategory(id); },
    },
    collections: {
      label: 'Collection',
      table: 'collections',
      bodyId: 'collections-body',
      addBtnId: 'add-collection-btn',
      uploadFolder: 'collections',
      upsert: function (row) { return BB.upsertCollection(row); },
      remove: function (id) { return BB.deleteCollection(id); },
    },
  };

  async function loadTaxonomy(kind) {
    const cfg = TAXONOMY[kind];
    const body = byId(cfg.bodyId);
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonTable(6, 5);
    try {
      taxonomyState[kind] = await fetchAdminRows(cfg.table);
      renderTaxonomy(kind);
    } catch (err) {
      AdminUI.renderError(body, err, function () { loadTaxonomy(kind); });
      BB.toast(err && err.message ? err.message : 'Could not load ' + kind + '.', 'error');
    }
  }

  function renderTaxonomy(kind) {
    const cfg = TAXONOMY[kind];
    const rows = taxonomyState[kind];
    const body = byId(cfg.bodyId);

    if (!rows.length) {
      body.innerHTML = BB.emptyStateHtml('No ' + kind + ' yet', 'Create the first one with the button above.');
      return;
    }

    const tableRows = rows.map(function (row) {
      const id = esc(row.id);
      return (
        '<tr>' +
          '<td>' + (row.image_url
            ? '<img class="thumb-cell" src="' + esc(row.image_url) + '" alt="' + esc(row.name) + '" loading="lazy">'
            : '<span class="thumb-cell thumb-empty" aria-hidden="true"></span>') + '</td>' +
          '<td class="cell-strong">' + esc(row.name) + '</td>' +
          '<td class="cell-muted">' + esc(row.slug) + '</td>' +
          '<td>' + esc(row.sort_order == null ? '' : row.sort_order) + '</td>' +
          '<td><input type="checkbox" data-tax-toggle="' + id + '"' + (row.is_active ? ' checked' : '') +
              ' aria-label="' + (row.is_active ? 'Deactivate ' : 'Activate ') + esc(row.name) + '"></td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-outline" data-tax-edit="' + id + '">Edit</button>' +
            '<button type="button" class="btn btn-danger" data-tax-delete="' + id + '">Delete</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>Image</th><th>Name</th><th>Slug</th><th>Sort order</th><th>Active</th><th>Actions</th></tr></thead>' +
        '<tbody>' + tableRows + '</tbody>' +
      '</table></div>';
  }

  function wireTaxonomy(kind) {
    const cfg = TAXONOMY[kind];
    const body = byId(cfg.bodyId);

    byId(cfg.addBtnId).addEventListener('click', function () { openTaxonomyEditor(kind, null); });

    body.addEventListener('change', async function (event) {
      const toggle = event.target.closest('input[data-tax-toggle]');
      if (!toggle) return;
      const id = toggle.getAttribute('data-tax-toggle');
      const isActive = toggle.checked;
      toggle.disabled = true;
      try {
        /* Partial upsert on the primary key flips just the flag. */
        await cfg.upsert({ id: id, is_active: isActive });
        BB.toast(cfg.label + ' "' + (taxonomyState[kind].find(function (r) { return r.id === id; }) || {}).name + '" is now ' + (isActive ? 'active' : 'hidden') + '.', 'success');
        await loadTaxonomy(kind);
      } catch (err) {
        toggle.checked = !isActive; /* revert the checkbox to the real state */
        toggle.disabled = false;
        BB.toast(err && err.message ? err.message : 'Could not update the ' + cfg.label.toLowerCase() + '.', 'error');
      }
    });

    body.addEventListener('click', async function (event) {
      const editButton = event.target.closest('button[data-tax-edit]');
      if (editButton) { openTaxonomyEditor(kind, editButton.getAttribute('data-tax-edit')); return; }

      const deleteButton = event.target.closest('button[data-tax-delete]');
      if (!deleteButton) return;
      const id = deleteButton.getAttribute('data-tax-delete');
      const row = taxonomyState[kind].find(function (r) { return r.id === id; });
      if (!row) return;

      const confirmText = kind === 'categories'
        ? 'Delete category "' + row.name + '"? Categories with products cannot be deleted until their products are moved.'
        : 'Delete collection "' + row.name + '"? Products that reference it will no longer show it as a seasonal collection.';
      if (!BB.confirmDialog(confirmText)) return;

      AdminUI.setButtonBusy(deleteButton, true, '...');
      try {
        await cfg.remove(id);
        BB.toast(cfg.label + ' deleted.', 'success');
        await loadTaxonomy(kind);
      } catch (err) {
        AdminUI.setButtonBusy(deleteButton, false);
        /* The products.category_id FK blocks deleting a used category (23503). */
        if (kind === 'categories' && (err.code === '23503' || /foreign key/i.test(err.message || ''))) {
          BB.toast('This category still has products — move them to another category first.', 'error');
        } else {
          BB.toast(err && err.message ? err.message : 'Could not delete the ' + cfg.label.toLowerCase() + '.', 'error');
        }
      }
    });
  }

  function openTaxonomyEditor(kind, id) {
    const cfg = TAXONOMY[kind];
    const existing = id ? taxonomyState[kind].find(function (r) { return r.id === id; }) : null;
    let imageUrl = existing ? (existing.image_url || '') : '';
    const replacedUrls = [];  /* old image files replaced/removed — cleaned after save */
    const sessionUploads = []; /* uploads from this modal — cleaned on cancel */
    let slugTouched = Boolean(existing);

    const backdrop = AdminUI.openModal(
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tax-editor-title">' +
        '<div class="modal-head">' +
          '<h3 id="tax-editor-title">' + (existing ? 'Edit ' : 'New ') + cfg.label + '</h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close editor">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<form id="tax-form" novalidate>' +
            '<div class="form-field">' +
              '<label for="tax-name">Name <span class="optional">(required)</span></label>' +
              '<input type="text" id="tax-name" value="' + esc(existing ? existing.name : '') + '">' +
            '</div>' +
            '<div class="form-field">' +
              '<label for="tax-slug">Slug <span class="optional">(required)</span></label>' +
              '<input type="text" id="tax-slug" value="' + esc(existing ? existing.slug : '') + '">' +
              '<p class="field-hint">Lowercase letters, numbers and dashes. Used in shop links.</p>' +
            '</div>' +
            '<div class="form-field">' +
              '<label for="tax-desc">Description <span class="optional">(optional)</span></label>' +
              '<textarea id="tax-desc">' + esc(existing ? existing.description || '' : '') + '</textarea>' +
            '</div>' +
            '<div class="form-grid">' +
              '<div class="form-field">' +
                '<label for="tax-sort">Sort order</label>' +
                '<input type="number" id="tax-sort" step="1" value="' + esc(existing && existing.sort_order != null ? existing.sort_order : 0) + '">' +
              '</div>' +
              '<div class="form-field">' +
                '<label>Visibility</label>' +
                '<div class="checkbox-row">' +
                  '<input type="checkbox" id="tax-active"' + (!existing || existing.is_active ? ' checked' : '') + '>' +
                  '<label for="tax-active">Active (visible on the site)</label>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="form-field">' +
              '<label>Image <span class="optional">(optional card photo)</span></label>' +
              '<div id="tax-image-preview"></div>' +
              '<div class="tax-image-actions">' +
                '<label class="btn btn-outline btn-small">Replace image<input type="file" id="tax-image-input" accept="image/*"></label>' +
                '<button type="button" class="btn btn-outline btn-small" id="tax-image-remove">Remove image</button>' +
              '</div>' +
            '</div>' +
          '</form>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-outline" data-close-modal>Cancel</button>' +
          '<button type="submit" form="tax-form" class="btn btn-primary" id="tax-save">Save ' + cfg.label + '</button>' +
        '</div>' +
      '</div>',
      {
        onClose: function () {
          if (sessionUploads.length) {
            BB.deleteStorageObjectsIfUnused(sessionUploads).catch(function () { /* best effort */ });
          }
        },
      },
    );

    const root = backdrop.querySelector('.modal');
    const previewWrap = root.querySelector('#tax-image-preview');
    const removeButton = root.querySelector('#tax-image-remove');

    function renderPreview() {
      previewWrap.innerHTML = imageUrl
        ? '<img class="admin-img-preview" src="' + esc(imageUrl) + '" alt="Current ' + cfg.label.toLowerCase() + ' image">'
        : '<p class="field-hint">No image yet.</p>';
      removeButton.hidden = !imageUrl;
    }
    renderPreview();

    root.querySelector('#tax-name').addEventListener('input', function () {
      if (!slugTouched) root.querySelector('#tax-slug').value = AdminUI.slugify(this.value);
    });
    root.querySelector('#tax-slug').addEventListener('input', function () { slugTouched = true; });

    root.querySelector('#tax-image-input').addEventListener('change', async function () {
      const file = this.files && this.files[0];
      this.value = ''; /* allow re-choosing the same file */
      if (!file) return;
      previewWrap.innerHTML = '<div class="tile-uploading">Uploading...</div>';
      try {
        validateImageFile(file);
        const newUrl = await BB.uploadImage(file, cfg.uploadFolder);
        if (imageUrl && imageUrl !== newUrl) replacedUrls.push(imageUrl);
        imageUrl = newUrl;
        sessionUploads.push(newUrl);
      } catch (err) {
        BB.toast(err && err.message ? err.message : 'Upload failed.', 'error');
      }
      renderPreview();
    });

    removeButton.addEventListener('click', function () {
      if (!imageUrl) return;
      if (!BB.confirmDialog('Remove this image? The change applies when you save.')) return;
      replacedUrls.push(imageUrl);
      imageUrl = '';
      renderPreview();
    });

    root.querySelector('#tax-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      root.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });

      const name = root.querySelector('#tax-name').value.trim();
      const slug = AdminUI.slugify(root.querySelector('#tax-slug').value);
      const sortRaw = root.querySelector('#tax-sort').value.trim();
      const sortOrder = sortRaw === '' ? 0 : Number(sortRaw);

      const invalidFields = [];
      if (!name) invalidFields.push('#tax-name');
      if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalidFields.push('#tax-slug');
      if (isNaN(sortOrder)) invalidFields.push('#tax-sort');
      if (invalidFields.length) {
        invalidFields.forEach(function (selector) { root.querySelector(selector).classList.add('is-invalid'); });
        root.querySelector(invalidFields[0]).focus();
        BB.toast('Please fix the highlighted fields.', 'error');
        return;
      }

      const row = {
        slug: slug,
        name: name,
        description: root.querySelector('#tax-desc').value.trim() || null,
        sort_order: sortOrder,
        is_active: root.querySelector('#tax-active').checked,
        image_url: imageUrl || null,
      };
      if (existing) row.id = existing.id;

      const saveButton = root.querySelector('#tax-save');
      AdminUI.setButtonBusy(saveButton, true, 'Saving...');
      try {
        await cfg.upsert(row);
        if (replacedUrls.length) {
          BB.deleteStorageObjectsIfUnused(replacedUrls).catch(function () { /* best effort */ });
        }
        AdminUI.closeModal();
        BB.toast(cfg.label + ' saved.', 'success');
        await loadTaxonomy(kind);
      } catch (err) {
        AdminUI.setButtonBusy(saveButton, false);
        BB.toast(err && err.message ? err.message : 'Could not save the ' + cfg.label.toLowerCase() + '.', 'error');
      }
    });
  }

  AdminPanels.register('categories', function () { return loadTaxonomy('categories'); });
  AdminPanels.register('collections', function () { return loadTaxonomy('collections'); });

  /* ===========================================================================
     7. BOOT
     =========================================================================== */

  /* DOMContentLoaded fires AFTER all classic scripts (including
     admin-operations.js) have executed, so every panel loader is registered
     before the first tab activation. */
  function boot() {
    wireTabs();
    wireAuth();
    wireProductsToolbar();
    wireTaxonomy('categories');
    wireTaxonomy('collections');

    BB.ready.then(async function () {
      if (!BB.configured) {
        /* Setup notice: keep the form visible but disabled + explain the fix. */
        byId('login-email').disabled = true;
        byId('login-password').disabled = true;
        byId('login-submit').disabled = true;
        showLoginError('Connect Supabase first — paste your project URL and anon key into supabase.js (see README).');
        return;
      }
      try {
        const { data } = await BB.sb.auth.getSession();
        if (data && data.session) showShell(data.session.user);
        else showLogin();
      } catch (err) {
        showLogin();
        showLoginError('Could not check your session: ' + (err && err.message ? err.message : 'unknown error'));
      }
    }).catch(function (err) {
      console.error('Admin boot failed:', err);
      showLoginError('The admin panel failed to start: ' + (err && err.message ? err.message : 'unknown error'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.BB);
