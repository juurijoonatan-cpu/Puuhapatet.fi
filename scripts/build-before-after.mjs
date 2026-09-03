#!/usr/bin/env node
/**
 * Rajaa etusivun ennen/jälkeen-kuvaparin.
 *
 * Liu'un koko idea on että kuvat ovat päällekkäin kohdakkain: sama kulma,
 * sama rajaus, sama koko. Jos toinen on pikselinkin eri kokoinen, pyyhkäisy
 * paljastaa siirtymän eikä pesun jälkeä. Siksi molemmat ajetaan saman
 * skriptin läpi eikä käsin — ja siksi tämä skripti on tallessa: kun kuvat
 * joskus vaihdetaan, uudet ajetaan tästä.
 *
 * Kaksi asiaa joihin astuttiin kerran:
 *  1. Puhelimen ottama kuva on tiedostossa vaakana ja käännetään pystyyn
 *     vasta EXIFin orientation-kentällä. `withMetadata()` ilman `rotate()`ä
 *     jättäisi kuvan kyljelleen niissä selaimissa jotka eivät EXIFiä lue.
 *     `sharp().rotate()` ilman kulmaa polttaa käännöksen pikseleihin.
 *  2. Suhde 3:4 on sama kuin `.ba-root::before` -täytössä index.css:ssä.
 *     Muuta molemmat yhdessä tai kehys ja kuva erkanevat.
 *
 * Käyttö:
 *   node scripts/build-before-after.mjs <ennen.jpg> <jalkeen.jpg>
 */

import sharp from "sharp";
import path from "node:path";

const WIDTH = 1100;
const HEIGHT = 1467; // 3:4, sama kuin .ba-root::before padding-top: 133.3333%
const OUT_DIR = path.join(process.cwd(), "client", "public");

const [beforeSrc, afterSrc] = process.argv.slice(2);
if (!beforeSrc || !afterSrc) {
  console.error("Käyttö: node scripts/build-before-after.mjs <ennen> <jälkeen>");
  process.exit(1);
}

for (const [src, name] of [
  [beforeSrc, "window-before.jpg"],
  [afterSrc, "window-after.jpg"],
]) {
  const out = path.join(OUT_DIR, name);
  const info = await sharp(src)
    .rotate() // polttaa EXIF-orientaation pikseleihin
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    .jpeg({ quality: 76, progressive: true, mozjpeg: true })
    .toFile(out);
  console.log(`${name}: ${info.width}×${info.height}, ${Math.round(info.size / 1024)} kB`);
}
