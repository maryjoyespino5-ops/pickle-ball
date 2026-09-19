# Pickleball Booking

A React and Vite booking application for pickleball courts.

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and add Supabase credentials when the backend is connected.

## Deploying (important for QR code scanning)

The app uses client-side routing (`BrowserRouter`), so deep links such as the
QR scan page (`/paddle/paddle-001`) must fall back to `index.html` on the
hosting server. The repo already ships the right fallbacks:

- **Netlify** — `public/_redirects` (`/* /index.html 200`)
- **Vercel** — `vercel.json` rewrite rule
- **GitHub Pages / plain static hosts** — the build automatically copies the
  built `index.html` to `404.html` (see the `spa404Fallback` plugin in
  `vite.config.js`)

Paddle QR stickers encode the site origin + `/paddle/<qr_token>`. To make sure
QRs always point at the live site (even while generating/printing from a
localhost test run), set the canonical URL in `.env`:

```bash
VITE_SITE_URL=https://your-deployed-site.example.com
```

When no `VITE_SITE_URL` is set, the QR uses the browser's current origin — so
printing QRs from the opened **deployed** admin page always produces the
correct scan URLs.
