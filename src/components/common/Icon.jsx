/**
 * B17: shared inline-SVG icon set.
 *
 * Replaces the emoji/glyph characters (🏠 🎾 📅 🕘 💳 👤 ▦ ▤ □ ◇ ♙ ₱ ⌁ ⚙ ♢ ↪)
 * that rendered inconsistently across platforms. Every icon:
 *  - is stroke-drawn on a 24x24 grid and sized via the `size` prop,
 *  - inherits the current text color (`stroke="currentColor"`),
 *  - is marked `aria-hidden` because it is decorative (labels live in text).
 */
const ICONS = {
  dashboard: <path d="M5 5h14M5 12h14M8 5v14M14 5v14" />,
  bookings: <path d="M6 5h12M6 10h12M6 15h12" />,
  calendar: <path d="M6 4h12v15M6 4v15M6 9h12" />,
  court: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 5.5v13M5.5 12h13" />
    </>
  ),
  customers: (
    <>
      <circle cx="8" cy="7.5" r="2.8" />
      <circle cx="16" cy="7.5" r="2.8" />
      <path d="M5.2 10.3v3.4h6.2v3.4M13.6 10.3v3.4h6.2v3.4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="7.5" r="2.8" />
      <path d="M9.2 10.3v3.4h6.2v3.4" />
    </>
  ),
  payments: <path d="M5 6h14v11h-14v-11M8 9.5h8" />,
  reports: <path d="M6 16h3v-9M11 16h3v-12M16 16h3v-5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M8.5 6.5h7M8.5 17.5h7M6.5 12h11" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 5.5v13M12 12l-3.5-3M12 12l4-2" />
    </>
  ),
  bell: (
    <>
      <circle cx="12" cy="11" r="5.5" />
      <path d="M12 5.5v3M12 11v5M8.5 11h7" />
    </>
  ),
  logout: <path d="M8 5h8v14h-8v-14M10.5 12h5" />,
};

export function Icon({ name, size = 18, className = "" }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      {glyph}
    </svg>
  );
}