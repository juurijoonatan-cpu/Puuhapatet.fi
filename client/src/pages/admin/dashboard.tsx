/**
 * Admin Dashboard
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Clock,
  TrendingUp,
  Banknote,
  Plus,
  ArrowRight,
  List,
  Users,
} from "lucide-react";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { DashboardBriefing } from "@/components/dashboard-briefing";
import RevenueHero, { type HeroMonth } from "@/components/admin/RevenueHero";
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
  const [myJobUpcoming, setMyJobUpcoming] = useState<number | null>(null);
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
          setMyJobUpcoming(mine.filter(r => r.job.status === "scheduled").length);
          const rev = mine
            // A declined quote earned nothing — keep it out of personal income.
            // URAKKAKEIKAT POIS. Niiden `agreedPrice` on sopimuksen KATTO, ei
            // ansaittua rahaa, eikä se jakaudu tekijämäärällä. Jos urakkakeikka
            // merkitään valmiiksi, tämä summa hyppäisi kattoon jaettuna
            // tekijöillä — luku joka ei ole liikevaihtoa eikä katetta. Kaikki
            // muut tämän taulun lukijat suodattavat urakkakeikat pois
            // (server/finance/settlement.ts, post.ts); tämä oli ainoa joka ei.
            // Urakkakeikkojen oma ansio tulee `entitledByFounder`ista alla.
            .filter(r => r.job.status === "done" && r.job.quoteStatus !== "declined"
              && !r.job.isCustomGig && !r.job.gigData)
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
   * laskutettu mitään"), joten sen pitää näkyä tyhjänä pylväänä. Jos sarjaan
   * otettaisiin vain ne kuukaudet joissa on rahaa, kaksi kuukautta joiden
   * välissä on puolen vuoden tauko näyttäisivät vierekkäisiltä.
   */
  const heroMonths: HeroMonth[] = (() => {
    const merged: Record<string, number> = { ...smallGigMonths };
    for (const [k, v] of Object.entries(gigMoney?.totals.monthlyInvoicedCents ?? {})) {
      merged[k] = (merged[k] ?? 0) + v;
    }
    const keys = Object.keys(merged).sort();
    if (keys.length === 0) return [];
    const [fy, fm] = keys[0].split("-").map(Number);
    const now = new Date();
    const out: HeroMonth[] = [];
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
  })();

  const myDebt = workerStats && profile ? (workerStats.workerFees[profile.id] ?? 0) : null;
  const myJobCount = workerStats && profile ? (workerStats.workerJobCount[profile.id] ?? 0) : null;

  const cards = isHost
    ? [
        {
          title: "Omat keikat",
          value: myJobTotal === null ? "…" : String(myJobTotal),
          icon: Briefcase,
          description: "Kaikki omat kirjatut keikat",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
        },
        {
          title: "Tulevat keikat",
          value: myJobUpcoming === null ? "…" : String(myJobUpcoming),
          icon: Clock,
          description: "Aikataulutettu (omat)",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
        },
        {
          title: "Oma tulo",
          value: myRevenue === null ? "…" : fmt(Math.max(0, myRevenue + myGigEntitled - (myInvestmentShare ?? 0))),
          icon: TrendingUp,
          // Kolme osaa erikseen, koska yksi luku ilman erittelyä oli juuri se
          // mikä ei täsmännyt millään: urakkakeikkojen ansio puuttui kokonaan.
          description: [
            `Pikkukeikat ${myRevenue !== null ? fmt(myRevenue) : "…"}`,
            myGigEntitled > 0 ? `urakat ${fmt(myGigEntitled)}` : null,
            myInvestmentShare ? `− investoinnit ${fmt(myInvestmentShare)}` : null,
          ].filter(Boolean).join(" + ").replace("+ −", "−"),
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Oma palveluvelka",
          value: myDebt === null ? "…" : fmt(myDebt),
          icon: Banknote,
          description: `${HOST_SERVICE_FEE_PCT} % brändille — maksamatta`,
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
        },
      ]
    : [
        {
          title: "Omat keikat",
          value: myJobTotal === null ? "…" : String(myJobTotal),
          icon: Briefcase,
          description: "Kaikki omat kirjatut keikat",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
        },
        {
          title: "Tulevat keikat",
          value: myJobUpcoming === null ? "…" : String(myJobUpcoming),
          icon: Clock,
          description: "Aikataulutettu (omat)",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
        },
        {
          title: "Bruttotulo",
          value: myRevenue === null ? "…" : fmt(Math.max(0, myRevenue - (myInvestmentShare ?? 0))),
          icon: TrendingUp,
          description: myInvestmentShare
            ? `Keikat ${myRevenue !== null ? fmt(myRevenue) : "…"} − investoinnit ${fmt(myInvestmentShare)} (ennen palvelumaksua)`
            : `${myJobCount ?? "…"} valmistunutta keikkaa — ennen kuluja ja palvelumaksua`,
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Palveluvelka",
          value: myDebt === null ? "…" : fmt(myDebt),
          icon: Banknote,
          description: `${STAFF_SERVICE_FEE_PCT} % brändille — maksamatta`,
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
        },
      ];

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-5xl">
        {isHost && (
          <RevenueHero
            invoicedCents={heroGigCents + heroSmallCents}
            gigCents={heroGigCents}
            smallCents={heroSmallCents}
            myIncomeCents={heroMyIncome}
            myName={profile?.name?.split(" ")[0] || "Oma"}
            months={heroMonths}
            loading={loading || smallGigCents === null}
          />
        )}

        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
            Hei, {profile?.name?.split(" ")[0] || "Ylläpitäjä"}
          </h1>
          <p className="text-muted-foreground">Tervetuloa Puuhapatet-ylläpitoon</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {cards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="p-4 md:p-5 bg-card border-0 premium-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-semibold text-foreground mb-1">{stat.value}</p>
                <p className="text-sm text-foreground">{stat.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </Card>
            );
          })}
        </div>

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

        {/* URAKKAKEIKKOJEN RAHA — laskutettu, saatu ja tekijöille siirtämättä.
            Perustajille. Klikkaus vie keikan omaan Maksut-näkymään, jossa
            tasaus tehdään; tämä kortti on tilannekuva, ei toimintoja. */}
        {isHost && gigMoney && gigMoney.totals.invoicedCents > 0 && (
          <Card className="p-5 bg-card border-0 premium-shadow mb-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Urakkakeikat — raha
                </p>
                <p className="text-sm text-muted-foreground">
                  Asiakkailta laskutettu ja tekijöille siirretty
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Laskutettu", value: fmt(gigMoney.totals.invoicedCents), tone: "text-foreground" },
                { label: "Tekijöille maksettu", value: fmt(gigMoney.totals.workerPaidCents), tone: "text-foreground" },
                {
                  label: "Tekijöille siirtämättä",
                  value: fmt(gigMoney.totals.workerOpenCents),
                  tone: gigMoney.totals.workerOpenCents > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
                },
                {
                  label: "Jää meille",
                  value: fmt(gigMoney.totals.invoicedCents - gigMoney.totals.workerEarnedCents),
                  tone: "text-green-600 dark:text-green-400",
                },
              ].map((t) => (
                <div key={t.label} className="rounded-xl bg-muted/40 py-2.5 px-3 min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{t.label}</p>
                  <p className={`text-base font-bold tabular-nums ${t.tone}`}>{t.value}</p>
                </div>
              ))}
            </div>

            {/* Kumpi johtaja on kerännyt mitäkin — ja kumpi on velkaa kummalle.
                HUOM: velan mitta on `dueByFounder` (poikkeama keskiarvosta), EI
                `netByFounder`. Netto on `käsissä − oma osuus`, ja rivien
                nettojen summa on määritelmällisesti tekijöille kuuluva varaus
                (invariantti 17). Kun tässä näytettiin nettoa, MOLEMMAT johtajat
                lukivat "pitää liikaa" yhtä aikaa — velkalukemana mahdotonta —
                ja luku oli oikeasti kummankin puolikas tekijöiden rahoista. */}
            <div className="space-y-1.5 border-t border-border pt-3">
              {gigMoney.founders.map((f) => {
                const received = gigMoney.totals.receivedByFounder[f.id] ?? 0;
                const due = gigMoney.totals.dueByFounder?.[f.id] ?? 0;
                return (
                  <div key={f.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground truncate">{f.name}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="tabular-nums text-foreground">{fmt(received)}</span>
                      {Math.abs(due) >= 100 && (
                        <span className={`text-xs tabular-nums ${due > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                          {due > 0 ? `maksaa ${fmt(due)}` : `saa ${fmt(-due)}`}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}

              {/* Yksi lause siitä mitä pankissa oikeasti liikkuu — ja polku sinne
                  missä sen voi kuitata. Luku ilman toimintoa on umpikuja: siirto
                  merkitään tehdyksi keikan Maksut-näkymän tasausosiossa
                  ("Merkitse siirretyksi"), eikä sinne päässyt tästä mitenkään. */}
              {(() => {
                const tr = gigMoney.totals.transfer;
                const nameOf = (id: string) => gigMoney.founders.find((x) => x.id === id)?.name ?? id;
                const moneyGigs = gigMoney.gigs ?? [];
                const settleHref = moneyGigs.length === 1
                  ? `/admin/gig/${moneyGigs[0].jobId}/projekti`
                  : "/admin/gigs";
                if (!tr || tr.cents < 100) {
                  return <p className="text-xs text-green-600 dark:text-green-400 pt-1">Tasan</p>;
                }
                return (
                  <Link
                    href={settleHref}
                    className="block text-xs text-amber-600 dark:text-amber-400 pt-1 hover:underline"
                  >
                    Tasaus {fmt(tr.cents)}: {nameOf(tr.fromId)} → {nameOf(tr.toId)} · merkitse tehdyksi →
                  </Link>
                );
              })()}

              {/* Tekijöiden raha erikseen, jottei sitä lueta johtajien katteeksi. */}
              {(gigMoney.totals.reserveCents ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Tekijöille kuuluvaa käsissä {fmt(gigMoney.totals.reserveCents ?? 0)}
                </p>
              )}

              {/* Maksut ilman maksajaa vääristävät yllä olevia lukuja. Keikan oma
                  tasausnäkymä varoittaa tästä; etusivu ei varoittanut lainkaan. */}
              {(gigMoney.totals.unattributedPaidCents ?? 0) > 0 && (
                <Link
                  href={(gigMoney.gigs ?? []).length === 1 ? `/admin/gig/${(gigMoney.gigs ?? [])[0].jobId}/projekti` : "/admin/gigs"}
                  className="block text-xs text-amber-600 dark:text-amber-400 pt-1 hover:underline"
                >
                  {fmt(gigMoney.totals.unattributedPaidCents ?? 0)} maksettu ilman maksajamerkintää →
                </Link>
              )}
              {gigMoney.totals.unassignedCents > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
                  {fmt(gigMoney.totals.unassignedCents)} laskutettu ilman merkintää siitä kuka rahat sai.
                </p>
              )}
            </div>

            {/* Per keikka — vain ne joissa on jotain kesken. */}
            {gigMoney.gigs.filter((g) => g.transfer || g.unassignedEraCount > 0).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                {gigMoney.gigs.filter((g) => g.transfer || g.unassignedEraCount > 0).map((g) => (
                  <Link key={g.jobId} href={`/admin/gig/${g.jobId}/projekti`}>
                    <div className="flex items-center justify-between gap-3 text-sm cursor-pointer hover:opacity-80 transition-opacity">
                      <span className="text-foreground truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {g.transfer
                          // Suunta mukaan: `fromId`/`toId` tulivat jo mukana,
                          // mutta rivi näytti pelkän summan — eli sen ainoan
                          // paikan joka tiesi kuka maksaa, ei kertonut sitä.
                          ? `${gigMoney.founders.find((x) => x.id === g.transfer!.fromId)?.name?.split(" ")[0] ?? g.transfer.fromId} maksaa ${fmt(g.transfer.cents)} →`
                          : `${g.unassignedEraCount} erää merkitsemättä →`}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}

        <DashboardBriefing />

        {/* STAFF: personal earnings breakdown note */}
        {!isHost && myRevenue !== null && myRevenue > 0 && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tilitys — erittely
            </p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bruttotulo (keikat)</span>
                <span className="font-medium text-foreground">{fmt(Math.max(0, myRevenue - (myInvestmentShare ?? 0)))}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">− Palvelumaksu ~{profile ? feePctForWorker(profile.id) : STAFF_SERVICE_FEE_PCT} %</span>
                <span className="text-purple-600 dark:text-purple-400">−{fmt(Math.round(Math.max(0, myRevenue - (myInvestmentShare ?? 0)) * (profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE)))}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 mt-1">
                <span className="text-muted-foreground">≈ Nettotulo</span>
                <span className="font-bold text-green-600 dark:text-green-400">
                  {fmt(Math.round(Math.max(0, myRevenue - (myInvestmentShare ?? 0)) * (1 - (profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE))))}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Arvio — tarkka netto riippuu kirjatuista kuluista. Katso täsmälliset luvut Verotulosteesta.
            </p>
          </Card>
        )}

        {/* Revenue breakdown — HOST: team view, STAFF: personal earnings link */}
        {!loading && stats && isHost && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-8">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Talous — erittely (tiimi)
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Tulot</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Kulut</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.totalExpenses)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Palvelumaksu</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.serviceFeeTotal)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Nettotulo</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">{fmt(stats.netIncome)}</p>
            </div>
          </Card>
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

        <Link href="/admin/new">
          <Card className="p-6 bg-primary text-primary-foreground border-0 mb-8 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Uusi keikka</h2>
                  <p className="text-primary-foreground/80 text-sm">
                    Aloita uuden asiakkaan palveluprosessi
                  </p>
                </div>
              </div>
              <ArrowRight className="w-6 h-6" />
            </div>
          </Card>
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Link href="/admin/jobs">
            <Card className="p-5 bg-card border-0 premium-shadow cursor-pointer hover:opacity-95 transition-opacity h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <List className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Keikat</h3>
                    <p className="text-sm text-muted-foreground">Selaa ja hae keikkoja</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </Card>
          </Link>
          <Link href="/admin/customers">
            <Card className="p-5 bg-card border-0 premium-shadow cursor-pointer hover:opacity-95 transition-opacity h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Users className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Asiakkaat</h3>
                    <p className="text-sm text-muted-foreground">Asiakasrekisteri</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </Card>
          </Link>
        </div>

        {profile?.role && (
          <div className="text-center text-xs text-muted-foreground">
            Rooli: {profile.role}
          </div>
        )}
      </div>
    </div>
  );
}
