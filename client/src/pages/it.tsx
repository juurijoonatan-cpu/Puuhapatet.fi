/**
 * puuhapatet.fi/it — Puuhapatetin digipalvelut (CV-verkkosivut).
 *
 * Sivu on tarkoituksella oma, tumma "sisarbrändi": se ei jaa julkisen sivuston
 * vaaleaa ilmettä eikä alanavigaatiota, koska tarjonta on eri (digi, ei pesu).
 * Kieli tulee kuitenkin sivuston yhteisestä valinnasta (I18nProvider kattaa
 * koko Routerin), joten suomenkielinen kävijä saa suomea — aiemmin tämä sivu
 * oli yksinomaan englanniksi keskellä suomenkielistä sivustoa.
 *
 * Yksinkertaistettu tietoisesti (ks. git-historia):
 *   - Poistettu kiertävä "orbital timeline" ja hiiren mukaan kääntyvät kortit:
 *     ne olivat raskaita, eivät toimineet kosketuksella ja vetivät huomion
 *     itse asiasta.
 *   - Poistettu LiquidButton: sen lasiefekti nojaa SVG-suodattimeen
 *     (backdrop-filter: url(#…)), jota Safari ei tue — napista tuli iOS:llä
 *     näkymätön. Nyt tavallinen, luettava nappi.
 *   - Poistettu kahdesta kohdasta harmaista palkeista koostuvat valemockupit
 *     (näyttivät ikuiselta latausruudulta) ja viittaus puuttuvaan
 *     /cv-person.jpg-kuvaan.
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, RefreshCw, Link2, Globe, ArrowRight, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { postJson, warmBackend } from "@/lib/api";

// ─── Paketit ─────────────────────────────────────────────────────────────────
// Hinnat ovat sivun aiemmat, julkaistut hinnat — niitä ei ole muutettu.

const PACKAGES = [
  { value: "starter",      label: "Starter",      price: "299 €",  termFi: "kerta",  termEn: "one-off" },
  { value: "professional", label: "Professional", price: "599 €",  termFi: "kerta",  termEn: "one-off" },
  { value: "growth",       label: "Growth",       price: "999 €",  termFi: "/ vuosi", termEn: "/ year" },
] as const;

// ─── Tilauslomake ────────────────────────────────────────────────────────────

type Phase = "idle" | "sending" | "done" | "error";

function OrderForm({ fi }: { fi: boolean }) {
  const [form, setForm] = useState({ name: "", email: "", linkedinUrl: "", pkg: "starter" });
  const [phase, setPhase] = useState<Phase>("idle");

  // Ilmaisen tason backend nukkuu — herätetään heti, ettei lähetys jää
  // odottamaan kylmäkäynnistystä.
  useEffect(() => { warmBackend(); }, []);

  const inp = cn(
    "w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-sm text-white",
    "placeholder:text-zinc-600 transition-colors",
    "focus:outline-none focus-visible:border-zinc-600 focus-visible:ring-1 focus-visible:ring-white/25",
  );
  const lbl = "mb-2 block text-xs font-medium text-zinc-400";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhase("sending");
    const res = await postJson("/api/it-contact", {
      name:    form.name,
      email:   form.email,
      service: "cv",
      message: `Paketti: ${form.pkg}\nLinkedIn/CV: ${form.linkedinUrl}`,
    });
    setPhase(res.ok ? "done" : "error");
  };

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/5">
          <Check size={18} className="text-white" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-white">
          {fi ? "Kiitos — pyyntö on perillä" : "Thanks — we've got your request"}
        </h3>
        <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
          {fi
            ? "Olemme yhteydessä vuorokauden sisällä ja kerromme, miltä sivusi voisi näyttää."
            : "We'll be in touch within 24 hours with a plan for your site."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={lbl} htmlFor="it-name">{fi ? "Nimi" : "Your name"}</label>
          <input
            id="it-name"
            className={inp}
            required
            autoComplete="name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder={fi ? "Matti Meikäläinen" : "Jane Smith"}
          />
        </div>
        <div>
          <label className={lbl} htmlFor="it-email">{fi ? "Sähköposti" : "Email address"}</label>
          <input
            id="it-email"
            className={inp}
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="matti@example.com"
          />
        </div>
      </div>

      <div>
        <label className={lbl} htmlFor="it-cv">
          {fi ? "LinkedIn-osoite tai CV tekstinä" : "LinkedIn URL or paste your CV text"}
        </label>
        <textarea
          id="it-cv"
          className={cn(inp, "min-h-[88px] resize-y")}
          value={form.linkedinUrl}
          onChange={e => setForm({ ...form, linkedinUrl: e.target.value })}
          placeholder={fi ? "linkedin.com/in/nimesi — tai liitä CV tähän…" : "linkedin.com/in/yourname — or paste CV text…"}
        />
      </div>

      <div>
        <span className={lbl}>{fi ? "Paketti" : "Package"}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PACKAGES.map(p => {
            const active = form.pkg === p.value;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={active}
                onClick={() => setForm({ ...form, pkg: p.value })}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
                  "sm:flex-col sm:items-start sm:gap-1",
                  active
                    ? "border-white/30 bg-white/10 text-white"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                )}
              >
                <span className="text-xs font-medium">{p.label}</span>
                <span className="text-sm font-semibold">
                  {p.price}
                  <span className="ml-1 text-[10px] font-normal opacity-60">{fi ? p.termFi : p.termEn}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {phase === "error" && (
        <p className="text-xs text-red-400">
          {fi ? "Lähetys ei onnistunut. Voit myös laittaa sähköpostia: " : "Something went wrong. You can also email "}
          <a href="mailto:info@puuhapatet.fi" className="underline">info@puuhapatet.fi</a>.
        </p>
      )}

      <button
        type="submit"
        disabled={phase === "sending"}
        className="w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
      >
        {phase === "sending"
          ? (fi ? "Lähetetään…" : "Sending…")
          : (fi ? "Lähetä pyyntö" : "Send request")}
      </button>
      <p className="text-center text-[11px] text-zinc-600">
        {fi ? "Vastaamme vuorokauden sisällä. Ei sitoumusta." : "We reply within 24 hours. No commitment."}
      </p>
    </form>
  );
}

// ─── Sivu ────────────────────────────────────────────────────────────────────

export default function ITPage() {
  const { lang, toggleLang } = useI18n();
  const fi = lang === "fi";

  // Oma otsikko tälle osoitteelle: index.html:n otsikko myy ikkunanpesua, ja
  // /it jaetaan omana linkkinä.
  useEffect(() => {
    const prev = document.title;
    document.title = fi
      ? "Puuhapatet Digi — CV-verkkosivut"
      : "Puuhapatet Digital — CV websites";
    return () => { document.title = prev; };
  }, [fi]);

  const scrollToOrder = () =>
    document.getElementById("tilaus")?.scrollIntoView({ behavior: "smooth" });

  const steps = [
    {
      title: fi ? "Kerro perustiedot" : "Send the raw material",
      desc: fi
        ? "LinkedIn-osoite tai CV tekstinä. Muuta ei tarvita alkuun."
        : "A LinkedIn URL or your CV as text. Nothing else needed to start.",
    },
    {
      title: fi ? "Saat vedoksen" : "You get a draft",
      desc: fi
        ? "Teksti ja ilme sinulle hyväksyttäväksi. Muutokset tehdään ennen julkaisua."
        : "Copy and visual direction for your approval. Changes happen before launch.",
    },
    {
      title: fi ? "Julkaisu omalle osoitteelle" : "Live on your own domain",
      desc: fi
        ? "Sivu liveksi omaan verkko-osoitteeseen ja Googlen hakuun."
        : "Your site goes live on your own domain and gets indexed by Google.",
    },
  ];

  const features = [
    {
      icon: Search,
      title: fi ? "Google löytää nimelläsi" : "Google finds you by name",
      desc: fi ? "PDF-tiedosto ei näy hakutuloksissa. Verkkosivu näkyy." : "A PDF never ranks. A web page does.",
    },
    {
      icon: RefreshCw,
      title: fi ? "Päivittyy ilman uutta tiedostoa" : "Update without resending files",
      desc: fi ? "Uusi työpaikka tai projekti lisätään sivulle — linkki pysyy samana." : "New roles and projects are added in place — the link stays the same.",
    },
    {
      icon: Link2,
      title: fi ? "Yksi linkki kaikkeen" : "One link for everything",
      desc: fi ? "Sama osoite hakemuksiin, sähköpostin allekirjoitukseen ja someen." : "The same address for applications, email signatures and social bios.",
    },
    {
      icon: Globe,
      title: fi ? "Oma verkko-osoite" : "Your own domain",
      desc: fi ? "nimesi.fi — ei jonkin palvelun aliosoite." : "yourname.com — not a subdomain of someone else's service.",
    },
  ];

  const promises = fi
    ? ["Vastaus vuorokauden sisällä", "Ei sitoumusta ennen kuin hyväksyt vedoksen", "Oma verkko-osoite kuuluu kaikkiin paketteihin"]
    : ["A reply within 24 hours", "No commitment until you approve the draft", "Your own domain included in every package"];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Navi ── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-5">
          <Link href="/" className="text-sm text-zinc-400 transition-colors hover:text-white">
            ← puuhapatet.fi
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLang}
              className="rounded-full px-2.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              aria-label={fi ? "Switch to English" : "Vaihda suomeksi"}
            >
              {lang.toUpperCase()}
            </button>
            <button
              onClick={scrollToOrder}
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              {fi ? "Pyydä tarjous" : "Get started"}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="relative overflow-hidden px-5 pb-20 pt-32 sm:pt-40">
        {/* Hillitty hehku taustalle — pelkkä gradientti, ei kuvatiedostoja. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(255,255,255,0.07) 0%, transparent 70%)" }}
        />
        <div className="relative mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-zinc-300">
              {fi ? "Puuhapatet · Digipalvelut" : "Puuhapatet · Digital services"}
            </span>
            <h1 className="mt-7 text-4xl font-bold leading-[1.06] tracking-tight sm:text-5xl">
              {fi ? <>CV:stä verkkosivu,<br />joka pysyy ajan tasalla</> : <>Your CV as a<br />living website</>}
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-400 sm:text-lg">
              {fi
                ? "Yksi linkki, oma verkko-osoite ja sisältö joka päivittyy uran mukana — eikä PDF, joka hautautuu sähköpostiin."
                : "One link, your own domain, and content that grows with your career — not a PDF that ends up in a trash folder."}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={scrollToOrder}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                {fi ? "Pyydä tarjous" : "Get started"}
                <ArrowRight size={15} />
              </button>
              <Link
                href="/cv"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/30 hover:text-white"
              >
                {fi ? "Katso demo" : "See a live demo"}
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>

          {/* Havainnekuva: selainkehys oikeaa tekstiä — ei harmaita palkkeja. */}
          <div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 lg:block">
            <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-900/70 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="ml-2 flex h-6 flex-1 items-center rounded-md bg-zinc-800/70 px-2.5 font-mono text-[10px] text-zinc-500">
                {fi ? "nimesi.fi" : "yourname.com"}
              </span>
            </div>
            <div className="space-y-5 p-7">
              <div>
                <p className="text-lg font-semibold text-white">{fi ? "Etunimi Sukunimi" : "Jane Smith"}</p>
                <p className="text-sm text-zinc-500">{fi ? "Projektipäällikkö · Helsinki" : "Project Manager · Helsinki"}</p>
              </div>
              <p className="text-sm leading-relaxed text-zinc-400">
                {fi
                  ? "Kymmenen vuotta rakennusalan projekteja. Vahvuutena aikataulut, budjetti ja se että työmaalla tiedetään mitä tehdään."
                  : "Ten years of construction projects. Strong on schedules, budgets, and making sure the site knows what to do next."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(fi
                  ? ["Projektinjohto", "Budjetointi", "Aikataulutus", "Urakkalaskenta"]
                  : ["Project management", "Budgeting", "Scheduling", "Tendering"]
                ).map(s => (
                  <span key={s} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Näin se menee ── */}
      <section className="border-t border-white/10 px-5 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {fi ? "Kolme askelta, muutama päivä" : "Three steps, a few days"}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-white/10 bg-zinc-950 p-6">
                <span className="font-mono text-xs text-zinc-600">0{i + 1}</span>
                <h3 className="mt-3 font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Miksi ── */}
      <section className="border-t border-white/10 px-5 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {fi ? "Miksi verkkosivu voittaa PDF:n" : "Why a website beats a PDF"}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {features.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex gap-4 rounded-2xl border border-white/10 bg-zinc-950 p-6">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <Icon size={15} className="text-zinc-300" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{f.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{f.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Demo ── */}
      <section className="border-t border-white/10 px-5 py-20">
        <div className="mx-auto max-w-5xl">
          <Link
            href="/cv"
            className="group flex flex-col gap-6 rounded-2xl border border-white/10 bg-zinc-950 p-7 transition-colors hover:border-white/25 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-mono text-xs text-zinc-600">puuhapatet.fi/cv</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {fi ? "Katso valmis esimerkki" : "See a finished example"}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                {fi
                  ? "Oikea, julkaistu CV-sivu selattavaksi. Näin sinunkin sivusi rakentuu."
                  : "A real, published CV site you can browse. Yours is built the same way."}
              </p>
            </div>
            <span className="inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors group-hover:border-white/40 group-hover:text-white">
              {fi ? "Avaa demo" : "Open demo"}
              <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </section>

      {/* ── Tilaus ── */}
      <section id="tilaus" className="border-t border-white/10 px-5 py-20">
        <div className="mx-auto grid max-w-5xl items-start gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {fi ? "Aloitetaanko?" : "Ready to get started?"}
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-zinc-400">
              {fi
                ? "Lähetä LinkedIn-osoite tai CV, niin hoidamme loput. Valmiina päivissä, ei viikoissa."
                : "Send your LinkedIn or CV and we'll handle the rest. Live in days, not weeks."}
            </p>
            <ul className="mt-8 space-y-3">
              {promises.map(item => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-400">
                  <Check size={15} className="mt-0.5 flex-shrink-0 text-zinc-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5 sm:p-7">
            <OrderForm fi={fi} />
          </div>
        </div>
      </section>

      {/* ── Alatunniste ── */}
      <footer className="border-t border-white/10 px-5 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-600">
            puuhapatet.fi/it · {fi ? "Puuhapatetin digipalvelut" : "Digital services by Puuhapatet"}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500">
            <Link href="/palvelut" className="transition-colors hover:text-zinc-200">
              {fi ? "Pesu- ja siivouspalvelut" : "Cleaning services"}
            </Link>
            <Link href="/tietosuoja" className="transition-colors hover:text-zinc-200">
              {fi ? "Tietosuoja" : "Privacy"}
            </Link>
            <Link href="/ehdot" className="transition-colors hover:text-zinc-200">
              {fi ? "Sopimusehdot" : "Terms"}
            </Link>
            <Link href="/" className="transition-colors hover:text-zinc-200">
              Puuhapatet.fi
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
