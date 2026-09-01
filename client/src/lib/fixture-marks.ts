/**
 * Kalustemerkkien muodot — yksi määritelmä kolmelle näkymälle.
 *
 * Sama tähti piirretään tekijän/johtajan kartalle (`FloorView`), dashin
 * riveille (`FixturePanel`) ja asiakkaan karttaan (`CustomerFloorMap`). Muoto
 * on se mikä erottaa lampun ikkunasta ja ovesta — väri kertoo jo tilan — joten
 * sen on oltava kaikissa kolmessa sama piste pisteeltä. Kolmena kopiona ne
 * ehtisivät erkaantua ensimmäisessä hienosäädössä.
 *
 * Väri EI ole täällä: jokainen näkymä tuo sen omalta, mitatulta paletiltaan.
 */

/** Viisisakarainen tähti, CSS clip-pathina — lamppupisteen merkki. */
export const STAR_CLIP =
  "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";
