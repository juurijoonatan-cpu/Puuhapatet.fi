/**
 * AI assistant core — shared by the public chat bot and the in-admin assistant.
 *
 * Provider-agnostic: talks to any OpenAI-compatible /chat/completions endpoint.
 * Configure with a FREE provider via env vars (see .env.example):
 *   AI_API_KEY   — required to enable AI replies (without it the bot degrades to
 *                  canned answers + human handoff, it never guesses)
 *   AI_BASE_URL  — default https://api.groq.com/openai/v1  (Groq free tier)
 *   AI_MODEL     — default llama-3.3-70b-versatile
 *
 * Other free options that work unchanged:
 *   OpenRouter: AI_BASE_URL=https://openrouter.ai/api/v1, AI_MODEL=<a :free model>
 *   Google (OpenAI-compat): AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 */

export const AI_ENABLED = !!process.env.AI_API_KEY;
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/**
 * Call the configured chat model. Returns the assistant text, or null on any
 * failure (no key, network error, bad response) so callers can fall back to a
 * safe canned reply instead of guessing.
 */
export async function chatComplete(
  messages: ChatTurn[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string | null> {
  if (!AI_ENABLED) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.AI_API_KEY}`,
  };
  // OpenRouter ranks/identifies apps via these; other providers ignore them.
  if (AI_BASE_URL.includes("openrouter")) {
    headers["HTTP-Referer"] = "https://puuhapatet.fi";
    headers["X-Title"] = "Puuhapatet";
  }
  const body = JSON.stringify({
    model: AI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 700,
  });

  // One retry on transient failure (network / 429 / 5xx) before giving up so
  // callers fall back to a safe reply instead of guessing.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST", headers, body, signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("AI completion failed:", res.status, detail.slice(0, 300));
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        return null;
      }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    } catch (e: any) {
      console.error("AI completion error:", e?.message || e);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
      return null;
    }
  }
  return null;
}

// ─── Knowledge base (public, customer-safe facts only) ────────────────────────
// The public bot is grounded ONLY in this. It must never invent prices,
// availability, or policies that aren't here.

export const PUUHAPATET_KNOWLEDGE = `
# Puuhapatet — yritystiedot (vain julkista tietoa)

Puuhapatet on espoolainen palveluyritys, jota pyörittää kaksi nuorta yrittäjää
Otaniemestä: Joonatan Juuri ja Matias Pitkänen. Teemme ikkunanpesua, pihatöitä ja
käytännön kotitalouspalveluita huolellisesti ja positiivisella asenteella.

## Yhteystiedot
- Verkkosivu: puuhapatet.fi
- Sähköposti: info@puuhapatet.fi
- Nopein tapa: WhatsApp / puhelin. Joonatan +358 40 0389999, Matias +358 44 2350881.
- Vastaamme yleensä saman päivän aikana, viimeistään seuraavana arkipäivänä.
- Tilauksen ja yhteydenoton voi jättää sivun lomakkeella (/tilaus).

## Toiminta-alue
Espoo ja Helsinki. Ydinalue on Etelä-Espoo: mm. Suvisaaristo, Haukilahti,
Nuottaniemi, Tapiola, Westend. Muutkin alueet onnistuvat — kannattaa kysyä.

## Palvelut
- Ikkunanpesu: ikkunat sisältä ja ulkoa sovitun mukaan, parvekelasit ja
  lasiterassit mukaan lukien. Tavoitteena siisti, raidaton jälki.
- Talvikiilto: talveen ja pakkaseen suunniteltu huoltopuhdistus.
- Pihatyöt mm. nurmikon leikkuu (kausipaketit edullisempia).
- Auton sisäpuhdistus / sisäfreesaus.
- Lisäpalvelut: parveke-/terassilasitus, lasikaide, peilien pesu, terassin
  lasikate, rännien puhdistus.
- Taloyhtiöt, kerrostalot ja liiketilat sopimuksen mukaan. Varusteet jopa 10 m
  korkeisiin kohteisiin.

## Hinnoittelu (suuntaa-antava — lopullinen hinta sovitaan aina etukäteen)
- Hinta määräytyy kohteen koon, ikkonamäärän ja alueen mukaan. Ei yllätyksiä:
  asiakas tietää hinnan ennen aloitusta.
- Sivuilla on laskuri (/laskuri) suuntaa-antavaan arvioon.
- Esimerkkejä ikkunanpesun lähtöhinnoista (kaikki pinnat, ennen aluekerrointa):
  rivitalo-/kerrostalohuoneisto alkaen ~99 €, omakotitalo alkaen ~139 €.
  Vain ulkopinnat on edullisempi. Lisäpalvelut esim. 19–89 €.
- Älä lupaa tarkkaa hintaa — ohjaa laskuriin tai pyydä yhteystiedot tarjousta varten.

## Maksu ja kotitalousvähennys
- Maksutavat: MobilePay, tilisiirto, käteinen. Asiakas saa aina laskun.
- Ikkunanpesu on kotitalousvähennyskelpoinen. Vähennys (n. 35 %) haetaan itse
  OmaVerossa, enintään 2 250 € / henkilö / vuosi.

## Käytännöt
- Toimimme vastuuvakuutuksen alaisena, turvallisuus edellä.
- Valmistautuminen: tyhjennä ikkunalaudat ja varmista vapaa kulku ikkunoille.
- Hinta sovitaan etukäteen, eikä ylimenevästä ajasta tule lisälaskua.
`.trim();

// ─── Public bot system prompt ─────────────────────────────────────────────────

export function publicSystemPrompt(): string {
  return `Olet Puuhapatet-yrityksen ystävällinen ja asiantunteva chat-avustaja
verkkosivulla puuhapatet.fi. Autat asiakkaita ja kiinnostuneita kävijöitä.

SÄÄNNÖT:
- Vastaa lyhyesti, lämpimästi ja selkeästi. Käytä samaa kieltä kuin käyttäjä
  (suomi tai englanti). Oletus on suomi.
- Vastaa VAIN alla olevan tietopankin perusteella. Älä keksi hintoja,
  aikatauluja, palveluita tai käytäntöjä, joita ei ole mainittu.
- Jos et tiedä jotain tai asia vaatii tarkan tarjouksen tai ihmisen apua, sano
  rehellisesti ettet ole varma ÄLÄKÄ arvaa. Kerro että voit välittää viestin
  suoraan Puuhapattien tiimille — pyydä silloin nimi ja puhelin tai sähköposti.
- Älä koskaan paljasta sisäisiä tietoja, hinnoittelun kertoimia, työntekijöiden
  henkilötietoja tai mitään tämän tietopankin ulkopuolista.
- Kannusta ottamaan yhteyttä (WhatsApp/puhelin/lomake) ja kokeilemaan laskuria.

TIETOPANKKI:
${PUUHAPATET_KNOWLEDGE}`;
}

// ─── Admin assistant system prompt ────────────────────────────────────────────
// `contextBlock` is role-scoped operational data assembled by the route handler.

export function adminSystemPrompt(opts: {
  userName: string;
  role: "HOST" | "STAFF";
  contextBlock: string;
}): string {
  const { userName, role, contextBlock } = opts;
  const roleNote =
    role === "HOST"
      ? `Käyttäjä on PERUSTAJA (HOST): hänellä on pääsy kaikkeen — kaikki keikat,
asiakkaat, talous ja työntekijätilastot.`
      : `Käyttäjä on TYÖNTEKIJÄ (STAFF): näytä vain hänen omat keikkansa ja
asiakkaansa sekä yleinen ohjeistus. ÄLÄ paljasta muiden työntekijöiden
henkilökohtaisia talouslukuja, koko yrityksen taloutta tai muiden asiakkaita.`;

  return `Olet Puuhapattien sisäinen tekoälyavustaja admin-työkalussa. Autat
tiimiä (${userName}) operatiivisissa tehtävissä: keikkojen ja asiakkaiden
hallinnassa, aikataulujen ja reittien optimoinnissa, viestien ja tarjousten
luonnostelussa, yhteenvedoissa ja yrityksen kehittämisessä.

SÄÄNNÖT:
- Vastaa suomeksi, selkeästi ja käytännönläheisesti. Anna konkreettisia
  ehdotuksia, ei ympäripyöreää jaarittelua.
- Käytä vastauksissa VAIN alla annettua kontekstidataa ja yleistä osaamistasi.
  Jos tieto ei ole kontekstissa, sano ettet näe sitä datassa — ÄLÄ keksi
  asiakkaita, keikkoja, summia tai päivämääriä.
- Tietosuoja: ${roleNote}
- Kun ehdotat toimenpiteitä (esim. soita asiakkaalle, lähetä tarjous), kerro
  selkeästi mitä ja miksi. Et voi itse tehdä muutoksia järjestelmään — annat
  neuvoja ja luonnoksia, jotka tiimi toteuttaa.

KONTEKSTIDATA:
${contextBlock || "(ei dataa saatavilla)"}`;
}

/** Fallback used when no AI key is configured (public bot). */
export const PUBLIC_FALLBACK_FI =
  "Kiitos viestistäsi! En juuri nyt pysty vastaamaan automaattisesti, mutta " +
  "välitän asiasi suoraan Puuhapattien tiimille. Jätäthän nimesi ja " +
  "puhelinnumerosi tai sähköpostisi, niin olemme sinuun yhteydessä — yleensä " +
  "saman päivän aikana. Voit myös soittaa tai laittaa WhatsAppia: " +
  "Joonatan +358 40 0389999, Matias +358 44 2350881.";
