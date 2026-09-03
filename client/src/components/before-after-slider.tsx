/**
 * Before/after comparison slider.
 *
 * Same window, same angle, same light — one shot before we cleaned and one
 * after. The proof is the photo pair; this component's only job is to get out
 * of its way and feel good under a finger.
 *
 * Why the hand-rolled drag instead of an input[type=range] or a motion value:
 * a `pointermove` on a phone can fire well above 60 Hz, and re-rendering React
 * on each one made the divider stutter. So the drag path writes a single CSS
 * custom property straight to the DOM node inside one rAF, and React state
 * only ever sees the settled value (for `aria-valuenow` and the label fades).
 *
 * Accessibility: the handle is a real `role="slider"` — tab to it, then arrows,
 * PageUp/PageDown and Home/End all work. `prefers-reduced-motion` skips the
 * intro sweep and the easing; dragging still works, it just tracks 1:1.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clampPercent, easeToward, positionFromPointer, stepPosition } from "@/lib/before-after";

type Props = {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel: string;
  afterLabel: string;
  alt: string;
  /** Accessible name for the handle, e.g. "Vertaile ennen ja jälkeen". */
  handleLabel: string;
  hint?: string;
  className?: string;
};

const START_POS = 55;

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeLabel,
  afterLabel,
  alt,
  handleLabel,
  hint,
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);

  /** Rendered position. Lives in a ref because the rAF loop owns it. */
  const posRef = useRef(START_POS);
  /** Where the position is heading. Equal to `posRef` once the motion settles. */
  const targetRef = useRef(START_POS);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const draggingRef = useRef(false);
  const easeRef = useRef(true);

  const [pos, setPos] = useState(START_POS);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * The one place that touches the DOM during a drag.
   *
   * Writes the complement as well as the position: the clip could say
   * `inset(0 calc(100% - var(--ba-pos)) 0 0)`, but `calc()` nested inside
   * `inset()` is exactly the kind of thing older Safari drops on the floor —
   * and this build targets safari12. Two custom properties are free.
   */
  const paint = useCallback((value: number) => {
    const node = rootRef.current;
    if (!node) return;
    node.style.setProperty("--ba-pos", `${value}%`);
    node.style.setProperty("--ba-rest", `${100 - value}%`);
  }, []);

  const tick = useCallback(
    (now: number) => {
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 16.6667;
      lastFrameRef.current = now;

      const next = easeRef.current
        ? easeToward(posRef.current, targetRef.current, dt)
        : targetRef.current;
      posRef.current = next;
      paint(next);

      if (next !== targetRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        lastFrameRef.current = 0;
        // React only hears about the settled value — one render per gesture,
        // not one per pointer event.
        setPos(next);
      }
    },
    [paint],
  );

  /** `ease = false` pins the divider to the finger; `true` glides to it. */
  const moveTo = useCallback(
    (value: number, ease: boolean) => {
      targetRef.current = clampPercent(value);
      easeRef.current = ease && !reduced;
      if (rafRef.current === null) {
        lastFrameRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
      }
    },
    [reduced, tick],
  );

  useEffect(() => {
    paint(START_POS);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [paint]);

  /**
   * Intro sweep: the first time the slider scrolls into view it wipes open and
   * back, so nobody has to guess that the picture is draggable. It runs once,
   * and never at all when the visitor asked for less motion.
   */
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let done = false;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || done) continue;
          done = true;
          observer.disconnect();
          if (reduced) return;
          timers.push(window.setTimeout(() => moveTo(88, true), 320));
          timers.push(window.setTimeout(() => moveTo(16, true), 1350));
          timers.push(window.setTimeout(() => moveTo(50, true), 2400));
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, [moveTo, reduced]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // Ignore right-click and any second finger: a two-finger pinch is a zoom,
    // not a drag, and grabbing it made the divider jump across the photo.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    draggingRef.current = true;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Tapping the photo glides the divider over; grabbing the handle itself
    // must not yank it, so only a tap away from the handle re-targets.
    const fromHandle = e.currentTarget === handleRef.current;
    if (!fromHandle) moveTo(positionFromPointer(e.clientX, rect), true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    // No preventDefault here: `touch-action: pan-y` already lets the page
    // scroll vertically through the photo while we own the horizontal axis.
    moveTo(positionFromPointer(e.clientX, rect), false);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setPos(clampPercent(targetRef.current));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = stepPosition(targetRef.current, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    moveTo(next, true);
  };

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return (
    <div className={`select-none ${className}`}>
      <div
        ref={rootRef}
        className="ba-root group relative w-full overflow-hidden rounded-2xl premium-shadow bg-muted"
        style={{
          ["--ba-pos" as string]: `${START_POS}%`,
          ["--ba-rest" as string]: `${100 - START_POS}%`,
          touchAction: "pan-y",
        }}
        {...dragHandlers}
        data-testid="before-after-slider"
      >
        {/* Bottom layer: after (clean). Kept whole so the wipe reveals it. */}
        <img
          src={afterSrc}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setReady(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Top layer: before (dirty), clipped to everything left of the divider. */}
        <div
          className="absolute inset-0 will-change-[clip-path]"
          style={{ clipPath: "inset(0 var(--ba-rest) 0 0)" }}
          aria-hidden="true"
        >
          <img
            src={beforeSrc}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        {/* Corner labels. The one the divider has swallowed fades out. */}
        <span
          className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm transition-opacity duration-300"
          style={{ opacity: pos < 18 ? 0 : 1 }}
        >
          {beforeLabel}
        </span>
        <span
          className="pointer-events-none absolute right-3 top-3 rounded-full bg-primary/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground backdrop-blur-sm transition-opacity duration-300"
          style={{ opacity: pos > 82 ? 0 : 1 }}
        >
          {afterLabel}
        </span>

        {/* Divider: hairline + a soft bloom so it reads on both dark frames and bright sky. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white/95 shadow-[0_0_14px_rgba(0,0,0,0.45)]"
          style={{ left: "var(--ba-pos)" }}
          aria-hidden="true"
        />

        <button
          ref={handleRef}
          type="button"
          role="slider"
          aria-label={handleLabel}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}%`}
          onKeyDown={onKeyDown}
          {...dragHandlers}
          className={`absolute top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-white/70 bg-white/25 text-white shadow-lg backdrop-blur-md outline-none transition-[transform,background-color,box-shadow] duration-200 focus-visible:ring-4 focus-visible:ring-white/70 ${
            dragging ? "scale-110 bg-white/40" : "hover:scale-105 hover:bg-white/35"
          }`}
          style={{ left: "var(--ba-pos)", touchAction: "none" }}
          data-testid="before-after-handle"
        >
          <ChevronLeft className="h-4 w-4 -mr-0.5 drop-shadow" />
          <ChevronRight className="h-4 w-4 -ml-0.5 drop-shadow" />
          {/* Breathing ring that stops the moment the visitor takes over. */}
          {!dragging && (
            <span className="ba-pulse pointer-events-none absolute inset-0 rounded-full border border-white/60" aria-hidden="true" />
          )}
        </button>

        {/* Shimmer while the photos decode — better than a grey hole. */}
        {!ready && <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
      </div>

      {hint && (
        <p className="mt-3 text-center text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
