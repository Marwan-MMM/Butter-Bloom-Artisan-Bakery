/* =============================================================================
   BUTTER & BLOOM — collections.js
   -----------------------------------------------------------------------------
   The "Seasonal Collections" page:
     · one <section id="SLUG"> per active collection (BB.getCollections)
     · each section: a split banner (image + copy + "Shop the collection"
       button -> shop.html?collection=SLUG) reused from the .promo-panel styles
     · below the banner: up to 8 matching products (BB.getProducts) or a small
       empty state when the collection has nothing in it yet
     · after everything renders, auto-scrolls to the #hash target so links
       like collections.html#valentines land on the right section
   ============================================================================= */

(function initCollectionsPage(BB) {
  'use strict';

  /* How many products to preview per collection grid */
  var PRODUCTS_PER_COLLECTION = 8;

  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(function () {
      var wrapper = document.getElementById('collections-sections');
      if (!wrapper) return;

      // When Supabase is not configured, main.js has already replaced the
      // .needs-data wrapper with the setup notice — leave it be.
      if (!BB.configured) return;

      renderCollections(wrapper);
    });
  });

  /* ---------------------------------------------------------------------------
     Render every collection section (banner + product grid)
     --------------------------------------------------------------------------- */
  async function renderCollections(wrapper) {
    var collections;
    try {
      collections = await BB.getCollections();
    } catch (error) {
      wrapper.classList.remove('needs-data');
      wrapper.removeAttribute('aria-busy');
      wrapper.innerHTML = '<div class="container">' + BB.errorStateHtml(error.message) + '</div>';
      return;
    }

    wrapper.classList.remove('needs-data');
    wrapper.removeAttribute('aria-busy');

    if (!collections.length) {
      wrapper.innerHTML =
        '<div class="container">' +
          BB.emptyStateHtml(
            'No collections yet',
            'Create seasonal collections in the admin panel and they will appear here.',
            '<a class="btn btn-primary" href="shop.html">Browse the shop</a>'
          ) +
        '</div>';
      return;
    }

    // Build all section shells first (banners + grid skeletons), in order
    wrapper.innerHTML = collections.map(sectionHtml).join('');

    // Then fill the grids one by one (sequential keeps the visual order calm)
    for (var i = 0; i < collections.length; i += 1) {
      await fillCollectionGrid(collections[i]);
    }

    // Deep links (collections.html#valentines) — the browser cannot scroll to
    // a section that did not exist at load time, so we do it once rendering
    // has finished.
    scrollToHashTarget();
  }

  function sectionHtml(collection) {
    var slug = BB.escapeHtml(collection.slug);
    var name = BB.escapeHtml(collection.name);
    var headingId = 'title-' + slug;

    var media = collection.image_url
      ? '<img src="' + BB.escapeHtml(collection.image_url) + '" alt="' + name + ' collection" loading="lazy">'
      : '';

    return (
      '<section id="' + slug + '" class="section-tight" aria-labelledby="' + headingId + '">' +
        '<div class="container">' +
          '<div class="promo-panel">' +
            '<div class="promo-media">' + media + '</div>' +
            '<div class="promo-copy">' +
              '<span class="eyebrow">Seasonal pick</span>' +
              '<h2 class="script-accent" id="' + headingId + '">' + name + '</h2>' +
              '<p>' + BB.escapeHtml(collection.description || '') + '</p>' +
              '<div class="promo-actions">' +
                '<a class="btn btn-primary" href="shop.html?collection=' + slug + '">Shop the collection</a>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="grid-' + slug + '" class="product-grid" style="margin-top:26px;" aria-label="' + name + ' products">' +
            gridSkeletonHtml() +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function gridSkeletonHtml() {
    var cards = '';
    for (var i = 0; i < 4; i += 1) {
      cards += '<div class="skeleton-card"><div class="skeleton skeleton-img"></div>' +
        '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>';
    }
    return cards;
  }

  async function fillCollectionGrid(collection) {
    var grid = document.getElementById('grid-' + collection.slug);
    if (!grid) return;

    try {
      var products = await BB.getProducts({ collection: collection.slug, limit: PRODUCTS_PER_COLLECTION });

      if (!products.length) {
        // An empty collection shows a friendly note instead of an empty grid
        grid.classList.remove('product-grid');
        grid.innerHTML = BB.emptyStateHtml(
          'Nothing here yet',
          'This collection is still being curated by our bakers — check back soon.'
        );
        return;
      }

      grid.innerHTML = products.map(BB.renderProductCard).join('');
    } catch (error) {
      grid.innerHTML = BB.errorStateHtml(error.message);
    }
  }

  /* Smooth-scroll to the section referenced by the URL hash, if any */
  function scrollToHashTarget() {
    if (!location.hash || location.hash.length < 2) return;
    var target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    window.setTimeout(function () {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120); // give the layout a beat to settle
  }
})(window.BB);
