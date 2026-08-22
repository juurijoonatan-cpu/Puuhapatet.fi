/**
 * Public live progress view for a custom gig (read-only, shareable link).
 *
 * Muotoilu: vaalea paperi, iso lihava näyttöluku, pehmeät kortit ja paljon
 * ilmaa — asiakkaan näkymä on tarkoituksella koruton koontinäyttö eikä
 * raportti. Ohjeteksti asuu sivun alaosan taittuvassa osiossa, jotta ruudulle
 * jää se mitä asiakas oikeasti tulee katsomaan. Päivittyy itsestään ~2 min
 * välein, vain kun välilehti on näkyvissä.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { api, type GigPublicView } from "@/lib/api";
import { eur } from "@shared/gig";
import { floorLabel } from "@shared/project";
import GigContractSign from "@/components/GigContractSign";
import CustomerFloorMap, { type P2CustomerActions, type ScopeCustomerState } from "@/components/CustomerFloorMap";
import FixturesPanel from "@/components/customer/FixturesPanel";
import CustomerProgressHero, { type HeroTile } from "@/components/CustomerProgressHero";
import LoadingOrb from "@/components/LoadingOrb";
import { downloadGigContract } from "@/lib/gig-contract-doc";
import { customerProgress } from "@/lib/customer-progress";
import { CT, CFONT, eyebrow, customerTheme, isTechTheme, eyebrowOn } from "@/lib/customer-theme";
import TechHero from "@/components/customer/TechHero";
import WorkloadGauge from "@/components/customer/WorkloadGauge";
import Greeting from "@/components/customer/Greeting";

const FONT = CFONT;
/** Oletusteema. Käytössä latausruudulla, jossa keikan teemaa ei vielä tiedetä. */
const T = CT;

/**
 * FR8:n allekirjoitettu Priority 2 -sopimus (PDF), bundlattu staattisena
 * assetina. Näytetään tilausehtojen hyväksynnän yhteydessä.
 *
 * TÄMÄ ON YHDEN ASIAKKAAN SOPIMUS, ei yleinen ehtoliite. Linkki näytettiin
 * ennen jokaisella keikalla jolla keltaiset olivat käytössä, joten toinen
 * asiakas olisi nähnyt FR8 FAFO Oy:n sopimusasiakirjan. Näytetään vain sille
 * keikalle jonka sopimus se on (`isFixedDeal` = FR8:n kiinteä urakka); muilla
 * keikoilla ehdot luetaan keikan omasta `p2.termsText`istä.
 */
const P2_CONTRACT_PDF_URL = "/fr8/priority2-sopimus-2026.pdf";

export default function GigLivePage() {
  const [, params] = useRoute("/seuranta/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<GigPublicView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  // P2 (lisäikkunat): kevyt ehtohyväksyntä ennen ensimmäistä hintatoimintoa.
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsName, setTermsName] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsBusy, setTermsBusy] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  // Sulje ehto-/kutsumodaali Escapella (a11y + tuttu käyttötapa).
  useEffect(() => {
    if (!termsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !termsBusy) setTermsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [termsOpen, termsBusy]);
  // Vaihe 2 -kutsu: kun vaihe avataan, linkki on muuten ennallaan mutta
  // asiakkaalle popuppaa kerran kutsu suunnitella keltaiset ikkunat + hinnat.
  // Kuittaus muistetaan per linkki, ettei se ponnahda joka käynnillä.
  const [p2InviteDismissed, setP2InviteDismissed] = useState(() => {
    try { return localStorage.getItem(`pp.p2invite.${token}`) === "1"; } catch { return true; }
  });
  const dismissP2Invite = () => {
    setP2InviteDismissed(true);
    try { localStorage.setItem(`pp.p2invite.${token}`, "1"); } catch { /* private mode */ }
  };

  /**
   * SOPIMUS POPUPPINA.
   *
   * Kun sopimus tehdään vasta työn alettua (`contractLater`), seuranta on auki
   * koko ajan eikä sopimus estä sitä. Kun sopimus sitten valmistuu, palvelin
   * kertoo sen `signPrompt`illa ja se nousee tähän näkymään dialogina.
   *
   * KUITTAUS MUISTETAAN, MUTTA EI LUKITSE: kehote ponnahtaa kerran, ja sen
   * jälkeen sopimukseen pääsee aina nappirivistä. Kuittaus on sidottu myös
   * sopimustunnukseen, jotta korjattu sopimus nousee kerran uudelleen — ilman
   * sitä yksi "ei nyt" olisi haudannut myös seuraavan version.
   *
   * SAMASTA SYYSTÄ AVAIMESSA ON LIITETYN TIEDOSTON AIKALEIMA: korjattu sopimus
   * vaihdetaan useimmiten liittämällä uusi PDF, EIKÄ sopimustunnus muutu siinä
   * lainkaan. Ilman aikaleimaa yksi "ei nyt" olisi haudannut myös sen version
   * jonka asiakas oikeasti odotti.
   */
  const [contractOpen, setContractOpen] = useState(false);
  const [contractDismissed, setContractDismissed] = useState(false);
  const contractKey = data
    ? `pp.contract.${token}.${data.contractId ?? "-"}.${data.contractFile?.uploadedAt ?? "-"}`
    : null;
  useEffect(() => {
    if (!contractKey) return;
    try { setContractDismissed(localStorage.getItem(contractKey) === "1"); } catch { setContractDismissed(true); }
  }, [contractKey]);
  const dismissContract = () => {
    setContractOpen(false);
    setContractDismissed(true);
    if (contractKey) { try { localStorage.setItem(contractKey, "1"); } catch { /* private mode */ } }
  };
  // Escape sulkee sopimusdialogin samalla tavalla kuin ehtoikkunan.
  useEffect(() => {
    if (!contractOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContractOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contractOpen]);

  // Kirjasin (Onest 400–800) tulee index.html:stä, joten sitä ei haeta täällä
  // ajonaikaisesti — yksi renderöintiä estävä pyyntö vähemmän puhelimella.
  useEffect(() => { document.title = "Puuhapatet — Edistyminen"; }, []);

  const reload = useCallback(async () => {
    const res = await api.getGig(token);
    if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
  }, [token]);

  // Havaintokuva haetaan vasta kun asiakas avaa kuplan. Tämä sivu pollaa
  // itseään, joten kuvat eivät saa olla mukana joka kierroksella.
  const loadObservationImage = useCallback(async (key: string) => {
    const res = await api.gigObservationImage(token, key);
    return res.ok ? res.data?.imageDataUrl : undefined;
  }, [token]);

  /**
   * Asiakkaan seurantanäkymän päivitys.
   *
   * Tämä oli `setInterval(load, 30_000)` ilman mitään ehtoa: jokainen auki
   * jätetty seurantavälilehti haki koko keikan tilan — karttablobin
   * havaintokuvineen ja allekirjoituksineen — kaksi kertaa minuutissa,
   * loputtomiin, myös taustalla ja yön yli. Yksi unohtunut välilehti riitti
   * polttamaan tietokannan siirtokiintiön.
   *
   * Nyt: 2 min välein, vain kun välilehti on näkyvissä, ja heti kun se
   * palaa näkyviin (silloin luku on tuore juuri kun sitä katsotaan).
   */
  useEffect(() => {
    if (!token) return;
    let active = true;
    let iv: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      const res = await api.getGig(token);
      if (!active) return;
      if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
      else setStatus((s) => (s === "ok" ? "ok" : "error"));
    };

    const start = () => {
      if (iv) return;
      iv = setInterval(() => { if (!document.hidden) void load(); }, 120_000);
    };
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      void load();
      start();
    };

    void load();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  // Kokonaisedistyminen lasketaan kartasta (kaikki pisteet, hylätyt keltaiset
  // pois) — sama funktio jota kartta itse käyttää, jotta luvut eivät voi olla
  // eri mieltä. useMemo on tässä, ennen varhaisia paluita, jotta hook-järjestys
  // pysyy samana joka renderillä.
  const mapProgress = useMemo(() => customerProgress(data?.map, data?.p2, data?.scope), [data]);

  if (status === "loading") return <LoadingOrb label="Ladataan seurantaa" theme="light" />;
  if (status === "error" || !data) return <Centered>Seurantaa ei löytynyt.</Centered>;

  // The intro is the signing: gate the live view until the contract is signed.
  if (data.requireSignature && !data.signed) {
    return <GigContractSign token={token} view={data} onSigned={reload} />;
  }

  /**
   * KEIKAN TEEMA.
   *
   * Tämä varjostaa tarkoituksella moduulitason `T`:n: koko näkymä on kirjoitettu
   * `T.x`-viittauksilla, joten yksi sijoitus teemaa koko sivun eikä sadan rivin
   * inline-tyylejä tarvitse koskea. Puuttuva teema = `CT` = täsmälleen entinen
   * vaalea ulkoasu, joten elävän sopimusasiakkaan sivu ei muutu.
   */
  const T = customerTheme(data.theme);
  /** Pelkkä viiva tarkoittaa "ei sopimustunnusta", ei tunnusta nimeltä "-". */
  const contractNo = (() => {
    const t = (data.contractId ?? "").trim();
    return !t || t === "-" || t === "–" || t === "—" ? null : t;
  })();
  const tech = isTechTheme(data.theme);

  const t = data.totals;
  // Customer view shows ACTUAL work progress (washed windows / scope), never euros.
  // This is the real, honest progress — and it matches the team dashboard's
  // window-based figure, so the two views never disagree. (Previously the
  // customer % was derived from invoices sent, which drifted from real work.)
  const sectorsWashed = data.sectors.reduce((s, x) => s + x.washed, 0);
  const sectorsTotal = data.sectors.reduce((s, x) => s + x.total, 0);
  // SOPIMUKSEN edistyminen: vain sovittu työ (Priority 1). Tämä ohjaa
  // laskutuseriä, joten se ei saa liikkua lisätöiden mukana.
  const contractPct = sectorsTotal > 0
    ? Math.round((sectorsWashed / sectorsTotal) * 100)
    : Math.round(t.percentByCap * 100);
  // KOKONAISEDISTYMINEN: mitä asiakas näkee isona lukuna. Kartta on tarkempi
  // (se tuntee myös lisätyöikkunat), joten sitä käytetään aina kun se on
  // olemassa; ilman karttaa palataan sopimuksen lukuun.
  const hasMapProgress = mapProgress.total > 0;
  const pct = hasMapProgress ? mapProgress.pct : contractPct;
  // LASKUTUS. Tämä luki ennen työn edistymisestä johdettuna ("työ on 100 %,
  // siis 4/4 erää") — ja se väitti asiakkaalle neljää lähetettyä laskua vaikka
  // yhtäkään ei olisi lähetetty.
  //
  // Nimittäjä on nyt poissa kokonaan. "4 / 4" luetaan niin että kaikki on
  // laskutettu ja urakka kuitattu loppuun, ja se on eri väite kuin mitä luku
  // tietää: montako laskua on lähetetty tähän mennessä. Juokseva määrä ei voi
  // luvata mitään sellaista.
  const INSTALMENTS = 4;
  const invoicesSent = data.paymentsCount;
  /**
   * TYÖMÄÄRÄMITTARIN IKKUNAMÄÄRÄ.
   *
   * Sama joukko jonka pääkortti näyttää: kartta jos se on olemassa, muuten
   * sopimuksen sektorit. Palvelin lähettää vain kertoimen (h/ikkuna) juuri
   * tästä syystä — jos se laskisi kokonaistunnit omasta ikkunajoukostaan,
   * mittari ja edistymisluku voisivat olla eri mieltä samasta keikasta.
   */
  const gaugeTotal = hasMapProgress ? mapProgress.total : sectorsTotal;
  const gaugeDone = hasMapProgress ? mapProgress.done : sectorsWashed;
  const showWorkload = !!data.estHoursPerWindow && gaugeTotal > 0;
  const updated = new Date(data.updatedAt).toLocaleString("fi-FI", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // ── P2 (lisäikkunat): asiakkaan neuvottelutoiminnot ─────────────────────────
  const p2 = data.p2;
  const p2Live = !!p2?.enabled;
  const p2Actions: P2CustomerActions = {
    accept: async (items) => {
      const res = await api.p2Accept(token, items);
      await reload();
      if (!res.ok) return res.error ?? "Hyväksyntä epäonnistui — yritä uudelleen";
      // Kentät luetaan varovasti: tämä on asiakkaan rahapolku, ja odottamaton
      // vastausmuoto (vanha palvelin, välityspalvelimen virhesivu) kaatoi koko
      // sivun juuri hyväksynnän hetkellä. Tuntematon vastaus = ei virhettä
      // näytettäväksi, ja `reload` yllä kertoo oikean tilan joka tapauksessa.
      const conflicts = res.data?.conflicts ?? [];
      const locked = res.data?.locked ?? [];
      if (conflicts.length > 0 && locked.length === 0) {
        return conflicts[0]?.error ?? "Hinta ehti muuttua — päivitä näkymä";
      }
      return null;
    },
    counter: async (key, counterCents, version) => {
      const res = await api.p2Counter(token, key, counterCents, version);
      await reload();
      return res.ok ? null : (res.error ?? "Vastatarjous epäonnistui — yritä uudelleen");
    },
    decline: async (key, version) => {
      const res = await api.p2Decline(token, key, version);
      await reload();
      return res.ok ? null : (res.error ?? "Toiminto epäonnistui — yritä uudelleen");
    },
    addPoint: async (floor, x, y) => {
      const res = await api.p2AddPoint(token, floor, x, y);
      await reload();
      // Avain palautetaan kutsujalle: kartta merkitsee juuri lisätyn pisteen
      // kirkkaaksi ja avaa sille toivelomakkeen.
      if (!res.ok || !res.data?.key) return { error: res.error ?? "Ikkunan lisäys epäonnistui — yritä uudelleen" };
      return { key: res.data.key };
    },
    setWish: async (key, cents, note) => {
      const res = await api.p2SetWish(token, key, cents, note);
      await reload();
      return res.ok ? null : (res.error ?? "Tallennus epäonnistui — yritä uudelleen");
    },
    removePoint: async (key) => {
      const res = await api.p2RemovePoint(token, key);
      await reload();
      return res.ok ? null : (res.error ?? "Poisto epäonnistui — yritä uudelleen");
    },
    requireTerms: () => { setTermsError(null); setTermsOpen(true); },
  };

  /**
   * LAAJUUSKYSELY — yhteisökeikan "pestäänkö tämä" per keltainen ikkuna.
   *
   * Tämä ei ole P2:n variantti: vastikkeettomalla keikalla ei ole hintaa
   * hyväksyttäväksi, joten kysymys on eri ("pestäänkö tämä", ei "kelpaako tämä
   * hinta") eikä siihen kuulu ehtoja, versioita tai lukituksia.
   *
   * Palvelin päättää onko kysely käytössä (`scope !== null`), joten tässä ei
   * toisteta ehtoa yhteisökeikasta — yksi paikka jossa se ratkaistaan.
   */
  /**
   * Hintaehdotuksen tallennus. Palvelin palauttaa tuoreen kalustetilanteen,
   * joka kirjoitetaan suoraan näkymään — niin asiakas näkee oman ehdotuksensa
   * ja sen summan ilman että koko sivu haetaan uudestaan.
   */
  const saveFixtureQuote = async (body: { bulbPriceCents?: number; switchPriceCents?: number; note?: string }) => {
    const res = await api.gigSetFixtureQuote(token, body);
    if (res.ok && res.data) {
      setData((cur) => (cur ? { ...cur, fixtures: res.data!.fixtures } : cur));
      return null;
    }
    return res.error || "Tallennus ei onnistunut. Yritä hetken kuluttua uudelleen.";
  };

  const scopeState: ScopeCustomerState | null = data.scope ? {
    votes: data.scope.votes,
    vote: async (key, answer) => {
      const res = await api.gigScopeVote(token, key, answer);
      await reload();
      return res.ok ? null : (res.error ?? "Tallennus epäonnistui — yritä uudelleen");
    },
  } : null;

  const acceptTerms = async () => {
    const name = termsName.trim();
    if (!name) { setTermsError("Kirjoita nimesi (nimenselvennys)."); return; }
    if (!termsChecked) { setTermsError("Vahvista, että olet lukenut ja hyväksyt tilausehdot."); return; }
    setTermsBusy(true); setTermsError(null);
    const res = await api.p2AcceptTerms(token, name);
    setTermsBusy(false);
    if (!res.ok) { setTermsError(res.error ?? "Hyväksyntä epäonnistui — yritä uudelleen"); return; }
    setTermsOpen(false);
    await reload();
  };

  // Pääkortin ruudut. Vain ne joilla on jotain sanottavaa — tyhjää ruutua ei
  // piirretä, jolloin yhden keikan näkymä voi olla pelkkä luku ja palkki.
  const zone = data.map?.activeZone ?? null;
  const heroTiles: HeroTile[] = [];
  if (p2Live && p2!.billing.proposedCount > 0) {
    heroTiles.push({ label: "Odottaa sinua", value: `${p2!.billing.proposedCount} ikkunaa`, tone: "amber" });
  }
  // "Kertynyt" on nimensä mukaisesti kertynyt: vain ne lisätyöikkunat jotka on
  // sekä pesty ETTÄ hinnaltaan sovittu. Sovittu kokonaissumma (myös vielä
  // pesemättömät) näkyy omana lukunaan Priority 2 -kortissa.
  // Euromäärä ei kuulu yhteisökeikan näkymään missään muodossa.
  if (p2Live && !data.isCommunity && mapProgress.p2AccruedCents > 0) {
    heroTiles.push({ label: "Kertynyt", value: eur(mapProgress.p2AccruedCents), tone: "green" });
  }
  if (zone) {
    heroTiles.push({ label: "Työn alla", value: floorLabel(data.map?.building as any, zone.floor), tone: "green" });
  }
  if (data.isFixedDeal && invoicesSent > 0) {
    heroTiles.push({ label: "Laskuja lähetetty", value: `${invoicesSent} kpl` });
  }
  /**
   * LAAJUUSKYSELY pääkortissa. Oma ruutu eikä pääkortin "Odottaa" -rivi, koska
   * se rivi lukee "odottaa hyväksyntääsi" — hinnan hyväksyntää. Tässä odotetaan
   * vastausta kysymykseen pestäänkö ikkuna, mikä on eri asia, ja väärä etiketti
   * on tällä sivulla pahempi kuin yksi ruutu enemmän.
   */
  if (mapProgress.scopeOpen > 0) {
    heroTiles.push({ label: "Odottaa vastaustasi", value: `${mapProgress.scopeOpen} ikkunaa`, tone: "amber" });
  }
  if (mapProgress.scopeYes > 0) {
    heroTiles.push({ label: "Lisätty työhön", value: `${mapProgress.scopeYes} ikkunaa`, tone: "green" });
  }

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "calc(34px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(56px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left))" }}>
      <style>{`@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <div style={{ maxWidth: 660, margin: "0 auto" }}>

        {/* Header. Nimi ja LIVE ylärivillä, tunnistetiedot ja tilamerkki
            alarivillä samassa virrassa — kapealla puhelimella merkki kiertyy
            omalle rivilleen sen sijaan että puskisi yrityksen nimen rikki. */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: "-0.035em" }}>Puuhapatet</p>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.08em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#3E7C59", animation: "ppPulse 1.8s ease-in-out infinite" }} />
              LIVE
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px 12px", flexWrap: "wrap", marginTop: 7 }}>
            <span style={{ fontSize: 13.5, color: T.muted, overflowWrap: "anywhere" }}>
              {contractNo ? `${contractNo} · ` : ""}{data.companyName}
            </span>
            {data.approved
              ? <StatusBadge color="#1F3B57" label={`Hyväksytty${data.approvedAt ? " " + fmtDate(data.approvedAt) : ""}`} />
              : data.signed
                ? <StatusBadge color="#3E7C59" label={`Allekirjoitettu${data.signedAt ? " " + fmtDate(data.signedAt) : ""}`} />
                : data.signPrompt
                  // Rehellinen tila: työ on käynnissä ja sopimus odottaa. Ei
                  // valeväitettä allekirjoituksesta, ei tyhjää kohtaa.
                  ? <StatusBadge color="#E0A800" label="Sopimus allekirjoitettavana" icon="dot" />
                  // Valittiin "allekirjoitetaan myöhemmin": sopimusta ei ole
                  // vielä olemassa, ja se pitää lukea näkymästä. Ilman tätä
                  // kohta oli tyhjä ja sivu vaikutti sopimuksettomalta.
                  : data.contractPending
                    ? <StatusBadge color={T.navy} label="Sopimus valmistelussa" icon="dot" />
                    : null}
          </div>
          {/* TERVEHDYS. Kellonajan mukaan ja nimellä, kirjoituskoneena — tämä on
              se yksi kohta jossa näkymä saa tuntua ihmisen tekemältä. Nimi tulee
              keikan yhteyshenkilöstä; ilman nimeä tervehditään ilman nimeä eikä
              keksitä mitään. */}
          <div style={{ marginTop: 13 }}>
            <Greeting contact={data.company?.contact} theme={T} />
          </div>
        </div>

        {/* PÄÄKORTTI. Yksi luku, yksi palkki, muutama ruutu. Ei euroja
            urakkahinnasta — sovittu hinta asuu allekirjoitetussa sopimuksessa.
            Kaikki selittävä teksti on siirretty sivun alaosan taittuvaan
            osioon, jotta tämä näkymä on koontinäyttö eikä saate. */}
        {/* Kaksi ulkoasua, sama tieto. Tekninen variantti on oma komponenttinsa
            eikä lippu vanhassa: vaalea on käytössä elävällä sopimusasiakkaalla,
            eikä sitä haluta testata uudelleen joka kerta kun tummaa muutetaan. */}
        {(() => {
          const heroProps = {
            pct,
            done: hasMapProgress ? mapProgress.done : undefined,
            total: hasMapProgress ? mapProgress.total : undefined,
            awaiting: mapProgress.awaiting,
            chip: (
              p2Live ? { text: "Priority 2", tone: "amber" as const }
              : pct >= 100 ? { text: "Valmis", tone: "green" as const }
              : null
            ),
            note: p2Live && contractPct >= 100
              ? "Priority 1 -urakka on valmis. Nyt suunnitellaan Priority 2 -ikkunat alla."
              : undefined,
            tiles: heroTiles,
          };
          return tech
            ? <TechHero theme={T} {...heroProps} />
            : <CustomerProgressHero {...heroProps} />;
        })()}

        {/* SOPIMUS ON TULOSSA.
            Kun keikka on aloitettu valinnalla "allekirjoitetaan myöhemmin",
            asiakas saa tämän linkin ennen sopimusta. Ilman tätä huomautusta
            sivulla ei ole sopimuksesta mitään merkkiä, ja se lukee kuin
            sopimusta ei olisi tarkoitus tehdä lainkaan. Tämä on näkyvillä
            ilman että mitään tarvitsee avata — se on lupaus, ei ohje. */}
        {data.contractPending && (
          <Notice theme={T} tone={T.navy} lead="Sopimus valmistelussa.">
            Turvallisuus- ja sopimusehdot toimitetaan tähän näkymään lähipäivinä.
            Saat siitä kehotteen tälle sivulle, ja voit allekirjoittaa sen suoraan tästä.
            Työtä tehdään siihen asti sovitussa laajuudessa.
          </Notice>
        )}

        {/* LAAJUUSKYSELY — kutsu vastaamaan.
            Kartalla oleva keltainen merkki on helppo lukea koristeeksi, joten
            kysymys sanotaan myös tekstinä ja lukuna. Näkyy vain kun jotain
            oikeasti odottaa vastausta. */}
        {mapProgress.scopeOpen > 0 && (
          <Notice theme={T} tone={T.amber} lead={`${mapProgress.scopeOpen} ikkunaa odottaa vastaustasi.`}>
            Kartalla keltaisella merkityistä ikkunoista ei ole vielä sovittu. Napauta
            ikkunaa ja kerro pestäänkö se — vastaus ei sido mihinkään, ja voit muuttaa
            sen milloin tahansa.
          </Notice>
        )}

        {/* TYÖMÄÄRÄN ARVIO.
            Oma mittari, koska se vastaa eri kysymykseen kuin pääkortti:
            pääkortti kertoo kuinka pitkällä työ on, tämä kertoo paljonko työtä
            on — tunneissa. Siksi tässä mittarissa ei ole prosenttilukua.
            Piirretään vain jos keikalle on annettu mitoitus (h/ikkuna) ja
            ikkunoita on; ilman arviota lukua ei keksitä. */}
        {showWorkload && (
          <Panel theme={T}>
            {/* Pelkkä yläotsikko. Ikkunamäärä ja mitoitus lukevat mittarin omassa
                luentataulukossa, joten niiden toistaminen tässä oli sama tieto
                kahdesti kahden sentin päässä toisistaan. */}
            <p style={{ margin: "0 0 16px", ...eyebrowOn(T) }}>Työmäärä · arvio</p>
            <WorkloadGauge
              theme={T}
              hoursPerWindow={data.estHoursPerWindow!}
              totalWindows={gaugeTotal}
              doneWindows={gaugeDone}
            />
            <p style={{ margin: "16px 0 0", fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
              Arvio työmäärästä keikan mitoituksen mukaan — ei sitova aikataulu. Isot
              monilohkoiset ikkunat viedään yksi kerrallaan, ja mittari liikkuu sitä mukaa
              kun ikkunoita merkitään pestyiksi.
            </p>
          </Panel>
        )}

        {/*
          * Sektorien eurokortit.
          *
          * Piilossa kiinteähintaisella urakalla (yksi kokonaishinta, ei
          * sektorikohtaista laskutusta) JA yhteisökeikalla. Jälkimmäinen oli
          * ennen pahin oletus koko sivulla: ehto oli pelkkä `!isFixedDeal`, joten
          * juuri vastikkeeton keikka sai eurokortit — "0,00 € / 525,00 €"
          * asiakkaalle joka ei maksa mitään.
          *
          * HUOM AALTOSULKEET: ilman niitä tämä ei ole kommentti vaan JSX:n
          * LAPSI, ja React piirsi koko tekstin asiakkaan sivulle sellaisenaan.
          * Asiakas luki sivultaan "juuri vastikkeeton keikka sai eurokortit".
          */}
        {!data.isFixedDeal && !data.isCommunity && data.sectors.map((s) => {
          const accrued = s.washed * s.unitPriceCents;
          const cap = s.total * s.unitPriceCents;
          const credit = s.skipped * s.unitPriceCents;
          const sp = s.total > 0 ? Math.round((s.washed / s.total) * 100) : 0;
          return (
            <Panel key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: s.color, display: "inline-block" }} />
                  {s.name}
                </span>
                <span style={{ fontSize: 14, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                  {eur(accrued)} <span style={{ opacity: 0.6 }}>/ {eur(cap)}</span>
                </span>
              </div>
              <div style={{ height: 8, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${sp}%`, background: s.color }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <span>Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{sp} %</strong></span>
                {s.skipped > 0 && (
                  <span style={{ color: T.muted, fontSize: 13 }}>Kuntovaraus {s.skipped} kpl · hyvitys −{eur(credit)}</span>
                )}
              </div>
            </Panel>
          );
        })}

        {/* Priority 2 -vaihe: kasvava sovittu summa + avoimet hintaehdotukset */}
        {p2Live && (
          <Panel theme={T}>
            {/* Accent header makes phase 2 read as the current main focus */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "4px 10px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} />
                PRIORITY 2
              </span>
              {/* Hyväksynnän koko kirjaus (nimi + aikaleima) näkyy ehtodialogissa
                  yhden napautuksen päässä — tässä riittää tieto että ehdot ovat
                  kunnossa, jottei kortin yläreuna täyty tekstillä. */}
              {p2!.termsAccepted && (
                <button
                  onClick={() => { setTermsError(null); setTermsOpen(true); }}
                  title={`Ehdot hyväksytty${p2!.termsAcceptorName ? ` · ${p2!.termsAcceptorName}` : ""}${p2!.termsAcceptedAt ? ` · ${fmtDate(p2!.termsAcceptedAt)}` : ""}`}
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#3E7C59", background: "rgba(62,124,89,0.1)", border: "1px solid rgba(62,124,89,0.3)", borderRadius: 999, padding: "4px 11px", fontFamily: FONT, cursor: "pointer" }}
                >
                  ✓ Ehdot hyväksytty
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <span style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.035em", fontVariantNumeric: "tabular-nums" }}>
                {eur(p2!.billing.lockedSumCents)}
              </span>
              <span style={{ fontSize: 13, color: T.muted }}>
                sovittu · {p2!.billing.lockedCount} ikkunaa
              </span>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
              Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{p2!.billing.lockedWashedCount} / {p2!.billing.lockedCount}</strong> sovituista.
              {p2!.billing.proposedCount > 0 && (
                <> <strong style={{ color: T.navy }}>{p2!.billing.proposedCount} hintaehdotusta odottaa sinua</strong> alla.</>
              )}
            </p>
            {!p2!.termsAccepted && (
              <button
                onClick={() => { setTermsError(null); setTermsOpen(true); }}
                style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Hyväksy tilausehdot ja aloita
              </button>
            )}
          </Panel>
        )}

        {/* Read-only floor-plan map — customer watches washed windows live. */}
        {data.map && (
          <Panel theme={T}>
            <p style={{ margin: "0 0 14px", ...label }}>Pohjapiirros</p>
            <CustomerFloorMap map={data.map} p2={p2} p2Actions={p2Live ? p2Actions : undefined} scope={scopeState} onLoadObservationImage={loadObservationImage} planUrlBase={api.planUrlBaseForGig(token)} theme={T} fixedDeal={data.isFixedDeal} />
          </Panel>
        )}

        {/* LAMPUT JA OVET — kalustetilanne, ostettava määrä ja asiakkaan oma
            hintaehdotus. Kartan JÄLKEEN: kartta kertoo missä, tämä kertoo
            paljonko. Osio puuttuu kokonaan kun keikalla ei ole kalusteita. */}
        {data.fixtures && (data.fixtures.lamps.total > 0 || data.fixtures.doors.total > 0) && (
          <Panel theme={T}>
            <p style={{ margin: "0 0 14px", ...label }}>Lamput ja ovet</p>
            <FixturesPanel
              fixtures={data.fixtures}
              theme={T}
              floorLabel={(f) => floorLabel(data.map?.building as any, f)}
              onSaveQuote={saveFixtureQuote}
            />
          </Panel>
        )}

        {/* TIEDOTTEET JA OHJEET — kaikki selittävä teksti yhdessä taittuvassa
            osiossa. Se on luettavissa kun sitä tarvitsee, muttei joka kerta
            ensimmäisenä ruudulla. Yhteydenotto jää näkyviin, koska se on
            toiminto eikä selitys. */}
        <Panel theme={T}>
          <details>
            <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
              <span aria-hidden style={{ color: T.muted, fontSize: 12 }}>▸</span>
              Tiedotteet ja ohjeet
            </summary>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, lineHeight: 1.7, color: T.ink }}>
              {data.description && <p style={{ margin: 0 }}>{data.description}</p>}
              <p style={{ margin: 0 }}>
                {data.customerNote || (data.isCommunity
                  ? "Tämä on yhteisökeikka: teemme työn veloituksetta, joten näkymässä ei ole hintoja eikä laskuja — vain työn tilanne. Voit seurata edistymistä reaaliaikaisesti."
                  : "Tälle sopimukselle on sovittu kiinteä kokonaishinta, ja työ tehdään sopimuksen mukaisten ehtojen mukaisesti. Voit seurata edistymistä reaaliaikaisesti tästä näkymästä.")}
              </p>
              {data.map && (
                <p style={{ margin: 0, color: T.muted }}>
                  {/* KELTAINEN = "EI VIELÄ PÄÄTETTY", EI "EI KUULU MEILLE".
                      Vanha teksti sanoi että keltaiset "eivät kuulu tähän
                      sopimukseen", mikä on FR8:n kiinteän urakan totuus mutta
                      väärä muualla: keltainen tarkoittaa ikkunaa jonka
                      pesemisestä ei ole vielä varmuutta. Sopimuksettomalla
                      keikalla lause oli suorastaan absurdi — se viittasi
                      sopimukseen jota ei ole. */}
                  {p2Live
                    ? "Kartalla keltaisella merkityt ovat Priority 2 -ikkunoita: jokainen hinnoitellaan ikkunakohtaisesti. Vastaa ehdotuksiin listasta tai napauta ikkunaa kartalta."
                    : data.scope
                      ? "Kartalla keltaisella merkityt ikkunat ovat niitä, joiden pesemisestä ei ole vielä sovittu. Napauta ikkunaa ja kerro pestäänkö se: vastauksesi ohjaa työtä, se ei sido sinua mihinkään, ja voit muuttaa sen milloin tahansa. Hyväksymäsi ikkunat tulevat mukaan työn laajuuteen ja aika-arvioon."
                      : data.isFixedDeal
                      ? "Kartalla keltaisella merkityt ikkunat eivät kuulu tähän sopimukseen — niiden tilanne katsotaan seuraavassa sopimuksessa."
                      : "Kartalla keltaisella merkityt ikkunat ovat Priority 2: niiden pesemisestä ei ole vielä sovittu. Ne eivät ole poissa laskuista — katsomme ne yhdessä kun ensimmäinen kierros on tehty."}
                </p>
              )}
              {p2Live && (
                <p style={{ margin: 0, color: T.muted }}>
                  Toisin kuin Priority 1 -urakan kiinteä hinta, Priority 2 -ikkunat hinnoitellaan
                  ikkunakohtaisesti: hyväksyt jokaisen hinnan erikseen (tai teet vastatarjouksen), ja
                  summa kasvaa vain hyväksymistäsi ikkunoista. Voit myös lisätä uusia ikkunoita kartalla.
                </p>
              )}
              {data.isFixedDeal && (
                <p style={{ margin: 0, color: T.muted }}>
                  Sopimus laskutetaan {INSTALMENTS} yhtä suuressa erässä työn edetessä.
                  “Laskuja lähetetty” kertoo, montako laskua olemme tähän mennessä lähettäneet.
                </p>
              )}
              {data.contractPending && (
                <p style={{ margin: 0, color: T.muted }}>
                  Sopimusasiakirja (työn laajuus, turvallisuus ja ehdot) on valmistelussa ja
                  toimitetaan tähän näkymään allekirjoitettavaksi. Se ei estä työn aloittamista:
                  laajuus on sovittu erikseen, ja sopimus kirjaa sen.
                </p>
              )}
              <p style={{ margin: 0, color: T.muted }}>
                Jos rakennuksessa on jotain työhön vaikuttavaa (kulku, hälytykset, telineet tai muu
                huomio), laita meille viestiä — vastaamme nopeasti. Ilmoitamme myös itse tästä
                näkymästä, jos jotain huomioitavaa tulee.
              </p>
              {data.vatNote && <p style={{ margin: 0, fontSize: 12, color: T.muted }}>{data.vatNote}</p>}
            </div>
          </details>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <a
              href="https://wa.me/358400389999"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 17px", borderRadius: 12, border: "none", background: "#25D366", color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
            >
              💬 Laita viesti
            </a>
          {data.signature && (
            <button
              type="button"
              onClick={() => downloadGigContract({
                contractId: data.contractId,
                companyName: data.companyName,
                description: data.description,
                vatNote: data.vatNote,
                customerNote: data.customerNote,
                contractText: data.contractText,
                sectors: data.sectors,
                capCents: data.totals.capCents,
                signature: {
                  signerName: data.signature!.signerName,
                  place: data.signature!.place ?? undefined,
                  signedAt: data.signature!.signedAt,
                  customer: data.signature!.customer,
                  signatureDataUrl: data.signature!.signatureDataUrl,
                },
                approvedAt: data.approvedAt,
              })}
              style={{ padding: "11px 17px", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.fill, color: T.ink, fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              {/* NIMI RIIPPUU SIITÄ MITÄ MUUTA ON SAATAVILLA. Tämä tiedosto
                  kootaan keikan tiedoista ja se kantaa allekirjoituksen. Kun
                  sopimus on liitetty PDF:nä, PDF on se sopimus — ja kaksi
                  nappia nimeltä "sopimus" olisi kaksi eri asiakirjaa samalla
                  nimellä. */}
              {data.contractFile ? "Lataa allekirjoitustodistus" : "Lataa urakkasopimus"}
            </button>
          )}
          {/* ALLEKIRJOITETTU SOPIMUS PYSYY SAATAVILLA.
              Asiakas allekirjoitti tämän tiedoston, joten hänen on saatava se
              itselleen myös jälkikäteen — ei vain siinä yhdessä näkymässä joka
              sulkeutui allekirjoituksen jälkeen. Lataus kulkee palvelimen kautta
              (`dl=1`), joka kertoo tiedostonimen. */}
          {data.signature && data.contractFile && (
            <a
              href={api.contractFileUrlForGig(token, { download: true })}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 17px", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.fill, color: T.ink, fontFamily: FONT, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            >
              Lataa sopimus (PDF)
            </a>
          )}
          {/* Sopimus joka odottaa allekirjoitusta. Kehote ponnahtaa kerran, mutta
              tämä nappi on aina paikalla — kuittaus ei saa haudata sopimusta. */}
          {data.signPrompt && (
            <button
              type="button"
              onClick={() => setContractOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 17px", borderRadius: 12, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Lue ja allekirjoita sopimus
            </button>
          )}
          {/* Keltaisten oma sopimus. Se oli tähän asti vain ehtoikkunan sisällä
              yhden napautuksen takana, eli siitä joka paikassa jossa asiakas
              hakee sopimuksiaan — tästä rivistä — se puuttui. Kaksi vaihetta,
              kaksi sopimusta, molemmat samasta paikasta. */}
          {p2Live && data.isFixedDeal && (
            <a
              href={P2_CONTRACT_PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 17px", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.fill, color: T.ink, fontFamily: FONT, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            >
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: T.amber }} />
              Priority 2 -sopimus
            </a>
          )}
          </div>

          {/* Hyväksynnän kirjaus: kuka hyväksyi ehdot ja milloin. Se on osa
              sopimusta, joten se kuuluu tähän eikä pelkästään dialogiin. */}
          {p2Live && p2!.termsAccepted && (
            <p style={{ margin: "12px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              Priority 2 -tilausehdot hyväksytty
              {p2!.termsAcceptorName ? ` — ${p2!.termsAcceptorName}` : ""}
              {p2!.termsAcceptedAt ? `, ${fmtDate(p2!.termsAcceptedAt)}` : ""}.{" "}
              <button
                onClick={() => { setTermsError(null); setTermsOpen(true); }}
                style={{ border: "none", background: "transparent", padding: 0, color: T.navy, fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
              >
                Näytä ehdot
              </button>
            </p>
          )}
        </Panel>

        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 10 }}>
          Viimeksi päivitetty {updated} · päivittyy automaattisesti · puuhapatet.fi
        </p>
      </div>

      {/* SOPIMUSDIALOGI. Sama kuori kuin ehtoikkunalla — yksi sisäinen
          vierityspalkki, ei kahta päällekkäistä — ja sisältönä koko oikea
          allekirjoituslomake (`GigContractSign` modaalimuodossa), ei toista
          toteutusta samasta asiasta.

          Avautuu itsestään kerran (`signPrompt && !contractDismissed`) ja aina
          napista. `signPrompt` tulee palvelimelta ja on epätosi heti kun
          allekirjoitus on olemassa, joten allekirjoittanut asiakas ei voi saada
          tätä uudelleen. `!termsOpen` estää kahden dialogin päällekkäisyyden. */}
      {data.signPrompt && (contractOpen || !contractDismissed) && !termsOpen && (
        <>
          <div onClick={dismissContract} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(26,26,26,0.55)" }} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sopimus allekirjoitettavana"
            style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 71, width: "min(680px, calc(100vw - 24px))", maxHeight: "88vh", display: "flex", flexDirection: "column", background: CT.paper, borderRadius: 16, border: `1px solid ${CT.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.45)", overflow: "hidden", fontFamily: FONT }}
          >
            <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "18px 20px 14px", borderBottom: `1px solid ${CT.hair}`, background: CT.card }}>
              <div>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: CT.muted }}>SOPIMUS</p>
                <p style={{ margin: "5px 0 0", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: CT.ink }}>
                  Sopimus on valmis allekirjoitettavaksi
                </p>
              </div>
              <button
                onClick={dismissContract}
                aria-label="Sulje"
                style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", border: `1px solid ${CT.hair}`, background: CT.paper, color: CT.muted, fontSize: 14, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ✕
              </button>
            </div>
            <div style={{ minHeight: 0, overflowY: "auto", padding: "16px 16px 20px" }}>
              <GigContractSign token={token} view={data} onSigned={() => { setContractOpen(false); reload(); }} variant="modal" />
            </div>
          </div>
        </>
      )}

      {/* Vaihe 2 -kutsu: ponnahtaa kerran kun keltaisten suunnittelu avataan.
          Muuten linkki toimii täsmälleen kuten ennen. */}
      {p2Live && !p2!.termsAccepted && !p2InviteDismissed && !termsOpen && !(data.signPrompt && (contractOpen || !contractDismissed)) && (
        <>
          <div onClick={dismissP2Invite} style={{ position: "fixed", inset: 0, zIndex: 68, background: "rgba(26,26,26,0.45)" }} />
          <div role="dialog" aria-modal="true" aria-label="Priority 2 voi alkaa" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 69, width: "min(440px, calc(100vw - 32px))", background: T.card, borderRadius: 16, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 26, fontFamily: FONT }}>
            <button onClick={dismissP2Invite} aria-label="Sulje" style={{ position: "absolute", top: 14, right: 14, width: 28, height: 28, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 14, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "5px 11px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} /> PRIORITY 2
            </span>
            <p style={{ margin: "14px 0 0", fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>
              Priority 2 voi alkaa
            </p>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7, color: T.ink }}>
              Priority 1 (punaiset) alkaa olla valmis — seuraavaksi suunnitellaan
              <strong> keltaisella merkityt Priority 2 -ikkunat</strong>. Toisin kuin Priority 1 -urakan
              kiinteä hinta, jokainen Priority 2 -ikkuna hinnoitellaan erikseen:
            </p>
            <ul style={{ margin: "8px 0 0", padding: "0 0 0 20px", fontSize: 13, lineHeight: 1.8, color: T.muted }}>
              <li>Näet hintaehdotukset selkeänä listana ja kartalla — ikkuna kerrallaan</li>
              <li>Hyväksyt hinnan tai teet vastatarjouksen — mikään ei tule työn alle ilman hyväksyntääsi</li>
              <li>Voit lisätä uusia ikkunoita Priority 2:seen napauttamalla karttaa</li>
            </ul>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={dismissP2Invite}
                style={{ flex: 1, padding: "12px", borderRadius: 11, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
              >
                Katselen ensin
              </button>
              <button
                onClick={() => { dismissP2Invite(); setTermsError(null); setTermsOpen(true); }}
                style={{ flex: 2, padding: "12px", borderRadius: 11, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Aloitetaan — näytä ehdot
              </button>
            </div>
          </div>
        </>
      )}

      {/* P2 terms dialog — a lightweight click-to-accept (nimi + aikaleima).
          Every price acceptance after this is logged per window, and together
          they form the phase-2 agreement. */}
      {termsOpen && (
        <>
          <div onClick={() => !termsBusy && setTermsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(26,26,26,0.45)" }} />
          {/* Yksi vierityskehys: otsikko + toiminnot pysyvät, vain sopimusteksti
              vierittyy (ei kahta päällekkäistä vierityspalkkia). */}
          <div role="dialog" aria-modal="true" aria-label="Priority 2 -tilausehdot" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", zIndex: 71, width: "min(440px, calc(100vw - 32px))", maxHeight: "88vh", display: "flex", flexDirection: "column", background: T.card, borderRadius: 16, border: `1px solid ${T.hair}`, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", padding: 22, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "#8A6A00", background: "rgba(224,168,0,0.16)", border: "1px solid rgba(224,168,0,0.4)", borderRadius: 999, padding: "4px 9px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E0A800" }} /> PRIORITY 2
              </span>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Tilausehdot</p>
              <button onClick={() => !termsBusy && setTermsOpen(false)} aria-label="Sulje" style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
            </div>

            {/* Liitetty sopimusteksti pre-wrap -tyylillä: monirivinen soppari
                säilyttää kappaleet ja rivinvaihdot. Ainoa vierittyvä alue. */}
            {p2?.termsText?.trim() ? (
              <div style={{ margin: "12px 0 0", flex: "1 1 auto", minHeight: 60, overflowY: "auto", padding: "12px 14px", borderRadius: 12, background: T.paper, border: `1px solid ${T.hair}`, fontSize: 13.5, lineHeight: 1.65, color: T.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {p2.termsText.trim()}
              </div>
            ) : (
              <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.65, flexShrink: 0 }}>
                Hyväksymällä ikkunakohtaisen hinnan tilaat kyseisen ikkunan pesun sovittuun
                hintaan. Hinta lukitaan, kun molemmat osapuolet ovat sen hyväksyneet, ja
                lukitut ikkunat laskutetaan toteutuneen työn mukaan erillään Priority 1
                -urakan kiinteästä hinnasta. Jokainen hyväksyntä kirjataan aikaleimalla.
              </p>
            )}

            {/* Valmis Priority 2 -sopimus (PDF) — luettavissa ennen hyväksyntää.
                Vain FR8:lla: PDF on sen oma allekirjoitettu sopimus. */}
            {data.isFixedDeal && (
            <a
              href={P2_CONTRACT_PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textDecoration: "none", flexShrink: 0 }}
            >
              <span aria-hidden style={{ fontSize: 15 }}>📄</span>
              Lue koko sopimus (PDF) <span style={{ color: T.muted, fontWeight: 500 }}>· avautuu uuteen välilehteen</span>
            </a>
            )}

            {/* Jos ehdot on jo hyväksytty, dialogi on VAIN katselua varten: näytä
                hyväksynnän leima (nimi + aikaleima) eikä uutta lomaketta. */}
            {p2?.termsAccepted ? (
              <>
                <div style={{ margin: "14px 0 0", padding: "11px 13px", borderRadius: 10, background: "rgba(62,124,89,0.08)", border: "1px solid rgba(62,124,89,0.28)", fontSize: 13, color: "#2f6a45", lineHeight: 1.55, flexShrink: 0 }}>
                  ✓ Tilausehdot hyväksytty{p2.termsAcceptorName ? ` — ${p2.termsAcceptorName}` : ""}{p2.termsAcceptedAt ? `, ${fmtDate(p2.termsAcceptedAt)}` : ""}. Jokainen ikkunakohtainen hinnan hyväksyntä kirjataan lisäksi erikseen.
                </div>
                <button
                  onClick={() => setTermsOpen(false)}
                  style={{ marginTop: 14, width: "100%", padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                >
                  Sulje
                </button>
              </>
            ) : (
              <>
                <label htmlFor="p2-terms-name" style={{ display: "block", margin: "14px 0 6px", fontSize: 12, fontWeight: 600, color: T.muted, flexShrink: 0 }}>Nimenselvennys</label>
                <input
                  id="p2-terms-name"
                  value={termsName}
                  onChange={(e) => setTermsName(e.target.value)}
                  placeholder="Etunimi Sukunimi"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14, flexShrink: 0 }}
                />

                {/* Selkeä suostumus: rasti + selite että hyväksyntä kirjataan. */}
                <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, fontSize: 12.5, lineHeight: 1.5, color: T.ink, cursor: "pointer", flexShrink: 0 }}>
                  <input type="checkbox" checked={termsChecked} onChange={(e) => setTermsChecked(e.target.checked)} style={{ width: 17, height: 17, marginTop: 1, accentColor: T.navy, flexShrink: 0, cursor: "pointer" }} />
                  <span>Olen lukenut ja hyväksyn Priority 2 -tilausehdot. Hyväksyntä kirjataan nimelläni ja aikaleimalla.</span>
                </label>

                {termsError && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#B4231F", flexShrink: 0 }}>{termsError}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexShrink: 0 }}>
                  <button
                    disabled={termsBusy}
                    onClick={() => setTermsOpen(false)}
                    style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Peruuta
                  </button>
                  <button
                    disabled={termsBusy || !termsName.trim() || !termsChecked}
                    onClick={() => void acceptTerms()}
                    style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: (termsBusy || !termsName.trim() || !termsChecked) ? "not-allowed" : "pointer", opacity: (termsBusy || !termsName.trim() || !termsChecked) ? 0.5 : 1 }}
                  >
                    {termsBusy ? "Hyväksytään…" : "Hyväksyn ehdot"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
}

/**
 * Sopimuksen tila otsikkorivillä.
 *
 * KAKSI MERKKIÄ, KAKSI MERKITYSTÄ: väkänen tarkoittaa "tehty" (allekirjoitettu,
 * hyväksytty), piste tarkoittaa "odottaa" (allekirjoitettavana, valmistelussa).
 * Väkänen oli aiemmin myös odottavassa tilassa, eli sivu näytti kuitatun
 * merkin asiasta jota kukaan ei ollut vielä tehnyt.
 */
function StatusBadge({ color, label, icon = "check" }: { color: string; label: string; icon?: "check" | "dot" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color, letterSpacing: "0.04em", border: `1px solid ${color}33`, borderRadius: 999, padding: "5px 10px", background: `${color}12`, whiteSpace: "nowrap" }}>
      {icon === "check"
        ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
        : <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 }} />}
      {label}
    </span>
  );
}

const label: React.CSSProperties = eyebrow;

/**
 * Yhden asian huomautusnauha.
 *
 * Ohuempi kuin kortti ja lihavampi kuin leipäteksti: tämä on tarkoitettu
 * asialle jonka asiakkaan pitää nähdä avaamatta mitään, mutta joka ei ole
 * mittari. Piste kantaa värin, teksti kantaa merkityksen — väri ei koskaan
 * yksin (vihreä/keltainen ovat CVD-erottelultaan rajatapaus).
 */
function Notice({ theme, tone, lead, children }: { theme: typeof CT; tone: string; lead: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex", gap: 11, alignItems: "flex-start",
        background: theme.card, border: `1px solid ${theme.hair}`,
        borderLeft: `3px solid ${tone}`, borderRadius: 14,
        padding: "13px 16px", marginBottom: 16,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: tone, flexShrink: 0, marginTop: 6 }} />
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: theme.muted }}>
        <strong style={{ color: theme.ink, fontWeight: 700 }}>{lead}</strong>{" "}
        {children}
      </p>
    </div>
  );
}

function Panel({ children, theme = CT }: { children: React.ReactNode; theme?: typeof CT }) {
  return (
    <div style={{ background: theme.card, border: `1px solid ${theme.hair}`, borderRadius: 22, padding: 22, marginBottom: 16 }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      {children}
    </div>
  );
}
