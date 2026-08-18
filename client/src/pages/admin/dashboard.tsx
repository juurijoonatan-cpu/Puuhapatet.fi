/**
 * Admin Dashboard
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { Banknote, ArrowRight, Users, Building2 } from "lucide-react";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { DashboardBriefing } from "@/components/dashboard-briefing";
import AdminOverview, { type OverviewMonth, type OverviewFigure } from "@/components/admin/AdminOverview";
import { api, StatsResponse, WorkerStatsResponse, type MyGigWork } from "@/lib/api";
import { isMyJob, parseWorkerIds } from "@/lib/visibility";
import { STAFF_SERVICE_FEE_RATE, STAFF_SERVICE_FEE_PCT, HOST_SERVICE_FEE_PCT, feeRateForWorker, feePctForWorker, effectiveJobTotal } from "@shared/team";

export default function AdminDashboard() {
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  const [myJobTotal, setMyJobTotal] = useState<number | null>(null);
  const [myRevenue, setMyRevenue] = useState<number | null>(null);
  const [myInvestmentShare, setMyInvestmentShare] = useState<number | null>(null);
  /**
   * PIKKUKEIKKOJEN laskutus koko tiimiltä, ja sama sarja kuukausittain.
   *
   * MIKSI TÄSTÄ EIKÄ `/api/stats`ista: `stats.totalRevenue` summaa KAIKKI
   * valmiit keikat, myös urakkakeikat — ja urakan `agreedPrice` on sopimuksen
   * katto, joka on jo laskettu mukaan `gigMoney.invoicedCents`iin. Avauskuvan
   * "laskutettu yhteensä" laskisi urakan siis kahdesti. Tämä luku on
   * nimenomaisesti urakat POIS SUODATETTUNA, joten summa on kertaalleen.
   */
  const [smallGigCents, setSmallGigCents] = useState<number | null>(null);
  const [smallGigMonths, setSmallGigMonths] = useState<Record<string, number>>({});
  /** Kirjautuneen OMA laskutus kuukausittain (oma osuus, keikkapäivän mukaan). */
  const [myMonths, setMyMonths] = useState<Record<string, number>>({});
  // Gigs where the logged-in admin is ALSO a worker (e.g. Petrus). Shows a small
  // earnings card + a button straight to their own worker dashboard.
  const [myGigWork, setMyGigWork] = useState<MyGigWork[]>([]);
  // Urakkakeikkojen (FR8) raha. Asuu gigData/projectData-blobeissa eikä siis
  // näy `/api/stats`issa lainkaan — ilman tätä koko urakan laskutettu ja saatu
  // raha puuttui admin-paneelista. Vain perustajille (palvelin rajaa myös).
  const [gigMoney, setGigMoney] = useState<Awaited<ReturnType<typeof api.getGigMoney>>["data"] | null>(null);

  useEffect(() => {
    api.getMyGigWork().then((res) => {
      if (res.ok && res.data) setMyGigWork(res.data.gigs.filter((g) => g.earnedCents > 0 || g.washed > 0 || g.pendingCents > 0));
    });
  }, []);

  useEffect(() => {
    if (!isHost) return;
    api.getGigMoney().then((res) => { if (res.ok && res.data) setGigMoney(res.data); });
  }, [isHost]);

  useEffect(() => {
    api.stats().then((res) => {
      if (res.ok && res.data) setStats(res.data);
      setLoading(false);
    });
    api.workersStats().then((res) => {
      if (res.ok && res.data) setWorkerStats(res.data);
    });
    // Always fetch personal stats for both HOST and STAFF
    if (profile) {
      api.getJobs().then((res) => {
        if (res.ok && res.data) {
          const rows = res.data as { job: { assignedTo: string | null; status: string; agreedPrice: number; waiveFee?: boolean; quoteStatus?: string | null; unitCount?: number | null; isTaloyhtiio?: boolean | null; isCustomGig?: boolean | null; gigData?: string | null; scheduledAt?: string | null } }[];
          const mine = rows.filter(r => isMyJob(r.job.assignedTo, profile.id));
          setMyJobTotal(mine.length);
          const mineDone = mine
            // A declined quote earned nothing — keep it out of personal income.
            // URAKKAKEIKAT POIS. Niiden `agreedPrice` on sopimuksen KATTO, ei
            // ansaittua rahaa, eikä se jakaudu tekijämäärällä. Jos urakkakeikka
            // merkitään valmiiksi, tämä summa hyppäisi kattoon jaettuna
            // tekijöillä — luku joka ei ole liikevaihtoa eikä katetta. Kaikki
            // muut tämän taulun lukijat suodattavat urakkakeikat pois
            // (server/finance/settlement.ts, post.ts); tämä oli ainoa joka ei.
            // Urakkakeikkojen oma ansio tulee `entitledByFounder`ista alla.
            .filter(r => r.job.status === "done" && r.job.quoteStatus !== "declined"
              && !r.job.isCustomGig && !r.job.gigData);
          const rev = mineDone
            .reduce((sum, r) => {
              const workerCount = Math.max(1, parseWorkerIds(r.job.assignedTo).length);
              // taloyhtiö gigs bill per apartment × unitCount — use the full total.
              return sum + Math.round(effectiveJobTotal(r.job) / workerCount);
            }, 0);
          setMyRevenue(rev);

          // Koko tiimin pikkukeikat: sama suodatus kuin yllä (valmis, ei
          // hylätty tarjous, ei urakka) mutta ilman "omat"-rajausta, ja ilman
          // jakoa tekijämäärällä — tämä on laskutus, ei kenenkään osuus.
          const small = rows.filter(
            (r) => r.job.status === "done" && r.job.quoteStatus !== "declined"
              && !r.job.isCustomGig && !r.job.gigData,
          );
          setSmallGigCents(small.reduce((sum, r) => sum + effectiveJobTotal(r.job), 0));
          const byMonth: Record<string, number> = {};
          for (const r of small) {
            // Keikkapäivä on oikea päivä pikkukeikalle: se on päivä jona työ
            // tehtiin ja lasku annettiin. Puuttuva ajankohta jätetään pois
            // sarjasta — arvattu kuukausi olisi väärä kuukausi.
            const iso = r.job.scheduledAt ?? null;
            if (!iso) continue;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            byMonth[key] = (byMonth[key] ?? 0) + effectiveJobTotal(r.job);
          }
          setSmallGigMonths(byMonth);

          // OMA sarja kuukausittain, samalla jaolla kuin `rev` yllä. Brändin
          // koko sarja on perustajien tietoa, joten muu ylläpito näkee vain
          // omansa — mutta näkee sen, eikä pelkkiä lukuja ilman kehitystä.
          const mineByMonth: Record<string, number> = {};
          for (const r of mineDone) {
            const iso = r.job.scheduledAt ?? null;
            if (!iso) continue;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) continue;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            const workerCount = Math.max(1, parseWorkerIds(r.job.assignedTo).length);
            mineByMonth[key] = (mineByMonth[key] ?? 0) + Math.round(effectiveJobTotal(r.job) / workerCount);
          }
          setMyMonths(mineByMonth);
        }
      });
      api.getInvestments().then((res) => {
        if (res.ok && res.data) {
          const rows = res.data as { boughtBy: string; splitWith?: string | null; amount: number }[];
          const share = rows.reduce((sum, inv) => {
            if (inv.boughtBy === profile.id) return sum + (inv.splitWith ? Math.round(inv.amount / 2) : inv.amount);
            if (inv.splitWith === profile.id) return sum + Math.round(inv.amount / 2);
            return sum;
          }, 0);
          setMyInvestmentShare(share);
        }
      });
    }
  }, []);

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  /** Yleisnäkymän muotoilu: kokonaisia euroja. Sentit eivät kuulu avausnäkymään
   *  — ne ovat erittelyissä ja kirjanpidossa, joissa niillä on merkitys. */
  const eur0 = (cents: number) => Math.round(cents / 100).toLocaleString("fi-FI") + " €";

  /**
   * Oma ansio URAKKAKEIKOISTA.
   *
   * Tämä puuttui "Oma tulo" -luvusta kokonaan. Luku summasi vain
   * `status = "done"` -keikkojen `agreedPrice`ia, ja urakkakeikka on
   * `in_progress` koko kestonsa ajan — joten koko urakkatyö oli näkymätöntä.
   * `entitledCents` on moottorin oma vastaus (oma pesutyö + omat keltaiset +
   * tasaosuus katteesta), EI kassaan kerätty raha: kerätystä valtaosa on
   * tekijöiden palkkaa eikä omaa tuloa.
   */
  const myGigEntitled = (profile && gigMoney?.totals.entitledByFounder?.[profile.id]) || 0;

  /**
   * AVAUSKUVAN LUVUT.
   *
   * Kaksi rahavirtaa lasketaan yhteen kertaalleen (ks. `smallGigCents`), ja
   * aikasarja on molempien summa kuukausittain. Urakkaraha on perustajien
   * tietoa (`gigMoney` haetaan vain heille), joten avauskuva näytetään vain
   * heille — muille tervehdys ja omat kortit kuten ennen.
   */
  const heroGigCents = gigMoney?.totals.invoicedCents ?? 0;
  const heroSmallCents = smallGigCents ?? 0;
  const heroMyIncome = Math.max(0, (myRevenue ?? 0) + myGigEntitled - (myInvestmentShare ?? 0));
  /**
   * Kuukaudet YHTENÄISENÄ jaksona ensimmäisestä laskutuskuukaudesta tähän
   * kuukauteen, enintään 12 viimeisintä.
   *
   * Yhtenäisyys on tässä koko pointti: tyhjä kuukausi on tieto ("silloin ei
   * laskutettu mitään"), joten sen pitää näkyä tyhjänä. Jos sarjaan otettaisiin
   * vain ne kuukaudet joissa on rahaa, kaksi kuukautta joiden välissä on puolen
   * vuoden tauko näyttäisivät vierekkäisiltä.
   */
  const monthSeries = (...sources: Record<string, number>[]): OverviewMonth[] => {
    const merged: Record<string, number> = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) merged[k] = (merged[k] ?? 0) + v;
    }
    const keys = Object.keys(merged).sort();
    if (keys.length === 0) return [];
    const [fy, fm] = keys[0].split("-").map(Number);
    const now = new Date();
    const out: OverviewMonth[] = [];
    // Kalenterikävely, ei päivämäärä-aritmetiikkaa: kuukauden lisäys
    // päivämäärään kaatuu kuun 31. päivänä.
    let y = fy, m = fm;
    const endY = now.getFullYear(), endM = now.getMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, cents: merged[key] ?? 0 });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (out.length > 240) break; // vikaturva kelvottomalta aikaleimalta
    }
    return out.slice(-12);
  };

  const myDebt = workerStats && profile ? (workerStats.workerFees[profile.id] ?? 0) : null;

  /**
   * YLEISNÄKYMÄN LUVUT.
   *
   * Perustaja näkee brändin laskutuksen kärkilukuna ja oman tulonsa
   * mittalukuna; muu ylläpito näkee vain omat lukunsa — brändin summat ja
   * urakkaraha ovat perustajien tietoa (palvelin rajaa myös itse).
   */
  const workerOpen = gigMoney?.totals.workerOpenCents ?? 0;
  const heroLabel = isHost ? "Laskutettu" : "Bruttotulo";
  const heroValue = isHost
    ? eur0(heroGigCents + heroSmallCents)
    : eur0(Math.max(0, (myRevenue ?? 0) - (myInvestmentShare ?? 0)));
  /**
   * HUOMIORIVI — enintään yksi, ja vain kun jotain on OIKEASTI tekemättä.
   *
   * Tässä oli aiemmin viisi kappaletta selittävää tekstiä joista neljä kertoi
   * saman asian eri sanoin. Tärkeysjärjestys: ensin raha joka pitää siirtää,
   * sitten raha jonka saaja on merkitsemättä, sitten raha jonka maksaja on
   * merkitsemättä. Kun kaikki on kunnossa, rivi ei ole olemassa — ei "Tasan",
   * ei "ei huomioita", ei mitään.
   *
   * Siirtoluku on nyt `result.transfer`ista johdettu (ks. palvelimen
   * `dueByFounder`), joten kirjattu siirto todella kuittaa tämän pois.
   */
  const overviewAlert: { text: string; href: string } | null = (() => {
    if (!isHost || !gigMoney) return null;
    const moneyGigs = gigMoney.gigs ?? [];
    // Yhden rahakeikan tapauksessa mennään suoraan sen tasausnäkymään; useamman
    // kanssa keikkalistaan, koska rivi koskee useaa keikkaa.
    const href = moneyGigs.length === 1 ? `/admin/gig/${moneyGigs[0].jobId}/projekti` : "/admin/gigs";
    const tr = gigMoney.totals.transfer;
    // Alle euron siirto on pyöristyskohinaa, ei velka.
    if (tr && tr.cents >= 100) {
      const nameOf = (id: string) => (gigMoney.founders.find((x) => x.id === id)?.name ?? id).split(" ")[0];
      return { text: `Tasaus ${eur0(tr.cents)}: ${nameOf(tr.fromId)} → ${nameOf(tr.toId)}`, href };
    }
    const unassigned = gigMoney.totals.unassignedCents;
    if (unassigned > 0) return { text: `${eur0(unassigned)} laskutettu ilman merkintää saajasta`, href };
    const unattributed = gigMoney.totals.unattributedPaidCents ?? 0;
    if (unattributed > 0) return { text: `${eur0(unattributed)} maksettu ilman maksajamerkintää`, href };
    return null;
  })();

  const overviewFigures: OverviewFigure[] = isHost
    ? [
        { label: "Oma tulo", value: eur0(heroMyIncome), tone: "accent" },
        // Tekijöille kuuluva raha käsissä — ainoa luku tässä joka voi vaatia
        // toimenpiteen, siksi korostus vain kun se on yli nollan.
        { label: "Tekijöille", value: eur0(workerOpen), tone: workerOpen > 0 ? "warn" : "ink" },
        // EI keikkamäärää: se on lukumäärä eikä rahaa, se on keikkalistan
        // otsikossa ("N keikkaa (omat)") ja navipalkissa yhden napautuksen
        // päässä. Avausnäkymään mahtuu vain tärkein.
      ]
    : [
        { label: "Keikat", value: myJobTotal === null ? "…" : String(myJobTotal) },
        // Palvelumaksuvelka näkyy muulle ylläpidolle VAIN täällä
        // (`/admin/settings` palvelumaksukortti on perustajaportin takana),
        // joten tämä tiili ei ole poistettavissa.
        { label: "Velka", value: myDebt === null ? "…" : eur0(myDebt), tone: (myDebt ?? 0) > 0 ? "warn" : "ink" },
      ];

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-5xl">
        <AdminOverview
          eyebrow={`${profile?.name?.split(" ")[0] || "Ylläpito"} · Puuhapatet`}
          heroLabel={heroLabel}
          heroValue={heroValue}
          shares={isHost ? [
            { label: "Urakat", cents: heroGigCents, text: eur0(heroGigCents) },
            { label: "Pikkukeikat", cents: heroSmallCents, text: eur0(heroSmallCents) },
          ] : undefined}
          figures={overviewFigures}
          months={isHost
            ? monthSeries(smallGigMonths, gigMoney?.totals.monthlyInvoicedCents ?? {})
            : monthSeries(myMonths)}
          fmt={eur0}
          fmtExact={fmt}
          alert={overviewAlert}
          loading={loading || (isHost && smallGigCents === null)}
        />

        {/* Gigs where this admin also works (e.g. Petrus): own earnings + a
            button straight to the worker dashboard. Limited on purpose — no gig
            total, no other workers' euros. */}
        {myGigWork.map((g) => (
          <Card key={g.jobId} className="p-5 bg-card border-0 premium-shadow mb-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Oma keikka
                </p>
                <p className="text-base font-semibold text-foreground truncate">{g.gigName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{g.washed} pestyä ikkunaa</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ansaittu</p>
                <p className="text-base font-bold tabular-nums text-foreground">{fmt(g.earnedCents)}</p>
              </div>
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Maksettu</p>
                <p className="text-base font-bold tabular-nums text-green-600 dark:text-green-400">{fmt(g.paidCents)}</p>
              </div>
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avoinna</p>
                <p className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(Math.max(0, g.earnedCents - g.paidCents))}</p>
              </div>
            </div>
            <a href={`/tyo/${g.token}`} className="block">
              <Button className="w-full">
                Avaa oma työpöytä <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </Card>
        ))}

        <DashboardBriefing />

        {/* Tilitys — pudotusvalikon takana. Luvut ovat oikeat, mutta ne ovat
            erittely eivätkä tilannekuva: yleisnäkymä kertoo bruttotulon, ja
            palvelumaksun jälkeinen arvio kiinnostaa kertaa kuussa. */}
        {!isHost && myRevenue !== null && myRevenue > 0 && (() => {
          const brutto = Math.max(0, myRevenue - (myInvestmentShare ?? 0));
          const rate = profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE;
          const netto = Math.round(brutto * (1 - rate));
          return (
            <Disclosure
              className="mb-6"
              title="Tilitys"
              right={<span className="text-sm font-bold tabular-nums text-green-600 dark:text-green-400">{fmt(netto)}</span>}
            >
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bruttotulo</span>
                  <span className="font-medium text-foreground tabular-nums">{fmt(brutto)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">− Palvelumaksu ~{profile ? feePctForWorker(profile.id) : STAFF_SERVICE_FEE_PCT} %</span>
                  <span className="text-purple-600 dark:text-purple-400 tabular-nums">−{fmt(Math.round(brutto * rate))}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 mt-1">
                  <span className="text-muted-foreground">≈ Nettotulo</span>
                  <span className="font-bold text-green-600 dark:text-green-400 tabular-nums">{fmt(netto)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Arvio. Tarkat luvut: Verotuloste.
              </p>
            </Disclosure>
          );
        })()}

        {/* Tiimin talous — pudotusvalikon takana. Nämä neljä lukua eivät ole
            missään muualla (`/api/stats` on tämän sivun oma reitti), joten niitä
            ei poisteta — mutta ne ovat erittely, eivät avausluku.

            HUOM: `totalRevenue` sisälsi aiemmin valmiin urakkakeikan
            `agreedPrice`-katon, jolloin urakka laskettiin kahdesti (kerran täällä,
            kerran gig-money-reitillä). Reitti suodattaa urakat nyt pois. */}
        {!loading && stats && isHost && (
          <Disclosure
            className="mb-6"
            title="Tiimin talous"
            right={<span className="text-sm font-bold tabular-nums text-green-600 dark:text-green-400">{fmt(stats.netIncome)}</span>}
          >
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Tulot", value: stats.totalRevenue },
                { label: "Kulut", value: stats.totalExpenses },
                { label: "Palvelumaksu", value: stats.serviceFeeTotal },
              ].map((x) => (
                <div key={x.label}>
                  <p className="text-xs text-muted-foreground mb-0.5">{x.label}</p>
                  <p className="text-lg font-semibold text-foreground tabular-nums">{fmt(x.value)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Nettotulo</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400 tabular-nums">{fmt(stats.netIncome)}</p>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Pikkukeikat, koko tiimi. Urakat: Urakkakeikat-sivu.
            </p>
          </Disclosure>
        )}
        {!isHost && (
          <Link href="/admin/talous">
            <Card className="p-4 bg-card border-0 premium-shadow mb-8 cursor-pointer hover:opacity-95 transition-opacity">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Omat tulot
                  </p>
                  <p className="text-sm text-foreground font-medium">Katso oma verotuloste</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Omat keikat · palvelumaksu · nettotulo verotusta varten
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </div>
            </Card>
          </Link>
        )}

        {/* Worker service fee debts — HOST only */}
        {isHost && workerStats && (
          <Disclosure
            className="mb-8"
            title="Tekijöiden palvelumaksut — maksamatta"
            right={(() => {
              const totalOwed = USERS.reduce((s, u) => s + (workerStats.workerFees[u.id] ?? 0), 0);
              return <span className={`text-sm font-bold tabular-nums ${totalOwed > 0 ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>{fmt(totalOwed)}</span>;
            })()}
          >
            <div className="space-y-3">
              {USERS.map((u) => {
                const owed = workerStats.workerFees[u.id] ?? 0;
                const jobCount = workerStats.workerJobCount[u.id] ?? 0;
                return (
                  <div key={u.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/tiimi/${u.id}`} aria-label={`Avaa ${u.name}`} className="shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95">
                        {u.photoUrl ? (
                          <img
                            src={u.photoUrl}
                            alt={u.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {u.name[0]}
                            </span>
                          </div>
                        )}
                      </Link>
                      <div>
                        <p className="text-sm font-medium text-foreground">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {jobCount} valmista keikkaa
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-base font-bold ${owed > 0 ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>
                        {fmt(owed)}
                      </p>
                      <p className="text-xs text-muted-foreground">velassa</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
              Laskettu valmistuneista keikoista: (hinta − kulut) × palvelumaksu-% per tekijä — perustajat {HOST_SERVICE_FEE_PCT} %, työntekijät {STAFF_SERVICE_FEE_PCT} %
            </p>
          </Disclosure>
        )}

        {/* Kaksi sisäänkäyntiä, ei enempää. "Uusi keikka" ja "Keikat" olivat
            omina kortteinaan, vaikka molemmat ovat navipalkissa sekä
            puhelimessa että työpöydällä. Asiakkaat EI ole puhelimen
            navipalkissa, joten se kortti on siellä ainoa reitti. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {[
            { href: "/admin/customers", icon: Users, title: "Asiakkaat" },
            { href: "/admin/gigs", icon: Building2, title: "Urakkakeikat" },
          ].map((x) => {
            const Icon = x.icon;
            return (
              <Link key={x.href} href={x.href}>
                <Card className="p-5 bg-card border-0 premium-shadow cursor-pointer hover:opacity-95 transition-opacity h-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                        <Icon className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <h3 className="font-semibold text-foreground">{x.title}</h3>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

      </div>
    </div>
  );
}
