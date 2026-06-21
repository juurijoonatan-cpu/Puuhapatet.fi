/**
 * Dashboard AI briefing — an on-demand "what should I focus on today" summary.
 *
 * On-demand (button) rather than auto-run, so it never burns the free model
 * quota on every dashboard load. Role-scoped server side like the assistant.
 */

import { useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getAdminProfile } from "@/lib/admin-profile";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE, withAuth } from "@/lib/api";

const PROMPT =
  "Anna lyhyt päivän tilannekatsaus: tärkeimmät tämän viikon keikat, avoimet " +
  "liidit/tarjoukset jotka kaipaavat toimenpiteitä, ja 1–3 konkreettista " +
  "ehdotusta mihin kannattaa keskittyä tänään. Lisää loppuun lyhyt kohta " +
  "\"Iso keikka\": kerro isojen keikkojen (esim. FR8) edistyminen — montako " +
  "ikkunaa pesty, maksuerän tilanne ja paljonko seuraavaan maksuun — muotoiltuna " +
  "niin että sen voi suoraan kertoa asiakkaan yhteyshenkilölle. Pidä tiiviinä ja käytä lyhyttä listaa.";

export function DashboardBriefing() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Päivän katsaus</p>
            <p className="text-xs text-muted-foreground">Tekoälyn tiivistys keikoista ja prioriteeteista</p>
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-50"
          data-testid="dashboard-briefing-generate"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : text ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {text ? "Päivitä" : "Luo katsaus"}
        </button>
      </div>

      {loading && !text && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-muted rounded w-3/4" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
      )}
      {text && (
        <div className="text-sm text-foreground">
          <ChatMarkdown content={text} />
        </div>
      )}
      {!text && !loading && (
        <p className="text-sm text-muted-foreground">
          Pyydä tekoälyltä nopea yhteenveto siitä, mihin kannattaa keskittyä tänään.
        </p>
      )}
    </Card>
  );
}
