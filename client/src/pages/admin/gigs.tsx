/**
 * Urakkakeikat — keikkahakemisto (`/admin/gigs`).
 *
 * MIKSI TÄMÄ SIVU ON OLEMASSA: urakkakeikkaan pääsi tähän asti vain
 * `/admin/jobs`-listan kautta, jossa se on yksi rivi kaikkien pikkukeikkojen
 * seassa, tai suoralla `/admin/gig/:id`-osoitteella. Niin kauan kuin keikkoja
 * oli yksi (FR8), se riitti; kahdella se ei riitä (ks.
 * `docs/uusi-keikka-ja-asiakas.md`, aukko 5: "Ei keikkalistaa eikä
 * keikanvalitsinta"). Tämä sivu on se valitsin.
 *
 * KAKSI LÄHDETTÄ, ERI TEHTÄVÄ:
 *
 *   `api.getJobs()`     → LISTA. Kaikki `isCustomGig`-keikat, myös vasta
 *                         perustettu jolla ei ole vielä senttiä rahaa.
 *   `api.getGigMoney()` → RAHA. Vain perustajille, ja se jättää tarkoituksella
 *                         pois keikat joilla ei ole maksuja eikä erälaskuja
 *                         (server/routes.ts: "Keikka ilman rahaa ei kuulu
 *                         listalle"). Jos tämä olisi listan lähde, uusi keikka
 *                         olisi näkymätön juuri sinä hetkenä kun sitä
 *                         perustetaan — eli aina kun tätä sivua tarvitaan.
 *
 * Raha on siis LISÄTIETO joka liitetään riviin `jobId`:llä, ei listan runko.
 *
 * JAKO OSIOIHIN: käynnissä olevat ovat auki, päättyneet dropdownin takana.
 * Ero on työn ero, ei makuasia — käynnissä olevaa keikkaa katsotaan päivittäin,
 * valmista kerran kuussa kirjanpidon takia. Päättyneet EI poisteta listalta:
 * niiden rahaluvut ovat edelleen ainoa paikka josta näkee mitä keikka tuotti.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Loader2, Plus, Building2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { customerTypeOf, CUSTOMER_TYPE_LABEL } from "@shared/schema";
import { cn } from "@/lib/utils";

type DbStatus = "lead" | "scheduled" | "in_progress" | "done" | "cancelled";

const STATUS_LABEL: Record<DbStatus, string> = {
  lead: "Liidi",
  scheduled: "Ajoitettu",
  in_progress: "Käynnissä",
  done: "Valmis",
  cancelled: "Peruutettu",
};

const STATUS_TONE: Record<DbStatus, string> = {
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  scheduled: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  in_progress: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

/** Keikka on "auki" niin kauan kuin se ei ole valmis eikä peruutettu. */
const OPEN_STATUSES: DbStatus[] = ["lead", "scheduled", "in_progress"];

/**
 * `/api/jobs`-rivin ne kentät joita tämä sivu käyttää.
 *
 * HUOM MITÄ TÄSSÄ EI OLE: `gigData` eikä `projectData`. Keikkalista ei kanna
 * niitä mukanaan tahallaan — ne ovat kymmeniä megatavuja per keikka, ja niiden
 * lukeminen monelle riville poltti tietokannan siirtokiintiön kertaalleen
 * (yleiskuvan "Säilytys ja siirtokiintiö"). Siksi tämä sivu EI voi lukea
 * blobista yrityksen nimeä, ikkunamääriä eikä korvaustapaa; se käyttää sitä
 * mitä listalla ja rahareitillä on. Ks. `gigName` ja `communityHint` alla.
 */
interface GigJobRow {
  job: {
    id: number;
    description: string;
    agreedPrice: number;
    status: DbStatus;
    createdAt: string;
    updatedAt: string;
    isCustomGig?: boolean | null;
  };
  customer: {
    id: number;
    name: string;
    companyName?: string | null;
    customerType?: string | null;
    isYritys?: boolean | null;
    address?: string;
  } | null;
}

type GigMoney = NonNullable<Awaited<ReturnType<typeof api.getGigMoney>>["data"]>;
type GigMoneyRow = GigMoney["gigs"][number];

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/**
 * Yksi keikkarivi. Omana komponenttina koska sama rivi piirretään kolmessa
 * osiossa (käynnissä / valmiit / peruutetut) — kopio kolmesti oli varma tapa
 * saada niistä kolme eri riviä.
 */
function GigRow({
  row, m, isHost, moneyLoaded, founderName,
}: {
  row: GigJobRow;
  m: GigMoneyRow | undefined;
  isHost: boolean;
  /** Rahareitti on vastannut. Ilman tätä "ei laskutusta" välähtäisi latauksen ajan. */
  moneyLoaded: boolean;
  founderName: (id: string) => string;
}) {
  const { job, customer } = row;
  /**
   * Nimi. Yrityksen nimi asuu `GigData.company`ssa jota tämä reitti ei tuo (ks.
   * `GigJobRow`), joten paras saatavilla oleva lähde on rahareitin `name` —
   * palvelin muodostaa sen juuri siitä blobista (`gig?.company?.name ||
   * job.description`). Ilman rahaa keikkaa ei ole rahareitillä lainkaan, ja
   * silloin jää kuvaus.
   */
  const gigName = m?.name || job.description || `Keikka #${job.id}`;
  // Yhdistyksen/yrityksen nimi on eri asia kuin yhteyshenkilö — molemmat
  // näytetään, jottei "Stuhi" ja "Akseli" sekoitu.
  const orgName = customer?.companyName?.trim() || null;
  const custType = customerTypeOf(customer);
  /**
   * YHTEISÖKEIKKA — PÄÄTELMÄ, EI LIPPU.
   *
   * Oikea tieto on `ProjectData.compensation === "community"`
   * (`isCommunityGig`), ja se asuu projektiblobissa jota tämä lista ei lue.
   * Mitä tiedämme: palvelin kirjoittaa yhteisökeikan `agreedPrice`n
   * NIMENOMAISESTI nollaksi joka projektin tallennuksella ("vapaaehtoistyö ei
   * saa päätyä agreedPriceen"), ja maksullinen keikka syntyy
   * `/admin/new-gig`issa aina positiivisella sopimusarvolla (ks. sen
   * "SOPIMUSARVON SÄÄNTÖ"). Nolla on siis vahva vihje — mutta se on vihje: sen
   * voi saada myös keikka jonka hinnat on käsin nollattu. Siksi merkki on
   * "0 €", ei väite korvaustavasta, ja varmistus tapahtuu keikan asetuksissa.
   */
  const communityHint = job.agreedPrice === 0;

  return (
    // Linkki on itse osumakohde: <a> antaa näppäimistöfokuksen, Enterin ja
    // "avaa uuteen välilehteen" ilmaiseksi. Pelkkä onClick-div ei anna niistä
    // mitään.
    <Link
      href={`/admin/gig/${job.id}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-testid={`gig-row-${job.id}`}
    >
      <Card className="p-4 bg-card border-0 premium-shadow hover:opacity-90 transition-opacity">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground truncate">{gigName}</p>
            <p className="text-sm text-muted-foreground truncate">
              {orgName && orgName !== gigName ? `${orgName} · ` : ""}
              {customer?.name ?? "Ei asiakasta"}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {/* Keikan laji: rahaton vs. maksullinen. */}
          {communityHint ? (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
              title="Sopimusarvo 0 € — yhteisökeikan tunnusmerkki. Korvaustapa varmistetaan keikan asetuksista."
            >
              Yhteisökeikka · 0 €
            </Badge>
          ) : (
            // `agreedPrice` näkyy jokaiselle ylläpitäjälle myös
            // `/admin/jobs`-listalla, joten tässä ei ole uutta tietovuotoa —
            // rahaportti koskee gig-money-lukuja.
            <Badge variant="secondary" title="Sopimusarvo: kiinteä katto + lukitut keltaiset">
              Sopimus {fmt(job.agreedPrice)}
            </Badge>
          )}

          {/* Etenemä siinä tarkkuudessa kuin tämä lista sen tietää: keikan
              status. Ikkunakohtainen prosentti tulisi projektiblobista, jota ei
              lueta listalle. */}
          <Badge variant="secondary" className={STATUS_TONE[job.status] ?? STATUS_TONE.lead}>
            {STATUS_LABEL[job.status] ?? job.status}
          </Badge>

          {custType !== "henkilo" && (
            <Badge variant="outline" className="text-muted-foreground">
              {CUSTOMER_TYPE_LABEL[custType]}
            </Badge>
          )}
        </div>

        {/* ── Raha: vain perustajalle ─────────────────────────────────────── */}
        {isHost && m && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { label: "Laskutettu", value: fmt(m.invoicedCents), tone: "text-foreground" },
              { label: "Tekijöille", value: fmt(m.workerPaidCents), tone: "text-foreground" },
              {
                // Sama luku kuin dashboardin "Jää meille": laskutettu −
                // tekijöiden ANSAINTA (ei maksettu), eli kate ei näytä
                // paremmalta vain siksi että palkat ovat vielä maksamatta.
                label: "Kate",
                value: fmt(m.invoicedCents - m.workerEarnedCents),
                tone: "text-green-600 dark:text-green-400",
              },
            ].map((t) => (
              <div key={t.label} className="rounded-xl bg-muted/40 py-2 px-2 min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{t.label}</p>
                <p className={cn("text-sm font-bold tabular-nums", t.tone)}>{t.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Rahareitti jättää rahattoman keikan pois. Nollat näyttäisivät
            virheeltä ("miksi laskutettu 0 €?"), joten tilalle sanotaan mikä
            tilanne oikeasti on. */}
        {isHost && moneyLoaded && !m && (
          <p className="mt-3 text-xs text-muted-foreground">
            Ei vielä laskutusta — keikalle ei ole kirjattu maksuja eikä erälaskuja.
          </p>
        )}

        {/* ── Huomiot ─────────────────────────────────────────────────────── */}
        {isHost && m && m.unassignedEraCount > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              {/* SUMMA MUKAAN. Kappalemäärä ei kerro onko kyse kahdesta kympistä
                  vai kahdesta tuhannesta, ja euroluku oli koko sovelluksessa
                  vain etusivun rahakortissa — joka on nyt purettu. */}
              {fmt(m.unassignedCents)} ({m.unassignedEraCount} erä{m.unassignedEraCount === 1 ? "" : "ä"}) ilman
              merkintää siitä kumpi rahat sai — kohdentamaton raha ei kuulu kenellekään eikä ole
              tasauksessa mukana.
            </span>
          </p>
        )}

        {/* SUUNTA MUKAAN. Pelkkä summa ("Tasaus 1 271,25 €") oli tässä repossa
            jo kertaalleen virhe: se on ainoa paikka joka tietää kuka maksaa,
            eikä se kertonut sitä. Nimet ovat roolimerkinnän takana
            ("maksaja"/"saaja"), koska taivutettu muoto ("Matias Pitkänenlle")
            menisi väärin. */}
        {/* Alle euron siirto on pyöristyskohinaa (sama raja kuin dashboardin
            tasauslauseessa) — ei varoituksen arvoinen. */}
        {isHost && m?.transfer && m.transfer.cents >= 100 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Tasaus {fmt(m.transfer.cents)}: maksaja {founderName(m.transfer.fromId)} →
            saaja {founderName(m.transfer.toId)}
          </p>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          Päivitetty {new Date(job.updatedAt || job.createdAt).toLocaleDateString("fi-FI")}
        </p>
      </Card>
    </Link>
  );
}

export default function AdminGigsPage() {
  const [, navigate] = useLocation();
  const profile = getAdminProfile();
  // Sama portti kuin dashboardin "Urakkakeikat — raha" -kortissa: eurot ovat
  // perustajien tietoa. Palvelin torjuu myös itse (403), mutta ilman tätä
  // ehtoa muu ylläpito näkisi turhan virheen ja tyhjät rahatiilet.
  const isHost = profile?.role === "HOST";

  const [gigs, setGigs] = useState<GigJobRow[]>([]);
  const [money, setMoney] = useState<GigMoney | null>(null);
  const [moneyLoaded, setMoneyLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getJobs().then((res) => {
      const rows = (res.ok && res.data ? res.data : []) as GigJobRow[];
      setGigs(rows.filter((r) => !!r.job?.isCustomGig));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!isHost) return;
    api.getGigMoney().then((res) => {
      if (res.ok && res.data) setMoney(res.data);
      setMoneyLoaded(true);
    });
  }, [isHost]);

  const moneyByJob = new Map<number, GigMoneyRow>((money?.gigs ?? []).map((g) => [g.jobId, g]));
  const founderName = (id: string) =>
    (money?.founders.find((f) => f.id === id)?.name ?? id).split(" ")[0];

  /**
   * Järjestys: viimeksi päivitetty ensin.
   *
   * `jobs.updatedAt` leimataan myös karttablobin tallennuksesta, eli se
   * seuraa oikeaa työtä (pesumerkinnät) eikä pelkkiä hallinnollisia muutoksia.
   * Rahajärjestys (isoin laskutettu ensin) olisi toinen vaihtoehto, mutta se
   * hautaisi juuri perustetun keikan pohjalle — ja tämä sivu on nimenomaan
   * sitä varten, että uusi keikka löytyy heti.
   */
  const sorted = [...gigs].sort((a, b) => {
    const t = (r: GigJobRow) => new Date(r.job.updatedAt || r.job.createdAt).getTime() || 0;
    return t(b) - t(a);
  });

  const open = sorted.filter((r) => OPEN_STATUSES.includes(r.job.status));
  const done = sorted.filter((r) => r.job.status === "done");
  const cancelled = sorted.filter((r) => r.job.status === "cancelled");
  // Tuntematon status ei saa kadottaa keikkaa listalta: se on silloin auki.
  const other = sorted.filter(
    (r) => !OPEN_STATUSES.includes(r.job.status) && r.job.status !== "done" && r.job.status !== "cancelled",
  );
  const active = [...open, ...other];

  const row = (r: GigJobRow) => (
    <GigRow
      key={r.job.id}
      row={r}
      m={moneyByJob.get(r.job.id)}
      isHost={isHost}
      moneyLoaded={moneyLoaded}
      founderName={founderName}
    />
  );

  /** Osion yhteenlaskettu laskutus — dropdownin otsikossa, jottei sitä tarvitse
   *  avata nähdäkseen paljonko siellä on rahaa. */
  const sumInvoiced = (rows: GigJobRow[]) =>
    rows.reduce((acc, r) => acc + (moneyByJob.get(r.job.id)?.invoicedCents ?? 0), 0);

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon" aria-label="Takaisin dashboardille">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Urakkakeikat</h1>
            <p className="text-muted-foreground text-sm">
              {loading
                ? "Ladataan…"
                : `${active.length} käynnissä${done.length ? ` · ${done.length} valmis` : ""}`}
            </p>
          </div>
          <Link href="/admin/new-gig" className="shrink-0">
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              Uusi
            </Button>
          </Link>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <EmptyState
            icon={Building2}
            title="Ei urakkakeikkoja"
            description="Urakkakeikka on karttapohjainen keikka omalla asiakas- ja tekijänäkymällä. Perusta ensimmäinen — asiakas ja keikka syntyvät samalla kertaa."
            actionLabel="Perusta urakkakeikka"
            onAction={() => navigate("/admin/new-gig")}
          />
        )}

        {/* ── Käynnissä: aina auki ────────────────────────────────────────── */}
        {!loading && active.length > 0 && (
          <div className="space-y-3 mb-4">{active.map(row)}</div>
        )}

        {/* Kaikki keikat ovat päättyneet: tyhjä väli näyttäisi virheeltä. */}
        {!loading && active.length === 0 && sorted.length > 0 && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-4">
            <p className="text-sm text-muted-foreground">
              Ei käynnissä olevia urakkakeikkoja. Päättyneet löytyvät alta.
            </p>
          </Card>
        )}

        {/* ── Valmiit: dropdownin takana ──────────────────────────────────── */}
        {!loading && done.length > 0 && (
          <Disclosure
            title={`Valmiit (${done.length})`}
            icon={<CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />}
            right={
              isHost && moneyLoaded ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {fmt(sumInvoiced(done))} laskutettu
                </span>
              ) : undefined
            }
            contentClassName="space-y-3"
          >
            {done.map(row)}
          </Disclosure>
        )}

        {/* ── Peruutetut: omana osiona, ei "valmiiden" seassa ─────────────── */}
        {!loading && cancelled.length > 0 && (
          <Disclosure
            title={`Peruutetut (${cancelled.length})`}
            icon={<XCircle className="w-4 h-4 text-muted-foreground" />}
            contentClassName="space-y-3"
          >
            {cancelled.map(row)}
          </Disclosure>
        )}
      </div>
    </div>
  );
}
