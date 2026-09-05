# Viitelogot

Etusivun "Meihin luottavat mm." -rivi hakee logot tästä kansiosta.

## Logon lisääminen

Pudota tiedosto tähän kansioon oikealla nimellä. **Koodiin ei tarvitse koskea.**
Rivi yrittää ladata logon automaattisesti, ja jos tiedostoa ei ole, se näyttää
nimen tekstinä. Puuttuva tiedosto ei siis riko mitään.

| viite | tiedosto |
|---|---|
| FR8 | `fr8.png` |
| Stuhi | `stuhi.png` |
| YoloCo Coaching | `yoloco.png` |

## Millainen tiedoston pitää olla

- **PNG, läpinäkyvä tausta.** Valkoinen tai musta laatikko logon ympärillä
  näkyy sivulla laatikkona, koska rivin tausta ei ole valkoinen kummassakaan
  teemassa.
- **Korkeus vähintään 72 px** (rivi piirtää 36 px:n korkuisena, ja tarkoilla
  näytöillä tarvitaan kaksinkertainen).
- Reunoilla ei turhaa tyhjää: logot tasataan keskelle, ja ylimääräinen
  läpinäkyvä marginaali saa yhden logon näyttämään muita pienemmältä.
- Pidä tiedosto kevyenä, mieluiten alle 30 kt.

## Musteen sävy

Läpinäkyvä PNG on pelkkää mustetta ilman taustaa, joten sen väri ratkaisee
näkyykö se. Valkoisella musteella tehty logo katoaa vaaleaan taustaan ja
mustalla tehty tummaan, ja sivulla on molemmat teemat.

Siksi jokainen viite kertoo `reference-strip.tsx`:ssä `ink`-kentässä millainen
se on:

- `"dark"` – tumma muste (musta teksti). Käännetään tummassa teemassa.
- `"light"` – vaalea muste (valkoinen teksti). Käännetään vaaleassa teemassa.
- `"color"` – värillinen tunnus. Ei käännetä koskaan, koska käännetty vihreä
  on magenta.

Värillinen tunnus saa tummassa teemassa vaalean laatan taakseen, koska
esimerkiksi tummanvihreä puu on lähes näkymätön mustaa vasten eikä sitä voi
kääntää (käännetty vihreä on magenta).

Jos lisäät uuden viitteen, aseta `ink` sen mukaan millä värillä tunnus on
piirretty — ei sen mukaan miltä alkuperäinen tiedosto näyttää taustoineen.

## Lupa

Asiakkaan nimen tai logon näyttäminen referenssinä on asiakkaan päätös, ei
meidän. Lisää tänne vain ne, joilta on lupa kysytty.
