import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Check, X, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

function isYouTube(url: string) {
  return /youtube\.com|youtu\.be/.test(url);
}

function isVimeo(url: string) {
  return /vimeo\.com/.test(url);
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

  // Response flow
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
  const kotitalous = Math.round(quote.agreedPriceCents * 0.65);
  const validDate = quote.validUntil ? new Date(quote.validUntil).toLocaleDateString("fi-FI") : null;

  // Already responded
  if (step === "done") {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-2xl font-black text-[#2d5016] tracking-tight">Puuhapatet.</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            {declined ? (
              <>
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <X className="w-7 h-7 text-gray-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Kiitos vastauksestasi</h2>
                <p className="text-gray-500 text-sm">Olemme kirjanneet vastauksesi. Ota yhteyttä, jos mielesi muuttuu.</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Tarjous hyväksytty!</h2>
                <p className="text-gray-500 text-sm mb-4">
                  Otamme sinuun yhteyttä pian ja vahvistamme ajankohdan.
                </p>
              </>
            )}
            <a href="https://wa.me/358400389999" className="inline-block mt-4 text-[#2d5016] text-sm font-medium underline">
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
      <div className="relative w-full overflow-hidden" style={{ height: "52vw", minHeight: 200, maxHeight: 340 }}>
        <video
          src="/tarjous-intro.mp4"
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Dark gradient overlay */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.70) 100%)" }} />
        {/* Brand + badge */}
        <div className="absolute inset-0 flex flex-col justify-between px-5 py-5 max-w-lg mx-auto" style={{ left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 512 }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white text-xl font-black tracking-tight" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>Puuhapatet.</p>
              <p className="text-white/60 text-xs mt-0.5">Ikkunapesu · Pihapalvelut · Nurmikko</p>
            </div>
            <span className="text-xs font-bold tracking-widest uppercase px-3 py-1.5 rounded-full" style={{ background: "#2d5016", color: "#b8e07a" }}>
              TARJOUS
            </span>
          </div>
          <div>
            <p className="font-mono text-white/50 text-xs font-bold tracking-widest">{quote.quoteId}</p>
            <p className="text-white/70 text-sm font-medium mt-0.5">
              {validDate ? `Voimassa ${validDate} asti` : "Tarjous"}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Optional job-specific video from admin */}
        {quote.quoteVideoUrl && (() => {
          const vUrl = quote.quoteVideoUrl!;
          if (isYouTube(vUrl)) {
            const embed = getYouTubeEmbedUrl(vUrl);
            return embed ? (
              <div className="rounded-2xl overflow-hidden shadow-sm aspect-video bg-black">
                <iframe src={embed} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            ) : null;
          }
          if (isVimeo(vUrl)) {
            const embed = getVimeoEmbedUrl(vUrl);
            return embed ? (
              <div className="rounded-2xl overflow-hidden shadow-sm aspect-video bg-black">
                <iframe src={embed} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
              </div>
            ) : null;
          }
          return (
            <div className="rounded-2xl overflow-hidden shadow-sm aspect-video bg-black">
              <video src={vUrl} autoPlay muted loop playsInline className="w-full h-full object-cover" />
            </div>
          );
        })()}

        {/* Customer + worker columns */}
        <div className="bg-[#fafafa] rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-zinc-200">
            <div className="p-4">
              <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Asiakkaalle</p>
              <p className="text-zinc-800 text-sm font-bold leading-snug">{quote.customerName}</p>
              {quote.customerAddress && <p className="text-zinc-500 text-xs mt-0.5">{quote.customerAddress}</p>}
            </div>
            <div className="p-4 text-right">
              <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">Lähettäjä</p>
              <p className="text-zinc-800 text-sm font-bold">Puuhapatet</p>
              <p className="text-zinc-500 text-xs mt-0.5">+358 400 389 999</p>
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden shadow-sm">
          <div className="px-5 pt-4 pb-2">
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-3">Palvelut</p>
            <div className="divide-y divide-zinc-100">
              {services.map((s, i) => (
                <div key={i} className="flex justify-between items-center py-2.5">
                  <p className="text-sm text-zinc-800">{s}</p>
                  {i === services.length - 1 && services.length === 1 && (
                    <p className="text-sm font-bold text-zinc-900">{fmt(quote.agreedPriceCents)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="border-t-2 border-zinc-900 px-5 py-3 flex justify-between items-center">
            <p className="text-sm font-bold text-zinc-900">Yhteensä</p>
            <p className="text-2xl font-black text-zinc-900">{fmt(quote.agreedPriceCents)}</p>
          </div>
          {/* Kotitalousvähennys */}
          <div className="border-t border-zinc-100 bg-green-50 px-5 py-3">
            <p className="text-xs font-bold text-green-800 uppercase tracking-wide mb-1">Kotitalousvähennys</p>
            <p className="text-green-700 text-xs leading-relaxed">
              Tämä palvelu on kotitalousvähennyskelpoinen. Tosiasiallinen hintasi on vain noin{" "}
              <strong className="text-base">{fmt(kotitalous)}</strong> — 35 % työn osuudesta palautuu veroissa.
              Tilauksen vahvistuksen jälkeen saat laskun, joka käy dokumenttina verotukseen.
            </p>
          </div>
        </div>

        {/* Response section */}
        {step === "view" && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5">
            <p className="text-sm font-semibold text-zinc-800 mb-4">Mitä haluat tehdä?</p>
            <div className="flex flex-col gap-3">
              <Button
                className="w-full gap-2 h-12 text-base"
                style={{ background: "#2d5016" }}
                onClick={() => setStep("accept")}
              >
                <Check className="w-5 h-5" />
                Hyväksy tarjous
                <ChevronRight className="w-4 h-4 ml-auto" />
              </Button>
              <Button
                variant="outline"
                className="w-full gap-2 h-11 text-sm text-zinc-500"
                onClick={handleDecline}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Kiitos, ei kiitos
              </Button>
            </div>
          </div>
        )}

        {step === "accept" && (
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-zinc-800 mb-1">Ehdota sopivia aikoja</p>
              <p className="text-xs text-zinc-400 mb-3">Valitse 1–3 ajankohtaa, jotka sopivat sinulle. Vahvistamme pian.</p>
              <div className="space-y-2">
                {times.map((t, i) => (
                  <div key={i}>
                    <p className="text-xs text-zinc-400 mb-1">Vaihtoehto {i + 1}{i === 0 ? " *" : " (valinnainen)"}</p>
                    <input
                      type="datetime-local"
                      value={t}
                      onChange={e => setTimes(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                      className={cn(
                        "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800",
                        "focus:outline-none focus:ring-2 focus:ring-[#2d5016]"
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Viesti (valinnainen)</p>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Lisätietoja, toiveita tai kysymyksiä…"
                rows={3}
                className="text-sm resize-none"
              />
            </div>

            <Button
              className="w-full h-12 text-base gap-2"
              style={{ background: "#2d5016" }}
              onClick={handleAccept}
              disabled={submitting || !times[0]}
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              Lähetä hyväksyntä
            </Button>
            <button
              className="text-xs text-zinc-400 w-full text-center"
              onClick={() => setStep("view")}
            >
              ← Takaisin
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-zinc-400 text-xs">
            Puuhapatet · <a href="mailto:info@puuhapatet.fi" className="underline">info@puuhapatet.fi</a> ·{" "}
            <a href="https://puuhapatet.fi" className="underline">puuhapatet.fi</a>
          </p>
        </div>
      </div>
    </div>
  );
}
