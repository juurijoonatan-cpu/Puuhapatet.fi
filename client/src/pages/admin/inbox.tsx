/**
 * Admin Inbox — website contact requests.
 *
 * Kaksi lähdettä samassa laatikossa:
 *   1. Nettisivun lomakkeet (/api/contact, /api/it-contact) — nämä kirjataan
 *      kantaan ENNEN ilmoitussähköpostia, joten ne eivät katoa vaikka posti
 *      olisi rikki. Rikkinäinen posti näkyy tässä omana varoituksenaan.
 *   2. Verkkochatin handoffit — kävijä jättää yhteystietonsa botille.
 *
 * Chatin viestisisältö poistetaan kahden vuorokauden jälkeen, yhteystiedot
 * jäävät (ne ovat yhteydenotto, eivät chat-historiaa). Emme ole livenä
 * chatissa, joten täällä ei vastata reaaliajassa.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, MessageCircle, RefreshCw, Phone, Mail, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ChatMarkdown } from "@/components/chat-markdown";
import { API_BASE, withAuth } from "@/lib/api";

interface ContactRow {
  id: number; kind: string; name: string;
  phone?: string | null; email?: string | null; address?: string | null;
  urgency?: string | null; message: string; pageUrl?: string | null;
  notified: boolean; notifyError?: string | null;
  handledAt?: string | null; createdAt: string;
}

/**
 * Nettisivun yhteydenotot + kevyt tilasto.
 *
 * `emailBroken` on tämän tärkein luku. Yhteydenotot lähtivät ennen pelkkänä
 * sähköpostina, joten rikkinäinen posti tarkoitti hiljaa menetettyjä
 * asiakkaita — vasta puhelimen hiljeneminen olisi paljastanut sen. Nyt
 * pyynnöt ovat tallessa ja rikkinäinen ilmoitus näkyy punaisena.
 */
function ContactRequests() {
  const [data, setData] = useState<{ rows: ContactRow[]; stats: any } | null>(null);
  const [open, setOpen] = useState(false);

  const load = () => {
    fetch(`${API_BASE}/api/admin/contact-requests`, { headers: withAuth() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setData({ rows: d.rows, stats: d.stats }); })
      .catch(() => {});
  };
  useEffect(load, []);

  async function toggleHandled(row: ContactRow) {
    await fetch(`${API_BASE}/api/admin/contact-requests/${row.id}/handled`, {
      method: "POST",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ handled: !row.handledAt }),
    });
    load();
  }

  if (!data) return null;
  const { rows, stats } = data;
  const shown = open ? rows : rows.filter((r) => !r.handledAt).slice(0, 5);

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-lg font-semibold text-foreground">Nettisivun yhteydenotot</h2>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span><b className="text-foreground">{stats.last7}</b> / 7 pv</span>
          <span><b className="text-foreground">{stats.last30}</b> / 30 pv</span>
          <span><b className="text-foreground">{stats.unhandled}</b> hoitamatta</span>
        </div>
      </div>

      {stats.emailBroken > 0 && (
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          <b>{stats.emailBroken} yhteydenottoa ei saanut ilmoitusta sähköpostiin.</b>{" "}
          Pyynnöt ovat tallessa tässä, mutta sähköposti-ilmoitus ei toimi — tarkista RESEND_API_KEY.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ei yhteydenottoja vielä.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <div key={r.id} className={`rounded-lg border p-3 ${r.handledAt ? "opacity-55" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {r.name}
                    {r.kind === "it" && <span className="ml-2 text-xs text-muted-foreground">IT</span>}
                    {!r.notified && <span className="ml-2 text-xs text-red-500">ei ilmoitusta</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[r.phone, r.email, r.urgency, new Date(r.createdAt).toLocaleString("fi-FI")].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{r.message}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void toggleHandled(r)}>
                  {r.handledAt ? "Palauta" : "Hoidettu"}
                </Button>
              </div>
            </div>
          ))}
          {rows.length > shown.length && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Näytä kaikki ({rows.length})</Button>
          )}
        </div>
      )}
    </Card>
  );
}

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
  bot: "Botti hoiti",
  needs_human: "Odottaa yhteydenottoa",
  human: "Hoidettu",
  closed: "Hoidettu",
};

export default function AdminInboxPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const listQuery = useQuery({
    queryKey: ["/api/admin/chats"],
    queryFn: async (): Promise<Convo[]> => {
      const res = await fetch(`${API_BASE}/api/admin/chats`, { headers: withAuth() });
      if (!res.ok) throw new Error("Latauksen virhe");
      return res.json();
    },
    // 10 s -> 30 s. Tämä sivu jää auki taustalle, ja jokainen kierros luki 100
    // keskustelua kannasta — turhaa siirtoa (Neonin kiintiö). 30 s riittää
    // postilaatikolle, ja uusi viesti näkyy silti käytännössä heti.
    // Tausta-välilehti ei pollaa lainkaan: se säästää siirtoa, ja ennen kaikkea
    // se päästää Neonin computen lepotilaan. Jatkuva polli piti tietokannan
    // hereillä ympäri vuorokauden ja poltti compute-tunteja vaikka kukaan ei
    // katsonut sivua.
    refetchInterval: () => (document.hidden ? false : 30_000),
    refetchIntervalInBackground: false,
  });

  const convoQuery = useQuery({
    queryKey: ["/api/admin/chats", activeId],
    enabled: activeId != null,
    queryFn: async (): Promise<Convo & { messages: Msg[] }> => {
      const res = await fetch(`${API_BASE}/api/admin/chats/${activeId}`, { headers: withAuth() });
      if (!res.ok) throw new Error("Latauksen virhe");
      return res.json();
    },
    // 5 s -> 15 s. Avoin keskustelu haki koko viestihistorian joka kierros.
    // Sekin vain näkyvänä — piilossa oleva välilehti ei pidä computea hereillä.
    refetchInterval: () => (activeId != null && !document.hidden ? 15_000 : false),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [convoQuery.data?.messages?.length]);

  async function setStatus(status: string) {
    if (!activeId) return;
    await fetch(`${API_BASE}/api/admin/chats/${activeId}`, {
      method: "PATCH",
      headers: withAuth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    await convoQuery.refetch();
    qc.invalidateQueries({ queryKey: ["/api/admin/chats"] });
  }

  const list = listQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard">
              <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Yhteydenottopyynnöt</h1>
              <p className="text-muted-foreground">Nettisivun lomakkeet ja verkkochatti — soita tai laita viestiä</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isRefetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${listQuery.isRefetching ? "animate-spin" : ""}`} />
            Päivitä
          </Button>
        </div>

        <ContactRequests />

        <div className="grid md:grid-cols-[300px_1fr] gap-4">
          {/* Conversation list */}
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {listQuery.isLoading ? (
              <Card className="p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></Card>
            ) : list.length === 0 ? (
              <EmptyState icon={MessageCircle} title="Ei yhteydenottopyyntöjä" description="Kun kävijä pyytää chatissa yhteydenottoa, se näkyy tässä." />
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

                <div className="p-3 border-t border-border flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground flex-1 min-w-[140px]">
                    Ota yhteyttä kävijään puhelimitse tai sähköpostilla — chat ei ole reaaliaikainen.
                  </p>
                  {convoQuery.data?.visitorPhone && (
                    <a href={`tel:${convoQuery.data.visitorPhone}`}>
                      <Button size="sm"><Phone className="w-4 h-4 mr-2" />Soita</Button>
                    </a>
                  )}
                  {convoQuery.data?.visitorEmail && (
                    <a href={`mailto:${convoQuery.data.visitorEmail}`}>
                      <Button size="sm" variant="outline"><Mail className="w-4 h-4 mr-2" />Sähköposti</Button>
                    </a>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
