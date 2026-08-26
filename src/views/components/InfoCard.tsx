import { useEffect, useRef, type ReactNode } from "react";

export function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!details.current?.contains(event.target as Node)) details.current?.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") details.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return <details className="info-card" ref={details}>
    <summary aria-label={`About ${title}`}>i</summary>
    <div className="info-card-panel">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  </details>;
}
