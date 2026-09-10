/**
 * FR8 — pesijän tunnisteen perussäännöt. LEHTIMODUULI: ei importteja, jotta
 * jokainen laskenta (crew, tasaus, tuntiraha, kartta) voi käyttää samaa sääntöä
 * ilman kehäriippuvuutta.
 */

/**
 * Varattu pesijä-id: "tämän puoliskon teki joku jota ei ole järjestelmässä".
 *
 * Ikkunan voi jakaa 50/50 myös silloin kun toista tekijää ei ole crew-listalla
 * (naapurin apu, kaveri, vielä perustamaton rivi). Ilman tätä vaihtoehtoa jako
 * oli pakko tehdä olemassa olevalle tekijälle — tai jättää tekemättä, jolloin
 * koko ikkuna meni yhdelle ja toisen työ katosi.
 *
 * Tämä id ei koskaan ole crew-rivi eikä koskaan maksulistalla, mutta sen osuus
 * kertyy näkyvään "kohdentamaton työ" -pottiin (`shared/work-attribution.ts`),
 * jotta se voidaan selvittää myöhemmin. Alaviivat estävät törmäyksen oikeaan
 * tekijä-id:hen.
 */
export const UNNAMED_WASHER_ID = "__nimeamaton";
export const UNNAMED_WASHER_NAME = "Nimeämätön tekijä";

export function isUnnamedWasher(id?: string | null): boolean {
  return (id || "").trim() === UNNAMED_WASHER_ID;
}

/** Onko tämä id sellainen jolle voi ylipäätään maksaa (= oikea tekijä)? */
export function isPayableWasherId(id?: string | null): boolean {
  const t = (id || "").trim();
  return !!t && !isUnnamedWasher(t);
}

/**
 * Ikkunan toinen pesijä normalisoituna.
 *
 * Sama henkilö kirjattuna molempiin päihin EI ole jaettu ikkuna. Ilman tätä
 * `crewMemberStats` antoi hänelle 0,5 (koska "toinen pesijä" oli tosi) ja
 * `founderWashCounts` 1,0 (0,5 + 0,5) — sama ikkuna, kaksi eri palkkaa, ja
 * tekijä näki puolet omastaan katoavan. Kirjoituspolut estävät tämän jo, mutta
 * vanha data ei korjaannu itsestään, joten lukupolku normalisoi sen.
 */
export function normalizedSecondWasher(primary?: string | null, second?: string | null): string {
  const p = (primary || "").trim();
  const s = (second || "").trim();
  if (!s || s === p) return "";
  return s;
}
