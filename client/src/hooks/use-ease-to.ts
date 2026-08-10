import { useEffect, useRef, useState } from "react";

/**
 * Yksi arvo, joka kiipeää kohti tavoitetta rAF:lla.
 *
 * Sekä luku että palkki ajetaan SAMASTA arvosta, jotta ne eivät voi olla eri
 * kohdassa animaation aikana — CSS-siirtymä palkille ja erillinen laskuri
 * numerolle ajautuvat aina erilleen, ja silloin ruudulla lukee hetken "61 %"
 * palkin ollessa puolivälissä.
 *
 * Kunnioittaa `prefers-reduced-motion`ia: silloin arvo on heti tavoitteessa.
 * Tarkistus tehdään joka ajolla eikä moduulin latauksessa, koska käyttäjä voi
 * vaihtaa asetusta kesken istunnon.
 */

export const EASE_MS = 1100;

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useEaseTo(target: number, ms = EASE_MS): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(reducedMotion() ? target : 0);

  useEffect(() => {
    if (reducedMotion()) { from.current = target; setValue(target); return; }
    const start = performance.now();
    const a = from.current;
    if (a === target) return;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 4);            // easeOutQuart
      const cur = a + (target - a) * eased;
      from.current = cur;
      setValue(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
