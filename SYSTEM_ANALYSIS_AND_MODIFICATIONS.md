# Alicayard Pickle Ball — Full System Analysis, Bugs & Improvement Plan

> Generated from a deep read of the entire repository (React + Vite front end, Supabase/Postgres back end, RLS policies, migrations, styles, and every screen/button).
>
> **Scope covered:** front end → services → Supabase connections → database schema/RLS → desktop & mobile responsive design → every button → bugs found → recommended fixes → improvement roadmap.

---

## 1. What the system is

A single-page booking application for a small pickleball facility ("Alicayard Pickle Ball", 2 courts, Manila). It has three front ends in **one codebase**:

| Area | Users | Paths |
|---|---|---|
| Public marketing site | Anyone | `/`, `/courts`, `/availability`, `/pricing`, `/contact` |
| Customer portal | Logged-in customers | `/dashboard`, `/book`, `/my-bookings`, `/history`, `/payments`, `/profile` |
| Admin workspace | `role = 'admin'` users | `/admin` + 7 sub-pages |

There is **no custom backend server**. The browser talks directly to **Supabase** (Auth API + PostgREST REST API + Postgres Realtime). All business rules (pricing, double-booking prevention, booking numbers, amounts, role protection) live in the **database** via triggers, constraints, RLS policies and RPC functions.

---

## 2. Technology stack & connections

```
 Browser (React 19 + Vite 7 + react-router 7)
     │
     ├── Auth flows ──► supabase.auth.* (signUp / signIn / password reset / session)
     │                      │
     │                      └──► auth.users ──trigger──► public.profiles (RLS)
     │
     ├── Data reads ──► supabase.from(...).select(...)  (PostgREST, RLS enforced)
     │     ├── courts             (customers see active & not-maintenance only)
     │     ├── bookings           (customers see own; admins see all)
     │     ├── payments           (customers see own; admins see all)
     │     ├── profiles           (customers own; admins all)
     │     └── facility_settings  (admin only)
     │
     ├── Public availability ──► RPC get_booked_slots(date)  (security definer)
     │                              returns (court_id, start_time) pairs — no PII leak
     │
     └── Live updates ──► Realtime channel "bookings-changes"
                              ● INSERT/UPDATE/DELETE on public.bookings
                              ● debounced 350 ms refetch on Availability,
                                BookCourt, customer Dashboard/MyBookings,
                                Admin Dashboard and Admin Calendar
```

- **Env config:** `.env` → `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (client key). `src/lib/supabase.js` creates the client (`persistSession`, `autoRefreshToken`, `detectSessionInUrl`).
- **Auth context:** `AuthProvider` (src/context/AuthContext.jsx) loads the session once, calls `authService.getProfile()` and stores a normalized `user`.
- **Route guards:** `ProtectedRoute` (customer) and `AdminRoute` (checks `user.role === "admin"`).
- **Data services** (`src/services/`): thin wrappers mapping Supabase rows → app objects (`toAppBooking`, `toAdminBooking`, `toAppCourt`, …). Errors bubble up to the pages.

---

## 3. Database schema (Supabase / Postgres)

### Tables
- **`profiles`** — id (= `auth.users.id`), full_name, email, phone, role (`customer|admin`). Auto-created by trigger; `prevent_role_change` trigger blocks ALL role edits (admins included too).
- **`courts`** — id, name unique, description, accent, price_per_hour (default 300), is_active, maintenance, image.
- **`bookings`** — id, booking_number (`RB-YYMMDD-NNN` auto), **user_id (nullable → walk-ins)**, court_id, booking_date, start_time (07:00–21:00, :00 only), duration_hours (1–2), amount (auto = court_price × duration), status (`upcoming|confirmed|completed|cancelled`), payment_status (`pending|paid|refunded`), customer_name/email/phone (walk-ins).
- **`payments`** — id, booking_id unique, user_id (nullable), amount, method, status, reference, paid_at. Auto-created on booking insert.
- **`facility_settings`** — single row: facility name/address/contact/email, opening (07:00), closing (22:00), default_duration (1), max_duration (2).

### Key business rules in SQL
1. **No double booking** — EXCLUDE (GiST) constraint `bookings_no_overlap` on `(court_id, booking_date, tsrange(booking_date+start_time, … +duration_hours))` where `status <> 'cancelled'`. Real safety net.
2. **Friendly booking number** — trigger `assign_booking_number()`.
3. **Amount always server-side** — trigger `set_booking_amount()` reads court price.
4. **Customer update guard** — `protect_booking_updates()`: customers may only flip `status → cancelled` for `upcoming`/`confirmed`; all other fields are admin-only.
5. **Admin detection** — `is_admin()` security-definer function used by RLS.
6. **Public slot data** — RPC `get_booked_slots(date)` returns only `(court_id, start_time)`, expanded per duration hour.

---

## 4. Front end structure

```
src/
  App.jsx / main.jsx          entry; AuthProvider > BrowserRouter > ScrollToTop > AppRoutes
  routes/AppRoutes.jsx        all routes + Public/Customer/Admin layouts
  routes/ProtectedRoute.jsx   customer guard      routes/AdminRoute.jsx admin guard
  context/AuthContext.jsx     session + login/register/logout/updateProfile/updatePassword
  hooks/                      useAuth, useCourts, useBookings, useRealtimeBookings, useScrollReveal
  services/                   auth, booking, court, customer, payment, report, settings
  lib/                        supabase client, constants (HOURLY_RATE=300, COURT_HOURS 07-21)
  utils/                      currency (PHP peso), date formatting (12h + ISO)
  components/
    layout/   Navbar, Footer, CustomerSidebar, AdminSidebar, AdminTopbar
    common/   Button, Modal, ErrorMessage, Loading, HeroShowcase, ScrollToTop
    booking/  BookingCard, BookingDetails, BookingSummary, TimeSlot
    courts/   CourtCard, CourtStatus
    dashboard/BookingTable, AdminBookingTable, CalendarView, StatCard
  pages/
    public/   Home, Courts, Availability, Pricing, Contact
    auth/     Login, Register, ForgotPassword, ResetPassword
    customer/ Dashboard, BookCourt, MyBookings, BookingHistory, Payments, Profile
    admin/    Dashboard, Bookings, Calendar, Courts, Customers, Payments, Reports, Settings
styles/  premium.css (visual layer)    index.css (layout + responsive)
```

---

## 5. Button-by-button walkthrough & connection check

### 5.1 Public site

| Screen | Buttons / controls | Status | Notes |
|---|---|---|---|
| Header navbar | Courts · Availability · Pricing · Contact · Log in · Book a court | FAIL | **On mobile (<=760 px) the nav and Log-in link are `display:none` and there is no hamburger menu - public site is a dead end on phones.** |
| Home hero | Book a court · Check availability | OK | - |
| Home courts | Court card "Book" button | OK | Requires login (routes to /login). |
| Home LIVE AVAILABILITY | - | FAIL | Shows **hardcoded fake slots** under a "LIVE" label. |
| Courts page | Court cards -> Book | OK | Real data + scroll reveal. |
| Availability | Date picker + 15 slots per court | OK | Real data via RPC; live subscription. |
| Pricing | Book your hour | PARTIAL | Price hardcoded PHP 300; ignores admin price edits. |
| Contact | Send message | FAIL | Form `preventDefault()` only - **does nothing**. |
| Footer | Courts · Pricing · Contact | OK | - |

### 5.2 Auth pages

| Screen | Buttons | Status | Notes |
|---|---|---|---|
| Login | Sign in · Remember me · Forgot password | PARTIAL | "Remember me" checkbox **does nothing**. No deep-link return after login. |
| Register | Create account | PARTIAL | Phone `required`; no phone format validation. |
| Forgot password | Send reset link | OK | Supabase email with /reset-password redirect. |
| Reset password | Update password | OK | Uses recovery session. |

### 5.3 Customer portal

| Screen | Buttons | Status | Notes |
|---|---|---|---|
| Sidebar desktop / bottom tab bar mobile | Dashboard · Book · My bookings · History · Payments · Profile · Log out | OK | Mobile bottom bar works (recent commit). |
| Dashboard | Book a court · All bookings | OK | Dynamic greeting by time of day. |
| Book a court | Date · court · time slot · summary · Confirm booking | PARTIAL | Live slot sync OK. **Duration is always 1 hour** (facility default/max ignored). No error shown if availability fetch fails (no `.catch`). |
| My bookings | Cancel | OK | Status-based cancel. |
| Booking history | Filters: all / completed / cancelled | OK | - |
| Payments | View only · Book your first hour | OK | No online payment flow - pay-at-court / GCash recorded manually by admin. |
| Profile | Edit profile / Save · Change password modal | PARTIAL | Email input looks editable but **changes are silently dropped** (only full_name/phone are saved). |

### 5.4 Admin workspace

| Screen | Buttons | Status | Notes |
|---|---|---|---|
| Sidebar desktop / bottom bar mobile | Dashboard · Bookings · Calendar · Courts · Customers · Payments · Reports · Settings | OK | Logout hidden on the mobile bar but still in the topbar profile popover. |
| Topbar | Notification bell · Profile popover | FAIL | Notifications are **static fake HTML**; avatar hardcoded **"AR"**; date hardcoded **"Sunday, September 6, 2026"**. |
| Dashboard | Stat cards · Today's table row actions · activity list | PARTIAL | Greeting always **"Good morning"**. Table **Cancel** action opens the details modal instead of the cancel-confirm dialog. |
| Bookings | Search/date/court/status/payment filters · row actions | PARTIAL | Search fires on **every keystroke** (no debounce). Reschedule modal: `min` date + defaults hardcoded **2026-09-18**; court dropdown hardcodes **court-1/court-2**. |
| Calendar | Date picker · slot grid · open-slot form · booked-slot details | FAIL | **BUG: `const [error, setError] = ""` (Calendar.jsx:26) - `setError` is `undefined`; any manual-booking error crashes.** Payment-method select is **never sent to the backend** - payment rows stay "Pay at Court". `?court=` param from Courts page is ignored. |
| Courts | Edit court (name/description/price/image/toggles) | OK | "2 courts total" counter is hardcoded text. |
| Customers | Search · View profile modal | PARTIAL | Search fires per keystroke; stats pull **all** bookings per search. |
| Payments | Search/date/status · View · Mark paid · Refund | PARTIAL | No `try/catch` around Mark paid / Refund. No realtime refresh. |
| Reports | Range · court/status/payment · Export CSV | PARTIAL | Default dates hardcoded **2026-09-01 to 2026-09-18**. Court dropdown hardcoded. Bar-chart weekday labels fixed M/T/W/T/F/S/S. |
| Settings | Facility info · booking rules · admin profile · password | FAIL | **Saved opening/closing/duration settings are never used** - `COURT_HOURS` and `HOURLY_RATE` stay hardcoded in `lib/constants.js`; the customer flow always books 1 hour. Admin email edits are not persisted. |

---

## 6. Responsive design (desktop to tablet to mobile)

### Breakpoints currently used
`index.css` + `premium.css`: `max-width: 400px`, `640px`, `720px`, `760px`, `900px` - no `min-width` breakpoints.

| Breakpoint | What changes |
|---|---|
| <= 900 px | Book layout shrinks; admin sidebar -> 205 px; court grid -> 1 col; stat grids -> 2 col; admin filters -> 2 col. |
| <= 760 px | **Public nav + Log in link hidden**; hero stacks; contact stacks; auth video hidden; customer shell -> bottom tab bar; admin shell -> bottom tab bar; tables scroll. |
| <= 640 px | Book layout stacks fully; admin padding shrinks; cards/forms full width; slot grids -> 3 cols; settings grid -> 1 col. |
| <= 400 px | Court card art height adjusts. |

### What works well
- Customer bottom tab bar and admin bottom tab bar on mobile - good pattern.
- Tables use `overflow-x: auto` so they never break the layout.
- Slot grids collapse to 3 columns on phones.
- Modals, stat cards and forms all collapse cleanly.

### What is broken / could be better
1. **Public mobile navigation is missing** (biggest UX gap). Under 760 px: `.public-nav { display:none }` and `.header-login { display:none }` (index.css:1423-1436). No hamburger - mobile users cannot reach Courts / Availability / Pricing / Contact or Log in.
2. **Tables scroll horizontally** on mobile - OK for admin, but customer History / Payments tables would be nicer as stacked card rows under ~640 px.
3. **Admin tables** (`min-width: 1050px`) are usable but heavy on phones; the Calendar grid is cramped (62 px time column + 2x110 px slots).
4. `env(safe-area-inset-bottom)` (index.css:1565) is non-standard and ignored by browsers - replace with a `padding-bottom` fallback plus `@supports`.
5. No coverage below ~360 px; 58 px hero headlines can wrap awkwardly on very small phones.
6. `prefers-reduced-motion` only partially handled (hero); slot/stat animations still run.
7. Touch targets `.row-actions` / `.time-slot` are near 40 px - bump to at least 44 px on mobile.

---

## 7. Bugs (with exact locations & recommended fixes)

### CRITICAL

| # | Where | What happens | Fix |
|---|---|---|---|
| B1 | `src/pages/admin/Calendar.jsx:26` | `const [error, setError] = "";` destructures an empty string, so `setError` is `undefined`. Any manual-booking submission error throws `TypeError: setError is not a function`, and the friendly error never displays. | `const [error, setError] = useState("");` |
| B2 | `src/index.css:1423-1436` (`@media max-width:760px`) | Public navbar + Log in link are `display:none`. No mobile menu exists, so phone visitors are stranded on Home/Book. | Add a hamburger menu to `Navbar.jsx` that toggles the `.public-nav` (slide-down panel), keep a visible "Log in / My dashboard" item, and annotate the toggle with `aria-expanded`. |

### MAJOR

| # | Where | What happens | Fix |
|---|---|---|---|
| B3 | `src/services/bookingService.js:265-295` + `Calendar.jsx:157-166` | Admin Calendar "Payment method" select (Pay at Court/GCash) is never sent to `createAdminBooking`; the DB trigger creates every payment row with `method = 'Pay at Court'`. | Extend `createAdminBooking` to accept `paymentMethod`, include `payments(method)` in the admin select, and set the method on the payment row after the booking insert. |
| B4 | `src/pages/admin/Calendar.jsx` (whole page) | "View availability" from Courts (`navigate('/admin/calendar?court=...')`) is ignored — no query param is read. | Read `?court=` via `useSearchParams`, prefill/highlight that court column. |
| B5 | `src/components/layout/AdminTopbar.jsx:40` | Hardcoded date "Sunday, September 6, 2026", hardcoded "AR" avatar, static fake notifications. | Compute today with `Intl.DateTimeFormat`; derive initials from `user.fullName`; make the bell show **real** counts (e.g., pending bookings today) or remove it. |
| B6 | `src/pages/public/Home.jsx:99-121` | "LIVE AVAILABILITY" section shows hardcoded mock slots under a "LIVE" label. | Reuse `courtService.getAvailability(todayISO())` + `useRealtimeBookings` and render real open slots. |
| B7 | `src/lib/constants.js` + `src/pages/public/Pricing.jsx` + `src/components/dashboard/CalendarView.jsx:10` | Pricing/Calendar show the hardcoded `HOURLY_RATE = 300`, while courts have an editable DB price. | Remove `HOURLY_RATE` from UI strings; Pricing should show the first active court's price (or an `get_facility_info` RPC); CalendarView should receive price from the court object. |
| B8 | `src/pages/admin/Settings.jsx` + `src/lib/constants.js` | Facility settings (opening/closing/default_duration/max_duration) are saved but never used. | Add a public RPC `get_facility_info()`; build `COURT_HOURS` from `opening_time..closing_time`; pass `maxDuration` to `BookCourt` for the duration picker; pass `defaultDuration` on booking creation. |
| B9 | `src/pages/public/Contact.jsx:33-51` | "Send message" does nothing (`preventDefault()` only). | Create a `contact_messages` table + `send_contact_message(v)` RPC or an Edge Function email; show a success notice. |

### MODERATE

| # | Where | What happens | Fix |
|---|---|---|---|
| B10 | `src/pages/admin/Bookings.jsx:22-24,211,220-227` | Reschedule modal hardcodes `min="2026-09-18"` (future!), default date/court/time, and a `<select>` with only court-1/court-2. | Build options from `courtService.getManagedCourts()`; default `min={todayISO()}`; keep court UUIDs as option values. |
| B11 | `src/pages/admin/Reports.jsx:7-12,42,162-163` | Default range hardcoded to 2026-09-01..09-18 (contains future dates); bar legend `[M,T,W,T,F,S,S]` ignores real weekdays. | Default `from` = today-30d, `to` = today; compute weekday letters from the actual trend dates. |
| B12 | `src/pages/admin/Dashboard.jsx` | Table Cancel opens details modal instead of the confirm dialog; always greets "Good morning"; `today` computed once at import. | Wire `onCancel` to `setCancelTarget`; compute greeting by hour; compute `today` inside `load()`. |
| B13 | `src/pages/customer/BookCourt.jsx:25-28` | `getAvailability(date)` has no `.catch` — on failure the grid silently stays stale/empty. | Add an error branch with a retry button. |
| B14 | `src/pages/public/Availability.jsx` | Error state exists but no retry. | Add a "Try again" action that re-runs `load()`. |
| B15 | `src/pages/admin/Payments.jsx:18-23,34-43` | `markPaid`/`refund` have no try/catch; failures leave rows stale silently. | Wrap in try/catch + `ErrorMessage`. |
| B16 | `src/pages/customer/Profile.jsx:112-115` | Email field is editable but never persisted (updateProfile only sends full_name/phone). | Make it read-only or wire `supabase.auth.updateUser({ email })`. |
| B17 | Icons/emoji/special glyphs (`🗓`, `♢`, `▦`, `₱`, `↪`) across sidebars/layout. | Inconsistent cross-platform rendering; poor a11y. | Swap to inline SVG icon set with `aria-hidden`. |
| B18 | `src/hooks/useRealtimeBookings.js:27-34` | Every screen opens its own channel subscribed to ALL booking events; customers refetch on unrelated bookings. | Single shared channel at app level; `.filter` by `user_id` on customer pages; reliable dispose. |
| B19 | `src/pages/auth/Login.jsx:58-60` | "Remember me" checkbox does nothing. | Remove it or implement (e.g., session persistence toggle). |
| B20 | `src/lib/supabase.js:19` | `console.warn` is not a function — throws when Supabase is unconfigured. | Change to `console.warn` -> `console.log`/`console.error`. |

### MINOR / HYGIENE

| # | Where | What | Fix |
|---|---|---|---|
| B21 | `src/services/bookingService.js:1`, `customerService.js:1` | BOM characters at file start. | Re-save as UTF-8 no BOM. |
| B22 | `src/pages/admin/Courts.jsx:27` | "2 courts total" hardcoded. | Use `{courts.length} courts total`. |
| B23 | `src/components/layout/AdminSidebar.jsx` | Glyph icons inconsistent; admin mobile bar hides logout (topbar popover still has it). | SVG icons + explicit mobile logout item. |
| B24 | `src/pages/admin/Reports.jsx:18-42` | CSV export does not escape commas/quotes in names. | Escape fields when building rows. |
| B25 | `index.html` | No `meta description`, OpenGraph/Twitter tags. | Add them (favicon + theme-color already present). |
| B26 | `vite.config.js` | 548 kB single JS chunk (build warning). | Add `manualChunks` (react, react-dom, supabase) or lazy-load admin routes. |
| B27 | `supabase/migrations/0008_seed_admin.sql` | Admin password `123123123` in a committed migration. | Change after first login; move secrets out of migrations. |
| B28 | `.env` | Real publishable key in repo workspace (`.gitignore` covers it, but rotate periodically). | Rotate key; never commit real keys. |
| B29 | `src/components/common/Modal.jsx` | No ESC / backdrop-close / focus trap / scroll lock. | Add keyboard + backdrop handling and focus management. |
| B30 | `src/pages/customer/MyBookings.jsx` / `Payments.jsx` | Success notices never auto-dismiss. | Auto-dismiss after a few seconds or add an `x`. |
| B31 | `src/pages/admin/Dashboard.jsx:149-156` | Table Cancel vs details conflict (see B12). | Single consistent action signature in `AdminBookingTable`. |
| B32 | `Customers.jsx`, `Bookings.jsx`, `Reports.jsx` | Filter/search re-query on every keystroke. | Debounce 300 ms + ignore stale responses. |

---

## 8. Security & performance review

### Security — already good
- RLS enabled on **all 5 tables**; customers strictly scoped to their own rows.
- Booking amount is never trusted from the client (DB trigger).
- Double-booking prevented at the DB (EXCLUDE GiST constraint).
- Public availability exposes only slot coordinates via a security-definer RPC.
- `prevent_role_change` protects the admin role.
- Admin detection via security-definer `is_admin()`, anon key only — no service-role key in front end.

### Security — needs attention
| # | Item | Action |
|---|---|---|
| S1 | `0008_seed_admin.sql` contains the plaintext admin password `123123123`. | Change the password immediately; create the admin with a generated hash outside of committed migrations. |
| S2 | `customer_name/email/phone` PII on `bookings`. | Verified safe today (`get_booked_slots` returns IDs/times only). Keep it that way; never expose those columns via anon RPCs. |
| S3 | No rate limiting / CAPTCHA on auth or contact forms. | Use Supabase Auth built-in rate limits + hCaptcha/Cloudflare Turnstile on public forms. |
| S4 | Realtime broadcasts booking events to every client (reads stay RLS-filtered). | Filter the subscription per user (`eq user_id`) on customer screens. |
| S5 | `dist` folder exists in the repo workspace (gitignored). | Keep gitignored; do not commit builds. |

### Performance
| # | Item | Action |
|---|---|---|
| P1 | Single JS bundle 548 kB (Vite warning). | `manualChunks` for `react`, `react-dom`, `@supabase/supabase-js`; lazy-load admin routes so customers never download admin code. |
| P2 | `getCustomers` fetches **all** profiles + **all** bookings per search keystroke. | Rewrite as an RPC with SQL aggregates (`count`, `sum`), server-side search + pagination. |
| P3 | `getAllBookings` has no server-side search/limits; filters run client-side. | Add date/status/court/search params + `limit/offset` + paginated table. |
| P4 | `resolveCourtId` queries courts on every call. | Memoize the court map once per app session. |
| P5 | One realtime channel per open page. | Centralize into one shared channel managed in `AuthProvider`. |
| P6 | Static images/video have no lazy-loading. | `loading="lazy"` on below-fold images; `preload="none"` on the auth video. |
| P7 | No immutable-cache headers for `/assets/*`. | Configure on hosting platform (Netlify/Supabase). |

---

## 9. Recommended improvements (make it a "nice system")

### 9.1 UX / UI
1. **Hamburger menu** for public mobile (B2).
2. **Toast/notification system** instead of inline banners ("Booking confirmed", "Payment recorded").
3. **Real-time admin notifications**: bell badge = count of pending bookings today (replaces the fake popover, B5).
4. **Standardized empty states** with a CTA on every list page.
5. **Skeleton loaders** for tables/availability instead of "Loading..." text.
6. **Card-style tables on mobile** for customer History/Payments (stacked rows under 640 px).
7. **Quick actions on admin dashboard**: "New walk-in booking" jumps to Calendar pre-filled for today; "Today's upcoming" timeline.
8. **FAQ / "How it works"** section on Home + a working Contact form (B9).
9. **Booking confirmation screen** after success (instead of banner redirect): show date/time/court/total + "Add to calendar (.ics)".
10. **Google Calendar / Outlook export** per booking (`data:text/calendar` link).
11. **Cancellation policy UI** (2-hour rule from Pricing) shown inline on My Bookings.
12. **Real court photos** — `public/pic1..5.jpg` + `vid1.mp4` already exist; use them in CourtCard/admin cards instead of CSS art only.
13. **Dark mode** (CSS vars are brand-consistent; add `[data-theme]`).
14. **Better branding touch**: replace emoji/glyph icons with an inline SVG set (B17).

### 9.2 Functional / business
15. **Duration picker for customers** (1-2 h from settings) with live price update.
16. **Payment improvements**: keep "Pay at Court" default; add a "GCash reference" field for self-service/admin; plan a real GCash/PayMongo integration later.
17. **Email confirmations** via Supabase Edge Function (booked / cancelled / rescheduled / paid) — biggest professional upgrade.
18. **Reminders** — same Edge Function sends a reminder the day before.
19. **Court maintenance windows**: only a boolean exists today; add date ranges so slots auto-block in advance.
20. **Optional players count / max players** on bookings and courts.
21. **Account deletion / data export** for privacy compliance.
22. **Pagination** on bookings, payments, customers, reports (P3).
23. **Richer reports**: revenue-by-day line chart, month-over-month, busiest time of day, weekend vs weekday utilization.
24. **Countdown card** on customer dashboard ("Your next game is in X days").

### 9.3 Backend / database
25. **`get_facility_info()` RPC** (anon) so public pages show real hours/price/name from settings + courts (B7/B8).
26. **`send_contact_message` RPC + `contact_messages` table** (B9).
27. **`get_customer_directory` RPC** with SQL-side aggregates + pagination (P2).
28. **Timestamps** `bookings.cancelled_at`, `payments.refunded_at`; index `bookings(booking_date, status)`.
29. **No-past-bookings rule** in a trigger (`booking_date + start_time > now()` for new rows) to stop backdated bookings via crafted calls.
30. **Search indexes**: `pg_trgm` GIN on `profiles.full_name/email`, `bookings.customer_name`.
31. **Notifications table** (RLS admin-only) fed by booking triggers — powers the real bell (B5).
32. **Audit log** (`audit_logs`, admin-only) for status/payment changes.

### 9.4 Accessibility (a11y)
33. Skip-to-content link; `<th scope>` + `<caption>` on tables; `aria-label`s on icon buttons; inline errors tied via `aria-describedby`; visible `:focus-visible` rings; 44 px touch targets; `prefers-reduced-motion` applied everywhere; focus trap + ESC-to-close in `Modal` (B29).

### 9.5 SEO / meta / deploy
34. Add `meta description`, OpenGraph/Twitter, and LocalBusiness JSON-LD (name, address, hours, phone) to `index.html`.
35. `robots.txt` + `sitemap.xml` + canonical tags.
36. SPA redirect file for the hosting platform (`_redirects`: `/* /index.html 200`) so deep links and the `/reset-password` callback work in production.
37. CI gate: `npm run lint` + `npm run build`; later a Playwright smoke test (login -> book -> cancel).
38. Friendly "Supabase not configured" screen instead of a thrown error (B20).

---

## 10. Prioritized fix roadmap

### Phase 1 — Ship-blockers (do first, ~1 afternoon)
1. **B1** fix `Calendar.jsx:26` (`useState("")`).
2. **B2** public mobile hamburger menu + always-visible login.
3. **B5** replace hardcoded topbar date/avatar; remove fake notifications.
4. **B20** `console.warn` -> valid logging.
5. **B9** Contact form: wire a `send_contact_message` RPC or a `mailto:` fallback.
6. **B6** Home "LIVE AVAILABILITY" uses real data.
7. **B27/S1** change admin password from `123123123`.

### Phase 2 — Correctness (do next)
8. **B3** persist payment method on manual bookings.
9. **B4** Calendar reads `?court=`.
10. **B7/B8** make pricing/hours/duration settings actually drive the booking flow.
11. **B10/B11** remove future/hardcoded dates; dynamic court options.
12. **B12** Dashboard greeting + Cancel confirm wiring.
13. **B13-B16** add error handling in BookCourt, Payments, Profile email.

### Phase 3 — Polish (make it "nice")
14. **B17** SVG icon set. **B29** modal focus/ESC. **B32** debounce search.
15. **B26** chunking/lazy routes. **B25** SEO meta. **B30** auto-dismiss notices.
16. Street: card tables on mobile, skeleton loaders, toasts, email confirmations, pagination, richer reports, notifications table.

---

## 11. Quick patches for the top bugs (copy-paste starting points)

### 11.1 B1 — fix Calendar state (src/pages/admin/Calendar.jsx:26)
```js
// before
const [error, setError] = "";      // setError is undefined -> crash
// after
const [error, setError] = useState("");
```

### 11.2 B20 — valid log call (src/lib/supabase.js:19)
```js
// before
console.warn("Supabase is not configured ...");
// after
console.error("Supabase is not configured ...");
```

### 11.3 B12 — dynamic greeting (src/pages/admin/Dashboard.jsx)
```js
const hour = new Date().getHours();
const greeting =
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
// <h2>{greeting}, {firstName}.</h2>
```

### 11.4 B3 — persist manual-booking payment method
In `src/services/bookingService.js`, `createAdminBooking(...)`:
```js
// accept paymentMethod, then after a successful insert:
if (data?.id && paymentMethod && paymentMethod !== "Pay at Court") {
  const { error: payError } = await supabase
    .from("payments")
    .update({ method: paymentMethod })
    .eq("booking_id", data.id);
  if (payError) throw payError;
}
```

### 11.5 B2 — minimal mobile hamburger (src/components/layout/Navbar.jsx)
```jsx
// add near the top of the component
const [navOpen, setNavOpen] = useState(false);
// ... inside <header>, before .header-actions:
<button
  className="nav-toggle"
  aria-label="Toggle menu"
  aria-expanded={navOpen}
  onClick={() => setNavOpen(!navOpen)}>
  &#9776;
</button>
// give .public-nav a class when open:
<nav className={`public-nav ${navOpen ? "open" : ""}`} ...>
```
CSS:
```css
@media (max-width: 760px) {
  .nav-toggle { display: inline-flex; border: 0; background: transparent; font-size: 22px; }
  .public-nav.open { display: flex; flex-direction: column; gap: 14px; width: 100%; }
  .public-nav a, .header-login { display: flex; }
}
```

---

## 12. Final summary

The core architecture is **solid and secure**: RLS on every table, DB-enforced pricing and double-booking prevention, friendly booking numbers, realtime updates, and a clean component/service/DB split. The system already does the hard parts right.

The bugs cluster into **four themes**:
1. **Broken pieces** — Calendar error state (B1), fake notifications/date (B5), dead Contact form (B9), static "LIVE" panels (B6).
2. **Config-drift** — hardcoded dates/prices/courts that contradict admin-editable data (B7/B8/B10/B11).
3. **Mobile gaps** — no public mobile navigation (B2), horizontal-scroll tables, touch sizes.
4. **Resilience & polish** — missing error handling, debounce, pagination, a11y, SEO, emails, chunking.

Apply **Phase 1 = ship-blockers** first (all small, high-impact), then Phase 2 correctness, then Phase 3 polish. Re-running `npm run build` + `npm run lint` after each batch will keep the app green.