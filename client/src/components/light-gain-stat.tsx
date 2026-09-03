/**
 * Valonlisä-luku ennen/jälkeen-osiossa.
 *
 * LUKU ON MITATTU, EI KEKSITTY, ja siksi se on tässä kommentissa lähteineen.
 * Sharples, Stewart & Tregenza, "Glazing daylight transmittances: a field
 * survey of windows in urban areas", Building and Environment (2001): 430
 * ikkunaa Sheffieldissä, pesemättä 3 kuukaudesta 5 vuoteen. Valonläpäisyn
 * keskimääräinen menetys oli 10 %, ja siitä noin puolet oli sisäpinnan likaa.
 * Pystyikkunassa menetys ei yleensä ylittänyt 10 %:a.
 *
 * Kaksi seurausta jotka näkyvät sivulla:
 *  1. Luku on 10, ei 30 tai 40. Verkossa pyörivät "likaiset ikkunat estävät
 *     jopa 40 % valosta" ovat pesuyritysten omaa markkinointia ilman mittausta
 *     takanaan. Kuluttajansuojalaki koskee myös meidän etusivuamme.
 *  2. Koko 10 % saadaan takaisin vain pesemällä molemmat puolet, koska puolet
 *     liasta on sisäpinnalla. Se on sama asia kuin osion ensimmäinen lupaus,
 *     ja siksi ne ovat vierekkäin.
 *
 * Jos lukua joskus muutetaan, muutetaan lähde samalla tai poistetaan koko
 * väite. Numero ilman mittausta on huonompi kuin ei numeroa lainkaan.
 */

import { useEffect, useRef, useState } from "react";
import { Sun } from "lucide-react";
import { AnimatedCounter } from "@/components/animated-counter";

/** Sharples ym. 2001: valonläpäisyn keskimääräinen menetys pesemättömässä lasissa. */
export const LIGHT_GAIN_PERCENT = 10;

type Props = {
  label: string;
  source: string;
  className?: string;
};

export function LightGainStat({ label, source, className = "" }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [lit, setLit] = useState(false);

  // Hehku syttyy samalla kynnyksellä (0.3) kuin AnimatedCounterin oma
  // laskuri, joten valo ja numero lähtevät yhdessä ilman jaettua tilaa.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setLit(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setLit(true);
        observer.disconnect();
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-lit={lit ? "" : undefined}
      className={`pp-lightstat relative overflow-hidden rounded-2xl border border-border bg-card/70 p-5 ${className}`}
      data-testid="light-gain-stat"
    >
      {/* Aurinko ja luku samalle riville, selite koko leveydelle sen alle.
          Aiemmin selite oli ikonin vieressä, jolloin iso numero leijui
          oikealla ja ikoni jäi tekstimassan puoliväliin.
          Väli ennen prosenttimerkkiä on sitova (U+00A0): "+10 %" ei saa
          taittua kahdelle riville. */}
      <div className="relative flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
          <Sun className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </span>
        <AnimatedCounter
          end={LIGHT_GAIN_PERCENT}
          prefix="+"
          suffix=" %"
          duration={1600}
          className="text-4xl font-semibold leading-none tabular-nums text-primary md:text-5xl"
        />
      </div>
      <p className="relative mt-3 text-sm leading-relaxed text-foreground">{label}</p>
      <p className="relative mt-3 border-t border-border/70 pt-3 text-[11px] leading-relaxed text-muted-foreground">
        {source}
      </p>
    </div>
  );
}
