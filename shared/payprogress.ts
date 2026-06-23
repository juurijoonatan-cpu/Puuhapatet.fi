/**
 * FR8 — maksuerän edistyminen ("paydate progress").
 *
 * Iso keikka laskutetaan asiakkaalta ja maksetaan tekijöille MONESSA erässä.
 * Esim. 168 ikkunaa jaettuna 4 maksuerään → yksi erä = 42 ikkunaa. Tämä laskee,
 * kuinka pitkällä ollaan kohti seuraavaa maksupäivää — hauska, jaettu mittari
 * sekä tekijöille (työpöytä) että johtajille (admin). Perustuu pelkkiin
 * ikkunamääriin, EI euroihin — tekijä ei näe keikan kokonaissummaa.
 */

/** Oletusmäärä maksueriä koko keikalle. Säädä tästä yhdestä paikasta. */
export const PAY_PERIODS = 4;

export interface PayProgress {
  total: number;        // ikkunoita koko keikassa (scope)
  washed: number;       // pesty tähän mennessä (tiimi yhteensä)
  periods: number;      // maksuerien määrä
  perPeriod: number;    // ikkunaa tässä erässä (voi vaihdella erien välillä)
  currentPeriod: number;// monesko erä menossa (1..periods)
  inPeriod: number;     // pesty tässä erässä
  toNext: number;       // ikkunaa seuraavaan maksuun
  pct: number;          // edistyminen tässä erässä 0..1
  done: boolean;        // koko keikka pesty
}

/**
 * Jakaa n ikkunaa k maksuerään niin, että aiemmat erät saavat vähemmän
 * (floor ensin, jaettavat ylijäämäikkunat lisätään viimeisiin eriin).
 * Esim. 170 / 4 → [42, 42, 43, 43].
 */
export function computePayProgress(total: number, washed: number, periods: number = PAY_PERIODS): PayProgress {
  const t = Math.max(0, Math.floor(total || 0));
  const w = Math.max(0, Math.min(t || Infinity, Math.floor(washed || 0)));
  const n = Math.max(1, Math.floor(periods || PAY_PERIODS));
  const done = t > 0 && w >= t;

  if (t === 0) {
    return { total: 0, washed: 0, periods: n, perPeriod: 0, currentPeriod: 1, inPeriod: 0, toNext: 0, pct: 0, done: false };
  }

  const base = Math.floor(t / n);
  const remainder = t % n;
  // Period i (0-based) size: base for the first (n - remainder) periods, base+1 for the rest.
  const periodSize = (i: number) => base + (i >= n - remainder ? 1 : 0);

  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    const size = periodSize(i);
    const nextCumulative = cumulative + size;
    if (w < nextCumulative || i === n - 1) {
      const currentPeriod = i + 1;
      const inPeriod = w - cumulative;
      const toNext = Math.max(0, size - inPeriod);
      const pct = size > 0 ? Math.min(1, inPeriod / size) : 0;
      return { total: t, washed: w, periods: n, perPeriod: size, currentPeriod, inPeriod, toNext, pct, done };
    }
    cumulative = nextCumulative;
  }

  // Unreachable, but TS needs a return.
  return { total: t, washed: w, periods: n, perPeriod: base, currentPeriod: n, inPeriod: 0, toNext: 0, pct: 1, done };
}
