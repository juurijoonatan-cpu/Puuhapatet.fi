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
  perPeriod: number;    // ikkunaa / maksuerä (= ceil(total/periods))
  currentPeriod: number;// monesko erä menossa (1..periods)
  inPeriod: number;     // pesty tässä erässä
  toNext: number;       // ikkunaa seuraavaan maksuun
  pct: number;          // edistyminen tässä erässä 0..1
  done: boolean;        // koko keikka pesty
}

export function computePayProgress(total: number, washed: number, periods: number = PAY_PERIODS): PayProgress {
  const t = Math.max(0, Math.floor(total || 0));
  const w = Math.max(0, Math.min(t || Infinity, Math.floor(washed || 0)));
  const n = Math.max(1, Math.floor(periods || PAY_PERIODS));
  const perPeriod = t > 0 ? Math.ceil(t / n) : 0;
  const done = t > 0 && w >= t;
  // Which instalment we're filling toward (cap at the last one).
  const rawPeriod = perPeriod > 0 ? Math.floor(w / perPeriod) + 1 : 1;
  const currentPeriod = Math.min(n, rawPeriod);
  const inPeriod = perPeriod > 0 ? w - (currentPeriod - 1) * perPeriod : 0;
  const toNext = Math.max(0, perPeriod - inPeriod);
  const pct = perPeriod > 0 ? Math.min(1, inPeriod / perPeriod) : 0;
  return { total: t, washed: w, periods: n, perPeriod, currentPeriod, inPeriod, toNext, pct, done };
}
