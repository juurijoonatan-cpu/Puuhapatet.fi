/**
 * Viitteet: keille olemme pesseet.
 *
 * Pieni ja hiljainen tarkoituksella. Kolme nimeä riittää kertomaan että
 * meillä on yritysasiakkaita; iso logomeri näyttäisi siltä että niitä
 * yritetään paisutella. Tämä on rivi tekstiä, ei referenssigalleria.
 *
 * LOGOT. Rivi toimii ilman kuvatiedostoja: ilman `logo`-kenttää nimi
 * ladotaan tekstinä. Kun logotiedosto tulee, pudota se kansioon
 * `client/public/refs/` ja lisää polku alle — muuta ei tarvita. Näin sivu ei
 * ole rikki sillä välin kun logoja odotellaan, eikä puuttuva tiedosto jätä
 * riviin reikää.
 *
 * LUPA. Asiakkaan nimen tai logon näyttäminen referenssinä on asiakkaan oma
 * päätös, ei meidän. Lisää tähän vain ne, joilta on lupa kysytty.
 */

import { useI18n } from "@/lib/i18n";

type Reference = {
  name: string;
  /** Polku kansiossa client/public. Ilman tätä nimi näytetään tekstinä. */
  logo?: string;
};

const REFERENCES: Reference[] = [
  { name: "FR8" },
  { name: "Stuhi" },
  { name: "YoloCo Coaching" },
];

export function ReferenceStrip() {
  const { t } = useI18n();
  if (REFERENCES.length === 0) return null;

  return (
    <section className="border-y border-border/60 bg-muted/20 py-8" data-testid="reference-strip">
      <div className="container mx-auto px-4 md:px-6">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("refs.title")}
        </p>
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:gap-x-12">
          {REFERENCES.map((ref) => (
            <li key={ref.name}>
              {ref.logo ? (
                <img
                  src={ref.logo}
                  alt={ref.name}
                  loading="lazy"
                  decoding="async"
                  /* Harmaasävy ja vaimennus pitävät rivin taustalla eivätkä
                     anna yhden kirkkaan logon viedä koko osiota. */
                  className="h-7 w-auto opacity-60 grayscale transition-[opacity,filter] duration-300 hover:opacity-100 hover:grayscale-0 md:h-8"
                />
              ) : (
                <span className="text-base font-semibold tracking-tight text-muted-foreground/80 transition-colors duration-300 hover:text-foreground md:text-lg">
                  {ref.name}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-center text-xs text-muted-foreground">{t("refs.note")}</p>
      </div>
    </section>
  );
}
