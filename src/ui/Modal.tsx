import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { color, radius, shadow } from "./theme";

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}

export function Modal({ open, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 999999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{
        background: color.surface,
        borderRadius: radius.xl,
        boxShadow: shadow.pop,
        width: "100%",
        maxWidth: 520,
        maxHeight: "90vh",
        overflow: "auto",
        margin: 16,
      }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
