/* =============================================================================
   BUTTER & BLOOM — shop.js
   -----------------------------------------------------------------------------
   The product catalog page:
     · sidebar filters (search, category chips, sort, "in stock only")
     · reads/writes filter state through URL params (?category=&search=&sort=
       &available=1&collection=) without reloading the page
     · paged product grid (12 per page + "Load more")
     · collection deep-links (?collection=SLUG) with a small heading
     · loading / empty / error / setup states on every path

   Data comes from the shared layer in supabase.js; cards are rendered by
   BB.renderProductCard in main.js.
   ============================================================================= */

(function initShopPage(BB) {
  'use strict';

  /* Number of products fetched per page. We always ask the data layer for one
     extra row so we know whether a "Load more" button should be shown. */
  var PAGE_SIZE = 12;

  /* ---------------------------------------------------------------------------
     Filter state — seeded from the URL on load, kept in sync both ways
     --------------------------------------------------------------------------- */
  var state = {
    category: '',
    search: '',
    sort: 'featured',   // "Featured" = the bakery's default ordering (newest first)
    available: false,   // true -> only is_available products
    collection: '',     // seasonal_collections slug (deep-link support)
    offset: 0,          // pagination cursor
  };

  /* Guards against out-of-order responses when the baker changes filters fast */
  var requestToken = 0;

  /* Cached DOM references (filled in init) */
  var grid;
  var resultCount;
  var loadMoreBtn;
  var searchBox;
  var searchForm;
  var chipsWrap;
  var sortSelect;
  var availableToggle;
  var filterToggle;
  var sidebar;
  var collectionNote;

  /* ---------------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(function () {
      grid = document.getElementById('shop-grid');
      resultCount = document.getElementById('result-count');
      loadMoreBtn = document.getElementById('load-more');
      searchBox = document.getElementById('search-box');
      searchForm = document.getElementById('filter-search-form');
      chipsWrap = document.getElementById('category-chips');
      sortSelect = document.getElementById('sort-select');
      availableToggle = document.getElementById('available-toggle');
      filterToggle = document.getElementById('filter-toggle');
      sidebar = document.getElementById('shop-sidebar');
      collectionNote = document.getElementById('collection-note');

      readUrlParams();
      prefillControls();
      wireFilterEvents();

      if (!BB.configured) {
        // main.js has already replaced the .needs-data grid with the setup
        // notice. Filters stay wired but only explain how to enable the shop.
        renderCategoryChips([]); // "All" chip still selectable
        return;
      }

      renderCategoryChipsFromApi();
      showCollectionHeading();
      loadProducts({ reset: true });
    });
  });

  /* ---------------------------------------------------------------------------
     URL params -> state (?category=&search=&sort=&available=1&collection=)
     --------------------------------------------------------------------------- */
  function readUrlParams() {
    var params = new URLSearchParams(location.search);

    state.category = params.get('category') || '';
    state.search = (params.get('search') || '').trim();
    state.collection = params.get('collection') || '';

    var sort = params.get('sort');
    var allowedSorts = ['featured', 'newest', 'price-asc', 'price-desc', 'name'];
    state.sort = allowedSorts.indexOf(sort) !== -1 ? sort : 'featured';

    var available = params.get('available');
    state.available = available === '1' || available === 'true';

    state.offset = 0;
  }

  /* Write the current state back to the address bar without a reload so
     filtered views can be shared or bookmarked. */
  function updateUrl() {
    var params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.search) params.set('search', state.search);
    if (state.sort && state.sort !== 'featured') params.set('sort', state.sort);
    if (state.available) params.set('available', '1');
    if (state.collection) params.set('collection', state.collection);

    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  /* ---------------------------------------------------------------------------
     Controls <- state (one-time, on load and after "reset filters")
     --------------------------------------------------------------------------- */
  function prefillControls() {
    if (searchBox) searchBox.value = state.search;
    if (sortSelect) sortSelect.value = state.sort;
    if (availableToggle) availableToggle.checked = state.available;

    // On phone widths the sidebar starts collapsed so treats come first
    if (sidebar && window.matchMedia('(max-width: 900px)').matches) {
      sidebar.hidden = true;
      if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
    }
  }

  /* ---------------------------------------------------------------------------
     Events (always wired, even before Supabase is connected)
     --------------------------------------------------------------------------- */
  function wireFilterEvents() {
    // 1. Search box — submit via the Apply button or the Enter key
    if (searchForm) {
      searchForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (guardUnconfigured()) return;
        state.search = searchBox.value.trim();
        applyFilters();
      });
    }

    // 2. Category chips (delegated — chips are rendered asynchronously)
    if (chipsWrap) {
      chipsWrap.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-category]');
        if (!chip) return;
        if (guardUnconfigured()) return;
        state.category = chip.getAttribute('data-category');
        markActiveChip(state.category);
        applyFilters();
      });
    }

    // 3. Sort select
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        if (guardUnconfigured()) return;
        state.sort = sortSelect.value;
        applyFilters();
      });
    }

    // 4. "In stock only" checkbox
    if (availableToggle) {
      availableToggle.addEventListener('change', function () {
        if (guardUnconfigured()) return;
        state.available = availableToggle.checked;
        applyFilters();
      });
    }

    // 5. Mobile "Filters" toggle — collapses/expands the sidebar
    if (filterToggle && sidebar) {
      filterToggle.addEventListener('click', function () {
        var willShow = sidebar.hidden; // hidden now -> about to be shown
        sidebar.hidden = !willShow;
        filterToggle.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      });
    }

    // 6. "Load more" pagination
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        state.offset += PAGE_SIZE;
        loadProducts({ reset: false });
      });
    }

    // 7. "Reset filters" button inside the empty state (delegated, the button
    //    does not exist until the empty state is rendered)
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#reset-filters-btn')) return;
      if (guardUnconfigured()) return;
      resetFilters();
    });

    // 8. "Show all treats" button on the collection heading (delegated too)
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#collection-clear')) return;
      state.collection = '';
      collectionNote.hidden = true;
      applyFilters();
    });
  }

  /* Central "a filter changed" handler: refresh URL + grid from page 1 */
  function applyFilters() {
    state.offset = 0;
    updateUrl();
    loadProducts({ reset: true });
  }

  /* When Supabase is not configured the filters politely no-op */
  function guardUnconfigured() {
    if (BB.configured) return false;
    BB.toast('Connect Supabase to browse products', 'info');
    return true;
  }

  /* Back to the pristine catalog (used by the empty-state CTA) */
  function resetFilters() {
    state.category = '';
    state.search = '';
    state.sort = 'featured';
    state.available = false;
    state.collection = '';
    prefillControls();
    markActiveChip('');
    collectionNote.hidden = true;
    renderCategoryChipsFromApi(); // refresh chip active states
    applyFilters();
  }

  /* ---------------------------------------------------------------------------
     Category chips
     --------------------------------------------------------------------------- */
  function renderCategoryChips(categories) {
    if (!chipsWrap) return;
    var html = chipHtml('', 'All');
    categories.forEach(function (category) {
      html += chipHtml(category.slug, category.name);
    });
    chipsWrap.innerHTML = html;
    markActiveChip(state.category);
  }

  function chipHtml(slug, name) {
    return (
      '<button type="button" class="chip" data-category="' + BB.escapeHtml(slug) + '" ' +
        'aria-pressed="false">' + BB.escapeHtml(name) + '</button>'
    );
  }

  function renderCategoryChipsFromApi() {
    BB.getCategories()
      .then(renderCategoryChips)
      .catch(function () { renderCategoryChips([]); }); // chips are optional sugar
  }

  function markActiveChip(activeSlug) {
    if (!chipsWrap) return;
    chipsWrap.querySelectorAll('[data-category]').forEach(function (chip) {
      var isActive = chip.getAttribute('data-category') === activeSlug;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------------------
     Collection deep-link (?collection=SLUG) — small heading above the grid
     --------------------------------------------------------------------------- */
  function showCollectionHeading() {
    if (!collectionNote) return;
    if (!state.collection) { collectionNote.hidden = true; return; }

    // Human-readable name from the collections table (falls back to the slug)
    BB.getCollections()
      .then(function (collections) {
        var match = collections.find(function (c) { return c.slug === state.collection; });
        var name = match ? match.name : state.collection;
        collectionNote.innerHTML =
          '<span>Collection: ' + BB.escapeHtml(name) + '</span>' +
          '<button type="button" class="btn btn-outline" id="collection-clear">Show all treats</button>';
        collectionNote.hidden = false;
      })
      .catch(function () { collectionNote.hidden = true; });
  }

  /* ---------------------------------------------------------------------------
     Product loading + rendering
     --------------------------------------------------------------------------- */
  function buildQuery() {
    return {
      category: state.category || undefined,
      search: state.search || undefined,
      // "featured" and "newest" both map to the data layer's default ordering
      // (newest first) — supabase.js exposes no featured-first sort.
      sort: state.sort === 'featured' ? undefined : state.sort,
      availableOnly: state.available || undefined,
      collection: state.collection || undefined,
    };
  }

  async function loadProducts(opts) {
    var reset = opts && opts.reset;
    var token = ++requestToken;

    if (reset) {
      showSkeleton();
      if (loadMoreBtn) loadMoreBtn.hidden = true;
    }
    if (loadMoreBtn) loadMoreBtn.disabled = true;

    try {
      var query = buildQuery();
      query.limit = PAGE_SIZE + 1; // one extra row reveals whether more exist
      query.offset = state.offset;

      var rows = await BB.getProducts(query);
      if (token !== requestToken) return; // a newer request already won

      var hasMore = rows.length > PAGE_SIZE;
      var products = rows.slice(0, PAGE_SIZE);
      var shown = state.offset + products.length;

      if (reset) {
        grid.innerHTML = '';
        grid.classList.add('product-grid');
      }

      if (!products.length && state.offset === 0) {
        renderEmptyState();
        setResultCount('No treats found');
        return;
      }

      grid.insertAdjacentHTML('beforeend', products.map(BB.renderProductCard).join(''));
      setResultCount(hasMore ? 'Showing first ' + shown + ' treats' : shown + (shown === 1 ? ' treat' : ' treats') + ' found');
      if (loadMoreBtn) loadMoreBtn.hidden = !hasMore;
    } catch (error) {
      if (token !== requestToken) return;
      if (reset) {
        // First page failed: replace the skeleton with the error state
        grid.classList.add('product-grid');
        grid.innerHTML = BB.errorStateHtml(error.message);
        setResultCount('');
      } else {
        // "Load more" failed: keep the cards already on screen and the button
        // visible, rewind the pagination cursor so retrying refetches the page
        state.offset = Math.max(0, state.offset - PAGE_SIZE);
        BB.toast('Could not load more treats — please try again', 'error');
      }
      if (reset && loadMoreBtn) loadMoreBtn.hidden = true;
    } finally {
      if (token === requestToken && loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }

  /* Skeleton cards matching the markup used across the site */
  function showSkeleton() {
    var cards = '';
    for (var i = 0; i < PAGE_SIZE; i += 1) {
      cards += '<div class="skeleton-card"><div class="skeleton skeleton-img"></div>' +
        '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>';
    }
    grid.classList.add('product-grid');
    grid.innerHTML = cards;
  }

  function renderEmptyState() {
    grid.classList.remove('product-grid'); // let the empty state breathe full width
    grid.innerHTML = BB.emptyStateHtml(
      'No treats match your filters',
      'Try a different category, clear the search or include sold-out treats.',
      '<button type="button" class="btn btn-primary" id="reset-filters-btn">Reset filters</button>'
    );
  }

  function setResultCount(text) {
    if (resultCount) resultCount.textContent = text;
  }
})(window.BB);
