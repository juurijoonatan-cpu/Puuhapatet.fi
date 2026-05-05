import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Check, X, Loader2, Building2, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type UnitResponse = {
  unitId: string;
  unitName: string;
  status: "accepted" | "declined";
  times: string[];
  message: string;
};

type QuoteData = {
  quoteId: string;
  customerName: string;
  customerAddress: string;
  description: string;
  agreedPriceCents: number;
  validUntil: string | null;
  quoteStatus: string;
  quoteVideoUrl: string | null;
  isTaloyhtiio: boolean;
  taloyhtiioApproved: boolean;
  unitCount: number | null;
  propertyImageUrl: string | null;
  taloyhtiioName: string | null;
  unitResponses: UnitResponse[];
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
const GREEN = "#2d5016";
const GREEN_LIGHT = "#f0faf2";

function fmtEur(cents: number) {
  return Math.round(cents / 100).toLocaleString("fi-FI") + " €";
}

function getYouTubeEmbedUrl(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1` : null;
}

function getVimeoEmbedUrl(url: string) {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=1` : null;
}

// ── Time picker ────────────────────────────────────────────────────────────────

function TimePicker({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mb-1">
            {i === 0 ? "1. vaihtoehto" : `${i + 1}. vaihtoehto`}
            {i === 0 && <span className="text-zinc-300 ml-1 font-normal normal-case tracking-normal">pakollinen</span>}
          </p>
          <input
            type="datetime-local"
            value={times[i] ?? ""}
            onChange={e => {
              const next = [...times];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:border-transparent"
          />
        </div>
      ))}
    </div>
  );
}

// ── Taloyhtiö multi-unit portal ───────────────────────────────────────────────

function TaloyhtiioPortal({ token, quote }: { token: string; quote: QuoteData }) {
  const count    = quote.unitCount ?? 2;
  const unitNames = Array.from({ length: count }, (_, i) => `Asunto ${i + 1}`);

  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [expandedUnit, setExpandedUnit]   = useState<string | null>(null);
  const [unitTimes, setUnitTimes]         = useState<Record<string, string[]>>({});
  const [unitMessages, setUnitMessages]   = useState<Record<string, string>>({});
  const [submitting, setSubmitting]       = useState(false);
  const [submitted, setSubmitted]         = useState<string[]>([]);
  const [error, setError]                 = useState("");

  const existingIds = new Set(quote.unitResponses.map(r => r.unitId));

  const totalEur   = Math.round(quote.agreedPriceCents / 100);
  const perUnit    = Math.ceil(quote.agreedPriceCents / count / 100);
  const kotitalous = Math.round(perUnit * 0.65);

  const toggleUnit = (name: string) =>
    setSelectedUnits(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );

  const handleSubmitUnit = async (unitName: string) => {
    setSubmitting(true);
    setError("");
    const times   = (unitTimes[unitName] ?? []).filter(Boolean);
    const message = unitMessages[unitName] ?? "";
    const unitId  = unitName.replace(/\s+/g, "-").toLowerCase();

    const res = await api.respondToQuote(token, {
      status: "accepted",
      unitResponse: { unitId, unitName, status: "accepted", times, message },
    });

    if (res.ok) {
      setSubmitted(prev => [...prev, unitName]);
      setExpandedUnit(null);
    } else {
      setError("Lähetys epäonnistui. Yritä uudelleen.");
    }
    setSubmitting(false);
  };

  const handleDeclineUnit = async (unitName: string) => {
    setSubmitting(true);
    const unitId = unitName.replace(/\s+/g, "-").toLowerCase();
    await api.respondToQuote(token, {
      status: "declined",
      unitResponse: { unitId, unitName, status: "declined", times: [], message: "" },
    });
    setSubmitted(prev => [...prev, unitName]);
    setExpandedUnit(null);
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">

      {/* Price block */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #e0ede2" }}>
        <div className="px-5 pt-5 pb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Hinta per asunto</p>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-5xl font-black text-zinc-900 leading-none">{perUnit}</p>
              <p className="text-base font-bold text-zinc-400 mt-0.5">euroa</p>
              <p className="text-sm font-semibold mt-2" style={{ color: "#16a34a" }}>
                kotitalousvähennyksen jälkeen ~{kotitalous} €
              </p>
            </div>
            <div className="text-right pb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Yhteensä</p>
              <p className="text-2xl font-black text-zinc-400">{totalEur} €</p>
              <p className="text-xs text-zinc-300 mt-0.5">{count} asuntoa</p>
            </div>
          </div>
        </div>
        <div className="px-5 pb-4 flex flex-wrap gap-1.5 border-t border-zinc-50 pt-3">
          {["✅ Kotitalousvähennys", "⭐ Tyytyväisyystakuu", "🔒 Vakuutettu"].map(b => (
            <span key={b} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-500">{b}</span>
          ))}
        </div>
      </div>

      {/* Building info */}
      <div className="bg-white rounded-2xl px-5 py-4" style={{ border: "1px solid #e0ede2" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">Kohde</p>
        <p className="text-sm font-bold text-zinc-900">{quote.taloyhtiioName || quote.customerName}</p>
        {quote.customerAddress && <p className="text-xs text-zinc-400 mt-0.5">{quote.customerAddress}</p>}
      </div>

      {/* Unit selector */}
      <div className="bg-white rounded-2xl" style={{ border: "1px solid #e0ede2" }}>
        <div className="px-5 pt-4 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Valitse asuntosi</p>
          <p className="text-xs text-zinc-400">Voit vahvistaa useamman kerralla.</p>
        </div>
        <div className="px-5 pb-4 flex flex-wrap gap-2">
          {unitNames.map(name => {
            const done = submitted.includes(name) || existingIds.has(name.replace(/\s+/g, "-").toLowerCase());
            const sel  = selectedUnits.includes(name);
            return (
              <button
                key={name}
                disabled={done}
                onClick={() => !done && toggleUnit(name)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
                  done  ? "border-emerald-200 bg-emerald-50 text-emerald-600 cursor-default"
                  : sel ? "border-transparent text-white"
                        : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                )}
                style={sel && !done ? { background: GREEN, borderColor: GREEN } : undefined}
              >
                {done ? `✓ ${name}` : name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-unit forms */}
      {selectedUnits.map(unitName => {
        const isSubmitted = submitted.includes(unitName);
        const isExpanded  = expandedUnit === unitName;
        return (
          <div key={unitName} className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #e0ede2" }}>
            <button
              className="w-full flex items-center justify-between px-5 py-4"
              onClick={() => !isSubmitted && setExpandedUnit(isExpanded ? null : unitName)}
            >
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center shrink-0",
                  isSubmitted ? "bg-emerald-500" : "border-2 border-zinc-200"
                )}>
                  {isSubmitted && <Check className="w-3 h-3 text-white" />}
                </div>
                <p className="text-sm font-bold text-zinc-900">{unitName}</p>
              </div>
              {isSubmitted
                ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-wide">Vahvistettu</span>
                : isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-300" /> : <ChevronDown className="w-4 h-4 text-zinc-300" />
              }
            </button>

            {isExpanded && !isSubmitted && (
              <div className="border-t border-zinc-100">
                <div className="px-5 py-4 space-y-4">
                  <TimePicker
                    times={unitTimes[unitName] ?? ["", "", ""]}
                    onChange={t => setUnitTimes(prev => ({ ...prev, [unitName]: t }))}
                  />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Viesti (valinnainen)</p>
                    <textarea
                      value={unitMessages[unitName] ?? ""}
                      onChange={e => setUnitMessages(prev => ({ ...prev, [unitName]: e.target.value }))}
                      placeholder="Avain, sisäänkäynti, lisätiedot…"
                      rows={2}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 resize-none focus:outline-none"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
                  <button
                    onClick={() => handleSubmitUnit(unitName)}
                    disabled={submitting || !unitTimes[unitName]?.[0]}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-opacity",
                      submitting || !unitTimes[unitName]?.[0] ? "opacity-40" : "opacity-100"
                    )}
                    style={{ background: GREEN }}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Vahvista {unitName}
                  </button>
                  <button
                    onClick={() => handleDeclineUnit(unitName)}
                    disabled={submitting}
                    className="w-full text-xs text-zinc-300 py-2 text-center hover:text-zinc-500 transition-colors"
                  >
                    Ei kiitos tälle asunnolle
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && <p className="text-xs text-red-500 text-center">{error}</p>}

      {submitted.length > 0 && (
        <div className="rounded-2xl px-5 py-6 text-center" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <div className="w-11 h-11 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-3">
            <Check className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-bold text-zinc-900">
            {submitted.length === 1 ? "1 asunto vahvistettu" : `${submitted.length} asuntoa vahvistettu`}
          </p>
          <p className="text-xs text-zinc-400 mt-1">Otamme yhteyttä ja vahvistamme ajankohdan.</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function QuotePage() {
  const [, params] = useRoute("/tarjous/:token");
  const token = params?.token ?? "";

  const [quote, setQuote]           = useState<QuoteData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);
  const [step, setStep]             = useState<"view" | "accept" | "done">("view");
  const [declined, setDeclined]     = useState(false);
  const [times, setTimes]           = useState(["", "", ""]);
  const [message, setMessage]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getQuote(token).then(res => {
      if (res.ok && res.data) {
        setQuote(res.data);
        if (res.data.quoteStatus === "accepted") setStep("done");
        if (res.data.quoteStatus === "declined") { setDeclined(true); setStep("done"); }
      } else {
        setNotFound(true);
      }
      setLoading(false);
    });
  }, [token]);

  const handleDecline = async () => {
    setSubmitting(true);
    await api.respondToQuote(token, { status: "declined" });
    setDeclined(true);
    setStep("done");
    setSubmitting(false);
  };

  const handleAccept = async () => {
    setSubmitting(true);
    const validTimes = times.filter(Boolean);
    await api.respondToQuote(token, {
      status: "accepted",
      suggestedTimes: validTimes.length ? validTimes : undefined,
      customerMessage: message.trim() || undefined,
    });
    setStep("done");
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: GREEN_LIGHT }}>
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: GREEN }} />
      </div>
    );
  }

  if (notFound || !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: GREEN_LIGHT, fontFamily: FONT }}>
        <div className="text-center max-w-sm">
          <p className="text-3xl mb-4">🔍</p>
          <h1 className="text-base font-bold text-zinc-800 mb-2">Tarjousta ei löydy</h1>
          <p className="text-zinc-400 text-sm">Tarkista linkki tai ota yhteyttä.</p>
          <a href="https://puuhapatet.fi" className="mt-5 inline-block text-sm font-semibold underline" style={{ color: GREEN }}>
            puuhapatet.fi
          </a>
        </div>
      </div>
    );
  }

  const isTalo    = quote.isTaloyhtiio;
  const services  = quote.description.split(" + ").filter(Boolean);
  const validDate = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("fi-FI") : null;
  const totalEur  = Math.round(quote.agreedPriceCents / 100);
  const afterKota = Math.round(totalEur * 0.65);

  // Taloyhtiö — not yet approved
  if (isTalo && !quote.taloyhtiioApproved) {
    return (
      <div className="min-h-screen" style={{ background: GREEN_LIGHT, fontFamily: FONT }}>
        <div className="max-w-sm mx-auto px-4 pt-16 pb-10 text-center">
          <p className="text-xl font-black tracking-tight mb-8" style={{ color: GREEN }}>Puuhapatet.</p>
          <div className="bg-white rounded-2xl p-8" style={{ border: "1px solid #d4ead8" }}>
            <Building2 className="w-8 h-8 mx-auto mb-4 opacity-30" style={{ color: GREEN }} />
            <h2 className="text-sm font-bold text-zinc-800 mb-2">Taloyhtiötarjous</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Tarjous odottaa hallituksen hyväksyntää. Linkki aktivoituu, kun se on vahvistettu jaettavaksi.
            </p>
            <a href="https://wa.me/358400389999" className="inline-block mt-6 text-sm font-semibold" style={{ color: GREEN }}>
              WhatsApp: +358 400 389 999
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Single quote — done
  if (step === "done" && !isTalo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: GREEN_LIGHT, fontFamily: FONT }}>
        <div className="w-full max-w-sm text-center">
          <p className="text-xl font-black tracking-tight mb-8" style={{ color: GREEN }}>Puuhapatet.</p>
          <div className="bg-white rounded-2xl p-8" style={{ border: "1px solid #d4ead8" }}>
            {declined ? (
              <>
                <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mx-auto mb-4">
                  <X className="w-5 h-5 text-zinc-400" />
                </div>
                <h2 className="text-sm font-bold text-zinc-800 mb-2">Kiitos vastauksestasi</h2>
                <p className="text-zinc-400 text-sm">Ota yhteyttä, jos mielesi muuttuu.</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-sm font-bold text-zinc-800 mb-2">Tarjous hyväksytty</h2>
                <p className="text-zinc-400 text-sm">Otamme yhteyttä ja vahvistamme ajankohdan.</p>
              </>
            )}
            <a href="https://wa.me/358400389999" className="inline-block mt-6 text-sm font-semibold" style={{ color: GREEN }}>
              WhatsApp: +358 400 389 999
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: isTalo ? GREEN_LIGHT : "#f4f4f5", fontFamily: FONT }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      {isTalo ? (
        <>
          {quote.propertyImageUrl && (
            <div className="relative w-full overflow-hidden" style={{ maxHeight: 260 }}>
              <img
                src={quote.propertyImageUrl}
                alt={quote.taloyhtiioName || quote.customerName}
                className="w-full object-cover"
                style={{ maxHeight: 260 }}
              />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.4) 100%)" }} />
            </div>
          )}
          <div style={{ background: GREEN }}>
            <div className="max-w-lg mx-auto px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-white font-black text-lg tracking-tight">Puuhapatet.</p>
                <p className="text-[11px] mt-0.5" style={{ color: "#a3c97a" }}>
                  {validDate ? `Voimassa ${validDate} asti` : "Taloyhtiötarjous"}
                </p>
              </div>
              <span className="text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full"
                style={{ background: "#a3c97a", color: "#1a3a0a" }}>TALOYHTIÖ</span>
            </div>
          </div>
        </>
      ) : (
        <div className="relative w-full overflow-hidden" style={{ height: "52vw", minHeight: 200, maxHeight: 300 }}>
          <video src="/tarjous-intro.mp4" autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.68) 100%)" }} />
          <div className="absolute inset-x-0 bottom-0 px-5 pb-5 max-w-lg mx-auto flex items-end justify-between">
            <div>
              <p className="text-white text-lg font-black tracking-tight">Puuhapatet.</p>
              <p className="text-white/50 text-[11px] mt-0.5">{validDate ? `Voimassa ${validDate} asti` : "Tarjous"}</p>
            </div>
            <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full"
              style={{ background: GREEN, color: "#b8e07a" }}>TARJOUS</span>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-4 pb-12 space-y-3">

        {/* Optional video */}
        {quote.quoteVideoUrl && (() => {
          const vUrl = quote.quoteVideoUrl!;
          if (/youtube\.com|youtu\.be/.test(vUrl)) {
            const embed = getYouTubeEmbedUrl(vUrl);
            return embed ? (
              <div className="rounded-2xl overflow-hidden aspect-video bg-black">
                <iframe src={embed} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            ) : null;
          }
          if (/vimeo\.com/.test(vUrl)) {
            const embed = getVimeoEmbedUrl(vUrl);
            return embed ? (
              <div className="rounded-2xl overflow-hidden aspect-video bg-black">
                <iframe src={embed} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            ) : null;
          }
          return (
            <div className="rounded-2xl overflow-hidden aspect-video bg-black">
              <video src={vUrl} autoPlay muted loop playsInline className="w-full h-full object-cover" />
            </div>
          );
        })()}

        {/* ── TALOYHTIÖ ───────────────────────────────────────────────── */}
        {isTalo ? (
          <TaloyhtiioPortal token={token} quote={quote} />
        ) : (
          <>
            {/* Customer / sender */}
            <div className="bg-white rounded-2xl grid grid-cols-2 divide-x divide-zinc-100"
              style={{ border: "1px solid #e4e4e7" }}>
              <div className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Asiakkaalle</p>
                <p className="text-sm font-bold text-zinc-900 leading-snug">{quote.customerName}</p>
                {quote.customerAddress && <p className="text-zinc-400 text-xs mt-0.5">{quote.customerAddress}</p>}
              </div>
              <div className="p-4 text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Lähettäjä</p>
                <p className="text-sm font-bold text-zinc-900">Puuhapatet</p>
                <p className="text-zinc-400 text-xs mt-0.5">+358 400 389 999</p>
              </div>
            </div>

            {/* Services + price */}
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #e4e4e7" }}>
              <div className="px-5 pt-5 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Palvelut</p>
                <div className="space-y-2">
                  {services.map((s, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-1 h-1 rounded-full bg-zinc-300 mt-2 shrink-0" />
                      <p className="text-sm text-zinc-700 leading-snug">{s}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mx-5 mt-4 pt-4 border-t border-zinc-100 flex justify-between items-end pb-1">
                <p className="text-sm font-bold text-zinc-800">Yhteensä</p>
                <p className="text-3xl font-black text-zinc-900">{totalEur} €</p>
              </div>
              <div className="mx-5 pb-4">
                <p className="text-xs font-semibold" style={{ color: "#16a34a" }}>
                  kotitalousvähennyksen jälkeen ~{afterKota} €
                </p>
              </div>
              <div className="mx-5 pb-5 flex flex-wrap gap-1.5">
                {["✅ Kotitalousvähennys", "⭐ Tyytyväisyystakuu", "🔒 Vakuutettu työ"].map(b => (
                  <span key={b} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-500">{b}</span>
                ))}
              </div>
            </div>

            {/* CTA — view */}
            {step === "view" && (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => setStep("accept")}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white"
                  style={{ background: GREEN }}
                >
                  <Check className="w-4 h-4" />
                  Hyväksy tarjous
                </button>
                <button
                  onClick={handleDecline}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-zinc-400 bg-white"
                  style={{ border: "1px solid #e4e4e7" }}
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Kiitos, ei kiitos
                </button>
              </div>
            )}

            {/* CTA — accept form */}
            {step === "accept" && (
              <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #e4e4e7" }}>
                <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
                  <p className="text-sm font-bold text-zinc-900">Ehdota sopivia aikoja</p>
                  <p className="text-xs text-zinc-400 mt-1">1–3 vaihtoehtoa. Vahvistamme sopivan ajan.</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <TimePicker times={times} onChange={setTimes} />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 mb-1.5">Viesti (valinnainen)</p>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="Erityistoiveet, lisätietoja…"
                      rows={2}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 resize-none focus:outline-none"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
                  <button
                    onClick={handleAccept}
                    disabled={submitting || !times[0]}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-opacity",
                      submitting || !times[0] ? "opacity-40" : "opacity-100"
                    )}
                    style={{ background: GREEN }}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Lähetä hyväksyntä
                  </button>
                  <button
                    className="w-full text-xs text-zinc-400 py-2 text-center"
                    onClick={() => setStep("view")}
                  >
                    Takaisin
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <p className="text-center text-zinc-400 text-[11px] pt-3">
          Puuhapatet &nbsp;·&nbsp;{" "}
          <a href="mailto:info@puuhapatet.fi" className="underline">info@puuhapatet.fi</a>
          &nbsp;·&nbsp;{" "}
          <a href="https://puuhapatet.fi" className="underline">puuhapatet.fi</a>
        </p>
      </div>
    </div>
  );
}
