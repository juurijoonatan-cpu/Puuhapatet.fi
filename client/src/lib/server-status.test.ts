import { describe, expect, it } from "vitest";
import {
  serverPhase, serverLabel, WAKE_AFTER_MS, DOWN_AFTER_FAILURES,
  type ProbeState,
} from "./server-status";

/**
 * VARTIJA. Koko palkin arvo on yhdessä erottelussa: NUKKUU vs. EI VASTAA.
 *
 * Render nukuttaa ilmaisen instanssin ~15 min hiljaisuuden jälkeen, ja
 * herätys kestää ~50 s. Nukkuva palvelin ei palauta virhettä — se vain ei
 * vastaa. Jos palkki näyttäisi siitä punaista "ei vastaa", se neuvoisi
 * luovuttamaan juuri silloin kun odottaminen on ainoa oikea teko. Ja jos se
 * näyttäisi aidosta katkosta keltaista "herää", kirjautuja jäisi tuijottamaan
 * palkkia joka ei koskaan muutu.
 */

const base: ProbeState = { probing: false, probeElapsedMs: 0, consecutiveFailures: 0, lastLatencyMs: null };
const st = (o: Partial<ProbeState> = {}): ProbeState => ({ ...base, ...o });

describe("serverPhase", () => {
  it("ensimmäinen nopea kysely on 'tarkistetaan', ei vielä mitään väitettä", () => {
    expect(serverPhase(st({ probing: true, probeElapsedMs: 120 }))).toBe("checking");
  });

  it("VENYVÄ kysely on herääminen — se on odottamisen arvoista", () => {
    expect(serverPhase(st({ probing: true, probeElapsedMs: WAKE_AFTER_MS }))).toBe("waking");
    expect(serverPhase(st({ probing: true, probeElapsedMs: 30_000 }))).toBe("waking");
  });

  it("KAHDESTI KAATUNUT on alhaalla — odottaminen ei auta", () => {
    expect(serverPhase(st({ consecutiveFailures: DOWN_AFTER_FAILURES }))).toBe("down");
  });

  it("yksi kaatuminen ei vielä ole katko (tunneli, wifin vaihto)", () => {
    expect(serverPhase(st({ consecutiveFailures: 1 }))).toBe("checking");
    // …eikä se pyyhi tietoa siitä että palvelin vastasi äsken.
    expect(serverPhase(st({ consecutiveFailures: 1, lastLatencyMs: 80 }))).toBe("up");
  });

  it("VENYVÄ KYSELY VOITTAA AIEMMAN EPÄONNISTUMISEN", () => {
    // Juuri tämä yhdistelmä on nukkuva Render: edellinen yritys katkesi
    // aikakatkaisuun, ja uusi odottaa herätystä. "Ei vastaa" olisi väärä
    // neuvo — palvelin on tulossa.
    expect(serverPhase(st({ probing: true, probeElapsedMs: 5_000, consecutiveFailures: 5 }))).toBe("waking");
  });

  it("kerran vastannut pysyy vihreänä taustakyselyn ajan — ei välkkymistä", () => {
    // Ilman tätä palkki vilkkuisi vihreän ja harmaan väliä joka kyselyllä.
    expect(serverPhase(st({ probing: true, probeElapsedMs: 40, lastLatencyMs: 62 }))).toBe("up");
    expect(serverPhase(st({ lastLatencyMs: 62 }))).toBe("up");
  });

  it("hidas taustakysely tunnetusti hereillä olevalle näyttää silti heräämisen", () => {
    // Palvelin ehti nukahtaa kesken istunnon: se on rehellisesti herääminen.
    expect(serverPhase(st({ probing: true, probeElapsedMs: 9_000, lastLatencyMs: 62 }))).toBe("waking");
  });
});

describe("serverLabel", () => {
  it("valmis kertoo vasteajan", () => {
    expect(serverLabel("up", { probeElapsedMs: 0, lastLatencyMs: 84 })).toBe("Palvelin valmis · 84 ms");
    expect(serverLabel("up", { probeElapsedMs: 0, lastLatencyMs: 1500 })).toBe("Palvelin valmis · 1,5 s");
  });

  it("herätessä näkyy kulunut aika — se on ainoa asia jolla on merkitystä", () => {
    expect(serverLabel("waking", { probeElapsedMs: 4200, lastLatencyMs: null })).toBe("Palvelin herää… 4 s");
  });

  it("muut tilat eivät väitä numeroita joita ei ole", () => {
    expect(serverLabel("down", { probeElapsedMs: 0, lastLatencyMs: null })).toBe("Palvelin ei vastaa");
    expect(serverLabel("checking", { probeElapsedMs: 0, lastLatencyMs: null })).toBe("Tarkistetaan…");
  });
});
