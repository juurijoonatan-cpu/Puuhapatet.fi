/**
 * Asiakkaan erittely (`HoursStatement`) tulostettavaksi HTML-sivuksi.
 *
 * Yksi itsenäinen tiedosto: tyylit sisällä, ei ulkoisia resursseja. Se avataan
 * uuteen välilehteen ja tallennetaan PDF:ksi selaimen tulostuksella tai
 * ladataan sellaisenaan. Sisältö tulee kokonaan `buildHoursStatement`ista —
 * täällä ei lasketa mitään, vain muotoillaan, joten ruudun ja tiedoston luvut
 * eivät voi erota. Kaikki teksti ESCAPATAAN: kulun nimi ja tekijän nimi ovat
 * käyttäjän kirjoittamia.
 */
import { fmtShiftHours } from "@shared/project";
import type { HoursStatement, StatementInvoice } from "@shared/invoice-statement";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const eur = (c: number) =>
  `${(c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const hrs = (h: number) => `${fmtShiftHours(h)} h`;

const WEEKDAYS = ["su", "ma", "ti", "ke", "to", "pe", "la"];
/** "ma 8.9.2026" — päivä luetaan paikallisena, ei UTC:nä. */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]} ${d}.${m}.${y}`;
}
const shortDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d}.${m}.${y}`;
};

const KIND_LABEL: Record<string, string> = {
  transport: "Matka", materials: "Tarvikkeet", equipment: "Kalusto", other: "Muu kulu",
  subcontract: "Alihankinta", surcharge: "Lisä",
};

export interface StatementHtmlOpts {
  /** Kohde/asiakas otsikkoon, esim. keikan nimi. */
  title: string;
  nameOf: (workerId: string) => string;
  /** Laskun päivämäärä tai muu aikaleima alaotsikkoon. */
  issuedOn?: string;
}

function invoiceBlock(inv: StatementInvoice, st: HoursStatement, o: StatementHtmlOpts): string {
  const peopleRows = inv.people.map((p) =>
    `<tr><td>${esc(o.nameOf(p.worker))}</td><td class="n">${hrs(p.hours)}</td><td class="n">${eur(Math.round(p.hours * st.hourRateCents))}</td></tr>`).join("");
  const other = inv.otherCents !== 0
    ? `<tr><td colspan="2">Muut erät (ikkunatyö / korjaus aiempaan)</td><td class="n">${eur(inv.otherCents)}</td></tr>` : "";
  return `
  <section class="inv">
    <h3>Lasku ${inv.no}/2 · ${esc(inv.billerName)}${inv.yTunnus ? ` <span class="muted">Y-tunnus ${esc(inv.yTunnus)}</span>` : ""}</h3>
    <table>
      <thead><tr><th>Tekijä</th><th class="n">Tunnit</th><th class="n">${eur(st.hourRateCents)} / h</th></tr></thead>
      <tbody>${peopleRows || `<tr><td colspan="3" class="muted">Ei tunteja tällä laskulla</td></tr>`}</tbody>
      <tr class="sub"><td>Tunnit yhteensä</td><td class="n">${hrs(inv.hours)}</td><td class="n">${eur(inv.hoursCents)}</td></tr>
      <tr><td colspan="2">Muut kulut (erittely liitteen lopussa)</td><td class="n">${eur(inv.expensesCents)}</td></tr>
      ${other}
      <tr class="total"><td colspan="2">Laskun loppusumma</td><td class="n">${eur(inv.totalCents)}</td></tr>
    </table>
  </section>`;
}

export function renderStatementHtml(st: HoursStatement, o: StatementHtmlOpts): string {
  const [a, b] = st.invoices;
  const period = st.from && st.to ? `${shortDay(st.from)} – ${shortDay(st.to)}` : "";

  // ── 1. Yhteenveto ───────────────────────────────────────────────────────
  const names = st.byWorker.map((w) => w.worker);
  const cross = names.map((id) => {
    const w = st.byWorker.find((x) => x.worker === id)!;
    return `<tr><td>${esc(o.nameOf(id))}</td><td class="n">${w.invoice1 ? hrs(w.invoice1) : "–"}</td><td class="n">${w.invoice2 ? hrs(w.invoice2) : "–"}</td><td class="n strong">${hrs(w.hours)}</td></tr>`;
  }).join("");

  const summary = `
  <h2>1. Laskujen jako</h2>
  <p class="lead">Työ on laskutettu kahdella laskulla. Alla näkyy kumpi lasku sisältää kenen tunnit, ja että laskujen summa on sama kuin koko jakson summa.</p>
  <div class="grid2">${invoiceBlock(a, st, o)}${invoiceBlock(b, st, o)}</div>

  <table class="recon">
    <thead><tr><th></th><th class="n">${esc(a.billerName)}<br><span class="muted">lasku 1/2</span></th><th class="n">${esc(b.billerName)}<br><span class="muted">lasku 2/2</span></th><th class="n">Yhteensä</th></tr></thead>
    <tbody>
      <tr><td>Tunnit</td><td class="n">${hrs(a.hours)}</td><td class="n">${hrs(b.hours)}</td><td class="n strong">${hrs(st.totalHours)}</td></tr>
      <tr><td>Työ (${eur(st.hourRateCents)} / h)</td><td class="n">${eur(a.hoursCents)}</td><td class="n">${eur(b.hoursCents)}</td><td class="n strong">${eur(st.totalHoursCents)}</td></tr>
      <tr><td>Muut kulut</td><td class="n">${eur(a.expensesCents + a.otherCents)}</td><td class="n">${eur(b.expensesCents + b.otherCents)}</td><td class="n strong">${eur(st.totalExpensesCents + a.otherCents + b.otherCents)}</td></tr>
      <tr class="total"><td>Lasku yhteensä</td><td class="n">${eur(a.totalCents)}</td><td class="n">${eur(b.totalCents)}</td><td class="n">${eur(st.totalCents)}</td></tr>
    </tbody>
  </table>
  <p class="check ${st.reconciles ? "ok" : "bad"}">${st.reconciles
    ? `✓ Summat täsmäävät: ${eur(a.totalCents)} + ${eur(b.totalCents)} = ${eur(st.totalCents)}`
    : `Huom: summa ${eur(st.totalCents)} ei täsmää odotettuun ${eur(st.nextInvoiceCents)}`}</p>

  <h3>Tunnit tekijöittäin</h3>
  <table>
    <thead><tr><th>Tekijä</th><th class="n">Lasku 1/2</th><th class="n">Lasku 2/2</th><th class="n">Yhteensä</th></tr></thead>
    <tbody>${cross}</tbody>
    <tr class="total"><td>Yhteensä</td><td class="n">${hrs(a.hours)}</td><td class="n">${hrs(b.hours)}</td><td class="n">${hrs(st.totalHours)}</td></tr>
  </table>`;

  // ── 2. Päivät ───────────────────────────────────────────────────────────
  const dayCards = st.days.map((d) => {
    const rows = d.rows.map((r) =>
      `<tr><td>${esc(o.nameOf(r.worker))}</td><td class="n strong">${hrs(r.hours)}</td><td class="n tag">lasku ${r.invoice}/2</td></tr>`).join("");
    return `<div class="day">
      <div class="dayhead"><span>${esc(dayLabel(d.day))}</span><span class="dh">${hrs(d.hours)}</span></div>
      <table class="plain">${rows}</table>
    </div>`;
  }).join("");

  const days = `
  <h2>2. Tunnit päivittäin</h2>
  <p class="lead">Kaikki jaksolla kirjatut työpäivät aikajärjestyksessä: kuka oli töissä ja kuinka monta tuntia. Oikealla näkyy kumman laskun tunteihin rivi kuuluu.</p>
  <div class="days">${dayCards || `<p class="muted">Ei kirjattuja tunteja.</p>`}</div>
  <p class="check ok">${st.days.length} työpäivää · ${hrs(st.totalHours)} yhteensä</p>`;

  // ── 3. Muut kulut ───────────────────────────────────────────────────────
  const expBlock = (inv: StatementInvoice) => {
    if (inv.expenses.length === 0 && inv.otherCents === 0) {
      return `<h3>Lasku ${inv.no}/2 · ${esc(inv.billerName)}</h3><p class="muted">Ei muita kuluja.</p>`;
    }
    const rows = inv.expenses.map((x) =>
      `<tr><td>${esc(x.label)}</td><td class="muted">${esc(KIND_LABEL[x.kind] ?? "")}</td><td class="n strong">${eur(x.cents)}</td></tr>`).join("");
    const other = inv.otherCents !== 0
      ? `<tr><td>Muut erät (ikkunatyö / korjaus aiempaan)</td><td></td><td class="n strong">${eur(inv.otherCents)}</td></tr>` : "";
    return `<h3>Lasku ${inv.no}/2 · ${esc(inv.billerName)}</h3>
    <table>${rows}${other}<tr class="total"><td colspan="2">Kulut yhteensä</td><td class="n">${eur(inv.expensesCents + inv.otherCents)}</td></tr></table>`;
  };
  const expenses = `
  <h2>3. Muut kulut</h2>
  <p class="lead">Tuntien lisäksi laskulle on veloitettu seuraavat kulut: tarvikkeet, matkat ja alihankinta.</p>
  ${expBlock(a)}${expBlock(b)}
  <table class="recon"><tr class="total"><td>Muut kulut yhteensä</td><td class="n">${eur(st.totalExpensesCents + a.otherCents + b.otherCents)}</td></tr></table>`;

  return `<!doctype html>
<html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Erittely – ${esc(o.title)}</title>
<style>
  :root { --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --soft:#f6f7f9; --accent:#1f6f4a; --bad:#b42318; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); margin: 0; background: #fff; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 36px 0 6px; padding-top: 14px; border-top: 2px solid var(--ink); }
  h3 { font-size: 15px; margin: 22px 0 8px; }
  .meta { color: var(--muted); margin: 0 0 8px; }
  .lead { color: var(--muted); margin: 0 0 14px; }
  .muted { color: var(--muted); font-weight: 400; }
  .strong { font-weight: 650; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.sub td { font-weight: 650; background: var(--soft); }
  tr.total td { font-weight: 700; border-top: 2px solid var(--ink); border-bottom: 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .inv h3 { margin-top: 8px; }
  .recon { margin-top: 18px; }
  .check { margin: 10px 0 0; font-weight: 650; }
  .check.ok { color: var(--accent); } .check.bad { color: var(--bad); }
  .days { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .day { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; break-inside: avoid; }
  .dayhead { display: flex; justify-content: space-between; font-weight: 700; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .dh { font-variant-numeric: tabular-nums; }
  table.plain { table-layout: fixed; }
  table.plain td { border: 0; padding: 4px 0; }
  table.plain td:nth-child(1) { width: 46%; } table.plain td:nth-child(2) { width: 22%; }
  .tag { color: var(--muted); font-size: 12px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
  .noprint { margin: 0 0 20px; }
  .noprint button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--ink); background: var(--ink); color: #fff; cursor: pointer; }
  @media (max-width: 640px) { .grid2, .days { grid-template-columns: 1fr; } }
  @media print { .noprint { display: none; } main { padding: 0; max-width: none; } h2 { break-after: avoid; } }
</style></head>
<body><main>
  <p class="noprint"><button onclick="window.print()">Tulosta / tallenna PDF:ksi</button></p>
  <h1>Laskun erittely</h1>
  <p class="meta"><strong>${esc(o.title)}</strong>${period ? ` · työjakso ${esc(period)}` : ""}${o.issuedOn ? ` · ${esc(o.issuedOn)}` : ""}</p>
  <p class="meta">Laskuttajat: ${esc(a.billerName)} (lasku 1/2) ja ${esc(b.billerName)} (lasku 2/2) · Puuhapatet.</p>
  ${summary}
  ${days}
  ${expenses}
  <footer>Tunnit laskutetaan hintaan ${eur(st.hourRateCents)} / h.</footer>
</main></body></html>`;
}
