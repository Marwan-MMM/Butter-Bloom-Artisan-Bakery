/* =============================================================================
   BUTTER & BLOOM — supabase.js
   -----------------------------------------------------------------------------
   The data layer of the website. Everything that talks to Supabase lives here:
   products, categories, collections, orders, custom cake requests,
   reservations, contact messages and site settings.

   ┌─────────────────────────────────────────────────────────────────────────┐
   │  SETUP (see README.md for the full walkthrough)                         │
   │                                                                         │
   │  1. Create a free project at https://supabase.com                       │
   │  2. Run supabase-schema.sql, then supabase-seed.sql (SQL Editor)        │
   │  3. Create an admin user (Authentication → Users → Add user)            │
   │  4. Paste YOUR project URL + publishable anon key below:                │
   └─────────────────────────────────────────────────────────────────────────┘
   ============================================================================= */

/* ---------------------------------------------------------------------------
   1. CONNECTION SETTINGS  —  the only two values you normally need to change
   --------------------------------------------------------------------------- */
const SUPABASE_URL = 'https://rhnhybgjhtitjbobxczr.supabase.co';   // e.g. https://abcdefgh.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_WdyUX0xRaTDGXldaZAe4mg_BwoDW-8D';         // Dashboard → Settings → API → "anon" "publishable" key

/*
   How to know the site is configured:
   We simply check that the two values above were replaced. When they still
   contain the placeholder text, every page shows a friendly setup notice
   instead of pretending there is data.
*/
const BB_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  isConfigured:
    SUPABASE_URL.includes('YOUR-PROJECT-REF') === false &&
    SUPABASE_ANON_KEY.includes('YOUR-PUBLISHABLE-ANON-KEY') === false,
};

/* Storage buckets (created by supabase-schema.sql) */
const BUCKET_PRODUCTS = 'product-images';    // public read, admins write
const BUCKET_CAKE_REFS = 'cake-references';  // customer reference uploads

/* ---------------------------------------------------------------------------
   2. GLOBAL DATA NAMESPACE (window.BB)
   --------------------------------------------------------------------------- */
window.BB = window.BB || {};

(function buildDataLayer(BB) {
  'use strict';

  /* -------------------------------------------------------------------------
     2.1 Supabase client
     ------------------------------------------------------------------------- */
  BB.configured = BB_CONFIG.isConfigured;
  BB.sb = null;

  if (BB.configured) {
    if (typeof window.supabase === 'undefined') {
      // supabase-js.js failed to load (e.g. no internet). Fail loudly, not silently.
      BB.configured = false;
      console.error('[Butter & Bloom] supabase-js.js could not be loaded. Check your internet connection.');
    } else {
      BB.sb = window.supabase.createClient(BB_CONFIG.url, BB_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    }
  }

  /* Small helper: the current session user (or null) */
  BB.currentUser = async function currentUser() {
    if (!BB.sb) return null;
    const { data } = await BB.sb.auth.getUser();
    return data ? data.user : null;
  };

  /* -------------------------------------------------------------------------
     2.2 Settings
     -------------------------------------------------------------------------
     Site settings are a single row (id = 1). We cache them in localStorage so
     repeat visits paint instantly and the cart/checkout pages keep working
     while offline. The cache is refreshed silently on every load.
  ---------------------------------------------------------------------------- */
  const SETTINGS_CACHE_KEY = 'bb_settings_cache';

  BB.settings = null;

  function readCachedSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || 'null'); }
    catch (err) { return null; }
  }
  function cacheSettings(settings) {
    try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings)); } catch (err) { /* private mode */ }
  }

  BB.getSettings = async function getSettings() {
    if (!BB.sb) { BB.settings = readCachedSettings(); return BB.settings; }
    const { data, error } = await BB.sb
      .from('site_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.warn('[Butter & Bloom] Could not load settings:', error.message);
      BB.settings = readCachedSettings();
      return BB.settings;
    }
    BB.settings = data || readCachedSettings();
    if (data) cacheSettings(data);
    return BB.settings;
  };

  BB.saveSettings = async function saveSettings(patch) {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    const payload = Object.assign({}, patch, { id: 1, updated_at: new Date().toISOString() });
    const { data, error } = await BB.sb
      .from('site_settings')
      .upsert(payload)
      .select()
      .maybeSingle();
    if (error) throw error;
    BB.settings = data;
    cacheSettings(data);
    return data;
  };

  /* -------------------------------------------------------------------------
     2.3 Categories & collections
     -------------------------------------------------------------------------- */
  BB.getCategories = async function getCategories() {
    if (!BB.sb) return [];
    const { data, error } = await BB.sb
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  };

  BB.getCollections = async function getCollections() {
    if (!BB.sb) return [];
    const { data, error } = await BB.sb
      .from('collections')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  };

  /* Admin-side CRUD (require an authenticated session; RLS enforces it) */
  BB.upsertCategory = async function (row) {
    const { data, error } = await BB.sb.from('categories').upsert(row).select().maybeSingle();
    if (error) throw error;
    return data;
  };
  BB.deleteCategory = async function (id) {
    const { error } = await BB.sb.from('categories').delete().eq('id', id);
    if (error) throw error;
    return true;
  };
  BB.upsertCollection = async function (row) {
    const { data, error } = await BB.sb.from('collections').upsert(row).select().maybeSingle();
    if (error) throw error;
    return data;
  };
  BB.deleteCollection = async function (id) {
    const { error } = await BB.sb.from('collections').delete().eq('id', id);
    if (error) throw error;
    return true;
  };

  /* -------------------------------------------------------------------------
     2.4 Products
     -------------------------------------------------------------------------
     Public listings always read PUBLISHED products only (RLS enforces this).
     Hidden products (is_visible = false) are excluded from every listing,
     search result and featured section via the .eq('is_visible', true) below.
  ---------------------------------------------------------------------------- */
  BB.getProducts = async function getProducts(opts) {
    const options = opts || {};
    if (!BB.sb) return [];

    let query = BB.sb
      .from('products')
      .select('*, categories(name, slug), product_images(url, alt, sort_order, is_cover, product_id), product_options(id, name, choices, is_required, sort_order, product_id)')
      .eq('is_published', true)
      .eq('is_visible', true);

    if (options.category) query = query.eq('categories.slug', options.category);
    if (options.collection) query = query.contains('seasonal_collections', [options.collection]);
    if (options.search) {
      const term = options.search.replace(/[%,()]/g, ' ').trim();
      if (term) {
        query = query.or('name.ilike.%' + term + '%,short_description.ilike.%' + term + '%,description.ilike.%' + term + '%');
      }
    }
    if (options.availableOnly) query = query.eq('is_available', true);
    if (options.featured) query = query.eq('is_featured', true);
    if (options.bestSeller) query = query.eq('is_best_seller', true);
    if (options.isNew) query = query.eq('is_new', true);
    if (options.excludeSlug) query = query.neq('slug', options.excludeSlug);

    switch (options.sort) {
      case 'price-asc': query = query.order('price', { ascending: true }); break;
      case 'price-desc': query = query.order('price', { ascending: false }); break;
      case 'name': query = query.order('name', { ascending: true }); break;
      case 'oldest': query = query.order('created_at', { ascending: true }); break;
      case 'featured':
      default:
        // Featured products first, newest within each group.
        query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });
        break;
    }

    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 12) - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return normalizeProducts(data || []);
  };

  /* Fetch by primary key — used by the admin panel (sees unpublished too) */
  BB.getProductByIdAdmin = async function getProductByIdAdmin(id) {
    if (!BB.sb) return null;
    const { data, error } = await BB.sb
      .from('products')
      .select('*, categories(name, slug), product_images(*), product_options(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return normalizeProduct(data);
  };

  /* Admin listing — every product regardless of state */
  BB.getAllProductsAdmin = async function getAllProductsAdmin() {
    if (!BB.sb) return [];
    const { data, error } = await BB.sb
      .from('products')
      .select('*, categories(name, slug), product_images(url, alt, sort_order, is_cover, product_id), product_options(id, name, choices, is_required, sort_order, product_id)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return normalizeProducts(data || []);
  };

  /* Full product lookup for the public product page (published only) */
  BB.getProduct = async function getProduct(lookup) {
    if (!BB.sb) return null;
    let query = BB.sb
      .from('products')
      .select('*, categories(name, slug), product_images(url, alt, sort_order, is_cover, product_id), product_options(id, name, choices, is_required, sort_order, product_id)')
      .eq('is_published', true);
    if (lookup.slug) query = query.eq('slug', lookup.slug);
    else if (lookup.id) query = query.eq('id', lookup.id);
    else return null;

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return normalizeProduct(data);
  };

  /* Products by a list of ids (wishlist page). Unpublished ones are skipped. */
  BB.getProductsByIds = async function getProductsByIds(ids) {
    if (!BB.sb || !ids || ids.length === 0) return [];
    const { data, error } = await BB.sb
      .from('products')
      .select('*, categories(name, slug), product_images(url, alt, sort_order, is_cover, product_id), product_options(id, name, choices, is_required, sort_order, product_id)')
      .in('id', ids)
      .eq('is_published', true);
    if (error) throw new Error(error.message);
    return normalizeProducts(data || []);
  };

  BB.getRelatedProducts = async function getRelatedProducts(product, count) {
    const n = count || 4;
    if (!product || !product.categories) return [];
    const sameCategory = await BB.getProducts({ category: product.categories.slug, limit: n + 1, excludeSlug: product.slug });
    if (sameCategory.length >= n) return sameCategory.slice(0, n);
    const filler = await BB.getProducts({ limit: n + 4, excludeSlug: product.slug });
    const seen = new Set(sameCategory.map(function (p) { return p.id; }));
    const merged = sameCategory.slice();
    for (const p of filler) {
      if (merged.length >= n) break;
      if (!seen.has(p.id)) { merged.push(p); seen.add(p.id); }
    }
    return merged.slice(0, n);
  };

  /* Product CRUD used by the admin panel. RLS guarantees the caller is authed. */
  BB.createProduct = async function createProduct(row) {
    const { data, error } = await BB.sb.from('products').insert(row).select().maybeSingle();
    if (error) throw error;
    return data;
  };
  BB.updateProduct = async function updateProduct(id, patch) {
    const { data, error } = await BB.sb.from('products').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data;
  };
  BB.deleteProduct = async function deleteProduct(id) {
    // product_images / product_options rows are removed automatically (ON DELETE CASCADE).
    // Orders keep their history because order_items.product_id is ON DELETE SET NULL.
    const { error } = await BB.sb.from('products').delete().eq('id', id);
    if (error) throw error;
    return true;
  };

  /* Replace the whole image set of a product (simple, predictable admin flow) */
  BB.setProductImages = async function setProductImages(productId, images) {
    const { error: delError } = await BB.sb.from('product_images').delete().eq('product_id', productId);
    if (delError) throw delError;
    if (!images.length) return [];
    const rows = images.map(function (img, index) {
      return {
        product_id: productId,
        url: img.url,
        alt: img.alt || '',
        sort_order: index,
        is_cover: index === 0 ? true : Boolean(img.is_cover),
      };
    });
    const { data, error } = await BB.sb.from('product_images').insert(rows).select();
    if (error) throw error;
    return data;
  };

  /* Replace the whole option set of a product */
  BB.setProductOptions = async function setProductOptions(productId, options) {
    const { error: delError } = await BB.sb.from('product_options').delete().eq('product_id', productId);
    if (delError) throw delError;
    if (!options.length) return [];
    const rows = options.map(function (opt, index) {
      return {
        product_id: productId,
        name: opt.name,
        choices: opt.choices,
        is_required: Boolean(opt.is_required),
        sort_order: index,
      };
    });
    const { data, error } = await BB.sb.from('product_options').insert(rows).select();
    if (error) throw error;
    return data;
  };

  /* -------------------------------------------------------------------------
     2.5 Storage uploads
     ------------------------------------------------------------------------- */
  BB.uploadImage = async function uploadImage(file, folder) {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    validateImageFile(file, 8 * 1024 * 1024); // 8 MB hard cap for product/site images

    const safeName = sanitizeFileName(file.name);
    const path = (folder || 'products') + '/' + Date.now() + '-' + safeName;

    const { error } = await BB.sb.storage
      .from(BUCKET_PRODUCTS)
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw new Error(error.message);

    const { data } = BB.sb.storage.from(BUCKET_PRODUCTS).getPublicUrl(path);
    return data.publicUrl;
  };

  /* Delete a list of storage objects, ignoring objects that are still
     referenced by ANY product_images row (never break another product). */
  BB.deleteStorageObjectsIfUnused = async function deleteStorageObjectsIfUnused(urls) {
    if (!BB.sb || !urls || !urls.length) return;
    const stillUsed = new Set();
    try {
      const { data } = await BB.sb.from('product_images').select('url');
      (data || []).forEach(function (row) { stillUsed.add(row.url); });
    } catch (err) { /* if listing fails, be safe and delete nothing */ return; }

    const paths = [];
    urls.forEach(function (url) {
      if (stillUsed.has(url)) return;                 // referenced elsewhere → keep file
      const path = extractStoragePath(url, BUCKET_PRODUCTS);
      if (path) paths.push(path);
    });
    if (!paths.length) return;
    const { error } = await BB.sb.storage.from(BUCKET_PRODUCTS).remove(paths);
    if (error) console.warn('Storage cleanup skipped:', error.message);
  };

  /* Customer-side upload for custom cake reference photos */
  BB.uploadCakeReference = async function uploadCakeReference(file) {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    validateImageFile(file, 5 * 1024 * 1024); // 5 MB cap for references

    const safeName = sanitizeFileName(file.name);
    const path = 'uploads/' + Date.now() + '-' + safeName;

    const { error } = await BB.sb.storage
      .from(BUCKET_CAKE_REFS)
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw new Error(error.message);

    const { data } = BB.sb.storage.from(BUCKET_CAKE_REFS).getPublicUrl(path);
    return data.publicUrl;
  };

  /* -------------------------------------------------------------------------
     2.6 Orders
     ------------------------------------------------------------------------- */
  BB.saveOrder = async function saveOrder(order) {
    if (!BB.sb) throw new Error('Supabase is not configured.');

    const orderRow = {
      customer_name: order.customer_name,
      phone: order.phone,
      email: order.email || null,
      fulfillment_type: order.fulfillment_type,
      delivery_address: order.fulfillment_type === 'delivery' ? order.delivery_address : null,
      requested_date: order.requested_date || null,
      requested_time: order.requested_time || null,
      notes: order.notes || null,
      subtotal: order.subtotal,
      delivery_fee: order.delivery_fee,
      total: order.total,
      currency: (BB.settings && BB.settings.currency_code) || 'USD',
    };

    const { data: savedOrder, error: orderError } = await BB.sb
      .from('orders')
      .insert(orderRow)
      .select()
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);

    const itemRows = (order.items || []).map(function (item) {
      return {
        order_id: savedOrder.id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        selected_options: item.selected_options || [],
        line_total: item.line_total,
      };
    });
    if (itemRows.length) {
      const { error: itemsError } = await BB.sb.from('order_items').insert(itemRows);
      if (itemsError) throw new Error(itemsError.message);
    }
    return savedOrder;
  };

  BB.getOrdersAdmin = async function getOrdersAdmin(status) {
    let query = BB.sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  };

  BB.updateOrderStatus = async function updateOrderStatus(orderId, status) {
    const { error } = await BB.sb.from('orders').update({ status: status }).eq('id', orderId);
    if (error) throw new Error(error.message);
    return true;
  };

  /* -------------------------------------------------------------------------
     2.7 Custom cake requests / reservations / contact messages
     -------------------------------------------------------------------------- */
  BB.submitCakeRequest = async function submitCakeRequest(payload) {
    if (!BB.sb) throw new Error('Supabase is not configured.');

    // Optional reference photo — uploaded first so the request row can store the URL.
    let referenceUrl = null;
    if (payload.referenceFile) {
      referenceUrl = await BB.uploadCakeReference(payload.referenceFile);
    }

    const row = {
      customer_name: payload.customer_name,
      phone: payload.phone,
      email: payload.email || null,
      cake_type: payload.cake_type || null,
      flavor: payload.flavor,
      size_label: payload.size_label,
      filling: payload.filling || null,
      frosting_type: payload.frosting_type || null,
      frosting_color: payload.frosting_color || null,
      decoration_style: payload.decoration_style,
      message_on_cake: payload.message_on_cake || null,
      fulfillment_type: payload.fulfillment_type,
      requested_date: payload.requested_date,
      preferred_time: payload.preferred_time || null,
      budget_range: payload.budget_range || null,
      allergies: payload.allergies || null,
      special_instructions: payload.special_instructions || null,
      reference_image_url: referenceUrl,
      estimated_price: payload.estimated_price || null,
      status: 'pending',
    };

    const { data, error } = await BB.sb.from('cake_requests').insert(row).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.getCakeRequestsAdmin = async function getCakeRequestsAdmin(status) {
    let query = BB.sb.from('cake_requests').select('*').order('created_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  };

  BB.updateCakeRequest = async function updateCakeRequest(id, patch) {
    const { data, error } = await BB.sb.from('cake_requests').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.submitReservation = async function submitReservation(payload) {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    const { data, error } = await BB.sb
      .from('reservations')
      .insert({
        name: payload.name,
        phone: payload.phone,
        email: payload.email || null,
        reservation_type: payload.reservation_type,
        party_size: payload.party_size,
        requested_date: payload.requested_date,
        requested_time: payload.requested_time || null,
        notes: payload.notes || null,
        status: 'pending',
      })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.getReservationsAdmin = async function getReservationsAdmin() {
    const { data, error } = await BB.sb.from('reservations').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  };

  BB.updateReservation = async function updateReservation(id, patch) {
    const { data, error } = await BB.sb.from('reservations').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.submitContact = async function submitContact(payload) {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    const { data, error } = await BB.sb
      .from('contact_messages')
      .insert({
        name: payload.name,
        email: payload.email,
        phone: payload.phone || null,
        subject: payload.subject || 'General',
        message: payload.message,
        is_read: false,
      })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.getMessagesAdmin = async function getMessagesAdmin() {
    const { data, error } = await BB.sb.from('contact_messages').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  };

  BB.updateMessage = async function updateMessage(id, patch) {
    const { data, error } = await BB.sb.from('contact_messages').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  BB.deleteMessage = async function deleteMessage(id) {
    const { error } = await BB.sb.from('contact_messages').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  };

  /* -------------------------------------------------------------------------
     2.8 Demo data management (admin only — the SQL functions enforce this)
     -------------------------------------------------------------------------- */
  BB.loadDemoData = async function loadDemoData() {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    const { data, error } = await BB.sb.rpc('load_demo_catalog');
    if (error) throw new Error(error.message);
    return data;
  };

  BB.removeDemoData = async function removeDemoData() {
    if (!BB.sb) throw new Error('Supabase is not configured.');
    const { data, error } = await BB.sb.rpc('remove_demo_catalog');
    if (error) throw new Error(error.message);
    return data;
  };

  BB.getDemoStatus = async function getDemoStatus() {
    if (!BB.sb) return { configured: false };
    const counts = { configured: true, products: 0, categories: 0, collections: 0, loaded: false };
    const [prod, cat, col] = await Promise.all([
      BB.sb.from('products').select('id', { count: 'exact', head: true }).eq('demo_batch_id', 'bb-demo-v1'),
      BB.sb.from('categories').select('id', { count: 'exact', head: true }).eq('demo_batch_id', 'bb-demo-v1'),
      BB.sb.from('collections').select('id', { count: 'exact', head: true }).eq('demo_batch_id', 'bb-demo-v1'),
    ]);
    counts.products = prod.count || 0;
    counts.categories = cat.count || 0;
    counts.collections = col.count || 0;
    counts.loaded = counts.products > 0;
    return counts;
  };

  /* -------------------------------------------------------------------------
     2.9 Private helpers
     -------------------------------------------------------------------------- */
  function normalizeProducts(rows) {
    return (rows || []).map(normalizeProduct);
  }

  /* Attach `cover`, sort images/options and keep the shape predictable. */
  function normalizeProduct(row) {
    if (!row) return null;
    const product = Object.assign({}, row);

    const images = (product.product_images || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
    product.images = images;
    product.cover = images.length ? images[0].url : '';

    product.options = (product.product_options || []).slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    product.price = Number(product.price) || 0;
    product.compare_at_price = product.compare_at_price == null ? null : Number(product.compare_at_price);
    return product;
  }

  function validateImageFile(file, maxBytes) {
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Please choose an image file (JPG, PNG or WebP).');
    }
    if (file.size > maxBytes) {
      throw new Error('Image is too large. Maximum size is ' + Math.round(maxBytes / (1024 * 1024)) + ' MB.');
    }
  }

  function sanitizeFileName(name) {
    return String(name || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(-80) || 'image.jpg';
  }

  /* "/storage/v1/object/public/bucket/folder/file.jpg" → "folder/file.jpg" */
  function extractStoragePath(url, bucket) {
    try {
      const marker = '/object/public/' + bucket + '/';
      const index = url.indexOf(marker);
      if (index === -1) return null;
      return url.substring(index + marker.length);
    } catch (err) { return null; }
  }
})(window.BB);
