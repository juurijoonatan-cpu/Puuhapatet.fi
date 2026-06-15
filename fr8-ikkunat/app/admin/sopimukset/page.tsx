"use client";

import { useEffect, useState } from "react";
import { SIGNED_KEY, type SignedContract } from "@/lib/contract";
import { buildSignedHtml, signedFileName } from "@/lib/signedFile";

interface ServerItem {
  file: string;
  contractId: string;
  signedAt: number;
  order: "A" | "B";
  legalName?: string;
  signerName?: string;
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "16px",
  padding: "18px 20px",
};

function openHtml(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export default function AdminSopimukset() {
  const [serverItems, setServerItems] = useState<ServerItem[]>([]);
  const [serverError, setServerError] = useState(false);
  const [local, setLocal] = useState<SignedContract | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // siirrä tilamuutokset pois efektin synkronisesta rungosta
      try {
        const raw = localStorage.getItem(SIGNED_KEY);
        if (raw && !cancelled) setLocal(JSON.parse(raw));
      } catch {}
      try {
        const d = await (await fetch("/api/contract")).json();
        if (cancelled) return;
        if (d?.ok && Array.isArray(d.items)) setServerItems(d.items);
        else setServerError(true);
      } catch {
        if (!cancelled) setServerError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmt = (ts: number) => new Date(ts).toLocaleString("fi-FI");

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "40px 24px 80px" }}>
      <div style={{ maxWidth: "820px", margin: "0 auto" }}>
        <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>
          PUUHAPATET · ADMIN
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: "28px", fontWeight: 800 }}>Allekirjoitetut sopimukset</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px", marginTop: 0 }}>
          Tilaajien sähköisesti allekirjoittamat sopimukset. Avaa avataksesi tai tulostaaksesi.
        </p>

        {/* Palvelimelle tallennetut */}
        <h2 style={{ fontSize: "15px", marginTop: "30px" }}>Palvelimella ({serverItems.length})</h2>
        {loading && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Ladataan…</div>}
        {!loading && serverError && (
          <div style={{ ...card, color: "rgba(255,255,255,0.55)", fontSize: "13px" }}>
            Palvelintallennus ei ole käytettävissä tässä ympäristössä (esim. staattinen hosting).
            Allekirjoitetut sopimukset löytyvät silloin tilaajalle ladatusta tiedostosta ja alla olevasta
            tämän laitteen tallenteesta.
          </div>
        )}
        {!loading && !serverError && serverItems.length === 0 && (
          <div style={{ ...card, color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>Ei vielä allekirjoituksia.</div>
        )}
        <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
          {serverItems
            .sort((a, b) => b.signedAt - a.signedAt)
            .map((it) => (
              <div key={it.file} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>{it.legalName || "—"}</div>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
                    {it.contractId} · vaihtoehto {it.order} · {it.signerName} · {fmt(it.signedAt)}
                  </div>
                </div>
                <button
                  onClick={() => window.open(`/api/contract?file=${encodeURIComponent(it.file.replace(/\.json$/, ".html"))}`, "_blank")}
                  style={btnStyle}
                >
                  Avaa
                </button>
              </div>
            ))}
        </div>

        {/* Tämän laitteen tallenne */}
        <h2 style={{ fontSize: "15px", marginTop: "34px" }}>Tämä laite</h2>
        {local ? (
          <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "14px" }}>{local.customer.legalName || "—"}</div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
                {local.contractId} · vaihtoehto {local.order} · {local.signerName} · {fmt(local.signedAt)}
              </div>
            </div>
            <button onClick={() => openHtml(buildSignedHtml(local))} style={btnStyle} title={signedFileName(local)}>
              Avaa
            </button>
          </div>
        ) : (
          <div style={{ ...card, color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
            Tällä laitteella ei ole allekirjoitettua sopimusta.
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: "10px",
  border: "none",
  background: "#fff",
  color: "#0a0a0c",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  flexShrink: 0,
};
