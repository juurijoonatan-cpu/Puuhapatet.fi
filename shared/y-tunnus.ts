/**
 * Suomalaisen Y-tunnuksen (yritys- ja yhteisötunnus) muotovalidointi.
 * Muoto NNNNNNN-N, tarkistusmerkki laskettu mod 11 -algoritmilla painoilla
 * [7,9,10,5,8,4,2] — ks. esim. https://www.vero.fi/ ja PRH:n ohjeistus.
 */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2];

/** True jos syöte on muodoltaan ja tarkistusmerkiltään pätevä Y-tunnus. */
export function isValidYTunnus(input: string | null | undefined): boolean {
  if (!input) return false;
  const m = /^(\d{7})-(\d)$/.exec(input.trim());
  if (!m) return false;
  const digits = m[1].split("").map(Number);
  const checkDigit = Number(m[2]);
  const sum = digits.reduce((s, d, i) => s + d * WEIGHTS[i], 0);
  const remainder = sum % 11;
  if (remainder === 1) return false; // jäännös 1 ei voi koskaan olla pätevä
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === checkDigit;
}
