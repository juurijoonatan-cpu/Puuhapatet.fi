/**
 * In-admin AI assistant — floating helper for the team.
 *
 * Knows the operational data (role-scoped server side) and helps with tasks:
 * summaries, scheduling/route ideas, drafting customer messages, optimising.
 * It advises and drafts — it does not change data itself.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";

interface Msg { role: "user" | "assistant"; content: string; }

const SUGGESTIONS = [
  "Mitkä keikat ovat tällä viikolla?",
  "Tee yhteenveto avoimista liideistä",
  "Ehdota tehokas reitti tämän viikon keikoille",
  "Luonnostele viesti asiakkaalle tarjouksen perään",
];

export function AdminAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setSending(true);
    try {
      const res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          userId: profile?.id,
          userName: profile?.name,
          role: profile?.role,
          history: messages.slice(-12),
        }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "Ei vastausta." }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Yhteysvirhe. Yritä hetken kuluttua uudelleen." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-[55] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          aria-label="Avaa avustaja"
          data-testid="admin-assistant-launcher"
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-[55] w-[calc(100vw-2rem)] max-w-[400px] h-[72vh] max-h-[620px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <div>
                <p className="font-semibold leading-tight">Avustaja</p>
                <p className="text-xs opacity-80 leading-tight">{profile?.name} · {profile?.role}</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Sulje" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-sm text-muted-foreground px-1">
                  Kysy keikoista, asiakkaista tai pyydä apua tehtäviin. Avustaja näkee
                  {profile?.role === "HOST" ? " koko toiminnan." : " omat keikkasi ja asiakkaasi."}
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full text-left text-sm px-3 py-2 rounded-xl border border-border hover:bg-muted/60 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => {
              const mine = m.role === "user";
              return (
                <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.content}
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 p-3 border-t border-border bg-card">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Kysy jotain…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
              data-testid="admin-assistant-input"
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
              aria-label="Lähetä"
              data-testid="admin-assistant-send"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
