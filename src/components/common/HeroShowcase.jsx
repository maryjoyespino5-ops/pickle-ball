export function HeroShowcase() {
  return (
    <div className="hero-showcase">
      <div className="showcase-frame">
        <img
          className="showcase-img"
          src="/pic5.png"
          alt="Pickleball court at Alicayard Pickle Ball"
          draggable="false"
        />

        {/* Scrim so the overlay text stays legible */}
        <div className="showcase-shade" aria-hidden="true" />

        {/* Overlay copy */}
        <div className="showcase-copy">
          <span className="showcase-eyebrow">Alicayard Pickle Ball</span>
          <span className="showcase-label">
            Pickleball
            <br />
            played right.
          </span>
        </div>

        {/* Hours badge */}
        <span className="showcase-badge">
          <strong>24/7</strong>
          OPEN
        </span>
      </div>
    </div>
  );
}
