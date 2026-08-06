import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Kävijämittauksen on oltava hiljainen ja rajattu. Nämä testit lukitsevat sen
 * mitä tietosuojaselosteessa luvataan — jos lupaus ja koodi eriytyvät, se on
 * pahempi kuin puuttuva mittaus.
 */

const sent: string[] = [];

function setup(opts: { dnt?: string; gpc?: boolean } = {}) {
  sent.length = 0;
  vi.resetModules();
  const nav: any = { sendBeacon: (_u: string, b: Blob) => { sent.push(String(b.type)); return true; } };
  if (opts.dnt !== undefined) nav.doNotTrack = opts.dnt;
  if (opts.gpc !== undefined) nav.globalPrivacyControl = opts.gpc;
  // navigator on Node 22:ssa vain getter, joten sitä ei voi sijoittaa suoraan.
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("window", { location: { search: "" } });
  vi.stubGlobal("document", { referrer: "" });
  vi.stubGlobal("Blob", class { type: string; constructor(_p: any[], o: any) { this.type = o?.type ?? ""; } });
}

async function track(path: string) {
  const { trackPageView } = await import("./track");
  trackPageView(path);
}

describe("kävijämittaus", () => {
  beforeEach(() => setup());

  it("kirjaa julkisen sivun", async () => {
    await track("/palvelut");
    expect(sent).toHaveLength(1);
  });

  it("ei kirjaa samaa polkua kahdesti peräkkäin", async () => {
    const { trackPageView } = await import("./track");
    trackPageView("/palvelut");
    trackPageView("/palvelut");
    expect(sent).toHaveLength(1);
  });

  it("ei kirjaa sisäisiä työkaluja", async () => {
    const { trackPageView } = await import("./track");
    for (const p of ["/admin", "/admin/dashboard", "/tyo/abc123", "/seuranta/xyz"]) trackPageView(p);
    expect(sent).toHaveLength(0);
  });

  it("ei sekoita samalla etuliitteellä alkavaa julkista polkua", async () => {
    // "/adminium" ei ole /admin — etuliitteen on osuttava rajalle.
    await track("/adminium");
    expect(sent).toHaveLength(1);
  });

  it("kunnioittaa Do Not Trackia", async () => {
    setup({ dnt: "1" });
    await track("/palvelut");
    expect(sent).toHaveLength(0);
  });

  it("kunnioittaa Global Privacy Controlia", async () => {
    setup({ gpc: true });
    await track("/palvelut");
    expect(sent).toHaveLength(0);
  });

  it("ei kaadu jos sendBeacon puuttuu", async () => {
    setup();
    (navigator as any).sendBeacon = undefined;
    vi.stubGlobal("fetch", () => Promise.resolve({} as any));
    await expect(track("/palvelut")).resolves.not.toThrow();
  });
});
