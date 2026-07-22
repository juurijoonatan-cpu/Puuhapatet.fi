import { useEffect, useState } from "react";

/**
 * Returns `true` when a floating bar should be hidden: the user is scrolling
 * DOWN (reading content), and `false` when scrolling UP or near the top. Lets a
 * fixed bottom nav slide out of the way so it never traps the content behind it,
 * then slide back the moment the user reaches for it (scrolls up).
 *
 * rAF-throttled and passive — no layout thrash, no scroll jank.
 */
export function useHideOnScroll(threshold = 8): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      if (y < 80) {
        setHidden(false); // always visible near the top
      } else if (y > lastY + threshold) {
        setHidden(true); // scrolling down → get out of the way
      } else if (y < lastY - threshold) {
        setHidden(false); // scrolling up → come back
      }
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}
