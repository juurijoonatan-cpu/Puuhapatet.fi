/**
 * FR8 — jaetut ulkoasupoletit (design tokens).
 *
 * MIKSI: FR8:n näkymät on kirjoitettu inline-tyyleillä (tarkoituksella — musta
 * kuori elää shadcn-teeman ulkopuolella), mutta arvot olivat karanneet. Yhdessä
 * tiedostossa oli 14 eri fonttikokoa (9,5 / 10 / 10,5 / 11 / 11,5 / 12 / 12,5 /
 * 13 / 13,5 / 14 / 15 / 16 / 17 / 19 / 21 / 22 / 25 / 26 / 28 / 30 / 34 / 38 /
 * 44 / 52 px), viisi eri korttireunaa ja tusina eri väliä. Silmä lukee sen
 * levottomuutena: mikään ei ole samalla rivillä eikä mikään toistu.
 *
 * Tämä tiedosto on se yksi asteikko. Se EI muuta FR8:n identiteettiä (tumma
 * lasi, mono-otsikot, pyöreät kortit) — se vain vähentää arvojen määrän
 * sellaiseksi, että asiat asettuvat riviin itsestään.
 *
 * Käyttö: `import { T, card, mono, statLabel, money } from "./tokens";`
 */

/** Tyyppiasteikko. Kuusi kokoa riittää koko näkymään. */
export const T = {
  font: "var(--font-onest, system-ui, sans-serif)",
  mono: "var(--font-jetbrains-mono, monospace)",

  /** Fonttikoot px. hero → display-luku, xs → aputeksti. Kahdeksan askelta
   *  korvaa aiemmat 27 erillistä kokoa (mm. kuusi puolikasta pikseliä). */
  size: {
    hero: 40,
    display: 26,
    title: 19,
    /** Tiilen luku puhelimessa, jossa `title` murtuisi kahdelle riville. */
    lg: 16,
    body: 14,
    sm: 12.5,
    xs: 11.5,
    /** Mono-etiketit (VERSAALIT). */
    label: 10,
  },

  /** Väliasteikko px. Kaikki marginit/paddingit/gapit näistä. */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },

  /** Kulmapyöristykset px. */
  radius: {
    /** Edistymispalkit ja pienet merkit. */
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 22,
    pill: 999,
  },

  /** Pinnat — nousevat tasot tummalla lasilla. */
  surface: {
    /** Kortin tausta. */
    card: "rgba(255,255,255,0.035)",
    /** Kortin sisällä oleva tiili. */
    inset: "rgba(255,255,255,0.03)",
    /** Korostettu tiili (esim. lopputulos). */
    raised: "rgba(255,255,255,0.06)",
    /** Syvennys (syöttökenttä). */
    sunken: "rgba(0,0,0,0.28)",
  },

  /** Reunat. Kolme voimakkuutta, ei enempää. */
  border: {
    subtle: "1px solid rgba(255,255,255,0.06)",
    normal: "1px solid rgba(255,255,255,0.09)",
    strong: "1px solid rgba(255,255,255,0.16)",
    /** Osioiden sisäinen erotin. */
    divider: "1px solid rgba(255,255,255,0.07)",
  },

  /** Tekstin sävyt. */
  text: {
    primary: "#fff",
    secondary: "rgba(255,255,255,0.72)",
    muted: "rgba(255,255,255,0.5)",
    faint: "rgba(255,255,255,0.38)",
  },

  /** Merkitysvärit. Samat sävyt kaikkialla FR8:ssa. */
  tone: {
    /** Valmis / rahaa tulossa. */
    good: "#5fe08a",
    goodSoft: "#9ff0bd",
    goodBg: "rgba(95,224,138,0.12)",
    goodBorder: "rgba(95,224,138,0.30)",
    /** Odottaa toimenpidettä. */
    warn: "#ffce28",
    warnBg: "rgba(255,206,40,0.10)",
    warnBorder: "rgba(255,206,40,0.28)",
    /** Virhe / velka. */
    bad: "#ff8a8a",
    badBg: "rgba(224,59,59,0.12)",
    badBorder: "rgba(255,90,90,0.40)",
    /** Ei vielä varmaa (teoreettinen, odottaa hyväksyntää). */
    info: "rgb(150,175,255)",
    infoBg: "rgba(120,150,255,0.07)",
    infoBorder: "rgba(150,175,255,0.28)",
  },
} as const;

/** Kortin peruschrome. Levitä ja lisää tarvittaessa `padding`. */
export const card: React.CSSProperties = {
  background: T.surface.card,
  border: T.border.normal,
  borderRadius: T.radius.xl,
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};

/** Kortin sisäinen tiili (luku + etiketti). */
export const inset: React.CSSProperties = {
  background: T.surface.inset,
  border: T.border.subtle,
  borderRadius: T.radius.md,
  padding: `${T.space.md}px ${T.space.md + 2}px`,
  minWidth: 0,
};

/** Mono-versaalietiketti — osioiden ja tiilien yläotsikko. */
export const mono: React.CSSProperties = {
  fontFamily: T.mono,
  fontSize: T.size.label,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: T.text.faint,
};

/** Tiilen etiketti: mono, katkeaa kolmella pisteellä eikä koskaan kahdelle
 *  riville — juuri se sai statsirivin näyttämään rikkinäiseltä puhelimessa. */
export const statLabel: React.CSSProperties = {
  ...mono,
  marginBottom: T.space.xs + 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/**
 * Rahaluku. `tabular-nums` on pakollinen: ilman sitä allekkaiset summat
 * heiluvat numeron leveyden mukaan eivätkä pilkut ole linjassa.
 */
export function money(size: number = T.size.title, color: string = T.text.primary): React.CSSProperties {
  return {
    fontFamily: T.font,
    fontSize: size,
    fontWeight: 700,
    color,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.01em",
  };
}

/** Aputeksti tiilen alla. */
export const subLabel: React.CSSProperties = {
  margin: `${T.space.xs - 1}px 0 0`,
  fontFamily: T.font,
  fontSize: T.size.xs,
  lineHeight: 1.4,
  color: T.text.muted,
};

/**
 * Nappi. `minHeight: 40` on FR8:n osumakokosääntö (ks. index.css) — se on
 * täällä eksplisiittisesti, jotta nappi on oikean kokoinen myös
 * `[data-fr8-pane]`n ulkopuolella (dialogit).
 */
export function button(variant: "ghost" | "solid" | "accent" | "danger" = "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    padding: `9px ${T.space.md + 2}px`,
    borderRadius: T.radius.sm,
    cursor: "pointer",
    fontFamily: T.font,
    fontSize: T.size.sm,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
  switch (variant) {
    case "solid":
      return { ...base, border: "none", background: "#fff", color: "#0a0a0c", fontWeight: 700 };
    case "accent":
      return { ...base, border: "none", background: T.tone.warn, color: "#000", fontWeight: 700 };
    case "danger":
      return { ...base, border: `1px solid ${T.tone.badBorder}`, background: T.tone.badBg, color: T.tone.bad, fontWeight: 700 };
    default:
      return { ...base, border: T.border.strong, background: "rgba(255,255,255,0.04)", color: T.text.secondary };
  }
}

/** Tekstikenttä tummalla lasilla. */
export const input: React.CSSProperties = {
  minHeight: 40,
  padding: `9px ${T.space.md}px`,
  borderRadius: T.radius.sm,
  border: T.border.strong,
  background: T.surface.sunken,
  color: T.text.primary,
  fontFamily: T.font,
  fontSize: T.size.body,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

/** Pieni tilamerkki (chip). */
export function chip(color: string, bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    padding: "4px 10px",
    borderRadius: T.radius.pill,
    background: bg,
    color,
    fontFamily: T.font,
    fontSize: T.size.xs - 0.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

/** Euromuotoilu sentistä. Yksi paikka, jotta desimaalit ovat aina samat. */
export function eur(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
}

/** Ikkunamäärä: 0,5 näkyy puolikkaana, kokonaisluku ilman desimaalia. */
export function win(n: number): string {
  return n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
}
