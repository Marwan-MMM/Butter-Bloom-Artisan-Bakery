# Butter & Bloom — Premium Artisan Bakery Website

A complete, portfolio-ready bakery website built with **plain HTML, CSS and vanilla JavaScript**, using **Supabase** as the real backend (products, orders, custom cake requests, settings, admin auth) and deploying free on **GitHub Pages**.

Everything lives in this root folder — no nested folders, no build tools, no frameworks. Every file is human-readable and commented so you can edit anything yourself.

---

## 1. What's inside — every project file explained

### Pages (all in the root)

| File | Purpose |
|---|---|
| `index.html` | Homepage — hero, Featured Delights categories, best sellers, new arrivals, seasonal collections, custom-cake promo, story, gallery, testimonials, visit info |
| `shop.html` | Product catalog with search, category filters, price sorting and "in stock only" filter |
| `product.html` | Product details — gallery, options, quantity, ingredients/allergens, related products (`?slug=...`) |
| `collections.html` | Seasonal & curated collections, each with its own product grid |
| `custom-cake.html` | **Custom cake builder** — flavors, sizes, fillings, frosting, decoration styles, live price estimate, reference photo upload |
| `wishlist.html` | Saved products (stored locally in the browser) |
| `cart.html` | Shopping cart with quantity controls and live price re-validation |
| `checkout.html` | Pickup/delivery checkout — saves real orders to Supabase, no fake payments |
| `reservations.html` | Tasting table / workshop / event / table reservation requests |
| `about.html` | Bakery story, values and ingredient quality |
| `contact.html` | Contact info + message form (saved to Supabase) |
| `admin.html` | Secure admin panel (login, dashboard, full product CRUD, orders, requests, settings, demo data) |
| `404.html` | Friendly custom not-found page (GitHub Pages uses it automatically) |

### Code & data files

| File | Purpose |
|---|---|
| `style.css` | The entire design system: colors, typography, buttons, cards, forms, admin styles, responsive rules |
| `supabase.js` | **Connection settings** (the two values you edit) + the whole data layer |
| `main.js` | Shared UI: header/drawer/search, cart & wishlist, product cards, toasts, footer |
| `home.js`, `shop.js`, `product.js`, `wishlist.js`, `collections.js`, `cart.js`, `checkout.js`, `custom-cake.js`, `reservations.js`, `contact.js` | Page-specific logic |
| `admin.js` | Admin panel: auth, dashboard, products CRUD, image & option managers, categories/collections |
| `admin-operations.js` | Admin panel: orders, cake requests, reservations, messages, settings, demo data |
| `supabase-js.js` | Vendored copy of the official Supabase JavaScript client (so the site also works offline) |
| `supabase-schema.sql` | Creates all tables, indexes, RLS security policies, storage buckets and the demo-data functions |
| `supabase-seed.sql` | Loads the 30-product demo catalog (calls the idempotent `load_demo_catalog()` function) |
| `preview-server.js` | **Optional dev helper** — tiny static server for local preview (`bun preview-server.js` or `python3 -m http.server`). While your `supabase.js` still holds placeholder values it transparently points the preview at the bundled in-memory demo backend (`mini-services/mock-supabase`, started with `bun mini-services/mock-supabase/index.js`) so a fresh clone looks complete: demo data loads, and you can even sign into the admin panel with `admin@butterandbloom.test` / `bakery-demo-123`. This injection is strictly local-preview behavior — it never edits your files, stops the moment you paste real Supabase values, and GitHub Pages always serves the real `supabase.js`. Not needed for deployment; safe to delete |
| `favicon.svg` | Croissant favicon |
| `.nojekyll` | Tells GitHub Pages to serve files as-is (no Jekyll processing) |
| `README.md` | This file |

### Bundled images (45 root-level .jpg files)

All photography lives in the root next to the pages — e.g. `hero-croissants.jpg`, `vanilla-bean-cake.jpg`, `macarons-pink.jpg`, `artisan-sourdough.jpg`, `collection-wedding.jpg`, `gallery-baker-hands.jpg`, `about-storefront.jpg`. The demo database references them with relative paths (`./vanilla-bean-cake.jpg`), so they work under any GitHub Pages subpath.

---

## 2. Supabase setup (about 10 minutes)

1. Create a free account at [supabase.com](https://supabase.com) and create a new project (any name, e.g. `butter-and-bloom`).
2. Open **SQL Editor** → **New query**, paste the full contents of `supabase-schema.sql` and click **Run**. This creates every table, the security policies, two storage buckets (`product-images`, `cake-references`) and the demo-data functions.
3. Same way, paste the full contents of `supabase-seed.sql` and **Run**. This loads the demo catalog (30 products, 10 categories, 5 collections, site settings, sample testimonials).
4. Go to **Project Settings → API** and copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon / publishable** key (NEVER the `service_role` key!)
5. Open `supabase.js` and paste both values into `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top. Save — the site is now live with your data.

> Until you paste real values, every page shows a friendly "Connect Supabase" notice instead of pretending to have products. That is intentional.

## 3. Creating the administrator account

The admin panel has **no public sign-up** (by design):

1. In Supabase go to **Authentication → Users → Add user → Create new user**.
2. Enter your email + a strong password and tick **Auto Confirm User**.
3. Visit `admin.html`, sign in with that email/password.
4. RLS policies in `supabase-schema.sql` grant full management rights to *any confirmed authenticated user*, and to nobody else. Anonymous visitors can only read published products and insert orders/requests — they can never read other customers' orders or manage anything.

> Tip for a real client: create the account, then disable further user creation invites in **Authentication → Providers → Email** settings if you want to lock onboarding down completely.

## 4. Deploying to GitHub Pages

1. Create a GitHub repository (e.g. `butter-and-bloom`).
2. Upload **all files from this folder** (pages, JS, CSS, SQL, images) to the repository root. The bundled images must sit next to the pages, exactly as they are here.
3. GitHub **Settings → Pages → Build and deployment**: choose **Deploy from a branch**, pick your default branch and `/ (root)`, save.
4. Your site goes live at `https://<username>.github.io/<repo>/` a minute later. All paths are relative, so the subpath works out of the box. Unknown URLs automatically show your custom `404.html`.
5. Remember to put your real Supabase URL/keys into `supabase.js` *before* deploying, and add the live URL to **Authentication → URL Configuration → Site URL** in Supabase.

## 5. Demo data management

The site looks complete immediately thanks to the bundled demo catalog — clearly marked so you can remove it cleanly:

- Every demo row is tagged `is_demo = true` and `demo_batch_id = 'bb-demo-v1'`.
- **Load**: admin panel → *Demo Data* → **Load Demo Data** (or run `supabase-seed.sql`). Idempotent — running it twice never duplicates anything.
- **Remove**: *Demo Data* → **Remove Demo Data**. Deletes **only** rows tagged as demo. Your real products, orders, cake requests and client uploads are never touched (verified by design: order history even survives product deletion because order items snapshot the product name/price).
- **Replace**: *Demo Data* → **Replace Demo Data** (remove + load in one click).
- Removing demo data never auto-restores it; load again when you want it back.
- Every destructive action asks for confirmation and reports the exact result.

## 6. Adding, editing, hiding and deleting products (all products, not just demo)

Open `admin.html` → **Products**:

- **Add**: “+ Add Product” → fill name (slug auto-generates), description, price, category, flags (available / published / visible / featured / best seller / new), seasonal collections, ingredients, allergens, portion info, options and images → **Save**. The product is stored in Supabase and appears on the public site instantly — and stays after refreshes and on other devices.
- **Edit**: ✏️ Edit — the same editor opens prefilled.
- **Publish / Unpublish**: unpublished products vanish from the whole public site (shop, search, home sections, collections). The product page URL stops resolving for visitors.
- **Hide / Show**: hidden products stay unpublished-private read access (admin sees them; the public catalog, search results and featured sections exclude them).
- **Delete**: permanently removes the product **and** its option/image rows; storage files are cleaned up only when no other product references them. Requires confirmation.

## 7. Uploading and managing product images (Supabase Storage)

In the product editor's **Images** section you can:

- **Upload** multiple images (dragged straight into **Supabase Storage**, bucket `product-images`) — JPG/PNG/WebP up to 8 MB, validated client-side.
- **Set the cover**, **reorder** (up/down), **replace**, **edit alt text** and **remove** individual images. Alt text is required for accessibility and SEO.
- Uploaded images persist in Supabase and appear on every device. Bundled repo photos and uploaded photos mix freely on the same product.

> Admin-uploaded images live in Supabase Storage, **not** in the GitHub repository — a GitHub Pages site cannot accept file uploads. Bundled demo photos remain in the repo; when their product is deleted/hidden they simply stop appearing anywhere on the site.

## 8. Replacing bundled photographs

All images are plain root-level files. To swap one:

1. Replace the file (keep the same name, e.g. `hero-croissants.jpg`), **or**
2. Name your new photo `your-photo.jpg`, drop it in the root, and update the reference where it is used:
   - Hero/section images: Admin → **Settings** (hero image field) or directly in the HTML.
   - Product/category/collection photos: Admin → edit that record → set the image URL to `./your-photo.jpg`.
3. Use descriptive, lowercase, hyphenated names (`strawberry-tart.jpg`). Reasonable size: ≤ ~1400 px, JPG quality ~85 (keep pages fast).

## 9. Branding, text, prices, currency & business settings

Admin → **Settings** controls (all saved to Supabase and reflected across the public site):

- Bakery name, tagline, hero title/subtitle/image, hero button label
- Announcement bar text + on/off
- **Currency** (USD, EUR, GBP, EGP, AED, SAR + editable symbol) — every price on the site flows through `BB.formatPrice()`, so changing currency updates everywhere; never hardcode a symbol
- Phone, email, address, WhatsApp number (used for optional order confirmation links)
- Social links, opening hours (editable rows)
- Pickup/delivery toggles, delivery fee, free-delivery threshold, minimum order amount
- About text, custom-cake note, **custom cake sizes and decoration surcharges** (the live price estimate in the builder is computed from these rows)
- Policy note

Colors and fonts live in the CSS variables at the top of `style.css` (`--caramel`, `--blush`, fonts `Great Vibes` + `Quicksand`) — change them there for an instant rebrand. Sample business data (address, phone, testimonials) is placeholder content; replace it before using with a real client.

## 10. Testing the cart, checkout and custom-cake workflows

1. **Cart**: add products from cards or the product page (choose required options there), change quantities, remove lines — totals update everywhere, badges reflect counts. Cart contents re-validate against live Supabase prices on every cart visit.
2. **Checkout**: submit with pickup or delivery, future date, address — the order is written to Supabase (`orders` + `order_items`) and you get a real order number (`BB-YYYYMMDD-XXXX`). A WhatsApp button appears only if you configured a number. **No payment is ever faked** — the page clearly says payment is arranged with the bakery.
3. **Custom cake builder**: pick flavor/size/filling/frosting/decoration, watch the live summary + estimate, attach an optional reference photo (≤ 5 MB) and submit — the request lands in `cake_requests` and appears in the admin panel where you can accept/reject/complete it, add internal notes and tweak sizes/dates.
4. **Reservations & contact** forms persist to their tables and show up in the admin panel.

## 11. Security notes

- Only the **anon (publishable)** key is used in browser code; the service-role key never appears anywhere.
- Row Level Security on every table: anonymous visitors read only published/active rows; they may insert orders/requests/messages but can never read or modify anyone else's. Admin operations require an authenticated Supabase session (verified in the database, not just by hiding buttons).
- Demo management runs through `SECURITY DEFINER` SQL functions that only authenticated users can execute.
- Storage: `product-images` is public-read (product photos), writable only by authenticated admins; `cake-references` accepts customer uploads into an `uploads/` folder only.
- File type/size validation happens before every upload.

## 12. Handing over to a real client

1. Run the demo catalog once so the client sees a full site, walk them through the admin panel.
2. Replace demo content: edit or delete demo products (or *Remove Demo Data*), upload the real logo/hero photography, fill in Settings with real business data.
3. Create the client's admin account, swap the WhatsApp/phone/email values, set their currency.
4. Remove clearly-labeled sample items (stats marked “sample”, demo testimonials) and replace the announcement text.
5. Optional cleanup for a pure production repo: delete `preview-server.js`, this file's demo notes stay useful as reference. Keep `supabase-schema.sql` — it documents the whole database.

---

**Butter & Bloom** is a demo brand created for this portfolio template. Built with HTML5, CSS3 and vanilla JavaScript — no frameworks, no build step, just open the files.
