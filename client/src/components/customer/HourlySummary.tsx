/**
 * TUNTIKEIKAN TILANNE ASIAKKAALLE — tunnit, tekijät ja hänelle ostetut tarvikkeet.
 *
 * TÄMÄ ON TUNTIKEIKAN PÄÄKORTTI. Kohdennetulla keikalla asiakkaan tärkein luku
 * on pesuprosentti; tuntikeikalla se on TEHDYT TUNNIT, ja pesuprosentti on
 * sivujuonne (ikkunapesu on tauolla). Siksi tämä on sivun alussa ja
 * ikkunapesun edistymä painalluksen takana.
 *
 * TEKIJÖIDEN ETUNIMET NÄKYVÄT, toisin kuin muualla asiakkaan näkymässä. Ero on
 * laskutustavan seuraus eikä epäjohdonmukaisuus: tuntikeikalla asiakas maksaa
 * nimenomaan näiden ihmisten ajasta, joten hänen kuuluu nähdä kenen ja
 * kuinka paljon. Sukunimi ei ole hänen tarvitsemaansa tietoa.
 *
 * HANKINNAT OVAT VAIN NE JOTKA ON MERKITTY HÄNELLE. Sisäiset kulumme — tekijän
 * matkat, oma kalusto — eivät ole tässä eivätkä saa olla; ks.
 * `ProjExpense.forCustomer`. Kuittia ei näytetä missään tapauksessa.
 */
import type { GigPublicView } from "@/lib/api";
import { eurFromCents } from "@shared/project";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";

type Hourly = NonNullable<GigPublicView["hourly"]>;

const KIND_LABEL: Record<string, string> = {
  transport: "Kuljetus",
  materials: "Tarvikkeet",
  equipment: "Kalusto",
  other: "Muu",
};

function fmtHours(h: number): string {
  return h.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" });
}

interface Props {
  hourly: Hourly;
  theme: CustomerTheme;
}

export default function HourlySummary({ hourly, theme: T }: Props) {
  const { totalHours, workers, expenses, expensesTotalCents } = hourly;

  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: T.muted, fontFamily: CFONT,
  };

  return (
    <div style={{ fontFamily: CFONT, color: T.ink }}>
      {/* Yksi luku, iso. Se on se mistä tuntikeikalla on kyse. */}
      <div style={label}>Tehdyt tunnit</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}>{fmtHours(totalHours)}</span>
        <span style={{ fontSize: 18, fontWeight: 600, color: T.muted }}>h</span>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
        {workers.length === 0
          ? "Tunteja ei ole vielä kirjattu."
          : `${workers.length} tekijää · työaika pyöristetään lähimpään täyteen tuntiin`}
      </p>

      {/* Kuka on tehnyt montako. */}
      {workers.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {workers.map((w) => (
            <div key={w.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: T.fill }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {w.name}
              </span>
              {/* Palkki suhteessa eniten tehneeseen: rinnakkain luettuna se
                  kertoo työnjaon nopeammin kuin neljä lukua allekkain. */}
              <span aria-hidden style={{ flex: 2, maxWidth: 160, height: 6, borderRadius: 3, background: T.card, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${(w.hours / Math.max(...workers.map((x) => x.hours))) * 100}%`, height: "100%", borderRadius: 3, background: T.green }} />
              </span>
              <span style={{ flexShrink: 0, minWidth: 46, textAlign: "right", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {fmtHours(w.hours)} h
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hankinnat. Näkyy vain kun jotain on merkitty asiakkaalle — tyhjä
          otsikko lupaisi listan jota ei ole. */}
      {expenses.length > 0 && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.hair}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={label}>Hankinnat sinulle</span>
            <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700 }}>{eurFromCents(expensesTotalCents)}</span>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {expenses.map((e, i) => (
              <div key={`${e.ts}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "10px 12px", borderRadius: 10, background: T.fill }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>
                  {e.desc || KIND_LABEL[e.kind] || "Hankinta"}
                  <span style={{ color: T.muted, fontSize: 12 }}> · {fmtDate(e.ts)}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {eurFromCents(e.amountCents)}
                </span>
              </div>
            ))}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
            Tarvikkeet jotka olemme hankkineet tätä työtä varten. Työn hinta lasketaan
            tunneista erikseen.
          </p>
        </div>
      )}
    </div>
  );
}
