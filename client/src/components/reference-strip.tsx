/**
 * Viitteet: keille olemme pesseet.
 *
 * Pieni ja hiljainen tarkoituksella, ja sivun alalaidassa muun sosiaalisen
 * todisteen seassa: arvostelut ja viitteet kuuluvat yhteen, ja kumpikaan ei
 * ole se syy jonka takia kävijä tuli sivulle. Otsikossa lukee "mm.", koska
 * lista ei ole täydellinen eikä sen pidä väittää olevansa.
 *
 * LOGOT ILMAN KOODIMUUTOSTA. Jokainen viite yrittää ladata läpinäkyvän PNG:n
 * polusta `/refs/<slug>.png`. Jos tiedostoa ei ole, `onError` vaihtaa nimen
 * tekstiksi. Logon lisääminen on siis YKSI askel: pudota tiedosto kansioon
 * `client/public/refs/` oikealla nimellä. Koodiin ei tarvitse koskea, eikä
 * puuttuva tiedosto jätä riviin reikää tai rikkinäisen kuvan ikonia.
 *
 * MUSTEEN SÄVY. Läpinäkyvä PNG on vain muste ilman taustaa, joten sen väri
 * ratkaisee näkyykö se. Valkoisella musteella tehty logo katoaa vaaleaan
 * taustaan ja mustalla tehty tummaan. Siksi jokainen viite kertoo `ink`-
 * kentässä millainen se on, ja rivi kääntää sen tarvittaessa.
 *
 * Värillistä logoa EI käännetä koskaan, koska käännetty vihreä on magenta.
 * Se jättää kuitenkin oman ongelmansa: tummanvihreä puu on lähes näkymätön
 * mustaa vasten, ja juuri niin kävi kun tätä testattiin tummassa teemassa.
 * Siksi värillinen tunnus saa tummassa teemassa vaalean alustan. Se on
 * pieni laatta logon takana, ei koko rivin taustaväri, ja se säilyttää
 * oikeat värit myös silloin kun harmaasävy nousee hiiren alla pois.
 *
 * LUPA. Asiakkaan nimen tai logon näyttäminen referenssinä on asiakkaan oma
 * päätös, ei meidän. Lisää tähän vain ne, joilta on lupa kysytty.
 */

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

/** Millä musteella logo on piirretty — ratkaisee käännetäänkö se teemassa. */
type Ink = "dark" | "light" | "color";

type Reference = {
  name: string;
  /** Tiedostonimi ilman päätettä kansiossa client/public/refs/. */
  slug: string;
  ink: Ink;
};

const REFERENCES: Reference[] = [
  // FR8:n tunnus on valkoinen, joten se tarvitsee kääntämisen vaaleassa.
  { name: "FR8", slug: "fr8", ink: "light" },
  { name: "Stuhi", slug: "stuhi", ink: "dark" },
  // YoloCon puu on vihreä. Sitä ei käännetä kummassakaan teemassa.
  { name: "YoloCo Coaching", slug: "yoloco", ink: "color" },
];

/**
 * Tailwindin `invert` ja `dark:invert` on kirjoitettava kokonaisina luokkina,
 * ei koottava merkkijonona: kääntäjä lukee lähdekoodia tekstinä eikä näe
 * ajonaikaista yhdistelyä, jolloin luokka jäisi pois tuotantobundlesta.
 */
const INK_CLASS: Record<Ink, string> = {
  dark: "dark:invert",
  light: "invert dark:invert-0",
  color: "",
};

/** Vaalea laatta värillisen tunnuksen taakse, vain tummassa teemassa. */
const INK_PLATE: Record<Ink, string> = {
  dark: "",
  light: "",
  color: "dark:rounded-md dark:bg-white/90 dark:px-2.5 dark:py-1.5",
};

function ReferenceMark({ reference }: { reference: Reference }) {
  const [noLogo, setNoLogo] = useState(false);

  if (noLogo) {
    return (
      <span className="text-base font-semibold tracking-tight text-muted-foreground/80 transition-colors duration-300 hover:text-foreground md:text-lg">
        {reference.name}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${INK_PLATE[reference.ink]}`}>
      <img
        src={`/refs/${reference.slug}.png`}
        alt={reference.name}
        loading="lazy"
        decoding="async"
        onError={() => setNoLogo(true)}
        /* Harmaasävy ja vaimennus pitävät rivin taustalla eivätkä anna yhden
           kirkkaan logon viedä koko osiota. Hiiren alla logo palaa omakseen. */
        className={`h-7 w-auto opacity-60 grayscale transition-[opacity,filter] duration-300 hover:opacity-100 hover:grayscale-0 md:h-9 ${INK_CLASS[reference.ink]}`}
      />
    </span>
  );
}

export function ReferenceStrip() {
  const { t } = useI18n();
  if (REFERENCES.length === 0) return null;

  return (
    <section className="border-t border-border/60 py-10 md:py-12" data-testid="reference-strip">
      <div className="container mx-auto px-4 md:px-6">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t("refs.title")}
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-16">
          {REFERENCES.map((reference) => (
            <li key={reference.slug}>
              <ReferenceMark reference={reference} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-xs text-muted-foreground">{t("refs.note")}</p>
      </div>
    </section>
  );
}
