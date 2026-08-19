/**
 * Urakkakeikan perustus (`/admin/new-gig`).
 *
 * Tämä on JÄRJESTELMÄN AINOA paikka jossa urakkakeikka syntyy: samalla
 * lähetyksellä syntyy asiakas, keikka, keikkablobi (`gigData`) ja karttablobi
 * (`projectData`), sekä asiakkaan jakolinkki. Kaikki myöhempi säätö tapahtuu
 * keikan seurantasivulla ja sen Asetuksissa.
 *
 * MITÄ TÄSSÄ RATKAISTAAN — ja miksi lomake on tässä järjestyksessä:
 *
 *  1. KEIKAN LAJI ensin. Maksullinen vai vastikkeeton yhteisökeikka. Tämä
 *     valinta ratkaisee kaiken muun (näytetäänkö euroja lainkaan), joten se ei
 *     voi olla lomakkeen lopussa.
 *  2. HINNOITTELUMALLI toisena. Järjestelmässä on kaksi aitoa mallia, ja ne
 *     eivät ole makuasia:
 *
 *       pohjakuva  Ikkunat merkitään kerroskuvalle. Palvelin JOHTAA
 *                  laskutussektorit kartasta (`syncGigSectorsFromProject`) heti
 *                  kun kartalla on yksikin ikkuna: yksi sektori per kerros,
 *                  yksi yhteinen ikkunahinta. Käsin syötetyt sektorit
 *                  KORVATAAN — siksi niitä ei tässä mallissa edes kysytä.
 *       sektorit   Ei pohjakuvaa. Laskutus erittelyn mukaan: jokainen sektori
 *                  on oma määrä ja oma yksikköhinta.
 *
 *     Vanha lomake tarjosi vain sektorit, joten pohjakuvakeikka (FR8, Stuhi)
 *     perustettiin syöttämällä sektoreita jotka palvelin heitti pois
 *     ensimmäisellä pesumerkinnällä.
 *  3. Loput ovat tietoja, eivät valintoja.
 *
 * MIKSI TÄMÄ PITI KORJATA:
 *  - Lomake vaati JOKAISELLE sektorille hinnan > 0, joten vastikkeetonta
 *    keikkaa EI VOINUT PERUSTAA lainkaan. Ainoa kiertotie oli perustaa
 *    maksullinen keikka ja nollata se jälkikäteen — jolloin väliin jäi hetki,
 *    jona keikalla oli oikea sopimusarvo ja se näkyi liikevaihdossa.
 *  - Tilaaja kirjattiin aina yritykseksi, joten yhdistys (ry) katosi.
 *  - Karttablobia ei luotu, joten uusi keikka jäi ilman `dealKind: "none"`
 *    -leimaa (ks. `newGigProjectData`) ja sen rakennuksen nimi/osoite jäi
 *    tyhjäksi vaikka ne juuri kysyttiin tässä.
 *
 * SOPIMUSARVON SÄÄNTÖ (`jobs.agreedPrice`): maksullisella keikalla se on
 * perustettaessa POSITIIVINEN (arvio × hinta tai sektorien katto) ja
 * yhteisökeikalla NOLLA. Keikkalista `/admin/gigs` lukee nollan yhteisökeikan
 * tunnusmerkiksi, koska se ei lue raskaita blobeja — jos maksullinen keikka
 * syntyisi nollalla, se näkyisi listalla vastikkeettomana. Palvelin laskee
 * arvon uudelleen joka projektitallennuksessa, joten arvio korjautuu itsestään.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, Plus, Trash2, Building2, FileText, Layers, Users, Map, HeartHandshake, Euro, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { emptyGigData, newSector, computeTotals, eur, type GigSector, type GigData } from "@shared/gig";
import { newGigProjectData, floorLabel, type ProjectData } from "@shared/project";
import { CUSTOMER_TYPE_LABEL } from "@shared/schema";
import { cn } from "@/lib/utils";

/**
 *  - `paid`      tavallinen maksullinen sopimuskeikka (kattomalli)
 *  - `community` yhteisökeikka: EI rahaa. Tyypillisesti yhdistykselle tehty
 *                vapaaehtoistyö. Hinta on aidosti 0, eikä asiakkaalle näytetä
 *                euroja missään.
 */
type GigKind = "paid" | "community";

/** Ks. tiedoston alun kohta 2. */
type PricingModel = "plan" | "sectors";

/** Merkinnät joilla käyttäjä tarkoittaa "ei mitään". Ks. `contractId` alla. */
const DASHES = new Set(["-", "–", "—"]);

const VAT_PAID = "Hintoihin ei lisätä arvonlisäveroa (AVL 3 §, vähäinen liiketoiminta).";
const VAT_COMMUNITY = "Vastikkeeton yhteisötyö — ei laskutusta eikä arvonlisäveroa.";

/** Kenttäselite: kertoo mitä kohtaan kuuluu, jottei sitä tarvitse arvata. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{children}</p>;
}

/**
 * Kahden vaihtoehdon valinta. Sama visuaalinen kieli kuin asiakassivun
 * `CustomerTypePicker`illa, ja sama saavutettavuus: oikea `radiogroup`, jotta
 * valinta luetaan ruudunlukijalle valintana eikä nappiriviksi.
 */
function Choice<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; title: string; icon: typeof Euro }[];
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2 mt-1">
        {options.map((o) => {
          const Icon = o.icon;
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2.5 border text-sm text-left transition-colors",
                active
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 font-semibold text-blue-700 dark:text-blue-300"
                  : "border-border text-muted-foreground hover:bg-muted/30",
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-blue-600" : "text-muted-foreground")} />
              <span className="leading-tight">{o.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function randomToken(): string {
  const a = Math.random().toString(36).slice(2, 10);
  const b = Date.now().toString(36);
  return `${a}${b}`.toLowerCase();
}

/**
 * "K, 1, 2" → ["K","1","2"]. Sama siivous kuin keikan Asetuksissa
 * (`FloorSetupTool`), jottei perustus tuota kerrosnimeä jota asetukset eivät
 * hyväksy. Tyhjät ja kaksoiskappaleet putoavat pois.
 */
function parseFloors(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const clean = part.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "").slice(0, 8).trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, 24);
}

export default function AdminNewGigPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const profile = getAdminProfile();

  // ── 1. Keikan laji ──────────────────────────────────────────────────────────
  const [kind, setKind] = useState<GigKind>("paid");
  /** Tilaajan laji. Yhdistyksellä on Y-tunnus kuten yrityksellä, mutta se ei ole
   *  yritys — ja se on yleensä syy siihen ettei keikasta makseta. */
  const [entityType, setEntityType] = useState<"yritys" | "ry">("yritys");
  const [theme, setTheme] = useState<"paper" | "tech">("paper");
  const community = kind === "community";

  // ── 2. Hinnoittelumalli ─────────────────────────────────────────────────────
  const [model, setModel] = useState<PricingModel>("plan");

  // Tilaaja
  const [company, setCompany] = useState({
    name: "", contact: "", businessId: "", email: "", phone: "", address: "", billing: "",
  });

  // Sopimus & kuvaus
  const [description, setDescription] = useState("");
  const [contractId, setContractId] = useState("");
  const [contractText, setContractText] = useState("");
  /**
   * Milloin asiakas allekirjoittaa.
   *
   *  - `first` asiakkaan linkki avautuu allekirjoitukseen, ja seuranta vasta sen
   *            jälkeen. Näin FR8 tehtiin.
   *  - `later` työ alkaa ilman sopimusta: linkki menee suoraan seurantaan, ja kun
   *            sopimus valmistuu se nousee samaan näkymään popuppina.
   *
   * MIKSI TÄMÄ ON VALINTA: aiemmin sitä ei valittu vaan se seurasi siitä, oliko
   * sopimusteksti-kenttään liitetty jotain. Tyhjä kenttä = ei porttia; teksti =
   * portti. Kumpaakaan ei kerrottu missään, ja sopimuksen liittäminen jälkikäteen
   * heitti seurantaa katsovan asiakkaan takaisin lomakkeelle.
   */
  const [signMode, setSignMode] = useState<"first" | "later">("first");
  const [vatNote, setVatNote] = useState(VAT_PAID);
  /** Käyttäjän itse kirjoittamaa ALV-huomautusta ei ylikirjoiteta lajin vaihdosta. */
  const [vatTouched, setVatTouched] = useState(false);
  const [customerNote, setCustomerNote] = useState("");
  const [invoiceInterval, setInvoiceInterval] = useState(100);

  // Pohjakuvamalli
  const [floorsText, setFloorsText] = useState("1");
  const [unitWord, setUnitWord] = useState("");
  const [estWindows, setEstWindows] = useState(0);
  const [rateText, setRateText] = useState("");
  const [hoursText, setHoursText] = useState("");

  // Sektorimalli
  const [sectors, setSectors] = useState<GigSector[]>([
    { ...newSector(0), name: "Sektori 1", unitLabel: "ikkuna" },
  ]);

  // Tekijät
  const [assigned, setAssigned] = useState<string[]>(profile ? [profile.id] : []);
  const [submitting, setSubmitting] = useState(false);

  const chooseKind = (k: GigKind) => {
    setKind(k);
    if (!vatTouched) setVatNote(k === "community" ? VAT_COMMUNITY : VAT_PAID);
  };

  const floors = parseFloors(floorsText);
  const rateCents = Math.max(0, Math.round((parseFloat(rateText.replace(",", ".")) || 0) * 100));
  const hoursPerWindow = (() => {
    const n = Math.round((Number(hoursText.replace(",", ".")) || 0) * 100) / 100;
    // Sama rajaus kuin sanitoijassa: 0 < x ≤ 24, muuten ei arviota lainkaan.
    return Number.isFinite(n) && n > 0 ? Math.min(24, n) : undefined;
  })();

  const sectorTotals = computeTotals({ ...emptyGigData(), sectors });
  /** Sopimusarvo perustettaessa. Ks. tiedoston alun "SOPIMUSARVON SÄÄNTÖ". */
  const capCents = community
    ? 0
    : model === "plan"
      ? estWindows * rateCents
      : sectorTotals.capCents;

  const updateSector = (i: number, patch: Partial<GigSector>) => {
    setSectors((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addSector = () => setSectors((prev) => [...prev, newSector(prev.length)]);
  const removeSector = (i: number) => setSectors((prev) => prev.filter((_, idx) => idx !== i));
  const toggleWorker = (id: string) =>
    setAssigned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Puuttuvat tiedot NIMELTÄ. Vanha lomake sanoi vain "Täytä yrityksen nimi ja
   * anna jokaiselle sektorille määrä ja yksikköhinta", vaikka nappi oli lukossa
   * ihan muusta syystä — eikä kertonut mikä kenttä oli tyhjä.
   */
  const missing: string[] = [];
  if (!company.name.trim()) missing.push("tilaajan nimi");
  if (model === "plan") {
    if (!floors.length) missing.push("vähintään yksi kerros tai tila");
    if (!(estWindows > 0)) missing.push("ikkunoiden arvioitu määrä");
    if (!community && !(rateCents > 0)) missing.push("hinta / ikkuna");
  } else {
    if (!sectors.length) missing.push("vähintään yksi sektori");
    if (sectors.some((s) => !(s.total > 0))) missing.push("jokaiselle sektorille määrä");
    if (!community && sectors.some((s) => !(s.unitPriceCents > 0))) missing.push("jokaiselle sektorille yksikköhinta");
  }
  const canSubmit = missing.length === 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // 1) Asiakas. `isYritys` on tosi myös yhdistykselle: sen jokainen seuraus
      //    (nimi + Y-tunnus käytössä, vapaa hinnoittelu, ei kotitalousvähennystä)
      //    on oikein myös ry:lle. `customerType` kertoo kumpi se on.
      const custRes = await api.createCustomer({
        name: company.contact || company.name,
        phone: company.phone || "-",
        email: company.email || undefined,
        address: company.address || company.name,
        isYritys: true,
        customerType: entityType,
        companyName: company.name,
        yTunnus: company.businessId || undefined,
        ownedBy: assigned.join(",") || profile?.id,
        notes: company.billing || undefined,
      });
      if (!custRes.ok || !custRes.data) throw new Error(custRes.error || "Asiakkaan luonti epäonnistui");
      const customerId = (custRes.data as any).id as number;

      // 2) Keikkablobi. Pohjakuvamallissa sektori on YKSI arviosektori: se antaa
      //    asiakasnäkymälle etenemän nimittäjän (0/15) jo ennen kuin kartalla on
      //    ikkunoita, ja palvelin korvaa sen kerroskohtaisilla heti kun on.
      const planSector: GigSector = {
        ...newSector(0),
        name: floors.length === 1 ? floorLabel({ floors, unitWord: unitWord.trim() || undefined }, floors[0]) : "Ikkunat",
        unitLabel: "ikkuna",
        total: estWindows,
        unitPriceCents: community ? 0 : rateCents,
      };
      const gig: GigData = {
        ...emptyGigData(),
        // Pelkkä viiva tarkoittaa "ei tunnusta", ei tunnusta nimeltä "-".
        // Ilman tätä asiakkaan sopimusnäkymän otsikoksi tuli "- · Tarjous & sopimus".
        contractId: DASHES.has(contractId.trim()) ? undefined : contractId.trim() || undefined,
        company: { ...company, entityType },
        contractText: contractText.trim() || undefined,
        vatNote: vatNote.trim() || undefined,
        customerNote: customerNote.trim() || undefined,
        customerTheme: theme,
        // Kirjataan NIMENOMAISESTI molemmat, jottei portin tila jää riippumaan
        // siitä sattuiko sopimusteksti-kenttään tulemaan merkkejä.
        requireSignature: signMode === "first" && !!contractText.trim(),
        contractLater: signMode === "later",
        sectors: model === "plan"
          ? [planSector]
          : sectors.map((s, i) => ({ ...s, unitPriceCents: community ? 0 : s.unitPriceCents, priority: i + 1 })),
        invoiceInterval: invoiceInterval > 0 ? invoiceInterval : 100,
        log: [{ t: Date.now(), text: community ? "Yhteisökeikka luotu" : "Keikka luotu", by: profile?.name }],
      };

      const token = randomToken();
      const jobRes = await api.createJob({
        customerId,
        description: description.trim() || `${company.name} — ${community ? "yhteisökeikka" : "sopimuskeikka"}`,
        agreedPrice: capCents,
        status: "in_progress",
        assignedTo: assigned.join(",") || profile?.id,
        isCustomGig: true,
        gigData: JSON.stringify(gig),
        quoteToken: token,
        isYritys: true,
      });
      if (!jobRes.ok || !jobRes.data) throw new Error(jobRes.error || "Keikan luonti epäonnistui");
      const jobId = (jobRes.data as any).id as number;

      // 3) Karttablobi. Tämä on se osa joka ennen puuttui: ilman sitä keikalla ei
      //    ole `dealKind: "none"` -leimaa (jolloin `fixedDealFor` voisi haistaa
      //    sen FR8:ksi pohjakuvapolun perusteella), eikä korvaustapaa lainkaan —
      //    ja rakennuksen nimi/osoite jäi tyhjäksi vaikka ne kysyttiin yllä.
      //
      //    Perustus ei saa kaatua tähän: keikka on jo olemassa ja toimii, ja
      //    kaikki nämä kentät ovat muokattavissa keikan Asetuksista. Siksi virhe
      //    kerrotaan, mutta seurantaan siirrytään silti.
      const base = newGigProjectData({ community });
      const project: ProjectData = {
        ...base,
        building: {
          ...base.building,
          name: company.name.trim() || undefined,
          address: company.address.trim() || undefined,
          floors: model === "plan" && floors.length ? floors : base.building.floors,
          ...(model === "plan" && unitWord.trim() ? { unitWord: unitWord.trim() } : {}),
        },
        // Pohjakuvamallissa tämä on keikan ainoa ikkunahinta ja palvelin johtaa
        // siitä kaikki sektorihinnat. Sektorimallissa se on kartan hinta, jos
        // kartalle joskus merkitään ikkunoita: sektori 1:n hinta on oikeampi
        // arvaus kuin FR8:n oletus 37,50 €.
        pricePerWindow: community
          ? 0
          : model === "plan"
            ? rateCents / 100
            : (sectors[0]?.unitPriceCents ?? 0) / 100 || base.pricePerWindow,
        ...(hoursPerWindow ? { estimatedHoursPerWindow: hoursPerWindow } : {}),
        updatedAt: Date.now(),
      };
      const projRes = await api.updateProject(jobId, project);
      if (!projRes.ok) {
        toast({
          variant: "destructive",
          title: "Keikka luotu, kartan alustus ei",
          description: "Täydennä kerrokset ja hinta keikan Asetuksista.",
        });
      } else {
        toast({ title: community ? "Yhteisökeikka luotu" : "Keikka luotu", description: "Seuranta ja asiakaslinkki ovat valmiina." });
      }
      navigate(`/admin/gig/${jobId}`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Virhe", description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/new">
            <Button variant="ghost" size="icon" aria-label="Takaisin"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Uusi urakkakeikka</h1>
            <p className="text-sm text-muted-foreground">Asiakas, keikka, kartta ja asiakaslinkki syntyvät kerralla</p>
          </div>
        </div>

        {/* ── 1. Keikan laji ─────────────────────────────────────────────── */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <HeartHandshake className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Keikan laji</h2>
          </div>

          <Choice<GigKind>
            label="Korvaus *"
            value={kind}
            onChange={chooseKind}
            options={[
              { id: "paid", title: "Maksullinen", icon: Euro },
              { id: "community", title: "Yhteisökeikka", icon: HeartHandshake },
            ]}
          />
          <Hint>
            {community
              ? "Vastikkeeton työ. Kaikki hinnat ovat 0 €, sopimusarvoa ei kirjata eikä keikka näy liikevaihdossa tai verotulosteessa. Asiakas ei näe euroja missään."
              : "Asiakas maksaa tehdyistä yksiköistä, enintään sovitun hintakaton verran. Osalaskutus hoituu seurantasivulta."}
          </Hint>

          <div className="mt-4">
            <Choice<"yritys" | "ry">
              label="Tilaaja *"
              value={entityType}
              onChange={setEntityType}
              options={[
                { id: "yritys", title: CUSTOMER_TYPE_LABEL.yritys, icon: Building2 },
                { id: "ry", title: CUSTOMER_TYPE_LABEL.ry, icon: Users },
              ]}
            />
            <Hint>
              {entityType === "ry"
                ? "Rekisteröity yhdistys. Y-tunnus on kuten yrityksellä, mutta liiketoimintaa ei yleensä ole — siksi keikka on usein yhteisökeikka."
                : "Y-tunnuksellinen yritys. Laskutetaan normaalisti."}
            </Hint>
            {entityType === "ry" && !community && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                Yhdistys maksavana asiakkaana — varmista että laskutuksesta on sovittu.
              </p>
            )}
          </div>

          <div className="mt-4">
            <Choice<"paper" | "tech">
              label="Asiakasnäkymän ilme"
              value={theme}
              onChange={setTheme}
              options={[
                { id: "paper", title: "Vaalea", icon: FileText },
                { id: "tech", title: "Tekninen", icon: Layers },
              ]}
            />
            <Hint>Vaalea = selkeä esite. Tekninen = tumma mittarinäkymä. Vaihdettavissa myöhemmin keikan Asetuksista.</Hint>
          </div>
        </Card>

        {/* ── 2. Laajuus & hinnoittelu ───────────────────────────────────── */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Laajuus & hinnoittelu</h2>
          </div>

          <Choice<PricingModel>
            label="Malli *"
            value={model}
            onChange={setModel}
            options={[
              { id: "plan", title: "Pohjakuva & ikkunat", icon: Map },
              { id: "sectors", title: "Sektorit käsin", icon: Layers },
            ]}
          />
          <Hint>
            {model === "plan"
              ? "Ikkunat merkitään pohjakuvalle. Laskutussektorit syntyvät automaattisesti kerroksittain heti kun kartalla on ikkunoita, ja koko keikalla on yksi yhteinen ikkunahinta. Pohjakuvat ladataan keikan Asetuksista."
              : "Ei pohjakuvaa: laskutus erittelyn mukaan, jokaisella sektorilla oma määrä ja oma yksikköhinta. HUOM — jos merkitset ikkunoita kartalle myöhemmin, järjestelmä korvaa nämä sektorit kerroskohtaisilla."}
          </Hint>

          {model === "plan" ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Kerrokset / tilat *</Label>
                  <Input value={floorsText} onChange={(e) => setFloorsText(e.target.value)} placeholder="Esim. K, 1, 2, 3" />
                  <Hint>
                    Pilkulla eroteltuna, sama nimi kuin pohjakuvassa. Yksi nimi = yksi pohjakuva ja yksi
                    laskutussektori. Yhden tilan keikalla riittää yksi. Nyt: {floors.length || 0} kpl
                    {floors.length ? ` (${floors.join(", ")})` : ""}.
                  </Hint>
                </div>
                <div>
                  <Label className="text-xs">Yksikön nimi</Label>
                  <Input value={unitWord} onChange={(e) => setUnitWord(e.target.value)} placeholder="kerros" />
                  <Hint>Kun "kerros" on väärä sana — esim. "tila" tai "siipi". Tyhjä = kerros.</Hint>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Ikkunoita arviolta (kpl) *</Label>
                  <Input
                    type="number" min={0} value={estWindows || ""}
                    onChange={(e) => setEstWindows(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                  <Hint>
                    Arvio riittää: se antaa etenemälle nimittäjän ennen kuin kartta on piirretty, ja
                    tarkentuu itsestään kun ikkunat merkitään pohjakuvalle.
                  </Hint>
                </div>
                {!community && (
                  <div>
                    <Label className="text-xs">Hinta / ikkuna (€) *</Label>
                    <Input type="number" min={0} step="0.01" value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="0,00" />
                    <Hint>Keikan ainoa ikkunahinta. Jokainen laskutussektori käyttää tätä; muutos onnistuu myöhemmin seurantasivulta.</Hint>
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">Arvio: tuntia / ikkuna</Label>
                <Input value={hoursText} onChange={(e) => setHoursText(e.target.value)} placeholder="Esim. 1,5" className="md:max-w-[12rem]" />
                <Hint>Vapaaehtoinen. Antaa tehokkuusnäkymälle arvion kokonaistyöajasta ja jäljellä olevista tunneista.</Hint>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground">Sektorit</p>
                <Button variant="outline" size="sm" onClick={addSector}><Plus className="w-4 h-4 mr-1" /> Sektori</Button>
              </div>
              <div className="space-y-4">
                {sectors.map((s, i) => (
                  <div key={i} className="rounded-xl border border-border p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => updateSector(i, { color: e.target.value })}
                        className="w-8 h-8 rounded-md border border-border bg-transparent cursor-pointer"
                        aria-label="Sektorin väri"
                      />
                      <Input value={s.name} onChange={(e) => updateSector(i, { name: e.target.value })} placeholder="Sektorin nimi" className="flex-1" />
                      {sectors.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeSector(i)} aria-label="Poista sektori">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className={cn("grid gap-3", community ? "grid-cols-2" : "grid-cols-3")}>
                      <div>
                        <Label className="text-xs">Määrä (kpl) *</Label>
                        <Input type="number" min={0} value={s.total || ""} onChange={(e) => updateSector(i, { total: Math.max(0, parseInt(e.target.value) || 0) })} />
                      </div>
                      {!community && (
                        <div>
                          <Label className="text-xs">Hinta / yksikkö (€) *</Label>
                          <Input type="number" min={0} step="0.01" value={s.unitPriceCents ? s.unitPriceCents / 100 : ""} onChange={(e) => updateSector(i, { unitPriceCents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })} />
                        </div>
                      )}
                      <div>
                        <Label className="text-xs">Yksikön nimi</Label>
                        <Input value={s.unitLabel} onChange={(e) => updateSector(i, { unitLabel: e.target.value })} placeholder="ikkuna" />
                      </div>
                    </div>
                    {!community && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Hintakatto: <span className="font-semibold text-foreground">{eur(s.total * s.unitPriceCents)}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <Hint>
                {community
                  ? "Sektori jakaa työn asiakkaalle näkyviin osiin: nimi ja määrä. Väri erottaa sektorit näkymässä. Yhteisökeikalla hintaa ei ole, joten sektori on pelkkä etenemän erittely."
                  : "Sektori on laskun rivi: nimi, määrä ja yksikköhinta. Väri erottaa sektorit asiakkaan näkymässä. Määrä on sovittu laajuus — asiakas maksaa vain tehdyistä yksiköistä."}
              </Hint>
            </div>
          )}

          {/* Laskutusväli ja katto ovat rahaa: yhteisökeikalla niitä ei ole. */}
          {!community && (
            <div className="mt-4 pt-4 border-t border-border flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Laskuta n. joka</Label>
                  <Input type="number" min={1} value={invoiceInterval} onChange={(e) => setInvoiceInterval(Math.max(1, parseInt(e.target.value) || 100))} className="w-20" />
                  <span className="text-xs text-muted-foreground">yksikön välein</span>
                </div>
                <Hint>Muistutus osalaskun lähettämisestä. Ei lähetä mitään automaattisesti.</Hint>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">Hintakatto</p>
                <p className="text-xl font-bold text-foreground tabular-nums">{eur(capCents)}</p>
              </div>
            </div>
          )}
          {community && (
            <p className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
              Yhteisökeikka: sopimusarvo 0 €, ei laskutusta eikä laskutusväliä.
            </p>
          )}
        </Card>

        {/* ── 3. Tilaajan tiedot ─────────────────────────────────────────── */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Tilaajan tiedot</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{entityType === "ry" ? "Yhdistyksen nimi *" : "Yrityksen nimi *"}</Label>
              <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} placeholder={entityType === "ry" ? "Esim. Stuhi ry" : "Esim. Fr8"} />
              <Hint>Virallinen nimi. Näkyy sopimuksessa, laskulla, asiakaslinkissä ja keikkalistassa.</Hint>
            </div>
            <div>
              <Label className="text-xs">Yhteyshenkilö</Label>
              <Input value={company.contact} onChange={(e) => setCompany({ ...company, contact: e.target.value })} placeholder="Esim. Akseli Kettunen" />
              <Hint>Ihminen jonka kanssa asioidaan. Tallentuu asiakkaan nimeksi; organisaation nimi säilyy erikseen.</Hint>
            </div>
            <div>
              <Label className="text-xs">Y-tunnus</Label>
              <Input value={company.businessId} onChange={(e) => setCompany({ ...company, businessId: e.target.value })} placeholder="1234567-8" />
              <Hint>{entityType === "ry" ? "Yhdistyksellä on Y-tunnus. Tarvitaan sopimukseen." : "Tarvitaan sopimukseen ja laskulle."}</Hint>
            </div>
            <div>
              <Label className="text-xs">Sähköposti</Label>
              <Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
              <Hint>{community ? "Tähän lähetetään asiakkaan seurantalinkki." : "Laskut ja seurantalinkki."}</Hint>
            </div>
            <div>
              <Label className="text-xs">Puhelin</Label>
              <Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
              <Hint>Tyhjä tallentuu muodossa "-". Kohteessa tarvittava numero.</Hint>
            </div>
            <div>
              <Label className="text-xs">Osoite / kohde</Label>
              <Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} placeholder="Esim. Bulevardi 31, Helsinki" />
              <Hint>Työn tekopaikka. Tulee myös kartan otsikkoon.</Hint>
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-xs">Laskutustiedot (sisäinen)</Label>
            <Textarea rows={2} value={company.billing} onChange={(e) => setCompany({ ...company, billing: e.target.value })} placeholder="Verkkolaskuosoite, viite, yhteyshenkilö laskutuksessa…" />
            <Hint>Näkyy vain meille. Verkkolaskuosoite (OVT), tilausviite, kirjanpitäjän tiedot.</Hint>
          </div>
        </Card>

        {/* ── 4. Sopimus & kuvaus ────────────────────────────────────────── */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Sopimus & kuvaus</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs">Sopimustunnus</Label>
              <Input value={contractId} onChange={(e) => setContractId(e.target.value)} placeholder="Esim. PT-2026-02" />
              <Hint>Oma viitteemme. Näkyy sopimusdokumentissa ja laskulla.</Hint>
            </div>
            <div>
              <Label className="text-xs">Työn kuvaus</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Esim. Ikkunoiden pesu sisäkautta" />
              <Hint>Keikan nimi listoissa. Tyhjä = "{company.name || "Tilaaja"} — {community ? "yhteisökeikka" : "sopimuskeikka"}".</Hint>
            </div>
          </div>
          <Label className="text-xs">Sopimusteksti</Label>
          <Textarea rows={6} value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Liitä koko sopimus tähän…" className="font-mono text-xs" />
          <Hint>
            Liitä sovittu teksti sellaisenaan. Näkyy tiimille, sopimusdokumentissa
            JA asiakkaalle allekirjoitettavana — tyhjä kenttä on täysin ok, jos
            sopimus tehdään myöhemmin. Jos sopimus on PDF, liitä se tiedostona
            keikan Sopimus-kortista perustamisen jälkeen: PDF säilyttää taulukot,
            liitteet ja allekirjoitussivun, joita tämä kenttä ei säilytä.
          </Hint>

          <div className="mt-4">
            <Choice<"first" | "later">
              label="Allekirjoitus"
              value={signMode}
              onChange={setSignMode}
              options={[
                { id: "first", title: "Ensin sopimus", icon: FileText },
                { id: "later", title: "Sopimus myöhemmin", icon: Clock },
              ]}
            />
            <Hint>
              {signMode === "later"
                ? "Asiakkaan linkki avautuu suoraan seurantaan, eikä sopimus estä sitä missään vaiheessa. Kun liität sopimuksen myöhemmin keikan Sopimus-kortista, se nousee asiakkaalle samaan näkymään popuppina luettavaksi ja allekirjoitettavaksi."
                : "Asiakas lukee sopimuksen ja allekirjoittaa sen ennen kuin seuranta avautuu. Vaatii sopimustekstin yllä."}
            </Hint>
            {signMode === "first" && !contractText.trim() && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                Sopimusteksti on tyhjä, joten allekirjoitettavaa ei ole — linkki avautuu
                suoraan seurantaan. Valitse "Sopimus myöhemmin", jos se on tarkoitus, tai
                liitä sopimus PDF:nä keikan Sopimus-kortista heti perustamisen jälkeen.
              </p>
            )}
          </div>
          <div className="mt-3">
            <Label className="text-xs">ALV-huomautus</Label>
            <Input value={vatNote} onChange={(e) => { setVatTouched(true); setVatNote(e.target.value); }} />
            <Hint>Tulostuu laskulle ja sopimukseen. Oletus on vähäisen liiketoiminnan lauseke; vaihda jos ALV-velvollisuus alkaa.</Hint>
          </div>
          <div className="mt-3">
            <Label className="text-xs">Asiakkaalle näkyvä viesti</Label>
            <Textarea rows={2} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} placeholder={community ? "Esim. Kiitos yhteistyöstä — seuraa etenemistä tästä." : "Esim. Maksat vain pestyistä ikkunoista — hinta ei voi ylittää kattoa."} />
            <Hint>Näkyy asiakkaan seurantalinkin yläosassa. Muokattavissa milloin tahansa.</Hint>
          </div>
        </Card>

        {/* ── 5. Tekijät ─────────────────────────────────────────────────── */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Tekijät</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={assigned.includes(u.id)}
                onClick={() => toggleWorker(u.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all",
                  assigned.includes(u.id) ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {u.photoUrl ? (
                  <img src={u.photoUrl} alt={u.name} className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">{u.name[0]}</div>
                )}
                <span className="text-sm">{u.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
          <Hint>Kuka pääsee keikalle omalla tekijänäkymällään. Lisättävissä ja poistettavissa myöhemmin.</Hint>
        </Card>

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Luodaan…" : community ? "Perusta yhteisökeikka" : "Perusta keikka & avaa seuranta"}
        </Button>
        {missing.length > 0 && !submitting && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Puuttuu: {missing.join(", ")}.
          </p>
        )}
        {canSubmit && model === "plan" && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Seuraavaksi: lataa pohjakuvat ja merkitse ikkunat keikan Asetuksista ({floors.join(", ")}).
          </p>
        )}
      </div>
    </div>
  );
}
