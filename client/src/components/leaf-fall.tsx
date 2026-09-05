/**
 * Drifting leaves — or snow, depending on the month.
 *
 * "Syksy saapuu, ikkunat siistiks." A handful of leaves fall past the
 * before/after photos so the section says what time of year it is before
 * anybody reads a word of it. In winter the same machinery drops snow
 * instead, which pairs with Talvikiilto; in spring and summer the caller
 * simply doesn't render this at all. Autumn leaves falling in June would be
 * the same bug as the hero pill claiming spring in September, and the season
 * comes from the one place that knows it (`@shared/season`).
 *
 * Decoration only: `aria-hidden`, never a hit target, and gone entirely under
 * `prefers-reduced-motion`.
 *
 * Cost control matters more than leaf count here — this sits on a marketing
 * page that phones open on mobile data. So: no JS animation loop at all (pure
 * CSS keyframes on composited properties), a smaller flock on narrow screens,
 * and the whole thing unmounts while scrolled out of view, which stops the
 * compositor work instead of merely hiding it.
 */

import { useEffect, useRef, useState } from "react";

type Leaf = {
  /** Horizontal start, in % of the container. */
  x: number;
  /** Sideways travel over the fall, in px. */
  drift: number;
  delay: number;
  duration: number;
  scale: number;
  spin: number;
  index: number;
};

/**
 * Autumn without the clip-art: ochre, rust and one tired olive off the brand
 * green. Deep enough to read against the page's near-white background — the
 * first pass was pale beige and the leaves landed as smudges, not leaves.
 */
const LEAF_HUES = ["#b9781f", "#a3521a", "#8f6524", "#6f6526", "#5c6b3a", "#c68b1c"];

/** Snow needs the opposite treatment: light, low-contrast, cool. */
const SNOW_HUES = ["#cfe0ef", "#e6eef7", "#bcd2e6", "#dae7f2", "#c7d9ea", "#eef4fa"];

export type FallVariant = "leaves" | "snow";

function buildLeaves(count: number): Leaf[] {
  // Deterministic-ish spread rather than pure random: evenly seeded columns
  // keep the leaves from clumping into one corner on a narrow screen.
  return Array.from({ length: count }, (_, i) => {
    const r = (n: number) => ((Math.sin((i + 1) * n) + 1) / 2);
    return {
      x: ((i + 0.5) / count) * 100 + (r(12.9898) - 0.5) * 12,
      drift: (r(78.233) - 0.5) * 140,
      delay: r(43.7585) * 11,
      duration: 11 + r(93.9898) * 9,
      scale: 0.55 + r(27.61) * 0.7,
      spin: r(53.17) > 0.5 ? 1 : -1,
      index: i,
    };
  });
}

type Props = {
  className?: string;
  /** Leaves on a wide screen; narrow screens get roughly half. Default 14. */
  count?: number;
  /** Glyph size in px. Small surfaces (the front-page prompt) want ~11. */
  size?: number;
  /** What falls. Callers pick this from the season, not by taste. */
  variant?: FallVariant;
};

export function LeafFall({ className = "", count = 14, size = 18, variant = "leaves" }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [leaves, setLeaves] = useState<Leaf[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const wide = window.matchMedia("(min-width: 768px)").matches;
    const flock = buildLeaves(wide ? count : Math.max(4, Math.round(count * 0.6)));

    const node = hostRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setLeaves(flock);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setLeaves(entry.isIntersecting ? flock : []),
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  // Lumi putoaa hitaammin ja pyörii vähemmän kuin lehti — pyörivä lumihiutale
  // näyttää roskalta. Sama parvi, eri fysiikka.
  const slow = variant === "snow";

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {leaves.map((leaf, i) => (
        <span
          key={i}
          className="pp-leaf"
          style={{
            left: `${leaf.x}%`,
            animationDelay: `${leaf.delay}s`,
            animationDuration: `${slow ? leaf.duration * 1.5 : leaf.duration}s`,
            ["--leaf-drift" as string]: `${slow ? leaf.drift * 0.6 : leaf.drift}px`,
            ["--leaf-scale" as string]: leaf.scale,
            ["--leaf-spin" as string]: `${leaf.spin * (slow ? 90 : 540)}deg`,
          }}
        >
          {/* Inner wrapper spins; the outer one falls. See `.pp-leaf` in index.css. */}
          <span>
            <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
              {variant === "snow" ? (
                <circle cx="12" cy="12" r="7" fill={SNOW_HUES[leaf.index % SNOW_HUES.length]} opacity="0.95" />
              ) : (
                /* Blade + stem: a blob reads as dirt on the glass, a stem reads
                   as a leaf. Both need to survive being drawn at ~11px. */
                <path
                  d="M21.5 2.5c-7 .4-12.2 2.3-14.9 5.5-2.6 3.1-2.3 7 .3 9.4 3.6-4.6 8-7.6 12.4-9.2-3.9 2-7.4 5.1-10.5 9.7l-1.6 2.6a1 1 0 0 0 1.7 1l1.3-2.2c6.6 1.7 12.2-6.2 11.3-16.8Z"
                  fill={LEAF_HUES[leaf.index % LEAF_HUES.length]}
                  opacity="0.92"
                />
              )}
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}
