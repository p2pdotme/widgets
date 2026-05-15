// Accessible modal portal. One owner of the dialog landmark
// (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`), so inner
// views never declare their own — preventing nested-dialog landmarks
// that screen readers flag as invalid.
//
// On open: captures the previously-focused element, moves focus to the
// first focusable child, and traps Tab inside the modal. On close:
// returns focus to the previously-focused element so keyboard users
// don't get dumped on `<body>`.
//
// `ariaLabelledBy` should point at a stable id rendered by the child
// content (eg every phase of ReportProblemStep renders an h3 with
// `id="report-problem-title"`). Falls back to `ariaLabel` when the
// content has no labelling heading.

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { color, radius, shadow } from "./theme";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** Id of the labelling heading inside `children`. Wired to
   *  `aria-labelledby`. Preferred over `ariaLabel` when the modal has
   *  a visible title heading. */
  ariaLabelledBy?: string;
  /** Fallback accessible name when no labelling heading exists. */
  ariaLabel?: string;
  /** Theme CSS vars applied to the backdrop so the card surface + inner
   *  content render against the integrator's palette. The Modal portals
   *  to `document.body`, escaping the calling widget's root — without
   *  this, the card's `var(--p2p-color-bg, #ffffff)` falls back to white
   *  on dark themes, producing white-on-white text. Pass the same
   *  `themeToCssVars(theme)` result the calling widget applies to its
   *  root. */
  themeStyle?: React.CSSProperties;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  themeStyle,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Capture the active element BEFORE we move focus into the modal so
    // we can restore it on close.
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the modal. The first focusable element is the
    // most natural target — typically the primary button or the close
    // affordance.
    const root = dialogRef.current;
    if (root) {
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      // microtask delay so the children are mounted before we try to
      // focus. React 18+ batches the effect tick before mutation
      // observers settle.
      queueMicrotask(() => first?.focus());
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to the launcher / previously-focused element.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        queueMicrotask(() => prev.focus());
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        // Theme CSS vars first so `color.surface` (`var(--p2p-color-bg, …)`)
        // on the card resolves against the integrator's palette instead of
        // the white fallback.
        ...themeStyle,
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(2px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        style={{
          background: color.surface,
          color: color.text,
          borderRadius: radius.xl,
          boxShadow: shadow.pop,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflow: "auto",
          margin: 16,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
