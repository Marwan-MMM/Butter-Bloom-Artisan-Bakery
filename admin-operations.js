/* =============================================================================
   BUTTER & BLOOM — admin-operations.js (admin panel OPERATIONS)
   -----------------------------------------------------------------------------
   Loaded AFTER admin.js and reuses its shared helpers (window.AdminUI) and the
   tab registry (window.AdminPanels). This file owns the "operations" side of
   the bakery:

     1. Orders          — status filter, table, inline status changes, view modal
     2. Cake Requests   — card grid, quick accept/reject, full review modal
     3. Reservations    — table, status changes, view modal
     4. Messages        — table, view modal, mark read/unread, delete
     5. Settings        — the full site settings form (brand, homepage, currency,
                          contact, socials, ordering rules, about, custom cake,
                          hours, policies)
     6. Demo Data       — demo catalog status + load / remove / replace actions

   Conventions: every fetch is try/caught with a toast + inline error state,
   every price goes through BB.formatPrice, every destructive action asks via
   BB.confirmDialog, and nothing ever fakes success.
   ============================================================================= */

(function initAdminOperations(BB, AdminUI, AdminPanels) {
  'use strict';

  const esc = AdminUI.esc;
  function byId(id) { return document.getElementById(id); }

  /* Shared status vocabulary (DB CHECK constraints define the valid values). */
  const STATUS_LABELS = {
    pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
    completed: 'Completed', cancelled: 'Cancelled', accepted: 'Accepted', rejected: 'Rejected',
  };
  const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
  const REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
  const RESERVATION_TYPES = {
    tasting: 'Tasting table', workshop: 'Baking workshop', event: 'Private event', table: 'Regular table',
  };

  function statusOptions(list, current) {
    return list.map(function (status) {
      return '<option value="' + status + '"' + (status === current ? ' selected' : '') + '>' + STATUS_LABELS[status] + '</option>';
    }).join('');
  }

  function detailRow(label, valueHtml) {
    return '<div class="detail-row"><span class="detail-label">' + esc(label) + '</span><span class="detail-value">' + valueHtml + '</span></div>';
  }

  function excerpt(text, length) {
    const str = String(text || '');
    return str.length > length ? str.slice(0, length) + '…' : str;
  }

  /* ===========================================================================
     1. ORDERS
     =========================================================================== */

  const ordersState = { list: [] };

  async function loadOrders() {
    const body = byId('orders-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonTable(7, 5);
    try {
      const filter = byId('order-status-filter').value;
      ordersState.list = await BB.getOrdersAdmin(filter);
      renderOrders();
    } catch (err) {
      AdminUI.renderError(body, err, loadOrders);
      BB.toast(err && err.message ? err.message : 'Could not load orders.', 'error');
    }
  }

  function renderOrders() {
    const body = byId('orders-body');
    if (!ordersState.list.length) {
      body.innerHTML = BB.emptyStateHtml('No orders in this view', 'Orders appear here as customers check out on the public site.');
      return;
    }

    const rows = ordersState.list.map(function (order) {
      const id = esc(order.id);
      return (
        '<tr>' +
          '<td class="cell-strong">' + esc(order.order_number) + '</td>' +
          '<td><div class="cell-strong">' + esc(order.customer_name) + '</div><div class="cell-muted">' + esc(order.phone || '—') + '</div></td>' +
          '<td><span class="badge ' + (order.fulfillment_type === 'delivery' ? 'badge-caramel' : 'badge-soft') + '">' +
            (order.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup') + '</span></td>' +
          '<td>' + AdminUI.fmtDate(order.requested_date) + '<div class="cell-muted">' + esc(order.requested_time || 'Flexible') + '</div></td>' +
          '<td>' + AdminUI.fmt(order.total) + '</td>' +
          '<td><select class="status-select" data-order-status="' + id + '" aria-label="Status for order ' + esc(order.order_number) + '">' +
            statusOptions(ORDER_STATUSES, order.status) + '</select></td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-outline" data-order-view="' + id + '">View</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Requested</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  async function changeOrderStatus(select, order) {
    const newStatus = select.value;
    const previous = order.status;
    if (newStatus === previous) return;
    select.disabled = true;
    try {
      await BB.updateOrderStatus(order.id, newStatus);
      order.status = newStatus;
      BB.toast('Order ' + order.order_number + ' marked as "' + STATUS_LABELS[newStatus] + '".', 'success');
      await loadOrders(); /* keeps filter + rows honest; modal (if open) keeps its own select */
    } catch (err) {
      select.value = previous; /* show the real state, not the failed one */
      BB.toast(err && err.message ? err.message : 'Could not update the order.', 'error');
    }
    select.disabled = false;
  }

  function openOrderModal(order) {
    const settings = BB.settings || {};
    const waDigits = String(settings.whatsapp_number || '').replace(/[^0-9]/g, '');
    const waHref = waDigits
      ? 'https://wa.me/' + waDigits + '?text=' + encodeURIComponent(
          'Hello ' + order.customer_name + ', this is Butter & Bloom about your order ' + order.order_number + '.')
      : '';

    const items = order.order_items || [];
    const itemRows = items.map(function (item) {
      const optionsText = (item.selected_options || []).map(function (option) {
        const delta = Number(option.price_delta) || 0;
        return option.label + (delta ? ' (+' + AdminUI.fmt(delta) + ')' : '');
      }).join(', ');
      return (
        '<tr>' +
          '<td>' + esc(item.product_name || '—') + '</td>' +
          '<td>' + esc(item.quantity) + '</td>' +
          '<td>' + AdminUI.fmt(item.unit_price) + '</td>' +
          '<td>' + (optionsText ? esc(optionsText) : '—') + '</td>' +
          '<td>' + AdminUI.fmt(item.line_total) + '</td>' +
        '</tr>'
      );
    }).join('');

    const detailRows = [];
    detailRows.push(detailRow('Order', '<strong>' + esc(order.order_number) + '</strong>'));
    detailRows.push(detailRow('Placed', esc(AdminUI.fmtDateTime(order.created_at))));
    detailRows.push(detailRow('Customer', esc(order.customer_name)));
    detailRows.push(detailRow('Phone', order.phone ? '<a href="tel:' + esc(order.phone) + '">' + esc(order.phone) + '</a>' : '—'));
    detailRows.push(detailRow('Email', order.email ? '<a href="mailto:' + esc(order.email) + '">' + esc(order.email) + '</a>' : '—'));
    detailRows.push(detailRow('Fulfillment', order.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'));
    if (order.fulfillment_type === 'delivery') {
      detailRows.push(detailRow('Delivery address', esc(order.delivery_address || '—')));
    }
    detailRows.push(detailRow('Requested', esc(AdminUI.fmtDate(order.requested_date)) +
      (order.requested_time ? ' · ' + esc(order.requested_time) : '')));
    detailRows.push(detailRow('Notes', order.notes ? esc(order.notes) : '—'));

    AdminUI.openModal(
      '<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">' +
        '<div class="modal-head">' +
          '<h3 id="order-modal-title">Order ' + esc(order.order_number) + '</h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close order details">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="detail-list">' + detailRows.join('') + '</div>' +
          '<h4>Items</h4>' +
          '<div class="admin-table-wrap"><table class="admin-table">' +
            '<thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Options</th><th>Line total</th></tr></thead>' +
            '<tbody>' + (itemRows || '<tr><td colspan="5" class="cell-muted">No line items recorded.</td></tr>') + '</tbody>' +
          '</table></div>' +
          '<div class="detail-list order-totals">' +
            detailRow('Subtotal', esc(AdminUI.fmt(order.subtotal))) +
            detailRow('Delivery fee', esc(AdminUI.fmt(order.delivery_fee))) +
            detailRow('Total', '<strong>' + esc(AdminUI.fmt(order.total)) + '</strong>') +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<div class="order-status-field">' +
            '<label for="order-modal-status">Status</label>' +
            '<select id="order-modal-status" class="status-select">' + statusOptions(ORDER_STATUSES, order.status) + '</select>' +
          '</div>' +
          (waHref
            ? '<div>' +
                '<a class="btn btn-whatsapp" href="' + esc(waHref) + '" target="_blank" rel="noopener">Message customer</a>' +
                '<p class="modal-subnote">Opening WhatsApp does not confirm the order.</p>' +
              '</div>'
            : '') +
          '<button type="button" class="btn btn-outline" data-close-modal>Close</button>' +
        '</div>' +
      '</div>'
    );

    const modalSelect = byId('order-modal-status');
    modalSelect.addEventListener('change', function () { changeOrderStatus(modalSelect, order); });
  }

  function wireOrders() {
    byId('order-status-filter').addEventListener('change', loadOrders);
    byId('orders-body').addEventListener('change', function (event) {
      const select = event.target.closest('select[data-order-status]');
      if (!select) return;
      const order = ordersState.list.find(function (o) { return o.id === select.getAttribute('data-order-status'); });
      if (order) changeOrderStatus(select, order);
    });
    byId('orders-body').addEventListener('click', function (event) {
      const viewButton = event.target.closest('button[data-order-view]');
      if (!viewButton) return;
      const order = ordersState.list.find(function (o) { return o.id === viewButton.getAttribute('data-order-view'); });
      if (order) openOrderModal(order);
    });
  }

  AdminPanels.register('orders', loadOrders);

  /* ===========================================================================
     2. CAKE REQUESTS
     =========================================================================== */

  const cakesState = { list: [] };

  async function loadCakes() {
    const body = byId('cakes-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonCards(4);
    try {
      const filter = byId('cake-status-filter').value;
      cakesState.list = await BB.getCakeRequestsAdmin(filter);
      renderCakes();
    } catch (err) {
      AdminUI.renderError(body, err, loadCakes);
      BB.toast(err && err.message ? err.message : 'Could not load cake requests.', 'error');
    }
  }

  function renderCakes() {
    const body = byId('cakes-body');
    if (!cakesState.list.length) {
      body.innerHTML = BB.emptyStateHtml('No cake requests in this view', 'Custom cake requests from the builder will appear here.');
      return;
    }

    const cards = cakesState.list.map(function (request) {
      const id = esc(request.id);
      const meta = [request.flavor, request.size_label, AdminUI.fmtDate(request.requested_date), request.decoration_style]
        .filter(Boolean).map(esc).join(' · ');
      const quickButtons =
        (request.status === 'pending'
          ? '<button type="button" class="btn btn-small btn-primary" data-cake-id="' + id + '" data-cake-status="accepted">Accept</button>' +
            '<button type="button" class="btn btn-small btn-outline" data-cake-id="' + id + '" data-cake-status="rejected">Reject</button>'
          : '') +
        (request.status === 'accepted'
          ? '<button type="button" class="btn btn-small btn-primary" data-cake-id="' + id + '" data-cake-status="completed">Complete</button>' +
            '<button type="button" class="btn btn-small btn-outline" data-cake-id="' + id + '" data-cake-status="rejected">Reject</button>'
          : '');

      return (
        '<article class="request-card">' +
          '<div class="request-head">' +
            '<div class="cell-strong">' + esc(request.customer_name) + '</div>' +
            AdminUI.statusBadge(AdminUI.REQUEST_STATUS_BADGES, request.status) +
          '</div>' +
          '<div class="request-meta">' + meta + '</div>' +
          '<div class="request-detail">' +
            (request.message_on_cake ? '<p><strong>Message on cake:</strong> ' + esc(request.message_on_cake) + '</p>' : '') +
            (request.budget_range ? '<p><strong>Budget:</strong> ' + esc(request.budget_range) + '</p>' : '') +
            '<p><strong>' + (request.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup') + '</strong> — ' +
              esc(AdminUI.fmtDate(request.requested_date)) + (request.preferred_time ? ', ' + esc(request.preferred_time) : '') + '</p>' +
          '</div>' +
          '<div class="request-actions">' +
            '<button type="button" class="btn btn-outline btn-small" data-cake-view="' + id + '">Review</button>' +
            quickButtons +
          '</div>' +
        '</article>'
      );
    }).join('');

    body.innerHTML = '<div class="request-cards">' + cards + '</div>';
  }

  async function updateCakeRequestStatus(request, status, badgeEl) {
    try {
      const updated = await BB.updateCakeRequest(request.id, { status: status });
      request.status = updated ? updated.status : status;
      BB.toast('Request from ' + request.customer_name + ' marked as "' + STATUS_LABELS[status] + '".', 'success');
      await loadCakes(); /* refresh the grid behind the modal */
      if (badgeEl) badgeEl.innerHTML = AdminUI.statusBadge(AdminUI.REQUEST_STATUS_BADGES, request.status);
    } catch (err) {
      BB.toast(err && err.message ? err.message : 'Could not update the request.', 'error');
    }
  }

  function openCakeModal(request) {
    const sizeLabels = (((BB.settings || {}).custom_cake_sizes) || [])
      .map(function (size) { return size.label; })
      .filter(Boolean);
    if (request.size_label && sizeLabels.indexOf(request.size_label) === -1) {
      sizeLabels.unshift(request.size_label); /* keep the saved value selectable */
    }

    const detailRows = [];
    detailRows.push(detailRow('Customer', esc(request.customer_name)));
    detailRows.push(detailRow('Phone', request.phone ? '<a href="tel:' + esc(request.phone) + '">' + esc(request.phone) + '</a>' : '—'));
    detailRows.push(detailRow('Email', request.email ? '<a href="mailto:' + esc(request.email) + '">' + esc(request.email) + '</a>' : '—'));
    detailRows.push(detailRow('Cake type', esc(request.cake_type || '—')));
    detailRows.push(detailRow('Flavor', esc(request.flavor || '—')));
    detailRows.push(detailRow('Size', esc(request.size_label || '—')));
    detailRows.push(detailRow('Filling', esc(request.filling || '—')));
    detailRows.push(detailRow('Frosting', esc(request.frosting_type || '—') +
      (request.frosting_color ? ' · ' + esc(request.frosting_color) : '')));
    detailRows.push(detailRow('Decoration style', esc(request.decoration_style || '—')));
    detailRows.push(detailRow('Message on cake', request.message_on_cake ? esc(request.message_on_cake) : '—'));
    detailRows.push(detailRow('Fulfillment', request.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup'));
    detailRows.push(detailRow('Requested date', esc(AdminUI.fmtDate(request.requested_date))));
    detailRows.push(detailRow('Preferred time', esc(request.preferred_time || '—')));
    detailRows.push(detailRow('Budget range', esc(request.budget_range || '—')));
    detailRows.push(detailRow('Allergies', request.allergies ? esc(request.allergies) : '—'));
    detailRows.push(detailRow('Instructions', request.special_instructions ? esc(request.special_instructions) : '—'));
    detailRows.push(detailRow('Reference photo', request.reference_image_url
      ? '<img class="admin-img-preview" src="' + esc(request.reference_image_url) + '" alt="Customer reference photo">' +
        '<a href="' + esc(request.reference_image_url) + '" target="_blank" rel="noopener">Open reference photo</a>'
      : '—'));
    detailRows.push(detailRow('Estimated price', request.estimated_price == null ? '—' : esc(AdminUI.fmt(request.estimated_price))));
    detailRows.push(detailRow('Created', esc(AdminUI.fmtDateTime(request.created_at))));

    AdminUI.openModal(
      '<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="cake-modal-title">' +
        '<div class="modal-head">' +
          '<h3 id="cake-modal-title">Cake request <span id="cake-modal-badge">' +
            AdminUI.statusBadge(AdminUI.REQUEST_STATUS_BADGES, request.status) + '</span></h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close request review">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="detail-list scroll-area">' + detailRows.join('') + '</div>' +
          '<form id="cake-edit-form" novalidate>' +
            '<div class="form-grid">' +
              '<div class="form-field">' +
                '<label for="cake-size-edit">Size <span class="optional">(from Settings — Custom cake sizes)</span></label>' +
                '<select id="cake-size-edit">' +
                  sizeLabels.map(function (label) {
                    return '<option value="' + esc(label) + '"' + (label === request.size_label ? ' selected' : '') + '>' + esc(label) + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-field">' +
                '<label for="cake-date-edit">Requested date</label>' +
                '<input type="date" id="cake-date-edit" value="' + esc(request.requested_date || '') + '">' +
              '</div>' +
            '</div>' +
            '<div class="form-field">' +
              '<label for="cake-notes-edit">Admin notes <span class="optional">(internal — never shown to customers)</span></label>' +
              '<textarea id="cake-notes-edit">' + esc(request.admin_notes || '') + '</textarea>' +
            '</div>' +
          '</form>' +
          '<div class="form-field">' +
            '<label>Status</label>' +
            '<div class="status-buttons">' +
              REQUEST_STATUSES.map(function (status) {
                return '<button type="button" class="btn btn-small ' + (status === request.status ? 'btn-primary' : 'btn-outline') + '" data-cake-modal-status="' + status + '">' + STATUS_LABELS[status] + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-outline" data-close-modal>Close</button>' +
          '<button type="submit" form="cake-edit-form" class="btn btn-primary" id="cake-save-btn">Save notes</button>' +
        '</div>' +
      '</div>'
    );

    const badgeEl = byId('cake-modal-badge');
    byId('cake-edit-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const saveButton = byId('cake-save-btn');
      AdminUI.setButtonBusy(saveButton, true, 'Saving...');
      try {
        const updated = await BB.updateCakeRequest(request.id, {
          size_label: byId('cake-size-edit').value || null,
          requested_date: byId('cake-date-edit').value || null,
          admin_notes: byId('cake-notes-edit').value.trim() || null,
        });
        if (updated) {
          request.size_label = updated.size_label;
          request.requested_date = updated.requested_date;
          request.admin_notes = updated.admin_notes;
        }
        AdminUI.closeModal();
        BB.toast('Request updated.', 'success');
        await loadCakes();
      } catch (err) {
        AdminUI.setButtonBusy(saveButton, false);
        BB.toast(err && err.message ? err.message : 'Could not update the request.', 'error');
      }
    });

    byId('cake-modal-title').closest('.modal').querySelectorAll('[data-cake-modal-status]').forEach(function (button) {
      button.addEventListener('click', function () {
        updateCakeRequestStatus(request, button.getAttribute('data-cake-modal-status'), badgeEl);
      });
    });
  }

  function wireCakes() {
    byId('cake-status-filter').addEventListener('change', loadCakes);
    byId('cakes-body').addEventListener('click', function (event) {
      const statusButton = event.target.closest('button[data-cake-status]');
      if (statusButton) {
        const request = cakesState.list.find(function (r) { return r.id === statusButton.getAttribute('data-cake-id'); });
        if (request) updateCakeRequestStatus(request, statusButton.getAttribute('data-cake-status'), null);
        return;
      }
      const viewButton = event.target.closest('button[data-cake-view]');
      if (viewButton) {
        const request = cakesState.list.find(function (r) { return r.id === viewButton.getAttribute('data-cake-view'); });
        if (request) openCakeModal(request);
      }
    });
  }

  AdminPanels.register('cakes', loadCakes);

  /* ===========================================================================
     3. RESERVATIONS
     =========================================================================== */

  const reservationsState = { list: [] };

  async function loadReservations() {
    const body = byId('reservations-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonTable(7, 4);
    try {
      reservationsState.list = await BB.getReservationsAdmin();
      renderReservations();
    } catch (err) {
      AdminUI.renderError(body, err, loadReservations);
      BB.toast(err && err.message ? err.message : 'Could not load reservations.', 'error');
    }
  }

  function renderReservations() {
    const body = byId('reservations-body');
    if (!reservationsState.list.length) {
      body.innerHTML = BB.emptyStateHtml('No reservations yet', 'Reservation requests from the website will appear here.');
      return;
    }

    const rows = reservationsState.list.map(function (reservation) {
      const id = esc(reservation.id);
      return (
        '<tr>' +
          '<td class="cell-strong">' + esc(reservation.name) + '</td>' +
          '<td><span class="badge badge-soft">' + esc(RESERVATION_TYPES[reservation.reservation_type] || reservation.reservation_type) + '</span></td>' +
          '<td>' + esc(reservation.party_size) + '</td>' +
          '<td>' + AdminUI.fmtDate(reservation.requested_date) + '<div class="cell-muted">' + esc(reservation.requested_time || 'Flexible') + '</div></td>' +
          '<td>' + esc(reservation.phone || '—') + '</td>' +
          '<td><select class="status-select" data-res-status="' + id + '" aria-label="Status for the reservation of ' + esc(reservation.name) + '">' +
            statusOptions(REQUEST_STATUSES, reservation.status) + '</select></td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-outline" data-res-view="' + id + '">View</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>Name</th><th>Type</th><th>Party</th><th>Date &amp; time</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  async function changeReservationStatus(select, reservation) {
    const newStatus = select.value;
    const previous = reservation.status;
    if (newStatus === previous) return;
    select.disabled = true;
    try {
      await BB.updateReservation(reservation.id, { status: newStatus });
      reservation.status = newStatus;
      BB.toast('Reservation for ' + reservation.name + ' marked as "' + STATUS_LABELS[newStatus] + '".', 'success');
      await loadReservations();
    } catch (err) {
      select.value = previous;
      BB.toast(err && err.message ? err.message : 'Could not update the reservation.', 'error');
    }
    select.disabled = false;
  }

  function openReservationModal(reservation) {
    const detailRows = [];
    detailRows.push(detailRow('Name', esc(reservation.name)));
    detailRows.push(detailRow('Phone', reservation.phone ? '<a href="tel:' + esc(reservation.phone) + '">' + esc(reservation.phone) + '</a>' : '—'));
    detailRows.push(detailRow('Email', reservation.email ? '<a href="mailto:' + esc(reservation.email) + '">' + esc(reservation.email) + '</a>' : '—'));
    detailRows.push(detailRow('Type', esc(RESERVATION_TYPES[reservation.reservation_type] || reservation.reservation_type)));
    detailRows.push(detailRow('Party size', esc(reservation.party_size)));
    detailRows.push(detailRow('Date', esc(AdminUI.fmtDate(reservation.requested_date))));
    detailRows.push(detailRow('Time', esc(reservation.requested_time || 'Flexible')));
    detailRows.push(detailRow('Customer notes', reservation.notes ? esc(reservation.notes) : '—'));
    detailRows.push(detailRow('Created', esc(AdminUI.fmtDateTime(reservation.created_at))));

    AdminUI.openModal(
      '<div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="reservation-modal-title">' +
        '<div class="modal-head">' +
          '<h3 id="reservation-modal-title">Reservation <span id="reservation-modal-badge">' +
            AdminUI.statusBadge(AdminUI.REQUEST_STATUS_BADGES, reservation.status) + '</span></h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close reservation details">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="detail-list">' + detailRows.join('') + '</div>' +
          '<form id="reservation-notes-form" novalidate>' +
            '<div class="form-field">' +
              '<label for="reservation-notes-edit">Admin notes <span class="optional">(internal — never shown to customers)</span></label>' +
              '<textarea id="reservation-notes-edit">' + esc(reservation.admin_notes || '') + '</textarea>' +
            '</div>' +
          '</form>' +
          '<div class="form-field">' +
            '<label>Status</label>' +
            '<div class="status-buttons">' +
              REQUEST_STATUSES.map(function (status) {
                return '<button type="button" class="btn btn-small ' + (status === reservation.status ? 'btn-primary' : 'btn-outline') + '" data-res-modal-status="' + status + '">' + STATUS_LABELS[status] + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-outline" data-close-modal>Close</button>' +
          '<button type="submit" form="reservation-notes-form" class="btn btn-primary" id="reservation-save-btn">Save notes</button>' +
        '</div>' +
      '</div>'
    );

    const badgeEl = byId('reservation-modal-badge');
    byId('reservation-notes-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const saveButton = byId('reservation-save-btn');
      AdminUI.setButtonBusy(saveButton, true, 'Saving...');
      try {
        const updated = await BB.updateReservation(reservation.id, {
          admin_notes: byId('reservation-notes-edit').value.trim() || null,
        });
        if (updated) reservation.admin_notes = updated.admin_notes;
        AdminUI.closeModal();
        BB.toast('Reservation updated.', 'success');
        await loadReservations();
      } catch (err) {
        AdminUI.setButtonBusy(saveButton, false);
        BB.toast(err && err.message ? err.message : 'Could not update the reservation.', 'error');
      }
    });

    byId('reservation-modal-title').closest('.modal').querySelectorAll('[data-res-modal-status]').forEach(function (button) {
      button.addEventListener('click', async function () {
        const status = button.getAttribute('data-res-modal-status');
        try {
          const updated = await BB.updateReservation(reservation.id, { status: status });
          reservation.status = updated ? updated.status : status;
          BB.toast('Reservation marked as "' + STATUS_LABELS[status] + '".', 'success');
          await loadReservations();
          badgeEl.innerHTML = AdminUI.statusBadge(AdminUI.REQUEST_STATUS_BADGES, reservation.status);
        } catch (err) {
          BB.toast(err && err.message ? err.message : 'Could not update the reservation.', 'error');
        }
      });
    });
  }

  function wireReservations() {
    byId('reservations-body').addEventListener('change', function (event) {
      const select = event.target.closest('select[data-res-status]');
      if (!select) return;
      const reservation = reservationsState.list.find(function (r) { return r.id === select.getAttribute('data-res-status'); });
      if (reservation) changeReservationStatus(select, reservation);
    });
    byId('reservations-body').addEventListener('click', function (event) {
      const viewButton = event.target.closest('button[data-res-view]');
      if (!viewButton) return;
      const reservation = reservationsState.list.find(function (r) { return r.id === viewButton.getAttribute('data-res-view'); });
      if (reservation) openReservationModal(reservation);
    });
  }

  AdminPanels.register('reservations', loadReservations);

  /* ===========================================================================
     4. MESSAGES
     =========================================================================== */

  const messagesState = { list: [] };

  async function loadMessages() {
    const body = byId('messages-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonTable(7, 4);
    try {
      messagesState.list = await BB.getMessagesAdmin();
      renderMessages();
    } catch (err) {
      AdminUI.renderError(body, err, loadMessages);
      BB.toast(err && err.message ? err.message : 'Could not load messages.', 'error');
    }
  }

  function renderMessages() {
    const body = byId('messages-body');
    if (!messagesState.list.length) {
      body.innerHTML = BB.emptyStateHtml('No messages yet', 'Contact form messages will appear here.');
      return;
    }

    const rows = messagesState.list.map(function (message) {
      const id = esc(message.id);
      const nameHtml = message.is_read
        ? esc(message.name)
        : '<span class="cell-strong">' + esc(message.name) + '</span><span class="unread-dot" title="Unread"></span>';
      return (
        '<tr>' +
          '<td>' + nameHtml + '</td>' +
          '<td>' + esc(message.email) + '</td>' +
          '<td>' + esc(message.subject || '—') + '</td>' +
          '<td class="cell-muted">' + esc(excerpt(message.message, 60)) + '</td>' +
          '<td class="cell-muted">' + AdminUI.fmtDateTime(message.created_at) + '</td>' +
          '<td>' + (message.is_read ? '<span class="badge badge-soft">Read</span>' : '<span class="badge badge-caramel">Unread</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-outline" data-msg-view="' + id + '">View</button>' +
            '<button type="button" class="btn btn-danger" data-msg-delete="' + id + '">Delete</button>' +
          '</div></td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table">' +
        '<thead><tr><th>From</th><th>Email</th><th>Subject</th><th>Message</th><th>Received</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  }

  async function toggleMessageRead(message, isRead) {
    try {
      await BB.updateMessage(message.id, { is_read: isRead });
      message.is_read = isRead;
      AdminUI.closeModal();
      BB.toast('Message marked as ' + (isRead ? 'read' : 'unread') + '.', 'success');
      await loadMessages();
    } catch (err) {
      BB.toast(err && err.message ? err.message : 'Could not update the message.', 'error');
    }
  }

  async function deleteMessageRow(message) {
    const confirmed = BB.confirmDialog('Delete the message from "' + message.name + '"? This cannot be undone.');
    if (!confirmed) return;
    try {
      await BB.deleteMessage(message.id);
      AdminUI.closeModal();
      BB.toast('Message deleted.', 'success');
      await loadMessages();
    } catch (err) {
      BB.toast(err && err.message ? err.message : 'Could not delete the message.', 'error');
    }
  }

  function openMessageModal(message) {
    const detailRows = [];
    detailRows.push(detailRow('From', esc(message.name)));
    detailRows.push(detailRow('Email', '<a href="mailto:' + esc(message.email) + '">' + esc(message.email) + '</a>'));
    if (message.phone) detailRows.push(detailRow('Phone', '<a href="tel:' + esc(message.phone) + '">' + esc(message.phone) + '</a>'));
    detailRows.push(detailRow('Subject', esc(message.subject || '—')));
    detailRows.push(detailRow('Received', esc(AdminUI.fmtDateTime(message.created_at))));
    detailRows.push(detailRow('Status', message.is_read ? 'Read' : 'Unread'));

    AdminUI.openModal(
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="message-modal-title">' +
        '<div class="modal-head">' +
          '<h3 id="message-modal-title">Message from ' + esc(message.name) + '</h3>' +
          '<button type="button" class="icon-btn" data-close-modal aria-label="Close message">' + AdminUI.X_SVG + '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="detail-list">' + detailRows.join('') + '</div>' +
          '<h4>Message</h4>' +
          '<p class="message-body">' + esc(message.message) + '</p>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-danger" data-msg-delete="' + esc(message.id) + '">Delete</button>' +
          '<button type="button" class="btn btn-outline" data-close-modal>Close</button>' +
          '<button type="button" class="btn btn-primary" id="message-read-toggle">' +
            (message.is_read ? 'Mark as unread' : 'Mark as read') + '</button>' +
        '</div>' +
      '</div>'
    );

    byId('message-read-toggle').addEventListener('click', function () {
      toggleMessageRead(message, !message.is_read);
    });
  }

  function wireMessages() {
    byId('messages-body').addEventListener('click', function (event) {
      const viewButton = event.target.closest('button[data-msg-view]');
      if (viewButton) {
        const message = messagesState.list.find(function (m) { return m.id === viewButton.getAttribute('data-msg-view'); });
        if (message) openMessageModal(message);
        return;
      }
      const deleteButton = event.target.closest('button[data-msg-delete]');
      if (deleteButton) {
        const message = messagesState.list.find(function (m) { return m.id === deleteButton.getAttribute('data-msg-delete'); });
        if (message) deleteMessageRow(message);
      }
    });
  }

  AdminPanels.register('messages', loadMessages);

  /* ===========================================================================
     5. SETTINGS
     =========================================================================== */

  const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', EGP: 'E£', AED: 'د.إ', SAR: '﷼' };

  async function loadSettings() {
    const body = byId('settings-body');
    if (!BB.configured) { body.innerHTML = BB.setupNoticeHtml(); return; }
    body.innerHTML = AdminUI.skeletonLines(6);
    try {
      const settings = await BB.getSettings();
      if (!settings) {
        AdminUI.renderError(body, new Error('The site settings row could not be loaded.'), loadSettings);
        return;
      }
      renderSettingsForm(settings);
    } catch (err) {
      AdminUI.renderError(body, err, loadSettings);
      BB.toast(err && err.message ? err.message : 'Could not load settings.', 'error');
    }
  }

  /* Small builders keep the giant form readable. `label` may contain HTML. */
  function textField(id, labelHtml, value, opts) {
    opts = opts || {};
    return (
      '<div class="form-field">' +
        '<label for="' + id + '">' + labelHtml + '</label>' +
        '<input type="' + (opts.type || 'text') + '" id="' + id + '"' +
          (opts.type === 'number' ? ' step="0.01" min="0"' : '') +
          ' value="' + esc(value == null ? '' : value) + '">' +
        (opts.hint ? '<p class="field-hint">' + opts.hint + '</p>' : '') +
      '</div>'
    );
  }

  function checkboxField(id, labelHtml, isChecked) {
    return (
      '<div class="form-field">' +
        '<div class="checkbox-row">' +
          '<input type="checkbox" id="' + id + '"' + (isChecked ? ' checked' : '') + '>' +
          '<label for="' + id + '">' + labelHtml + '</label>' +
        '</div>' +
      '</div>'
    );
  }

  /* Repeatable rows: opening hours (label + hours) and custom cake sizes /
     extras (label + price). The factory keeps DOM and state in sync. */
  function createRepeatRows(container, initialRows, valueKey, valueIsNumber, placeholder) {
    let rows = (initialRows || []).map(function (row) {
      return { label: String(row.label || ''), value: row[valueKey] == null ? '' : String(row[valueKey]) };
    });

    function readDom() {
      rows = [];
      container.querySelectorAll('.repeat-row').forEach(function (rowElement) {
        const labelInput = rowElement.querySelector('[data-rp-label]');
        const valueInput = rowElement.querySelector('[data-rp-value]');
        rows.push({ label: labelInput ? labelInput.value : '', value: valueInput ? valueInput.value : '' });
      });
    }

    function render() {
      if (!rows.length) {
        container.innerHTML = '<p class="field-hint">Nothing yet — add the first row below.</p>';
        return;
      }
      container.innerHTML = rows.map(function (row, index) {
        return (
          '<div class="repeat-row">' +
            '<input type="text" data-rp-label="' + index + '" value="' + esc(row.label) + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + ' name, row ' + (index + 1) + '">' +
            '<input type="' + (valueIsNumber ? 'number' : 'text') + '" data-rp-value="' + index + '" value="' + esc(row.value) + '" placeholder="' + (valueIsNumber ? '0.00' : 'Value') + '" aria-label="' + esc(placeholder) + ' value, row ' + (index + 1) + '"' + (valueIsNumber ? ' step="0.01" min="0"' : '') + '>' +
            '<button type="button" class="btn btn-outline" data-rp-remove="' + index + '" aria-label="Remove row ' + (index + 1) + '">Remove</button>' +
          '</div>'
        );
      }).join('');
    }

    container.addEventListener('click', function (event) {
      const removeButton = event.target.closest('button[data-rp-remove]');
      if (!removeButton) return;
      readDom();
      rows.splice(Number(removeButton.getAttribute('data-rp-remove')), 1);
      render();
    });

    return {
      render: render,
      add: function () {
        readDom();
        rows.push({ label: '', value: '' });
        render();
        const first = container.querySelector('input[data-rp-label]');
        if (first) first.focus();
      },
      read: function () {
        readDom();
        return rows
          .map(function (row) {
            const label = row.label.trim();
            if (!label) return null; /* ignore fully empty label rows */
            const item = { label: label };
            item[valueKey] = valueIsNumber ? (Number(row.value) || 0) : row.value.trim();
            return item;
          })
          .filter(Boolean);
      },
    };
  }

  function renderSettingsForm(settings) {
    const body = byId('settings-body');
    const optional = ' <span class="optional">(optional)</span>';

    body.innerHTML =
      '<form id="settings-form" novalidate>' +

        '<section class="admin-form-section"><h4>Brand</h4>' +
          '<div class="form-grid">' +
            textField('set-bakery-name', 'Bakery name', settings.bakery_name) +
            textField('set-tagline', 'Tagline', settings.tagline, { optional: true }) +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Homepage</h4>' +
          '<div class="form-grid">' +
            textField('set-hero-title', 'Hero title', settings.hero_title, { hint: 'Use | for a line break.' }) +
            textField('set-hero-subtitle', 'Hero subtitle', settings.hero_subtitle, { optional: true }) +
            textField('set-hero-cta', 'Hero button label', settings.hero_cta_label, { optional: true }) +
          '</div>' +
          '<div class="form-field">' +
            '<label for="set-hero-image">Hero image</label>' +
            '<input type="text" id="set-hero-image" value="' + esc(settings.hero_image || '') + '" placeholder="./hero-croissants.jpg or a Storage URL">' +
            '<p class="field-hint">A path like ./hero-croissants.jpg, or upload a new photo below (stored in Supabase Storage).</p>' +
            '<div id="hero-image-preview"></div>' +
            '<label class="upload-tile">Upload hero image<input type="file" id="set-hero-image-file" accept="image/*"></label>' +
          '</div>' +
          checkboxField('set-announcement-enabled', 'Show the announcement bar', Boolean(settings.announcement_enabled)) +
          textField('set-announcement-text', 'Announcement text', settings.announcement_text, { optional: true, hint: 'Shown at the very top of every page when enabled.' }) +
        '</section>' +

        '<section class="admin-form-section"><h4>Currency</h4>' +
          '<div class="form-grid">' +
            '<div class="form-field">' +
              '<label for="set-currency-code">Currency code</label>' +
              '<select id="set-currency-code">' +
                Object.keys(CURRENCY_SYMBOLS).map(function (code) {
                  return '<option value="' + code + '"' + (settings.currency_code === code ? ' selected' : '') + '>' + code + ' (' + CURRENCY_SYMBOLS[code] + ')</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            textField('set-currency-symbol', 'Currency symbol', settings.currency_symbol || '$', { hint: 'Suggested from the code — still editable.' }) +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Contact</h4>' +
          '<div class="form-grid">' +
            textField('set-phone', 'Phone', settings.phone, { optional: true }) +
            textField('set-email', 'Email', settings.email, { optional: true, type: 'email' }) +
            textField('set-address', 'Address', settings.address, { optional: true }) +
            textField('set-whatsapp', 'WhatsApp number', settings.whatsapp_number, { optional: true, hint: 'Digits with country code, e.g. 15551234567' }) +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Social</h4>' +
          '<div class="form-grid">' +
            textField('set-instagram', 'Instagram URL', settings.instagram_url, { optional: true, type: 'url' }) +
            textField('set-facebook', 'Facebook URL', settings.facebook_url, { optional: true, type: 'url' }) +
            textField('set-tiktok', 'TikTok URL', settings.tiktok_url, { optional: true, type: 'url' }) +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Orders</h4>' +
          '<div class="form-grid">' +
            checkboxField('set-pickup', 'Pickup enabled', settings.pickup_enabled !== false) +
            checkboxField('set-delivery', 'Delivery enabled', settings.delivery_enabled !== false) +
            textField('set-delivery-fee', 'Delivery fee', settings.delivery_fee, { type: 'number' }) +
            textField('set-delivery-free-over', 'Free delivery over', settings.delivery_free_over, { type: 'number', optional: true, hint: 'Leave empty for "never free".' }) +
            textField('set-min-order', 'Minimum order amount', settings.min_order_amount, { type: 'number' }) +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>About</h4>' +
          textField('set-about-title', 'About title', settings.about_title, { optional: true }) +
          '<div class="form-field"><label for="set-about-text">About text' + optional + '</label><textarea id="set-about-text">' + esc(settings.about_text || '') + '</textarea></div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Custom cake</h4>' +
          '<div class="form-field"><label for="set-cake-note">Custom cake note' + optional + '</label><textarea id="set-cake-note">' + esc(settings.custom_cake_note || '') + '</textarea>' +
          '<p class="field-hint">Shown under the price estimate in the cake builder.</p></div>' +
          '<div class="form-field">' +
            '<label>Cake sizes</label>' +
            '<div class="repeat-rows" id="set-sizes-rows"></div>' +
            '<button type="button" class="btn btn-outline btn-small" id="set-sizes-add">Add size</button>' +
          '</div>' +
          '<div class="form-field">' +
            '<label>Design extras (with price surcharge)</label>' +
            '<div class="repeat-rows" id="set-extras-rows"></div>' +
            '<button type="button" class="btn btn-outline btn-small" id="set-extras-add">Add extra</button>' +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Opening hours</h4>' +
          '<div class="form-field">' +
            '<div class="repeat-rows" id="set-hours-rows"></div>' +
            '<button type="button" class="btn btn-outline btn-small" id="set-hours-add">Add hours row</button>' +
          '</div>' +
        '</section>' +

        '<section class="admin-form-section"><h4>Policies</h4>' +
          '<div class="form-field"><label for="set-policy-note">Policy note' + optional + '</label><textarea id="set-policy-note">' + esc(settings.policy_note || '') + '</textarea></div>' +
        '</section>' +

        '<div class="settings-foot">' +
          '<p id="settings-error" class="field-error" hidden></p>' +
          '<button type="submit" class="btn btn-primary" id="settings-save">Save Settings</button>' +
        '</div>' +
      '</form>';

    /* --- wiring ------------------------------------------------------------- */

    const hoursList = createRepeatRows(body.querySelector('#set-hours-rows'), settings.opening_hours || [], 'hours', false, 'Monday');
    const sizesList = createRepeatRows(body.querySelector('#set-sizes-rows'), settings.custom_cake_sizes || [], 'price', true, '6 inch — serves 8');
    const extrasList = createRepeatRows(body.querySelector('#set-extras-rows'), settings.custom_cake_extras || [], 'price', true, 'Floral');
    hoursList.render(); sizesList.render(); extrasList.render();
    body.querySelector('#set-hours-add').addEventListener('click', hoursList.add);
    body.querySelector('#set-sizes-add').addEventListener('click', sizesList.add);
    body.querySelector('#set-extras-add').addEventListener('click', extrasList.add);

    /* Currency symbol auto-suggest (until the admin edits the symbol field). */
    const symbolInput = body.querySelector('#set-currency-symbol');
    let symbolTouched = Boolean(settings.currency_symbol);
    symbolInput.addEventListener('input', function () { symbolTouched = true; });
    body.querySelector('#set-currency-code').addEventListener('change', function () {
      if (!symbolTouched) symbolInput.value = CURRENCY_SYMBOLS[this.value] || '$';
    });

    /* Hero image preview + upload. */
    const heroInput = body.querySelector('#set-hero-image');
    const heroPreview = body.querySelector('#hero-image-preview');
    function renderHeroPreview() {
      heroPreview.innerHTML = heroInput.value.trim()
        ? '<img class="admin-img-preview" src="' + esc(heroInput.value.trim()) + '" alt="Current hero image preview">'
        : '<p class="field-hint">No hero image set.</p>';
    }
    renderHeroPreview();
    heroInput.addEventListener('change', renderHeroPreview);
    body.querySelector('#set-hero-image-file').addEventListener('change', async function () {
      const file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      heroPreview.innerHTML = '<div class="tile-uploading">Uploading...</div>';
      try {
        if (!file.type || file.type.indexOf('image/') !== 0) throw new Error('Please choose an image file (JPG, PNG or WebP).');
        if (file.size > 8 * 1024 * 1024) throw new Error('Image is too large. Maximum size is 8 MB.');
        const url = await BB.uploadImage(file, 'site');
        heroInput.value = url;
        BB.toast('Hero image uploaded — remember to save.', 'success');
      } catch (err) {
        BB.toast(err && err.message ? err.message : 'Upload failed.', 'error');
      }
      renderHeroPreview();
    });

    /* --- save ----------------------------------------------------------------- */
    body.querySelector('#settings-form').addEventListener('submit', async function (event) {
      event.preventDefault();

      function text(id) { return byId(id).value.trim() || null; }
      function numberOrNull(id) {
        const raw = byId(id).value.trim();
        return raw === '' ? null : Number(raw);
      }

      const errorEl = byId('settings-error');
      errorEl.hidden = true;
      this.querySelectorAll('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });

      const deliveryFee = numberOrNull('set-delivery-fee');
      const freeOver = numberOrNull('set-delivery-free-over');
      const minOrder = numberOrNull('set-min-order');
      const whatsapp = byId('set-whatsapp').value.trim();
      const symbol = symbolInput.value.trim();

      const invalidFields = [];
      if (deliveryFee == null || isNaN(deliveryFee) || deliveryFee < 0) invalidFields.push('set-delivery-fee');
      if (freeOver != null && (isNaN(freeOver) || freeOver < 0)) invalidFields.push('set-delivery-free-over');
      if (minOrder == null || isNaN(minOrder) || minOrder < 0) invalidFields.push('set-min-order');
      if (whatsapp && !/^[0-9]+$/.test(whatsapp)) invalidFields.push('set-whatsapp');
      if (!symbol) invalidFields.push('set-currency-symbol');

      if (invalidFields.length) {
        invalidFields.forEach(function (id) { byId(id).classList.add('is-invalid'); });
        byId(invalidFields[0]).focus();
        errorEl.textContent = 'Please fix the highlighted fields (fees and amounts must be 0 or more; WhatsApp digits only).';
        errorEl.hidden = false;
        BB.toast('Please fix the highlighted settings.', 'error');
        return;
      }

      const patch = {
        bakery_name: text('set-bakery-name'),
        tagline: text('set-tagline'),
        hero_title: text('set-hero-title'),
        hero_subtitle: text('set-hero-subtitle'),
        hero_image: text('set-hero-image'),
        hero_cta_label: text('set-hero-cta'),
        announcement_enabled: byId('set-announcement-enabled').checked,
        announcement_text: text('set-announcement-text'),
        currency_code: byId('set-currency-code').value,
        currency_symbol: symbol,
        phone: text('set-phone'),
        email: text('set-email'),
        address: text('set-address'),
        whatsapp_number: whatsapp || null,
        instagram_url: text('set-instagram'),
        facebook_url: text('set-facebook'),
        tiktok_url: text('set-tiktok'),
        pickup_enabled: byId('set-pickup').checked,
        delivery_enabled: byId('set-delivery').checked,
        delivery_fee: deliveryFee == null ? 0 : deliveryFee,
        delivery_free_over: freeOver, /* null = never free */
        min_order_amount: minOrder == null ? 0 : minOrder,
        about_title: text('set-about-title'),
        about_text: text('set-about-text'),
        custom_cake_note: text('set-cake-note'),
        custom_cake_sizes: sizesList.read(),
        custom_cake_extras: extrasList.read(),
        opening_hours: hoursList.read(),
        policy_note: text('set-policy-note'),
      };

      const saveButton = byId('settings-save');
      AdminUI.setButtonBusy(saveButton, true, 'Saving...');
      try {
        await BB.saveSettings(patch); /* also refreshes the shared BB.settings */
        errorEl.hidden = true;
        BB.toast('Settings saved — the public site updates on next load.', 'success');
      } catch (err) {
        errorEl.textContent = err && err.message ? err.message : 'Could not save the settings.';
        errorEl.hidden = false;
        BB.toast(err && err.message ? err.message : 'Could not save the settings.', 'error');
      } finally {
        AdminUI.setButtonBusy(saveButton, false);
      }
    });
  }

  AdminPanels.register('settings', loadSettings);

  /* ===========================================================================
     6. DEMO DATA
     =========================================================================== */

  const DEMO_BUTTON_IDS = ['load-demo-btn', 'remove-demo-btn', 'replace-demo-btn'];

  const DEMO_CONFIRM = {
    load: 'Load the 30-product demo catalog? Existing demo data is kept; nothing is duplicated.',
    remove: 'Remove ONLY demo-marked records? Your real products, orders and requests are never touched.',
    replace: 'Replace demo data? Demo records are removed and the fresh sample catalog is loaded.',
  };

  async function loadDemoTab() {
    const area = byId('demo-status-area');
    area.innerHTML = AdminUI.skeletonLines(2);
    try {
      renderDemoStatus(await BB.getDemoStatus());
    } catch (err) {
      AdminUI.renderError(area, err, loadDemoTab);
      BB.toast(err && err.message ? err.message : 'Could not load the demo status.', 'error');
    }
  }

  function renderDemoStatus(status) {
    const area = byId('demo-status-area');
    if (!status || !status.configured) {
      area.innerHTML = '<p class="field-hint">Connect Supabase first — paste your project URL and anon key into supabase.js (see README).</p>';
      DEMO_BUTTON_IDS.forEach(function (id) { byId(id).disabled = true; });
      return;
    }
    area.innerHTML =
      '<div class="demo-counts">' +
        '<span class="demo-count-chip">Products ' + esc(status.products) + '</span>' +
        '<span class="demo-count-chip">Categories ' + esc(status.categories) + '</span>' +
        '<span class="demo-count-chip">Collections ' + esc(status.collections) + '</span>' +
      '</div>' +
      '<p>' + (status.loaded ? 'Demo data is loaded.' : 'No demo data loaded.') + '</p>';
    DEMO_BUTTON_IDS.forEach(function (id) { byId(id).disabled = false; });
  }

  async function refreshDemoStatus() {
    try {
      renderDemoStatus(await BB.getDemoStatus());
    } catch (err) {
      AdminUI.renderError(byId('demo-status-area'), err, loadDemoTab);
    }
  }

  /* The SQL functions return jsonb:
     load_demo_catalog()  -> {loaded, skipped, categories, collections, products, testimonials}
     remove_demo_catalog()-> {products, categories, collections, testimonials, orders,
                              cake_requests, reservations, contact_messages}
     We display exactly what came back. */
  function describeDemoResult(kind, result) {
    const data = result || {};
    const count = function (key) { return data[key] == null ? 0 : data[key]; };

    if (kind === 'load') {
      if (data.skipped) {
        return {
          toast: 'Demo data is already loaded — nothing was duplicated.',
          summary: 'Nothing was duplicated — the demo catalog is already loaded.' +
            (data.message ? ' (' + data.message + ')' : ''),
        };
      }
      return {
        toast: 'Demo catalog loaded — ' + count('loaded') + ' products added.',
        summary: 'Loaded ' + count('loaded') + ' products, ' + count('categories') + ' categories, ' +
          count('collections') + ' collections, ' + count('testimonials') + ' testimonials.',
      };
    }

    if (kind === 'remove') {
      return {
        toast: 'Demo data removed.',
        summary: 'Removed demo records — products: ' + count('products') + ', categories: ' + count('categories') +
          ', collections: ' + count('collections') + ', testimonials: ' + count('testimonials') +
          ', orders: ' + count('orders') + ', cake requests: ' + count('cake_requests') +
          ', reservations: ' + count('reservations') + ', messages: ' + count('contact_messages') + '.',
      };
    }

    /* replace — the wrapper carries both raw results */
    const removed = data.removed || {};
    const loaded = data.loaded || {};
    const loadedCount = function (key) { return loaded[key] == null ? 0 : loaded[key]; };
    return {
      toast: 'Demo data replaced — fresh catalog loaded.',
      summary: 'Removed the previous demo batch (products: ' + (removed.products == null ? 0 : removed.products) +
        ', categories: ' + (removed.categories == null ? 0 : removed.categories) +
        ', collections: ' + (removed.collections == null ? 0 : removed.collections) + '), then loaded ' +
        loadedCount('loaded') + ' products, ' + loadedCount('categories') + ' categories, ' +
        loadedCount('collections') + ' collections, ' + loadedCount('testimonials') + ' testimonials.',
    };
  }

  async function runDemoAction(kind) {
    if (!BB.configured) {
      BB.toast('Connect Supabase first — see supabase.js.', 'error');
      return;
    }
    if (!BB.confirmDialog(DEMO_CONFIRM[kind])) return;

    const buttons = DEMO_BUTTON_IDS.map(byId);
    const activeButton = byId(kind + '-demo-btn');
    buttons.forEach(function (button) { button.disabled = true; });
    AdminUI.setButtonBusy(activeButton, true, kind === 'load' ? 'Loading...' : kind === 'remove' ? 'Removing...' : 'Replacing...');

    let result;
    try {
      if (kind === 'load') {
        result = await BB.loadDemoData();
      } else if (kind === 'remove') {
        result = await BB.removeDemoData();
      } else {
        const removed = await BB.removeDemoData();
        const loaded = await BB.loadDemoData();
        result = { removed: removed, loaded: loaded };
      }
    } catch (err) {
      /* Restore the button label first, then the correct disabled states. */
      AdminUI.setButtonBusy(activeButton, false);
      await refreshDemoStatus();
      BB.toast(err && err.message ? err.message : 'Demo action failed.', 'error');
      return;
    }

    const described = describeDemoResult(kind, result);
    AdminUI.setButtonBusy(activeButton, false);
    await refreshDemoStatus();
    const report = document.createElement('div');
    report.className = 'demo-result';
    report.textContent = described.summary;
    byId('demo-status-area').appendChild(report);
    BB.toast(described.toast, 'success');
  }

  function wireDemo() {
    ['load', 'remove', 'replace'].forEach(function (kind) {
      byId(kind + '-demo-btn').addEventListener('click', function () { runDemoAction(kind); });
    });
  }

  AdminPanels.register('demo', loadDemoTab);

  /* ===========================================================================
     BOOT — wire the static containers once (delegated handlers survive the
     frequent innerHTML re-renders of each panel body).
     =========================================================================== */

  function boot() {
    wireOrders();
    wireCakes();
    wireReservations();
    wireMessages();
    wireDemo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.BB, window.AdminUI, window.AdminPanels);
