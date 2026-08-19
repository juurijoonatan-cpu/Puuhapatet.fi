/**
 * Asiakkaan näkymien muotoilupoletit (seuranta, allekirjoitus, lataus).
 *
 * Nämä kolme näkymää ovat sama matka samalle ihmiselle, joten niiden värit,
 * kirjasin ja välistys tulevat yhdestä paikasta. Aiemmin jokainen tiedosto
 * määritteli oman `T`- ja `FONT`-vakionsa, ja ne ehtivät jo erkaantua.
 *
 * TYPOGRAFIA. Onest on ladattu valmiiksi index.html:ssä (400–800), joten sitä
 * ei tarvitse hakea ajonaikaisesti — yksi renderöintiä estävä pyyntö vähemmän
 * asiakkaan puhelimella. Poppins jää varalle: jos Onest ei jostain syystä
 * lataudu, näkymä näyttää täsmälleen entiseltä. Onest on tiiviimpi ja kantaa
 * lihavat leikkaukset paremmin, mikä on koko tämän muotoilun idea: iso luku,
 * paksu leikkaus, paljon ilmaa.
 */

import type { CSSProperties } from "react";

export const CT = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  /** Pehmeä täyttö korteille joissa ei ole reunaviivaa (tilastoruudut). */
  fill: "#F1EFE9",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
  green: "#3E7C59",
  amber: "#E0A800",
  /**
   * MITTARIN RATA — saman sävyn askel, ei harmaa.
   *
   * Dataviz-sääntö: rata on samaa ramppia kuin täyttö, jotta koko asteikko
   * luetaan mittarista eikä vain täytetystä osasta. Harmaa rata lukee "ei
   * mitään" ja mittari kutistuu palkiksi.
   *
   * PEITTÄVÄ HEX EIKÄ LÄPINÄKYVÄ: läpinäkyvän radan lopullinen väri riippuu
   * siitä minkä pinnan päälle mittari sattuu piirtymään, joten sen kontrastia
   * ei voi mitata — ja mitattuna se oli 1,22:1 valkoista korttia vasten, eli
   * mittarin tyhjä osa katosi käytännössä näkyvistä. Tämä askel on **mitattu**:
   * 2,19:1 vs `card` (#FFFFFF), ja ΔL täyttöön (`green`) yli 0,06.
   */
  meterTrack: "#94B7A4",
} as const;

/**
 * TEKNINEN TUMMA VARIANTTI.
 *
 * Sama rakenne, eri pinta. Tarkoitettu asiakkaille joille vaalea paperi on
 * väärä sävy — esim. teknisen yhteisön keikalle, jossa näkymä luetaan samassa
 * seurassa kuin kehitystyökaluja.
 *
 * MIKSI OMA OBJEKTI EIKÄ `CT`:N MUOKKAUS: `CT` on jäätynyt vakio jonka viisi
 * tiedostoa importtaa suoraan. Sen arvojen vaihtaminen muuttaisi käynnissä
 * olevan asiakkaan sivun kesken sopimuksen. Variantti on siis LISÄYS: `CT` on
 * edelleen oletus ja täsmälleen ennallaan, ja tämä valitaan erikseen.
 *
 * Värit: pinta lähes musta, teksti valkoinen, ja YKSI aksentti (vihreä =
 * pesty). Tilavärit ovat samat kuin FR8:n työkaluissa, jotta sama merkitys
 * näyttää samalta koko järjestelmässä.
 *
 * HUOM tilaväreistä: vihreä ja keltainen ovat CVD-erottelultaan rajatapaus
 * (protan ΔE 7,9), joten kumpaakaan ei saa käyttää YKSIN tilan merkkinä —
 * jokaisella merkillä on aina myös teksti. Ks. `Chip`.
 */
export const CT_TECH = {
  ink: "#FFFFFF",
  paper: "#08090A",
  card: "#101215",
  fill: "#16191D",
  hair: "#23272D",
  muted: "#8A929C",
  navy: "#8FB4FF",
  green: "#5FE08A",
  amber: "#FFCE28",
  /**
   * Sama askel tummalla pinnalla. Mitattu: 2,29:1 vs `card` (#101215).
   * Entinen `rgba(95,224,138,0.16)` oli 1,39:1 — rengasmittarin tyhjä osa oli
   * lähes näkymätön, eli asteikko luettiin vain täytetystä kaaresta.
   */
  meterTrack: "#2B583D",
} as const;

/** Asiakasnäkymien teemat. `CT` on oletus; `tech` on tumma tekninen. */
export type CustomerThemeId = "paper" | "tech";
export type CustomerTheme = typeof CT;

export function toCustomerThemeId(v: any): CustomerThemeId | undefined {
  return v === "paper" || v === "tech" ? v : undefined;
}

/** Puuttuva/tuntematon = "paper", eli täsmälleen vanha ulkoasu. */
export function customerTheme(id?: string | null): CustomerTheme {
  return toCustomerThemeId(id) === "tech" ? (CT_TECH as unknown as CustomerTheme) : CT;
}

export function isTechTheme(id?: string | null): boolean {
  return toCustomerThemeId(id) === "tech";
}

export const CFONT =
  "'Onest', 'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Edistymispalkin täyttö: raikas mutta ei neon, toimii vaalealla paperilla. */
export const PROGRESS_GRADIENT = "linear-gradient(90deg, #9BE47F 0%, #5FD9B4 58%, #45D6C0 100%)";
export const PROGRESS_GLOW = "0 6px 22px -6px rgba(69,214,192,0.65)";

/** Pieni yläotsikko: harva, versaali, hiljainen. */
export const eyebrow: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: CT.muted,
};

/**
 * Näyttöluku. Lihava leikkaus ja tiukka kirjainväli — mitä isompi luku, sitä
 * tiukemmalle se halutaan, muuten iso koko hajoaa harakoiksi.
 */
export function display(size: number): CSSProperties {
  return {
    fontSize: size,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: size >= 44 ? "-0.045em" : "-0.03em",
    fontVariantNumeric: "tabular-nums",
    color: CT.ink,
  };
}

/** Valkoinen kortti — sivun perusyksikkö. */
export const cardStyle: CSSProperties = {
  background: CT.card,
  border: `1px solid ${CT.hair}`,
  borderRadius: 20,
  padding: 22,
};

/** Täytetty ruutu ilman reunaa — tilastoille ja tiiviille tiedoille. */
export const tileStyle: CSSProperties = {
  background: CT.fill,
  borderRadius: 16,
  padding: "13px 15px",
  minWidth: 0,
};

/**
 * Teemakohtainen edistymispalkin täyttö. Vaalealla paperilla säilyy entinen
 * gradientti; tummalla käytetään YHTÄ sävyä, koska mittarin täyttö kantaa
 * merkityksen (pesty) eikä sen kuulu olla koriste.
 */
export function progressFill(id?: string | null): string {
  return isTechTheme(id) ? `linear-gradient(90deg, ${CT_TECH.green} 0%, #7CE8A4 100%)` : PROGRESS_GRADIENT;
}

export function progressGlow(id?: string | null): string {
  return isTechTheme(id) ? "0 6px 26px -8px rgba(95,224,138,0.55)" : PROGRESS_GLOW;
}

/**
 * Näyttöluku teemalla.
 *
 * `display()` käyttää `tabular-nums`ia. Se on oikein SARAKKEESSA jossa luvut
 * ladotaan allekkain, mutta väärin isolle yksittäiselle luvulle: tabular antaa
 * jokaiselle numerolle nollan levyisen ruudun, joten "121" näyttää display-koossa
 * löysältä. Näyttöluku käyttää siksi suhteellisia numeroita.
 */
export function displayOn(theme: CustomerTheme, size: number): CSSProperties {
  return {
    fontSize: size,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: size >= 44 ? "-0.045em" : "-0.03em",
    color: theme.ink,
  };
}

export function eyebrowOn(theme: CustomerTheme): CSSProperties {
  return { ...eyebrow, color: theme.muted };
}

export function cardOn(theme: CustomerTheme): CSSProperties {
  return { ...cardStyle, background: theme.card, border: `1px solid ${theme.hair}` };
}

export function tileOn(theme: CustomerTheme): CSSProperties {
  return { ...tileStyle, background: theme.fill };
}
