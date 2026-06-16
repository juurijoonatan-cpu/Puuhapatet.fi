/**
 * Admin Inbox — live website chat.
 *
 * Lists conversations started from the public chat widget and lets the team
 * reply live. Conversations needing a human are highlighted and polled.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, MessageCircle, Send, RefreshCw, Phone, Mail, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ChatMarkdown } from "@/components/chat-markdown";
import { getAdminProfile } from "@/lib/admin-profile";

interface Convo {
  id: number;
  status: string;
  visitorName?: string | null;
  visitorEmail?: string | null;
  visitorPhone?: string | null;
  unread: boolean;
  pageUrl?: string | null;
  lastMessageAt: string;
}
interface Msg { id: number; role: string; content: string; authorName?: string | null; createdAt: string; }

const STATUS_LABEL: Record<string, string> = {
  bot: "Botti hoitaa",
  needs_human: "Odottaa sinua",
  human: "Tiimi vastaa",
  closed: "Suljettu",
};

export default function AdminInboxPage() {
  const qc = useQueryClient();
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const [activeId, setActiveId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const listQuery = useQuery({
    queryKey: ["/api/admin/chats"],
    queryFn: async (): Promise<Convo[]> => {
      const res = await fetch("/api/admin/chats");
      if (!res.ok) throw new Error("Latauksen virhe");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const convoQuery = useQuery({
    queryKey: ["/api/admin/chats", activeId],
    enabled: activeId != null,
    queryFn: async (): Promise<Convo & { messages: Msg[] }> => {
      const res = await fetch(`/api/admin/chats/${activeId}`);
      if (!res.ok) throw new Error("Latauksen virhe");
      return res.json();
    },
    refetchInterval: activeId != null ? 5000 : false,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [convoQuery.data?.messages?.length]);

  async function sendReply() {
    const text = reply.trim();
    if (!text || !activeId || sending) return;
    setReply("");
    setSending(true);
    try {
      await fetch(`/api/admin/chats/${activeId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, authorName: profile?.name }),
      });
      await convoQuery.refetch();
      qc.invalidateQueries({ queryKey: ["/api/admin/chats"] });
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: string) {
    if (!activeId) return;
    await fetch(`/api/admin/chats/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await convoQuery.refetch();
    qc.invalidateQueries({ queryKey: ["/api/admin/chats"] });
  }

  const list = listQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Viestit</h1>
              <p className="text-muted-foreground">Verkkosivun chat-keskustelut</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isRefetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${listQuery.isRefetching ? "animate-spin" : ""}`} />
            Päivitä
          </Button>
        </div>

        <div className="grid md:grid-cols-[300px_1fr] gap-4">
          {/* Conversation list */}
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {listQuery.isLoading ? (
              <Card className="p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></Card>
            ) : list.length === 0 ? (
              <EmptyState icon={MessageCircle} title="Ei keskusteluja" description="Verkkosivun chat-viestit näkyvät tässä." />
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    activeId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                  data-testid={`inbox-convo-${c.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {c.visitorName || `Kävijä #${c.id}`}
                    </span>
                    {c.unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className={`text-[10px] ${c.status === "needs_human" ? "text-amber-600 border-amber-300" : "text-muted-foreground"}`}>
                      {STATUS_LABEL[c.status] || c.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.lastMessageAt).toLocaleDateString("fi-FI")}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Conversation thread */}
          <Card className="flex flex-col h-[70vh] overflow-hidden border-border">
            {activeId == null ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Valitse keskustelu vasemmalta
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{convoQuery.data?.visitorName || `Kävijä #${activeId}`}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {convoQuery.data?.visitorPhone && (
                        <a href={`tel:${convoQuery.data.visitorPhone}`} className="flex items-center gap-1 hover:text-foreground">
                          <Phone className="w-3 h-3" />{convoQuery.data.visitorPhone}
                        </a>
                      )}
                      {convoQuery.data?.visitorEmail && (
                        <a href={`mailto:${convoQuery.data.visitorEmail}`} className="flex items-center gap-1 hover:text-foreground">
                          <Mail className="w-3 h-3" />{convoQuery.data.visitorEmail}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {convoQuery.data?.status !== "closed" ? (
                      <Button variant="ghost" size="sm" onClick={() => setStatus("closed")}>Sulje</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setStatus("bot")}>Avaa uudelleen</Button>
                    )}
                  </div>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  {(convoQuery.data?.messages ?? []).map((m) => {
                    if (m.role === "system") {
                      return <p key={m.id} className="text-center text-xs text-muted-foreground py-1">{m.content}</p>;
                    }
                    const fromVisitor = m.role === "user";
                    return (
                      <div key={m.id} className={`flex ${fromVisitor ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                          fromVisitor ? "bg-muted text-foreground rounded-bl-sm"
                          : m.role === "assistant" ? "bg-blue-100 text-blue-950 dark:bg-blue-900/40 dark:text-blue-100 rounded-br-sm"
                          : "bg-primary text-primary-foreground rounded-br-sm"
                        }`}>
                          {m.role === "assistant" && <span className="block text-[10px] font-semibold opacity-70 mb-0.5">Botti</span>}
                          {m.role === "admin" && m.authorName && <span className="block text-[10px] font-semibold opacity-70 mb-0.5">{m.authorName}</span>}
                          {m.role === "assistant" ? <ChatMarkdown content={m.content} /> : <span className="whitespace-pre-wrap">{m.content}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-end gap-2 p-3 border-t border-border">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                    placeholder="Vastaa kävijälle…"
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
                    data-testid="inbox-reply-input"
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !reply.trim()}
                    className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 shrink-0"
                    aria-label="Lähetä"
                    data-testid="inbox-reply-send"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
