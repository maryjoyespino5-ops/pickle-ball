import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Real fields are matched first so opening a form dialog puts the caret in the
// first input; the dialog's close button leads the DOM, so it used to win.
const FIELD_SELECTOR = [
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
].join(", ");
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function Modal({ children, onClose, title, labelledBy }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  // Every caller passes an inline `onClose` arrow, so the prop identity changes
  // on each render. Reading it through a ref keeps the setup effect below
  // mount-only: depending on `onClose` re-ran it on every keystroke (typing
  // updates state, the page re-renders, a new arrow arrives) and focus jumped
  // to the close "x" button after a single character.
  const onCloseRef = useRef(onClose);
  const titleId = labelledBy || "modal-title";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = dialogRef.current;
    previousFocusRef.current = document.activeElement;
    const focusTarget =
      node?.querySelector(FIELD_SELECTOR) ||
      node?.querySelector(FOCUSABLE_SELECTOR) ||
      node;
    focusTarget?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
    };
    // Mount-only on purpose: re-running this would steal focus mid-typing.
  }, []);

  // Restore keyboard focus to the trigger when the dialog unmounts (B29).
  useEffect(() => {
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}>
      <section
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}>
        <button className="modal-close" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
        {title && <h2 id={titleId}>{title}</h2>}
        {children}
      </section>
    </div>,
    document.body,
  );
}

