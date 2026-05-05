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

function fmt(cents: number) {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0 }) + " €";
}

function getYouTubeEmbedUrl(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1` : null;
}

function getVimeoEmbedUrl(url: string) {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1&muted=1` : null;
}

// ── Single-unit acceptance form ───────────────────────────────────────────────

function AcceptForm({
  onSubmit,
  onBack,
  submitting,
  label = "Lähetä hyväksyntä",
}: {
  onSubmit: (times: string[], message: string) => void;
  onBack: () => void;
  submitting: boolean;
  label?: string;
}) {
  const [times, setTimes] = useState(["", "", ""]);
  const [message, setMessage] = useState("");
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
        <p className="text-sm font-semibold text-zinc-800">Ehdota sopivia aikoja</p>
        <p className="text-xs text-zinc-400 mt-1">Valitse 1–3 ajankohtaa. Vahvistamme sopivan ajan.</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        {times.map((t, i) => (
          <div key={i}>
            <p className="text-xs text-zinc-400 mb-1.5">
              {i === 0 ? "1. vaihtoehto *" : `${i + 1}. vaihtoehto`}
            </p>
            <input
              type="datetime-local"
              value={t}
              onChange={e => setTimes(prev => prev.map((v, j) => j === i ? e.target.value : v))}
              className={cn(
                "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800",
                "focus:outline-none focus:ring-2 focus:ring-[#2d5016] focus:border-transparent"
              )}
            />
          </div>
        ))}
        <div className="pt-1">
          <p className="text-xs text-zinc-400 mb-1.5">Viesti tai lisätiedot (valinnainen)</p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Erityistoiveet, lisätietoja…"
            rows={3}
            className={cn(
              "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 resize-none",
              "focus:outline-none focus:ring-2 focus:ring-[#2d5016] focus:border-transparent"
            )}
          />
        </div>
      </div>
      <div className="px-5 pb-5 space-y-2">
        <button
          onClick={() => onSubmit(times.filter(Boolean), message.trim())}
          disabled={submitting || !times[0]}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-opacity",
            submitting || !times[0] ? "opacity-40" : "opacity-100"
          )}
          style={{ background: "#2d5016" }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {label}
        </button>
        <button className="w-full text-xs text-zinc-400 py-2 text-center" onClick={onBack}>
          ← Takaisin
        </button>
      </div>
    </div>
  );
}

// ── Taloyhtiö multi-unit portal ───────────────────────────────────────────────

function TaloyhtiioPortal({
  token,
  quote,
}: {
  token: string;
  quote: QuoteData;
}) {
  const unitNames = Array.from(
    { length: quote.unitCount ?? 2 },
    (_, i) => `Asunto ${i + 1}`
  );

  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [unitTimes, setUnitTimes] = useState<Record<string, string[]>>({});
  const [unitMessages, setUnitMessages] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [error, setError] = useState("");

  const existingIds = new Set(quote.unitResponses.map(r => r.unitId));

  const toggleUnit = (name: string) => {
    setSelectedUnits(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  const handleSubmitUnit = async (unitName: string) => {
    setSubmitting(true);
    setError("");
    const times = (unitTimes[unitName] || []).filter(Boolean);
    const message = unitMessages[unitName] || "";
    const unitId = unitName.replace(/\s+/g, "-").toLowerCase();

    const unitResponse: UnitResponse = {
      unitId,
      unitName,
      status: "accepted",
      times,
      message,
    };

    const res = await api.respondToQuote(token, {
      status: "accepted",
      unitResponse,
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

  const perUnit = quote.unitCount ? Math.ceil(quote.agreedPriceCents / quote.unitCount / 100) : null;
  const kotitalous = perUnit ? Math.round(perUnit * 0.65) : null;

  return (
    <div className="space-y-3">
      {/* Building info */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-[#2d5016]" />
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Taloyhtiötarjous</p>
          </div>
          <p className="text-zinc-800 text-sm font-semibold leading-snug">
            {quote.taloyhtiioName || quote.customerName}
          </p>
          {quote.customerAddress && <p className="text-zinc-400 text-xs mt-0.5">{quote.customerAddress}</p>}
          {perUnit && (
            <div className="mt-3 pt-3 border-t border-zinc-100 flex justify-between items-baseline">
              <p className="text-xs text-zinc-400">Hinta / asunto (n.)</p>
              <div className="text-right">
                <p className="text-base font-black text-zinc-900">{perUnit} €</p>
                {kotitalous && <p className="text-[11px] text-emerald-600">Kotival. jälkeen ~{kotitalous} €</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unit selector */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Valitse asuntosi</p>
          <p className="text-xs text-zinc-400">Voit vahvistaa yhden tai useamman asunnon kerralla.</p>
        </div>
        <div className="px-5 pb-4 flex flex-wrap gap-2 pt-3">
          {unitNames.map(name => {
            const alreadyDone = submitted.includes(name) || existingIds.has(name.replace(/\s+/g, "-").toLowerCase());
            return (
              <button
                key={name}
                disabled={alreadyDone}
                onClick={() => !alreadyDone && toggleUnit(name)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                  alreadyDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-600 cursor-default"
                    : selectedUnits.includes(name)
                    ? "border-[#2d5016] bg-[#2d5016] text-white"
                    : "border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                )}
              >
                {alreadyDone ? `✓ ${name}` : name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-unit confirmation forms */}
      {selectedUnits.map(unitName => {
        const isSubmitted = submitted.includes(unitName);
        const isExpanded = expandedUnit === unitName;
        return (
          <div key={unitName} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4"
              onClick={() => setExpandedUnit(isExpanded ? null : unitName)}
            >
              <div className="flex items-center gap-2">
                {isSubmitted
                  ? <Check className="w-4 h-4 text-emerald-600" />
                  : <div className="w-4 h-4 rounded-full border-2 border-zinc-300" />
                }
                <p className="text-sm font-semibold text-zinc-800">{unitName}</p>
              </div>
              {isSubmitted
                ? <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Vahvistettu</span>
                : isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />
              }
            </button>

            {isExpanded && !isSubmitted && (
              <div className="border-t border-zinc-100">
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs text-zinc-400">Ehdota sopivia aikoja (1–3 vaihtoehtoa)</p>
                  {[0, 1, 2].map(i => (
                    <div key={i}>
                      <p className="text-xs text-zinc-400 mb-1">
                        {i === 0 ? "1. vaihtoehto *" : `${i + 1}. vaihtoehto`}
                      </p>
                      <input
                        type="datetime-local"
                        value={(unitTimes[unitName] || ["", "", ""])[i] || ""}
                        onChange={e => {
                          const arr = [...(unitTimes[unitName] || ["", "", ""])];
                          arr[i] = e.target.value;
                          setUnitTimes(prev => ({ ...prev, [unitName]: arr }));
                        }}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#2d5016] focus:border-transparent"
                      />
                    </div>
                  ))}
                  <div>
                    <p className="text-xs text-zinc-400 mb-1">Viesti (valinnainen)</p>
                    <textarea
                      value={unitMessages[unitName] || ""}
                      onChange={e => setUnitMessages(prev => ({ ...prev, [unitName]: e.target.value }))}
                      placeholder="Lisätiedot, avain, jne…"
                      rows={2}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#2d5016] focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
                  <button
                    onClick={() => handleSubmitUnit(unitName)}
                    disabled={submitting || !(unitTimes[unitName]?.[0])}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white transition-opacity",
                      submitting || !(unitTimes[unitName]?.[0]) ? "opacity-40" : "opacity-100"
                    )}
                    style={{ background: "#2d5016" }}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Vahvista {unitName}
                  </button>
                  <button
                    onClick={() => handleDeclineUnit(unitName)}
                    disabled={submitting}
                    className="w-full text-xs text-zinc-400 py-2 text-center hover:text-zinc-600"
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
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 px-5 py-4 text-center">
          <Check className="w-5 h-5 text-emerald-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-800">
            {submitted.length === 1 ? "1 asunto vahvistettu!" : `${submitted.length} asuntoa vahvistettu!`}
          </p>
          <p className="text-xs text-emerald-600 mt-1">Otamme yhteyttä ja vahvistamme ajankohdan.</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function QuotePage() {
  const [, params] = useRoute("/tarjous/:token");
  const token = params?.token ?? "";

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [step, setStep] = useState<"view" | "accept" | "done">("view");
  const [declined, setDeclined] = useState(false);
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

  const handleAccept = async (times: string[], message: string) => {
    setSubmitting(true);
    await api.respondToQuote(token, {
      status: "accepted",
      suggestedTimes: times.length ? times : undefined,
      customerMessage: message || undefined,
    });
    setStep("done");
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#2d5016]" />
      </div>
    );
  }

  if (notFound || !quote) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">🔍</p>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Tarjousta ei löydy</h1>
          <p className="text-gray-500 text-sm">Tarkista linkki tai ota yhteyttä meihin.</p>
          <a href="https://puuhapatet.fi" className="mt-6 inline-block text-[#2d5016] text-sm font-medium underline">
            puuhapatet.fi
          </a>
        </div>
      </div>
    );
  }

  const services = quote.description.split(" + ").filter(Boolean);
  const validDate = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("fi-FI") : null;
  const isTalo = quote.isTaloyhtiio;

  // Taloyhtiö: not yet approved — show info screen
  if (isTalo && !quote.taloyhtiioApproved) {
    return (
      <div className="min-h-screen bg-[#f0faf2]" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" }}>
        <div className="max-w-lg mx-auto px-4 pt-12 pb-10 space-y-4">
          <div className="text-center mb-6">
            <p className="text-xl font-black text-[#2d5016] tracking-tight">Puuhapatet.</p>
          </div>
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
            <Building2 className="w-10 h-10 text-[#2d5016] mx-auto mb-4 opacity-60" />
            <h2 className="text-base font-semibold text-zinc-800 mb-2">Taloyhtiötarjous</h2>
            <p className="text-zinc-500 text-sm leading-relaxed">
              Tarjous on lähetetty taloyhtiölle. Linkki aktivoituu asukaskäyttöön, kun isännöitsijä tai hallituksen jäsen on hyväksynyt sen jaettavaksi.
            </p>
            <a href="https://wa.me/358400389999" className="inline-block mt-6 text-[#2d5016] text-sm font-medium underline">
              Kysymyksiä? WhatsApp: +358 400 389 999
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (step === "done" && !isTalo) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <p className="text-center text-xl font-black text-[#2d5016] tracking-tight mb-6">Puuhapatet.</p>
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            {declined ? (
              <>
                <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mx-auto mb-4">
                  <X className="w-6 h-6 text-zinc-400" />
                </div>
                <h2 className="text-base font-semibold text-zinc-800 mb-2">Kiitos vastauksestasi</h2>
                <p className="text-zinc-500 text-sm">Olemme kirjanneet vastauksesi. Ota yhteyttä, jos mielesi muuttuu.</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-base font-semibold text-zinc-800 mb-2">Tarjous hyväksytty!</h2>
                <p className="text-zinc-500 text-sm">Otamme sinuun yhteyttä pian ja vahvistamme ajankohdan.</p>
              </>
            )}
            <a href="https://wa.me/358400389999" className="inline-block mt-6 text-[#2d5016] text-sm font-medium underline">
              WhatsApp: +358 400 389 999
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9]" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" }}>

      {/* Header — property image for taloyhtiö, video otherwise */}
      <div className="relative w-full overflow-hidden" style={{ height: isTalo ? "auto" : "52vw", minHeight: isTalo ? 0 : 200, maxHeight: isTalo ? "none" : 320 }}>
        {isTalo && quote.propertyImageUrl ? (
          <img
            src={quote.propertyImageUrl}
            alt={quote.taloyhtiioName || quote.customerName}
            className="w-full object-cover"
            style={{ maxHeight: 280 }}
          />
        ) : !isTalo ? (
          <video src="/tarjous-intro.mp4" autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
        ) : null}

        {!isTalo && (
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.72) 100%)" }} />
        )}

        {isTalo && quote.propertyImageUrl && (
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.5) 100%)" }} />
        )}

        {!isTalo && (
          <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-3 max-w-lg mx-auto flex items-end justify-between">
            <div>
              <p className="text-white text-lg font-black tracking-tight">Puuhapatet.</p>
              <p className="text-white/60 text-[11px] mt-0.5">{validDate ? `Voimassa ${validDate} asti` : "Tarjous"}</p>
            </div>
            <span className="text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full" style={{ background: "#2d5016", color: "#b8e07a" }}>
              TARJOUS
            </span>
          </div>
        )}
      </div>

      {/* Taloyhtiö top header */}
      {isTalo && (
        <div className="bg-[#2d5016] px-5 py-4 flex items-center justify-between max-w-lg mx-auto" style={{ borderRadius: quote.propertyImageUrl ? "0" : "0 0 0 0" }}>
          <div>
            <p className="text-white font-black tracking-tight text-lg">Puuhapatet.</p>
            <p className="text-[#a3c97a] text-[11px] mt-0.5">{validDate ? `Voimassa ${validDate} asti` : "Taloyhtiötarjous"}</p>
          </div>
          <span className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full bg-[#a3c97a] text-[#1a3a0a]">
            TALOYHTIÖ
          </span>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-5 pb-10 space-y-3">

        {/* Optional YouTube/Vimeo video */}
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

        {/* ── TALOYHTIÖ mode ─────────────────────────────────────────────── */}
        {isTalo ? (
          <TaloyhtiioPortal token={token} quote={quote} />
        ) : (
          <>
            {/* Customer row */}
            <div className="bg-white rounded-2xl border border-zinc-200 grid grid-cols-2 divide-x divide-zinc-100">
              <div className="p-4">
                <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-1">Asiakkaalle</p>
                <p className="text-zinc-800 text-sm font-semibold leading-snug">{quote.customerName}</p>
                {quote.customerAddress && <p className="text-zinc-400 text-xs mt-0.5">{quote.customerAddress}</p>}
              </div>
              <div className="p-4 text-right">
                <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-1">Lähettäjä</p>
                <p className="text-zinc-800 text-sm font-semibold">Puuhapatet</p>
                <p className="text-zinc-400 text-xs mt-0.5">+358 400 389 999</p>
              </div>
            </div>

            {/* Services + price */}
            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="px-5 pt-4 pb-1">
                <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-3">Palvelut</p>
                <div className="space-y-2">
                  {services.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 mt-1.5 shrink-0" />
                      <p className="text-sm text-zinc-700 leading-snug">{s}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mx-5 my-3 border-t border-zinc-100 pt-3 flex justify-between items-baseline">
                <p className="text-sm font-semibold text-zinc-800">Yhteensä</p>
                <p className="text-2xl font-black text-zinc-900">{fmt(quote.agreedPriceCents)}</p>
              </div>
              <div className="mx-5 mb-4 flex flex-wrap gap-2">
                {[
                  { emoji: "✅", label: "Kotitalousvähennys" },
                  { emoji: "⭐", label: "Tyytyväisyystakuu" },
                  { emoji: "🔒", label: "Vakuutettu työ" },
                ].map(b => (
                  <span key={b.label} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-100 text-zinc-500">
                    {b.emoji} {b.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Response — view */}
            {step === "view" && (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => setStep("accept")}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white"
                  style={{ background: "#2d5016" }}
                >
                  <Check className="w-4 h-4" />
                  Hyväksy tarjous
                </button>
                <button
                  onClick={handleDecline}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-zinc-400 bg-white border border-zinc-200"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Kiitos, ei kiitos
                </button>
              </div>
            )}

            {/* Response — accept form */}
            {step === "accept" && (
              <AcceptForm
                onSubmit={handleAccept}
                onBack={() => setStep("view")}
                submitting={submitting}
              />
            )}
          </>
        )}

        {/* Footer */}
        <p className="text-center text-zinc-400 text-[11px] pt-2">
          Puuhapatet ·{" "}
          <a href="mailto:info@puuhapatet.fi" className="underline">info@puuhapatet.fi</a>
          {" · "}
          <a href="https://puuhapatet.fi" className="underline">puuhapatet.fi</a>
        </p>
      </div>
    </div>
  );
}
