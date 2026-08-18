import { useEffect, useState } from "react";
import { withAuth } from "@/lib/api";

/**
 * KUVA BEARER-TOKENIN TAKAA `<img>`-ELEMENTILLE.
 *
 * Adminin API-reitit tunnistautuvat `Authorization: Bearer` -otsakkeella
 * (`client/src/lib/api.ts`), ja API on eri origin kuin sivusto. `<img src>` EI
 * voi lähettää otsaketta, joten suoraan asetettu API-osoite palautti **401** ja
 * selain piirsi rikkinäisen kuvan paikkamerkin — juuri sen "?"-ruudun jonka
 * juuri ladattu pohjakuva näytti kartalla.
 *
 * Vika oli rakenteellinen eikä latauksessa: kuva oli tallessa, mutta sitä ei
 * ollut mahdollista näyttää. Asiakkaan ja tekijän reitit ovat julkisia (token
 * polussa), joten ne toimivat `<img>`-elementissä sellaisenaan eivätkä kulje
 * tästä — vain admin tarvitsee tämän kierron.
 *
 * Kuva haetaan siis fetchillä otsakkeen kanssa ja tarjoillaan object-URLina.
 * Object-URL vapautetaan kun osoite vaihtuu tai komponentti purkautuu, jottei
 * jokainen kerrosvaihto jätä blobia muistiin.
 */
export interface AuthedImage {
  /** Valmis `src`, tai null kun ladataan tai lataus epäonnistui. */
  src: string | null;
  loading: boolean;
  /** Suomenkielinen virhe näytettäväksi, tai null. */
  error: string | null;
}

export function useAuthedImage(url: string | null | undefined): AuthedImage {
  const [state, setState] = useState<AuthedImage>({ src: null, loading: !!url, error: null });

  useEffect(() => {
    if (!url) { setState({ src: null, loading: false, error: null }); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ src: null, loading: true, error: null });

    fetch(url, { headers: withAuth() })
      .then(async (res) => {
        if (!res.ok) {
          // 401 tarkoittaa tässä käytännössä "kirjautuminen on vanhentunut",
          // 404 "kuvaa ei ole" — kumpikin on eri asia kuin rikkinäinen kuva.
          throw new Error(res.status === 401
            ? "Kirjautuminen vanhentunut — kirjaudu uudelleen"
            : res.status === 404 ? "Pohjakuvaa ei löydy" : `Kuvan lataus epäonnistui (${res.status})`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ src: null, loading: false, error: e instanceof Error ? e.message : "Kuvan lataus epäonnistui" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return state;
}
