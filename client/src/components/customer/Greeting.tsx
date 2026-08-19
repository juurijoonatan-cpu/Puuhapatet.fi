/**
 * Aikatietoinen tervehdys asiakkaan seurantanäkymän kärkeen, kirjoituskone-
 * efektillä.
 *
 * MIKSI TÄMÄ ON OLEMASSA: seurantalinkki on se paikka jossa asiakas kohtaa
 * meidät ilman että kukaan on paikalla. Nimellä tervehtiminen kellonajan mukaan
 * on halvin mahdollinen tapa saada näkymä tuntumaan siltä että sen takana on
 * ihmisiä — ja se on ainoa "koriste" tällä sivulla, joten se saa olla sellainen.
 *
 * REHELLISYYS NIMEN KANSSA. Nimi otetaan keikan yhteyshenkilöstä. Jos kenttä on
 * tyhjä tai siinä on sähköposti/numero eikä nimi, tervehditään ilman nimeä —
 * väärä nimi on pahempi kuin ei nimeä. Sukunimeä ei näytetä: tämä on tervehdys,
 * ei osoitekortti.
 *
 * SAAVUTETTAVUUS. Kirjoituskone on animaatio, ei sisältöä: ruudunlukija saa
 * koko lauseen kerralla (`aria-label`), ja kirjain kerrallaan piirtyvä teksti on
 * `aria-hidden`. `prefers-reduced-motion` = koko lause heti, ilman kursoria.
 * `aria-live`iä EI ole: tämä ei ole ilmoitus vaan sivun otsikkorivi, eikä sen
 * kuulu keskeyttää lukijaa joka kerta kun sivu päivittyy itsestään.
 */

import { useEffect, useRef, useState } from "react";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";

/** Kellonaika → tervehdys. Rajat suomalaisen arkikielen mukaan. */
export function greetingWord(d: Date): string {
  const h = d.getHours();
  if (h >= 5 && h < 10) return "Hyvää aamua";
  if (h >= 10 && h < 17) return "Hyvää päivää";
  if (h >= 17 && h < 23) return "Hyvää iltaa";
  return "Hyvää yötä";
}

/**
 * Etunimi yhteyshenkilökentästä, tai null jos kentässä ei ole nimeä.
 *
 * Kenttä on vapaa teksti, joten siinä on käytännössä myös sähköposteja,
 * puhelinnumeroita ja "Akseli Kettunen / hallitus" -tyylisiä merkintöjä.
 * Tervehdys ottaa ensimmäisen sanan vain jos se näyttää nimeltä.
 */
export function firstNameOf(contact: string | null | undefined): string | null {
  const raw = (contact ?? "").trim();
  if (!raw) return null;
  const token = raw.split(/[\s,/|(]+/)[0]?.replace(/[.,:;]+$/, "") ?? "";
  if (token.length < 2 || token.length > 24) return null;
  // Sähköposti, puhelinnumero tai y-tunnus ei ole etunimi.
  if (/[@\d]/.test(token)) return null;
  // Vain kirjaimia (ja väliviiva, esim. "Anna-Maria"). Merkkiluokka on
  // kirjoitettu auki eikä `\p{L}`:llä, koska unicode-ominaisuusluokat vaativat
  // uudemman käännöskohteen kuin tämä projekti käyttää.
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿŠšŽžŒœ][A-Za-zÀ-ÖØ-öø-ÿŠšŽžŒœ-]*$/.test(token)) return null;
  return token[0].toUpperCase() + token.slice(1);
}

export function greetingText(contact: string | null | undefined, now: Date): string {
  const name = firstNameOf(contact);
  return name ? `${greetingWord(now)}, ${name}` : greetingWord(now);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Greeting({
  contact, theme, size = 15,
}: {
  contact: string | null | undefined;
  theme: CustomerTheme;
  size?: number;
}) {
  const full = greetingText(contact, new Date());
  const instant = reducedMotion();
  const [shown, setShown] = useState(() => (instant ? full : ""));
  const [done, setDone] = useState(() => instant);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reducedMotion()) { setShown(full); setDone(true); return; }
    // Uusi lause (kellonaika vaihtui auki olevalla välilehdellä) → kirjoitetaan
    // uudelleen. Riippuvuus on VALMIS LAUSE eikä `data`, joten sivun oma
    // kahden minuutin päivitys ei käynnistä animaatiota uudelleen.
    setShown(""); setDone(false);
    let i = 0;
    const step = () => {
      i += 1;
      setShown(full.slice(0, i));
      if (i >= full.length) { setDone(true); return; }
      // Vaihteleva rytmi: tasainen 45 ms lukee koneelta, pieni vaihtelu
      // ihmiseltä. Pilkun jälkeen pidempi tauko, kuten puheessa.
      const prev = full[i - 1];
      const delay = prev === "," ? 260 : 34 + (i % 3) * 16;
      timer.current = setTimeout(step, delay);
    };
    timer.current = setTimeout(step, 260);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [full]);

  return (
    <>
      {/* Kursorin vilkku asuu komponentissa itsessään, jottei sen käyttö
          edellytä sivulta oikean nimistä keyframea. Sama määrittely kahdesti
          ei ole ongelma. */}
      <style>{"@keyframes ppCaret{0%,49%{opacity:1}50%,100%{opacity:0}}"}</style>
      <p
        aria-label={full}
        style={{
          margin: 0, fontFamily: CFONT, fontSize: size, lineHeight: 1.5,
          color: theme.ink, fontWeight: 700, letterSpacing: "-0.01em",
          // Korkeus varataan heti, jottei kirjoittuva rivi työnnä sivua alas.
          minHeight: Math.round(size * 1.5),
        }}
      >
        <span aria-hidden>
          {shown}
          {!instant && (
            <span
              style={{
                display: "inline-block", width: 2, height: Math.round(size * 0.95),
                marginLeft: 2, verticalAlign: "text-bottom",
                background: theme.green, borderRadius: 1,
                animation: done ? "ppCaret 1.1s steps(1) infinite" : undefined,
              }}
            />
          )}
        </span>
      </p>
    </>
  );
}
