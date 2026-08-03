/**
 * FR8 projektinäkymän yläpalkki.
 *
 * KOLME ASIAA OLI RIKKI, JA NE SELITTÄVÄT "ISTUU IHMEELLISEN HUONOSTI":
 *
 * 1. TURVA-ALUE PUUTTUI. Sovellus on `viewport-fit=cover` +
 *    `apple-mobile-web-app-capable`, eli kotivalikkoon asennettuna sisältö
 *    ulottuu kellon ja lovettoman alle. Jokainen muu sivun yläpalkki
 *    (admin-nav, login, sell, gig-live, worker) varaa siihen
 *    `env(safe-area-inset-top)`:n — tämä oli ainoa joka ei. 62 px:n palkista
 *    jäi iPhonella näkyviin ~15 px, ja takaisin-nappi oli kellon alla.
 *
 * 2. OMA ASTEIKKO. Koko FR8 piirretään `tokens.ts`:n arvoilla; tämä tiedosto
 *    oli ainoa joka ei niitä käyttänyt. Fonttikoot (12,5 / 13 / 13,5 / 10 / 9),
 *    kulmat (9 / 10 / 13) ja harmaat (0,4 / 0,55 / 0,7 / 0,75) olivat kaikki
 *    naapuriarvoja poleteille — tarpeeksi lähellä ettei se näytä virheeltä,
 *    tarpeeksi kaukana ettei mikään ole samalla rivillä sisällön kanssa.
 *
 * 3. TYHJÄ KESKUSTA. Välilehdet olivat kiinni takaisin-napissa ja loput
 *    työnnettynä `marginLeft: auto`lla oikeaan reunaan, joten palkin keskelle
 *    jäi työpöydällä iso aukko. Nyt palkki on kolme vyöhykettä ja välilehdet
 *    ovat siinä missä niitä katsotaan: keskellä.
 *
 * Puhelimessa kolmijako kääntyy: nimikilpi katoaa, välilehdet saavat kaiken
 * jäljelle jäävän tilan (ne ovat ainoa asia jota siellä painetaan) ja
 * reunoille jäävät vain nuoli ja tekijäkilpi.
 */
import { useState, useEffect } from "react";
import { ArrowLeft, Maximize2, Minimize2, ChevronDown, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, mono } from "./tokens";

export type Fr8Tab = "dashboard" | "floor" | "maksut";

interface NavbarProps {
  activeTab: Fr8Tab;
  onTabChange: (tab: Fr8Tab) => void;
  buildingName?: string;
  buildingAddress?: string;
  currentWorkerName?: string;
  saving?: boolean;
  onBack: () => void;
  /** Pickable crew for the "default washer" selector (manager view only). When
   *  given together with onChangeDefaultWasher, the worker chip becomes a
   *  dropdown that sets who new window markings are attributed to by default. */
  workers?: { id: string; name: string }[];
  defaultWasherId?: string;
  onChangeDefaultWasher?: (id: string) => void;
  /** "Maksut" — erälaskutuksen kokonaistilanne (kohta 3D). Näytetään vain
   *  johtajille, koska sivu sisältää jokaisen tekijän maksutiedot. */
  showMaksutTab?: boolean;
}

const TABS: { id: Fr8Tab; label: string; short: string }[] = [
  { id: "dashboard", label: "Kokonaistilanne", short: "Tilanne" },
  { id: "floor", label: "Tilanne kerroksittain", short: "Kerrokset" },
  { id: "maksut", label: "Maksut", short: "Maksut" },
];

/** Palkin oma nappipohja — matalampi kuin sisällön 40 px, koska palkki itse on
 *  vain 58–62 px korkea. Muuten samat poletit kuin sisällössä. */
const barButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 34,
  borderRadius: T.radius.sm,
  border: T.border.normal,
  background: "rgba(255,255,255,0.04)",
  color: T.text.secondary,
  cursor: "pointer",
  fontFamily: T.font,
  fontSize: T.size.sm,
  fontWeight: 600,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function tabStyle(active: boolean, m: boolean): React.CSSProperties {
  return {
    padding: m ? `7px ${T.space.md}px` : `7px ${T.space.lg - 1}px`,
    borderRadius: T.radius.sm - 2,
    border: "none",
    cursor: "pointer",
    fontFamily: T.font,
    fontSize: T.size.sm,
    fontWeight: active ? 700 : 500,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    transition: "background .18s, color .18s",
    background: active ? "#fff" : "transparent",
    color: active ? "#0a0a0c" : T.text.muted,
  };
}

export default function Navbar({ activeTab, onTabChange, buildingName, buildingAddress, currentWorkerName, saving, onBack, workers, defaultWasherId, onChangeDefaultWasher, showMaksutTab }: NavbarProps) {
  const m = useIsMobile();
  const [isFs, setIsFs] = useState(false);
  const [washerOpen, setWasherOpen] = useState(false);
  const canFs = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  // The chip becomes a "default washer" picker when a crew + change handler are given.
  const canPickWasher = !!onChangeDefaultWasher && !!workers && workers.length > 0;

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Puhelimessa välilehdet saavat kaiken jäljelle jäävän tilan; työpöydällä ne
  // ovat keskellä ja reunavyöhykkeet jakavat lopun tasan.
  const sideZone: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: m ? T.space.sm : T.space.md,
    flex: m ? "0 0 auto" : "1 1 0", minWidth: 0,
  };

  return (
    // data-fr8-bg: palkin oma tausta on lähes musta lasi. Ilman merkintää
    // mobiilisääntö vaihtoi sen 5,5 %:n valkoiseksi, jolloin yläpalkki oli
    // kartan päällä vaalea utu eikä palkki — ja sen teksti sen mukaista.
    <nav
      data-fr8-bg
      style={{
        position: "relative",
        zIndex: 20,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: m ? T.space.sm : T.space.md,
        // Turva-alue on PADDINGISSA, ei korkeudessa: rivi pysyy 58/62 px:nä ja
        // palkki kasvaa vain sen verran kuin loveus vaatii. Sivujen inset
        // koskee vaakatasoa (iPhone kyljellään).
        height: `calc(${m ? 58 : 62}px + env(safe-area-inset-top))`,
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: `max(${m ? T.space.md : T.space.lg}px, env(safe-area-inset-left))`,
        paddingRight: `max(${m ? T.space.md : T.space.lg}px, env(safe-area-inset-right))`,
        borderBottom: T.border.divider,
        background: "rgba(8,8,10,0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* ── VASEN: mistä tulit, ja missä olet ─────────────────────────────── */}
      <div style={sideZone}>
        <button
          onClick={onBack}
          title="Takaisin keikkaan"
          style={{ ...barButton, padding: m ? "0 9px" : `0 ${T.space.md}px` }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} /> {m ? "" : "Keikka"}
        </button>
        {!m && (buildingName || buildingAddress) && (
          // Katkeaa kolmella pisteellä eikä koskaan työnnä välilehtiä: talon
          // nimi on tieto, välilehdet ovat navigaatio.
          <div style={{ minWidth: 0, lineHeight: 1.25 }}>
            <div style={{
              fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: T.text.primary,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {buildingName || "Projektinäkymä"}
            </div>
            {buildingAddress && (
              <div style={{ ...mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {buildingAddress}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── KESKI: välilehdet ─────────────────────────────────────────────── */}
      <div
        data-fr8-tabs
        style={{
          display: "flex", alignItems: "center", gap: T.space.xs, padding: 3,
          background: "rgba(255,255,255,0.04)", border: T.border.subtle,
          borderRadius: T.radius.md, overflowX: "auto", minWidth: 0,
          flex: m ? "1 1 auto" : "0 0 auto",
        }}
      >
        {TABS.filter((t) => t.id !== "maksut" || showMaksutTab).map((t) => (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={tabStyle(activeTab === t.id, m)}>
            {m ? t.short : t.label}
          </button>
        ))}
      </div>

      {/* ── OIKEA: tila ja tekijä ─────────────────────────────────────────── */}
      <div style={{ ...sideZone, justifyContent: "flex-end" }}>
        {canFs && (
          <button
            onClick={toggleFs}
            title={isFs ? "Poistu koko näytöstä" : "Koko näyttö"}
            style={{
              ...barButton, width: 34, padding: 0,
              border: isFs ? "1px solid transparent" : T.border.normal,
              background: isFs ? "#fff" : "rgba(255,255,255,0.04)",
              color: isFs ? "#0a0a0c" : T.text.secondary,
            }}
          >
            {isFs ? <Minimize2 style={{ width: 15, height: 15 }} /> : <Maximize2 style={{ width: 15, height: 15 }} />}
          </button>
        )}
        {currentWorkerName && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => canPickWasher && setWasherOpen((v) => !v)}
              title={canPickWasher
                ? "Oletustekijä — uudet ikkunamerkinnät kirjataan tälle. Vaihda tästä; voit silti vaihtaa yksittäisen ikkunan tekijän kartalla."
                : "Kirjaukset merkitään tälle tekijälle"}
              style={{
                ...barButton,
                padding: m ? "0 9px" : `0 ${T.space.md - 1}px`,
                background: washerOpen ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
                border: T.border.subtle,
                cursor: canPickWasher ? "pointer" : "default",
                // Tallennuksen keltainen on palkin ainoa muuttuva väri — jos se
                // näkyy, pallon vieressä ei tarvita sanaa "TALLENNETAAN".
                gap: 7,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: saving ? T.tone.warn : T.tone.good,
                boxShadow: `0 0 8px ${saving ? "rgba(255,206,40,0.8)" : "rgba(95,224,138,0.8)"}`,
              }} />
              {!m && <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.secondary }}>{currentWorkerName}</span>}
              {canPickWasher && <ChevronDown style={{ width: 13, height: 13, color: T.text.faint, flexShrink: 0 }} />}
            </button>
            {canPickWasher && washerOpen && (
              <>
                <div onClick={() => setWasherOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
                {/* data-fr8-pop: leijuva valikko tarvitsee peittävän taustan.
                    Ilman merkintää mobiilisääntö pudotti tämän 5,5 %:n
                    valkoiseksi ja valikon läpi näkyi kartta. */}
                <div
                  data-fr8-pop
                  style={{
                    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 46, width: 208,
                    padding: T.space.xs + 3, background: "rgba(16,16,20,0.96)", border: T.border.strong,
                    borderRadius: T.radius.md, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                    boxShadow: "0 20px 50px rgba(0,0,0,0.7)",
                  }}
                >
                  <div style={{ ...mono, padding: `5px ${T.space.sm}px 7px` }}>OLETUSTEKIJÄ</div>
                  {workers!.map((w) => {
                    const active = w.id === defaultWasherId;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => { onChangeDefaultWasher!(w.id); setWasherOpen(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 9, width: "100%",
                          padding: `9px ${T.space.sm + 2}px`, borderRadius: T.radius.sm - 1,
                          cursor: "pointer", textAlign: "left",
                          border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "transparent"}`,
                          background: active ? "rgba(255,255,255,0.09)" : "transparent",
                          color: T.text.primary, fontFamily: T.font,
                          fontSize: T.size.sm, fontWeight: active ? 700 : 500,
                        }}
                      >
                        <span style={{
                          width: 20, height: 20, borderRadius: "50%", display: "flex",
                          alignItems: "center", justifyContent: "center", flexShrink: 0,
                          fontSize: T.size.label, fontWeight: 700,
                          background: T.tone.goodBg, color: "rgba(95,224,138,0.95)",
                        }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
                        {active && <Check style={{ width: 14, height: 14, color: T.tone.good, flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
