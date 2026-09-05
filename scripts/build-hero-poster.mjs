#!/usr/bin/env node
/**
 * Rakentaa etusivun taustavideon posterin ja verkkoversion.
 *
 * KAKSI VIKAA JOTKA TÄMÄ KORJAA, ja siksi tämä on tallessa eikä kertaluontoinen
 * komento jonkun terminaalihistoriassa:
 *
 *  1. POSTER OLI ERI KUVA KUIN VIDEO. Posterina oli `hero-workers.jpg`, joka on
 *     aivan eri otos kuin videon ensimmäinen ruutu. Jokaisella latauksella
 *     välähti väärä kuva. Poster on nyt videon oma ruutu 0, eli vaihdos ei näy.
 *  2. VIDEO OLI 4K JA 16 MB. Se on taustalla 82 %:n tummennuksen alla, eli
 *     tarkkuudesta ei nähdä mitään — mutta mobiilidatasta se näkyy. 720p ja
 *     CRF 30 pudottaa sen alle megan ilman että eroa erottaa.
 *
 * Käyttö (vaatii ffmpegin):
 *   node scripts/build-hero-poster.mjs <lähdevideo.mp4>
 *
 * Kirjoittaa client/public/hero-poster.jpg ja client/public/hero-bg.mp4.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Käyttö: node scripts/build-hero-poster.mjs <lähdevideo.mp4>");
  process.exit(1);
}

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const outDir = path.join(process.cwd(), "client", "public");
const poster = path.join(outDir, "hero-poster.jpg");
const video = path.join(outDir, "hero-bg.mp4");

const mb = (p) => (statSync(p).size / 1048576).toFixed(2);

// Ruutu 0 posteriksi. Sama ruutu jonka selain näyttäisi joka tapauksessa
// ensimmäisenä, joten poster ja video ovat identtiset sillä hetkellä.
execFileSync(ffmpeg, ["-v", "error", "-y", "-i", src, "-vframes", "1", "-vf", "scale=1600:-2", "-q:v", "5", poster]);
console.log(`hero-poster.jpg: ${mb(poster)} MB`);

// -an: video on aina mykistetty, joten ääniraita on pelkkää painolastia.
// +faststart: metadata tiedoston alkuun, jotta toisto alkaa ennen kuin koko
// tiedosto on ladattu — muuten häivytys jää odottamaan turhaan.
execFileSync(ffmpeg, [
  "-v", "error", "-y", "-i", src, "-an",
  "-vf", "scale=1280:-2",
  "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
  "-crf", "30", "-preset", "slow", "-movflags", "+faststart",
  video,
]);
console.log(`hero-bg.mp4:     ${mb(video)} MB`);
