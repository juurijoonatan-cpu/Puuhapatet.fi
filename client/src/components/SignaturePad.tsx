/**
 * Reusable drawable signature field (mouse + touch). Emits a PNG data URL.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onChange: (dataUrl: string) => void;
  height?: number;
  /** Ink colour of the stroke. */
  color?: string;
  className?: string;
  placeholder?: string;
  /** Cap the exported PNG width (px) so the data URL stays small (well under the
   *  300 KB server cap). The on-screen canvas is unaffected. Default 520. */
  maxExportWidth?: number;
}

export default function SignaturePad({
  onChange,
  height = 150,
  color = "#1A1A1A",
  className,
  placeholder = "Piirrä allekirjoitus tähän",
  maxExportWidth = 520,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const g = c.getContext("2d");
    if (g) {
      g.scale(ratio, ratio);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2.2;
      g.strokeStyle = color;
    }
  }, [color]);

  const posOf = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = posOf(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const g = canvasRef.current?.getContext("2d");
    if (!g || !last.current) return;
    const p = posOf(e);
    g.beginPath();
    g.moveTo(last.current.x, last.current.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  // Export a downscaled PNG so the data URL stays small (a hi-DPI canvas can
  // otherwise produce a multi-hundred-KB image and trip the server cap).
  const exportDataUrl = (c: HTMLCanvasElement): string => {
    if (c.width <= maxExportWidth) return c.toDataURL("image/png");
    const scale = maxExportWidth / c.width;
    const off = document.createElement("canvas");
    off.width = maxExportWidth;
    off.height = Math.round(c.height * scale);
    const g = off.getContext("2d");
    if (!g) return c.toDataURL("image/png");
    g.drawImage(c, 0, 0, off.width, off.height);
    return off.toDataURL("image/png");
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current;
    if (c) onChange(exportDataUrl(c));
  };
  const clear = useCallback(() => {
    const c = canvasRef.current;
    const g = c?.getContext("2d");
    if (c && g) g.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange("");
  }, [onChange]);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ display: "block", width: "100%", height, touchAction: "none", cursor: "crosshair" }}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {placeholder}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
      >
        Tyhjennä
      </button>
    </div>
  );
}
