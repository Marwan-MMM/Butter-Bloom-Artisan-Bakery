/* =============================================================================
   BUTTER & BLOOM — wishlist.js
   -----------------------------------------------------------------------------
   The wishlist page:
     · reads the saved product ids from BB.wishlist (localStorage)
     · empty wishlist -> friendly empty state with a CTA into the shop
     · otherwise fetches the products (BB.getProductsByIds) and renders cards
       with the shared BB.renderProductCard (delegated wishlist/remove buttons
       keep working because main.js handles those clicks globally)
     · ids that no longer resolve on the server are simply skipped (they stay
       in the wishlist, so nothing is lost while Supabase is being set up)
     · when Supabase is not configured the page shows the setup notice plus a
       note that wishlist items are stored locally in this browser
   ============================================================================= */

(function initWishlistPage(BB) {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    BB.ready.then(function () {
      var grid = document.getElementById('wishlist-grid');
      var note = document.getElementById('wishlist-note');
      if (!grid) return;

      var ids = BB.wishlist.ids();

      /* ---------------- Empty wishlist (works even without Supabase) ------- */
      if (!ids.length) {
        grid.classList.remove('product-grid'); // let the empty state breathe
        grid.innerHTML = BB.emptyStateHtml(
          'Your wishlist is empty',
          'Tap the heart on any treat and it will be saved here for later.',
          '<a class="btn btn-primary" href="shop.html">Discover our treats</a>'
        );
        return;
      }

      /* ---------------- Supabase not configured ---------------------------- */
      if (!BB.configured) {
        // Show the setup notice in place of the grid + a note about the
        // locally stored ids, so nothing the visitor saved appears "lost".
        grid.classList.add('needs-data');
        grid.innerHTML = BB.skeletonGridHtml(Math.min(ids.length, 8));
        BB.mountSetupNotices(); // swaps .needs-data content for the setup notice
        if (note) {
          note.textContent = 'Your ' + (ids.length === 1 ? 'saved treat is' : ids.length + ' saved treats are') +
            ' stored in this browser and will appear here once Supabase is connected.';
          note.hidden = false;
        }
        return;
      }

      /* ---------------- Normal path: fetch saved products ------------------ */
      loadWishlistProducts(grid, ids);
    });
  });

  async function loadWishlistProducts(grid, ids) {
    try {
      var products = await BB.getProductsByIds(ids);

      // Everything the visitor saved was removed from the shop (unpublished or
      // deleted). Per the contract we keep the ids in the wishlist but cannot
      // render anything — explain it instead of showing a bare empty grid.
      if (!products.length) {
        grid.classList.remove('product-grid');
        grid.innerHTML = BB.emptyStateHtml(
          'Your saved treats are unavailable',
          'The treats on your wishlist are not available right now. They may be seasonal — the shop always shows what is fresh today.',
          '<a class="btn btn-primary" href="shop.html">Discover our treats</a>'
        );
        return;
      }

      // Products are fetched in DB order; mirror the order the visitor saved
      // them in so the most recent heart is first.
      var byId = {};
      products.forEach(function (product) { byId[product.id] = product; });
      var ordered = [];
      ids.forEach(function (id) {
        if (byId[id]) ordered.push(byId[id]); // ids that no longer resolve are skipped silently
      });

      grid.classList.add('product-grid');
      grid.innerHTML = ordered.map(BB.renderProductCard).join('');
    } catch (error) {
      grid.classList.remove('product-grid');
      grid.innerHTML = BB.errorStateHtml(error.message);
    }
  }
})(window.BB);
