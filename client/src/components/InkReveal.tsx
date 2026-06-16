/**
 * InkReveal — an interactive ink-wash mask. The canvas paints over its parent
 * with `maskColor`; moving a pointer (or the auto-reveal sweep) carves wobbly
 * ink stamps out of the mask, revealing whatever sits behind it. Stamps fade,
 * so the mask heals back over time.
 */

import { useEffect, useRef, useCallback } from "react";

interface InkRevealProps {
  maskColor?: [number, number, number];
  brushSize?: number;
  lifetime?: number;
  rStart?: number;
  rVary?: number;
  stampStep?: number;
  maxStamps?: number;
  segments?: number;
  wobble?: [number, number, number];
  gradientInnerRadius?: number;
  gradientStops?: [number, number, number];
  /** Run a one-time reveal sweep on mount (good for touch / first impression). */
  autoReveal?: boolean;
  /** When set, the whole ink layer dissolves to fully reveal the content this many
   *  ms after mount (so the effect plays, then gets out of the way by itself). */
  fadeOutAfter?: number;
  /** Fade-out transition duration in ms (default 900). */
  fadeOutDuration?: number;
  /** Called once the fade-out finishes (content fully revealed). */
  onRevealed?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

interface Stamp {
  x: number;
  y: number;
  born: number;
  seed: number;
  rmax: number;
}

export default function InkReveal({
  maskColor = [10, 12, 14],
  brushSize = 128,
  lifetime = 1400,
  rStart = 10,
  rVary = 0.45,
  stampStep = 10,
  maxStamps = 240,
  segments = 36,
  wobble = [0.14, 0.08, 0.05],
  gradientInnerRadius = 0.2,
  gradientStops = [0.95, 0.88, 0],
  autoReveal = true,
  fadeOutAfter,
  fadeOutDuration = 900,
  onRevealed,
  className,
  style,
}: InkRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stampsRef = useRef<Stamp[]>([]);
  const runningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const mc = maskColor;

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = parent.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    dimsRef.current = { w, h };
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgb(${mc[0]},${mc[1]},${mc[2]})`;
    ctx.fillRect(0, 0, w, h);
  }, [mc]);

  const carveInk = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, r * gradientInnerRadius, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${gradientStops[0] * alpha})`);
      g.addColorStop(0.5, `rgba(0,0,0,${gradientStops[1] * alpha})`);
      g.addColorStop(1, `rgba(0,0,0,${gradientStops[2] * alpha})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const wob =
          0.78 +
          wobble[0] * Math.sin(a * 3 + seed) +
          wobble[1] * Math.sin(a * 5 + seed * 2.1) +
          wobble[2] * Math.sin(a * 7 + seed * 0.7);
        const px = x + Math.cos(a) * r * wob;
        const py = y + Math.sin(a) * r * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    },
    [segments, wobble, gradientInnerRadius, gradientStops],
  );

  const addStamp = useCallback(
    (x: number, y: number) => {
      const stamps = stampsRef.current;
      if (stamps.length >= maxStamps) stamps.shift();
      stamps.push({ x, y, born: performance.now(), seed: Math.random() * Math.PI * 2, rmax: brushSize * (1 - rVary + Math.random() * rVary) });
    },
    [brushSize, rVary, maxStamps],
  );

  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = dimsRef.current;
    const now = performance.now();
    const stamps = stampsRef.current;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgb(${mc[0]},${mc[1]},${mc[2]})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = stamps.length - 1; i >= 0; i--) {
      const t = (now - stamps[i].born) / lifetime;
      if (t >= 1) { stamps.splice(i, 1); continue; }
      const ease = 1 - Math.pow(1 - t, 3);
      const r = rStart + (stamps[i].rmax - rStart) * ease;
      const alpha = 1 - t * t;
      carveInk(ctx, stamps[i].x, stamps[i].y, r, stamps[i].seed, alpha);
    }
    if (stamps.length) requestAnimationFrame(loop);
    else runningRef.current = false;
  }, [carveInk, mc, lifetime, rStart]);

  const startLoop = useCallback(() => {
    if (!runningRef.current) {
      runningRef.current = true;
      requestAnimationFrame(loop);
    }
  }, [loop]);

  const stampAlong = useCallback(
    (x: number, y: number) => {
      const last = lastPosRef.current;
      if (!last) {
        addStamp(x, y);
      } else {
        const dx = x - last.x;
        const dy = y - last.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / stampStep));
        for (let i = 1; i <= steps; i++) addStamp(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
      }
      lastPosRef.current = { x, y };
      startLoop();
    },
    [addStamp, stampStep, startLoop],
  );

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // One-time reveal sweep so the effect shows itself (and works without hover).
  useEffect(() => {
    if (!autoReveal) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1500;
    const sweep = (now: number) => {
      const { w, h } = dimsRef.current;
      if (!w) { raf = requestAnimationFrame(sweep); return; }
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 2);
      const x = eased * w;
      const y = h / 2 + Math.sin(eased * Math.PI * 2) * h * 0.22;
      stampAlong(x, y);
      if (p < 1) raf = requestAnimationFrame(sweep);
      else lastPosRef.current = null;
    };
    raf = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(raf);
  }, [autoReveal, stampAlong]);

  // Dissolve the whole ink layer after a beat, then signal "revealed". Keeps the
  // cool intro but ensures it always clears itself (no swipe required).
  useEffect(() => {
    if (fadeOutAfter == null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t1 = setTimeout(() => {
      canvas.style.transition = `opacity ${fadeOutDuration}ms ease`;
      canvas.style.opacity = "0";
      canvas.style.pointerEvents = "none";
    }, fadeOutAfter);
    const t2 = setTimeout(() => onRevealed?.(), fadeOutAfter + fadeOutDuration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [fadeOutAfter, fadeOutDuration, onRevealed]);

  const relMouse = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const relTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = e.touches[0];
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: "absolute", inset: 0, zIndex: 1, cursor: "none", touchAction: "none", ...style }}
      onMouseEnter={(e) => { const p = relMouse(e); lastPosRef.current = p; stampAlong(p.x, p.y); }}
      onMouseMove={(e) => { const p = relMouse(e); stampAlong(p.x, p.y); }}
      onMouseLeave={() => { lastPosRef.current = null; }}
      onTouchStart={(e) => { const p = relTouch(e); lastPosRef.current = p; stampAlong(p.x, p.y); }}
      onTouchMove={(e) => { const p = relTouch(e); stampAlong(p.x, p.y); }}
      onTouchEnd={() => { lastPosRef.current = null; }}
    />
  );
}
