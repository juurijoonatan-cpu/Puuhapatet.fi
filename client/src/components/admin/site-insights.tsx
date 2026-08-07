/**
 * Nettisivun tilannekuva: kävijät ja yhteydenotot.
 *
 * MIKSI TÄMÄ ON LIIDIT-SIVULLA eikä omana välilehtenään: nettisivun
 * yhteydenotto ON liidi, samoin kuin myyjän keräämä. Kaksi eri paikkaa
 * samalle asialle tarkoittaa että toinen jää katsomatta — ja juuri niin kävi
 * kun tein tästä oman sivun, jota ei löytynyt puhelimen navista lainkaan.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { API_BASE, withAuth } from "@/lib/api";

/**
 * Kävijätilastot — evästeetön mittaus omalta palvelimelta.
 *
 * Suppilo on tämän tärkein rivi: liikenne yksin ei kerro mitään, mutta
 * "kävijöitä 340 → yhteydenottoja 6" kertoo tuleeko liikenteestä töitä.
 */
export function Analytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    setD(null);
    fetch(`${API_BASE}/api/admin/analytics?days=${days}`, { headers: withAuth() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setD(j); })
      .catch(() => {});
  }, [days]);

  const peak = d ? Math.max(1, ...d.perDay.map((x: any) => x.views)) : 1;

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-lg font-semibold text-foreground">Nettisivun kävijät</h2>
        <div className="flex gap-1">
          {[7, 30, 90].map((n) => (
            <Button key={n} variant={days === n ? "default" : "outline"} size="sm" onClick={() => setDays(n)}>
              {n} pv
            </Button>
          ))}
        </div>
      </div>

      {!d ? (
        <p className="text-sm text-muted-foreground">Ladataan…</p>
      ) : d.views === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ei vielä kävijädataa. Mittaus alkaa kun sivusto on päivitetty.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              ["Kävijöitä", d.visitors],
              ["Sivunlatauksia", d.views],
              ["Yhteydenottoja", d.contacts],
              ["Näistä yhteyttä", `${d.conversionPct} %`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold text-foreground tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* Käyrä pylväinä — ei kirjastoa yhtä riviä varten. */}
          <div className="flex items-end gap-[2px] h-16 mb-4">
            {d.perDay.map((x: any) => (
              <div key={x.day} title={`${x.day}: ${x.views} latausta, ${x.visitors} kävijää`}
                className="flex-1 bg-primary/30 hover:bg-primary/60 rounded-t transition-colors"
                style={{ height: `${Math.max(4, (x.views / peak) * 100)}%` }} />
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-4 text-sm">
            {[["Suosituimmat sivut", d.topPages], ["Mistä tullaan", d.topSources], ["Laite", d.devices]].map(([title, list]: any) => (
              <div key={title}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</p>
                {list.length === 0 ? <p className="text-muted-foreground">—</p> : list.map((x: any) => (
                  <div key={x.name} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">{x.name}</span>
                    <span className="text-muted-foreground tabular-nums">{x.count}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Evästeetön mittaus omalla palvelimella: ei evästeitä, ei IP-osoitteita, ei kolmansia
            osapuolia. Kävijä = eri selain saman päivän sisällä.
          </p>
        </>
      )}
    </Card>
  );
}

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
export function ContactRequests() {
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

