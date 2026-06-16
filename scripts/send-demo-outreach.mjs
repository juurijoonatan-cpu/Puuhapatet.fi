#!/usr/bin/env node
/**
 * Demo: lähetä agentti-outreach-sähköposti suoraan Resend-rajapinnan kautta.
 * Käyttö:
 *   RESEND_API_KEY=re_xxx node scripts/send-demo-outreach.mjs
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Puuhapatet <onboarding@resend.dev>";

if (!RESEND_API_KEY) {
  console.error("Virhe: RESEND_API_KEY ei asetettu. Aja: RESEND_API_KEY=re_xxx node scripts/send-demo-outreach.mjs");
  process.exit(1);
}

const to = "juurijoonatan@icloud.com";
const customerName = "Joonatan Juuri";
const customerAddress = "Otaniemi, Espoo";
const today = new Date().toLocaleDateString("fi-FI");

const personalMessage =
  "Hei Joonatan! Kevät on juuri oikea aika laittaa ikkunat kuntoon — aurinko paahtaa " +
  "ja roskat näkyvät. Meiltä onnistuu nopea ja huolellinen ikkunanpesu Otaniemessä, " +
  "tarvittaessa myös parvekelasit ja lasiterassi samalla kertaa. " +
  "Laita viestiä niin sovitaan sopiva aika! 😊";

const html = `<!DOCTYPE html>
<html lang="fi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f0faf2">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf2"><tr><td align="center" style="padding:28px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr>
    <td style="background:#2d5016;border-radius:16px 16px 0 0;padding:28px 32px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0;color:#ffffff;font-size:26px;font-weight:900;letter-spacing:-0.5px">Puuhapatet.</p>
            <p style="margin:5px 0 0;color:#a3c97a;font-size:12px;letter-spacing:0.3px">Ammattimainen kiinteistöpalvelu</p>
          </td>
          <td style="text-align:right;vertical-align:top;padding-top:2px">
            <span style="display:inline-block;background:#a3c97a;color:#1a3a0a;font-size:10px;font-weight:800;letter-spacing:2px;padding:5px 14px;border-radius:20px;text-transform:uppercase">YHTEYDENOTTO</span>
          </td>
        </tr>
      </table>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #3d6620">
        <p style="color:#8ab865;font-size:12px;margin:0">${today}</p>
      </div>
    </td>
  </tr>

  <!-- WORK PHOTO -->
  <tr>
    <td style="padding:0;line-height:0">
      <img src="https://puuhapatet.fi/hero-workers.jpg" alt="Puuhapatet työssä" style="width:100%;max-height:260px;object-fit:cover;object-position:center top;display:block" />
    </td>
  </tr>

  <!-- TO / FROM -->
  <tr>
    <td style="background:#ffffff;border-left:1px solid #d1f0d8;border-right:1px solid #d1f0d8">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:16px 28px;border-right:1px solid #e8f5e9;width:50%;vertical-align:top">
            <p style="margin:0 0 5px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">ASIAKKAALLE</p>
            <p style="margin:0 0 2px;color:#1a2e1a;font-size:14px;font-weight:700">${customerName}</p>
            <p style="margin:2px 0 0;color:#6a8a6a;font-size:12px;line-height:1.5">${customerAddress}</p>
          </td>
          <td style="padding:16px 28px;width:50%;text-align:right;vertical-align:top">
            <p style="margin:0 0 5px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">LÄHETTÄJÄ</p>
            <p style="margin:0 0 2px;color:#1a2e1a;font-size:14px;font-weight:700">Puuhapatet</p>
            <p style="margin:0;color:#6a8a6a;font-size:12px">Joonatan &amp; Matias</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="background:#ffffff;border:1px solid #d1f0d8;border-top:none;padding:28px 32px">

      <p style="margin:0 0 24px;color:#2a3a2a;font-size:15px;line-height:1.8">${personalMessage}</p>

      <p style="margin:0 0 12px;color:#6aab6a;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">PALVELUMME</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #2d5016">
        <tr style="border-bottom:1px solid #ecfdf5;background:#ffffff">
          <td style="padding:13px 16px 13px 0;vertical-align:top">
            <p style="margin:0;color:#1a2e1a;font-size:14px;font-weight:600">🪟 Ikkunanpesu</p>
            <p style="margin:3px 0 0;color:#4b7a4b;font-size:12px">Sisä- ja ulkopinnat, parvekelasit, lasiterassit</p>
          </td>
        </tr>
        <tr style="border-bottom:1px solid #ecfdf5;background:#f8fffe">
          <td style="padding:13px 16px 13px 0;vertical-align:top">
            <p style="margin:0;color:#1a2e1a;font-size:14px;font-weight:600">🌿 Pihatyöt</p>
            <p style="margin:3px 0 0;color:#4b7a4b;font-size:12px">Nurmikon leikkuu, kausipaketit edullisesti</p>
          </td>
        </tr>
        <tr style="border-bottom:1px solid #ecfdf5;background:#ffffff">
          <td style="padding:13px 16px 13px 0;vertical-align:top">
            <p style="margin:0;color:#1a2e1a;font-size:14px;font-weight:600">🚿 Lisäpalvelut</p>
            <p style="margin:3px 0 0;color:#4b7a4b;font-size:12px">Auton sisäpuhdistus, terassi, räystäskourut</p>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px">
        <tr>
          <td style="background:#f8fffe;border-radius:10px;padding:16px 18px;border:1px solid #d1f0d8">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:4px 0;font-size:13px;color:#2a3a2a;line-height:1.5">⭐ Tyytyväisyystakuu — tulos sovitun mukainen tai teemme uudelleen</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#2a3a2a;line-height:1.5">🔒 Vastuuvakuutettu — turvallisuus edellä</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#2a3a2a;line-height:1.5">✓ Selkeä hinnoittelu — hinta sovitaan etukäteen, ei yllätyksiä</td></tr>
              <tr><td style="padding:4px 0;font-size:13px;color:#2a3a2a;line-height:1.5">💰 Kotitalousvähennyskelpoinen — säästät n. 35 % verotuksessa</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px">
        <tr>
          <td style="text-align:center">
            <p style="color:#4a6a4a;font-size:14px;margin:0 0 20px;line-height:1.65">
              Pyydä maksuton tarjous — vastaamme yleensä saman päivän aikana.
            </p>
            <a href="https://puuhapatet.fi/tilaus" style="display:inline-block;background:#111111;color:#4ade80;font-size:16px;font-weight:800;text-decoration:none;padding:18px 48px;border-radius:14px;letter-spacing:0.3px;border:2px solid #22c55e">Jätä yhteydenottopyyntö →</a>
            <br>
            <a href="https://wa.me/358400389999" style="display:inline-block;background:#25D366;color:#ffffff;padding:11px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;margin:12px 4px 0">💬 WhatsApp — Joonatan</a>
            <p style="margin:10px 0 0;color:#999999;font-size:12px">Ilmainen tarjous alle 24 tunnissa</p>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#111111;border-radius:0 0 16px 16px;padding:20px 32px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top">
            <p style="margin:0 0 2px;color:#4ade80;font-size:16px;font-weight:800">Puuhapatet.</p>
            <p style="margin:0;color:#666666;font-size:12px">Joonatan +358 40 0389999 · Matias +358 44 2350881</p>
            <a href="mailto:info@puuhapatet.fi" style="color:#666666;text-decoration:none;font-size:12px">info@puuhapatet.fi</a>
          </td>
          <td style="text-align:right;vertical-align:top">
            <a href="https://puuhapatet.fi" style="color:#4ade80;font-weight:700;text-decoration:none;font-size:13px">puuhapatet.fi</a><br>
            <span style="color:#444444;font-size:12px">Espoo &amp; Helsinki</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr></table>
</body>
</html>`;

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM_EMAIL,
    to,
    subject: `Terveisiä Puuhapatet — ${customerName.split(" ")[0]}!`,
    html,
  }),
});

const result = await response.json();
if (response.ok) {
  console.log(`✓ Demo-sähköposti lähetetty osoitteeseen ${to} (ID: ${result.id})`);
} else {
  console.error("Virhe:", result);
  process.exit(1);
}
