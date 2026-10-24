/* =============================================================================
   BUTTER & BLOOM — home.js
   -----------------------------------------------------------------------------
   Dynamic sections of the homepage:
     · hero text + image (from site settings, with static fallbacks)
     · "Featured Delights" category track
     · best sellers grid
     · new arrivals grid
     · seasonal collections cards
     · "Visit the Bakery" hours + address cards
   ============================================================================= */

(function initHomepage(BB) {
  'use strict';

  /* Wait for shared chrome (settings, badges, drawer...) to be ready */
  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(function () {
      renderHeroFromSettings();
      renderVisitCards();
      if (BB.configured) {
        loadCategories();
        loadBestSellers();
        loadNewArrivals();
        loadCollections();
      }
    });
  });

  /* ---------------------------------------------------------------------------
     Hero — settings override the defaults that are already in the HTML
     --------------------------------------------------------------------------- */
  function renderHeroFromSettings() {
    const settings = BB.settings;
    if (!settings) return;

    const titleEl = document.getElementById('hero-title');
    if (titleEl && settings.hero_title) {
      // Allow a manual line break with a pipe: "Freshly baked,| every day"
      titleEl.innerHTML = BB.escapeHtml(settings.hero_title).replace(/\|/g, '<br>');
    }
    const subEl = document.getElementById('hero-subtitle');
    if (subEl && settings.hero_subtitle) subEl.textContent = settings.hero_subtitle;
    const imageEl = document.getElementById('hero-image');
    if (imageEl && settings.hero_image) imageEl.src = settings.hero_image;
  }

  /* ---------------------------------------------------------------------------
     Featured Delights — category track
     --------------------------------------------------------------------------- */
  async function loadCategories() {
    const track = document.getElementById('category-track');
    if (!track) return;
    try {
      const categories = await BB.getCategories();
      if (!categories.length) {
        track.innerHTML = BB.emptyStateHtml('No categories yet', 'Categories you create in the admin panel will appear here.');
        return;
      }
      track.innerHTML = categories.map(function (category) {
        const image = category.image_url || '';
        const safeName = BB.escapeHtml(category.name);
        return (
          '<a class="category-card" href="shop.html?category=' + BB.escapeHtml(category.slug) + '">' +
            (image ? '<img class="category-img" src="' + BB.escapeHtml(image) + '" alt="' + safeName + '" loading="lazy">' : '') +
            '<span class="category-name">' + safeName + '</span>' +
          '</a>'
        );
      }).join('');
    } catch (error) {
      track.innerHTML = BB.errorStateHtml(error.message);
    }
  }

  /* ---------------------------------------------------------------------------
     Product grids (best sellers + new arrivals)
     --------------------------------------------------------------------------- */
  async function loadBestSellers() {
    const grid = document.getElementById('best-sellers-grid');
    if (!grid) return;
    try {
      const products = await BB.getProducts({ bestSeller: true, limit: 8 });
      renderGrid(grid, products, 'No best sellers yet', 'Mark products as "Best Seller" in the admin panel to feature them here.');
    } catch (error) {
      grid.innerHTML = BB.errorStateHtml(error.message);
    }
  }

  async function loadNewArrivals() {
    const grid = document.getElementById('new-arrivals-grid');
    if (!grid) return;
    try {
      const products = await BB.getProducts({ isNew: true, limit: 8 });
      renderGrid(grid, products, 'No new arrivals yet', 'Mark products as "New" in the admin panel to feature them here.');
    } catch (error) {
      grid.innerHTML = BB.errorStateHtml(error.message);
    }
  }

  function renderGrid(grid, products, emptyTitle, emptyText) {
    if (!products.length) {
      grid.innerHTML = BB.emptyStateHtml(emptyTitle, emptyText, '<a class="btn btn-primary" href="shop.html">Browse the shop</a>');
      grid.classList.remove('product-grid'); // let the empty state breathe full width
      return;
    }
    grid.innerHTML = products.map(BB.renderProductCard).join('');
  }

  /* ---------------------------------------------------------------------------
     Seasonal collections
     --------------------------------------------------------------------------- */
  async function loadCollections() {
    const grid = document.getElementById('collections-grid');
    if (!grid) return;
    try {
      const collections = await BB.getCollections();
      if (!collections.length) {
        grid.innerHTML = BB.emptyStateHtml('No collections yet', 'Create seasonal collections in the admin panel to show them here.');
        return;
      }
      grid.classList.add('collections-grid');
      grid.innerHTML = collections.map(function (collection) {
        const name = BB.escapeHtml(collection.name);
        return (
          '<a class="collection-card" href="collections.html#' + BB.escapeHtml(collection.slug) + '">' +
            '<img src="' + BB.escapeHtml(collection.image_url || '') + '" alt="' + name + '" loading="lazy">' +
            '<div class="collection-info">' +
              '<h3>' + name + '</h3>' +
              '<p>' + BB.escapeHtml(collection.description || '') + '</p>' +
              '<span class="collection-cta">Shop the collection</span>' +
            '</div>' +
          '</a>'
        );
      }).join('');
    } catch (error) {
      grid.innerHTML = BB.errorStateHtml(error.message);
    }
  }

  /* ---------------------------------------------------------------------------
     Visit cards — opening hours + address from settings
     --------------------------------------------------------------------------- */
  function renderVisitCards() {
    const settings = BB.settings;
    if (!settings) return;

    const hoursEl = document.getElementById('visit-hours');
    if (hoursEl && Array.isArray(settings.opening_hours)) {
      hoursEl.innerHTML = settings.opening_hours.map(function (row) {
        return '<div class="hours-row"><span class="hours-label">' + BB.escapeHtml(row.label) + '</span><span class="hours-value">' + BB.escapeHtml(row.hours) + '</span></div>';
      }).join('');
    }

    const addressEl = document.getElementById('visit-address');
    if (addressEl) {
      const parts = [];
      if (settings.address) parts.push('<p>' + BB.escapeHtml(settings.address) + '</p>');
      if (settings.phone) parts.push('<p>Phone: <a href="tel:' + BB.escapeHtml(settings.phone) + '">' + BB.escapeHtml(settings.phone) + '</a></p>');
      if (settings.email) parts.push('<p>Email: <a href="mailto:' + BB.escapeHtml(settings.email) + '">' + BB.escapeHtml(settings.email) + '</a></p>');
      addressEl.innerHTML = parts.join('') || '<p class="text-muted">Address details are managed in the admin panel.</p>';
    }
  }
})(window.BB);
