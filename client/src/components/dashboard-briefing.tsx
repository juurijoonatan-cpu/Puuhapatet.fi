/**
 * Dashboard AI briefing — a tight "today at a glance" summary.
 *
 * Deliberately short and profit-first: it leads with what I earned TODAY and,
 * at most, the one or two things that genuinely need attention today. No
 * prospecting, no stale leads, no generic advice — that noise belongs in the
 * assistant, not the daily glance.
 *
 * On-demand (button) rather than auto-run, so it never burns the model quota on
 * every dashboard load. Role-scoped server side like the assistant.
 */

import { useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getAdminProfile } from "@/lib/admin-profile";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE, withAuth } from "@/lib/api";

const PROMPT =
  "Tee minulle päivän katsaus. PIDÄ SE ERITTÄIN LYHYENÄ JA YTIMEKKÄÄNÄ — enintään 5 riviä, ei johdantoa eikä lopetusta.\n\n" +
  "Rakenne tarkalleen näin:\n" +
  "1. **Tänään tienattu:** kerro paljonko olen ansainnut tänään. Käytä kontekstin 'tänään yhteensä' -lukua (oma työ + passiivinen tuotto-osuus). Jos tälle päivälle ei ole kertymää, kirjoita lyhyesti esim. 'Ei kirjattuja ansioita vielä tänään.' Älä koskaan keksi lukua.\n" +
  "2. **Vaatii huomiota:** enintään 1–2 asiaa jotka on oikeasti hoidettava juuri tänään (tälle päivälle sovittu keikka, erääntyvä lasku, tai liidi jolta odotetaan vastausta tänään). Jos mikään ei ole kiireellistä, kirjoita vain 'Ei kiireellisiä toimia.'\n\n" +
  "EHDOTTOMAT SÄÄNNÖT:\n" +
  "- ÄLÄ ehdota uusia prospekteja tai markkinointi-ideoita.\n" +
  "- ÄLÄ listaa vanhoja, roikkuvia tai yleisluontoisia liidejä — vain se mikä on kiireellistä tänään.\n" +
  "- Ei yleisiä vinkkejä, ei täytelauseita, ei kohteliaisuuksia, ei selittelyä. Pelkät faktat.\n" +
  "- Käytä lyhyttä listaa ja lihavoi otsikot. Älä lisää erillistä 'Iso keikka' -osiota ellei siinä ole nimenomaan tämän päivän tapahtumaa.\n" +
  "- Jätä täysin pois kaikki tapahtumat tai liidit joiden muistiinpanoissa lukee \"[Prospekti — AI-ehdotus\" — ne ovat tekoälyn luomia testikohteita, älä mainitse niitä millään tavalla.";

export function DashboardBriefing() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const today = new Date().toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "long" });

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-status`).then(r => r.json()).then(d => setAiEnabled(!!d.enabled)).catch(() => setAiEnabled(null));
  }, []);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/assistant`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: PROMPT, userId: profile?.id, userName: profile?.name, role: profile?.role }),
      });
      const data = await res.json();
      setText(data.reply || data.error || "Ei vastausta.");
    } catch {
      setText("Yhteysvirhe. Yritä hetken kuluttua uudelleen.");
    } finally {
      setLoading(false);
    }
  }

  if (aiEnabled === false) return null; // stay quiet until a key is configured

  return (
    <Card className="p-5 bg-card border-0 premium-shadow mb-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">Päivän katsaus</p>
            <p className="text-xs text-muted-foreground capitalize truncate">{today}</p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-50 shrink-0"
          data-testid="dashboard-briefing-generate"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : text ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {text ? "Päivitä" : "Luo katsaus"}
        </button>
      </div>

      {loading && !text && (
        <div className="space-y-2 animate-pulse pt-1">
          <div className="h-3 bg-muted rounded w-2/5" />
          <div className="h-3 bg-muted rounded w-4/5" />
          <div className="h-3 bg-muted rounded w-3/5" />
        </div>
      )}
      {text && (
        <div className="text-sm text-foreground leading-relaxed [&_p]:mb-2 [&_ul]:mt-1 [&_li]:mb-0.5">
          <ChatMarkdown content={text} />
        </div>
      )}
      {!text && !loading && (
        <p className="text-sm text-muted-foreground">
          Näe tämän päivän ansiot ja mikä vaatii huomiota — lyhyesti.
        </p>
      )}
    </Card>
  );
}
