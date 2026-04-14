import React, { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  width,
}: ModalProps): React.ReactElement | null {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="modal-content" style={width ? { maxWidth: width } : undefined}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
