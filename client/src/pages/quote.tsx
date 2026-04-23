import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Check, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type QuoteData = {
  quoteId: string;
  customerName: string;
  customerAddress: string;
  description: string;
  agreedPriceCents: number;
  validUntil: string | null;
  quoteStatus: string;
  quoteVideoUrl: string | null;
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

export default function QuotePage() {
  const [, params] = useRoute("/tarjous/:token");
  const token = params?.token ?? "";

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [step, setStep] = useState<"view" | "accept" | "done">("view");
  const [declined, setDeclined] = useState(false);
  const [times, setTimes] = useState(["", "", ""]);
  const [message, setMessage] = useState("");
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

  if (step === "done") {
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
            <a
              href="https://wa.me/358400389999"
              className="inline-block mt-6 text-[#2d5016] text-sm font-medium underline"
            >
              WhatsApp: +358 400 389 999
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9]" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" }}>

      {/* Video header */}
      <div className="relative w-full overflow-hidden" style={{ height: "52vw", minHeight: 200, maxHeight: 320 }}>
        <video src="/tarjous-intro.mp4" autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.72) 100%)" }} />
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-3 max-w-lg mx-auto flex items-end justify-between">
          <div>
            <p className="text-white text-lg font-black tracking-tight">Puuhapatet.</p>
            <p className="text-white/60 text-[11px] mt-0.5">{validDate ? `Voimassa ${validDate} asti` : "Tarjous"}</p>
          </div>
          <span className="text-[11px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-full" style={{ background: "#2d5016", color: "#b8e07a" }}>
            TARJOUS
          </span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-5 pb-10 space-y-3">

        {/* Optional admin-added video */}
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
          {/* Trust badges */}
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
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Ehdota sopivia aikoja</p>
              <p className="text-xs text-zinc-400 mt-1">Valitse 1–3 ajankohtaa. Vahvistamme sinulle sopivan ajan.</p>
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
                onClick={handleAccept}
                disabled={submitting || !times[0]}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-opacity",
                  submitting || !times[0] ? "opacity-40" : "opacity-100"
                )}
                style={{ background: "#2d5016" }}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Lähetä hyväksyntä
              </button>
              <button
                className="w-full text-xs text-zinc-400 py-2 text-center"
                onClick={() => setStep("view")}
              >
                ← Takaisin
              </button>
            </div>
          </div>
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
