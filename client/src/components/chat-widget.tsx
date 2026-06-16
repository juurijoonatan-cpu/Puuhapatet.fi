/**
 * Public chat bubble — floating assistant for the customer site.
 *
 * - Answers from the Puuhapatet knowledge base via a free AI model (server side).
 * - Never guesses: if it can't help it offers to pass the message to the team.
 * - Live handoff: once the team replies in the admin inbox, those messages
 *   appear here (the widget polls while open).
 */

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface Msg {
  role: "user" | "assistant" | "admin" | "system";
  content: string;
  authorName?: string | null;
}

const TOKEN_KEY = "puuhapatet_chat_token";
const GREETING: Msg = {
  role: "assistant",
  content:
    "Moi! 👋 Olen Puuhapattien avustaja. Voin kertoa palveluista, hinta-arvioista ja " +
    "alueista — tai välittää viestisi suoraan tiimille. Miten voin auttaa?",
};

export function ChatWidget() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string>("bot");
  const [token, setToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hide on admin / standalone tool routes — those have their own assistant.
  const hidden = location.startsWith("/admin") || location.startsWith("/tarjous") ||
    location.startsWith("/seuranta") || location.startsWith("/it") || location.startsWith("/cv");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Poll for live admin replies while the widget is open and a human is involved.
  useEffect(() => {
    if (!open || !token) return;
    if (status !== "needs_human" && status !== "human") return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/${token}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          setMessages([GREETING, ...data.messages.map((m: any) => ({ role: m.role, content: m.content, authorName: m.authorName }))]);
        }
        if (data.status) setStatus(data.status);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [open, token, status]);

  if (hidden) return null;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message: text, pageUrl: typeof window !== "undefined" ? window.location.href : undefined }),
      });
      const data = await res.json();
      if (data.token && data.token !== token) {
        setToken(data.token);
        localStorage.setItem(TOKEN_KEY, data.token);
      }
      if (data.status) setStatus(data.status);
      if (Array.isArray(data.messages)) {
        setMessages([GREETING, ...data.messages.map((m: any) => ({ role: m.role, content: m.content, authorName: m.authorName }))]);
      } else if (data.reply) {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setMessages((m) => [...m, {
        role: "assistant",
        content: "Yhteys katkesi hetkeksi. Voit myös soittaa: Joonatan +358 40 0389999.",
      }]);
    } finally {
      setSending(false);
    }
  }

  async function requestHuman() {
    if (!token) {
      // Need a conversation first — send a short opener
      setInput("Haluaisin jutella tiimin kanssa.");
      return;
    }
    try {
      await fetch(`/api/chat/${token}/request-human`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setStatus("needs_human");
      setMessages((m) => [...m, {
        role: "system",
        content: "Pyyntö välitetty tiimille. Voit jättää tähän nimesi ja puhelinnumerosi, niin olemme yhteydessä.",
      }]);
    } catch { /* ignore */ }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          aria-label="Avaa chat"
          data-testid="chat-launcher"
        >
          <MessageCircle className="w-7 h-7" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-[calc(100vw-2rem)] max-w-[380px] h-[70vh] max-h-[560px] flex flex-col rounded-2xl overflow-hidden bg-card border border-border shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
            <div>
              <p className="font-semibold leading-tight">Puuhapatet</p>
              <p className="text-xs opacity-80 leading-tight">
                {status === "human" ? "Tiimi vastaa" : status === "needs_human" ? "Odotetaan tiimiä…" : "Avustaja"}
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Sulje chat" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
            {messages.map((m, i) => {
              if (m.role === "system") {
                return (
                  <p key={i} className="text-center text-xs text-muted-foreground py-1">{m.content}</p>
                );
              }
              const mine = m.role === "user";
              return (
                <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    mine ? "bg-primary text-primary-foreground rounded-br-sm"
                         : m.role === "admin" ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-100 rounded-bl-sm"
                         : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.role === "admin" && (
                      <span className="block text-[10px] font-semibold opacity-70 mb-0.5">
                        {m.authorName || "Puuhapattien tiimi"}
                      </span>
                    )}
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

          <div className="px-3 pt-1 pb-1">
            <button
              onClick={requestHuman}
              className="text-xs text-primary hover:underline"
              data-testid="chat-request-human"
            >
              Haluan jutella tiimin kanssa →
            </button>
          </div>

          <div className="flex items-end gap-2 p-3 border-t border-border bg-card">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Kirjoita viesti…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-24"
              data-testid="chat-input"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
              aria-label="Lähetä"
              data-testid="chat-send"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
