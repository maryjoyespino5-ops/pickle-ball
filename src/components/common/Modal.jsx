export function Modal({ children, onClose, title }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {title && <h2>{title}</h2>}
        {children}
      </section>
    </div>
  );
}
