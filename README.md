# ✈️ Niko Leti

Arkadni simulator letenja za djecu koji radi u pregledniku (Three.js + TypeScript + Vite).

- **12 otoka**: Sunčani, Zeleni, Planinski, Pješčani, Borov, Dugi, Vulkan, Ledeni, Kameni, Gusarski, Otok dupina i Otok svjetionika
- **6 aerodroma** s pistom, tornjem, hangarom i vjetrokazom
- **4 aviona**: Mali avion, Mlažnjak, Hidroavion (smije na more!) i Putnički avion
- **4 aviokompanije** za putnički avion: Niko Air, Jadran Jet, Galeb Air i Otok Express
- **11 misija** sa zvjezdicama: prstenovi, pošta, putnički letovi, spašavanje hidroavionom, tura po otocima
- ⭐⭐⭐ za slijetanje (mekano, na sredini piste, ravnih krila), 🏝️ otkrivanje otoka
- **dan, zalazak i noć** (svjetla piste, svjetionik, zvijezde) i **vrijeme**: vedro, vjetar, kiša
- drugi avioni lete između aerodroma
- instrumenti (umjetni horizont, kompas), strelica do cilja, mini-karta, upozorenje „Pazi, brdo!"
- 3 kamere: iza aviona, iz kokpita (FPV) i sa strane; zvuk motora, vjetra i kiše
- radi i na mobitelu i tabletu (kontrole na dodir); napredak se pamti u pregledniku

## Igraj online

https://officeboric-cmyk.github.io/Nikoapp/

Svaka promjena na grani `main` automatski se objavi (GitHub Actions → GitHub Pages).

## Pokretanje na svom računalu

```bash
npm install
npm run dev      # razvojni server na http://localhost:5173
npm run build    # provjera tipova + produkcijski build u dist/
npm run preview  # pokreće gotovi build
```

## Kontrole

| Tipka | Radnja |
|---|---|
| `R` / `F` | više / manje gasa |
| `S` `↓` / `W` `↑` | nos gore / dolje (kao palica u avionu: prema sebi = gore) |
| `A` `←` / `D` `→` | nagib lijevo / desno (na pisti: skretanje) |
| `Q` / `E` | kormilo |
| `Razmak` | kočnica |
| `V` | zakrilca: 0 → pola → puno (sporije letiš, lakše slijetaš) |
| `G` | uvlačenje / izvlačenje kotača (mlažnjak i putnički avion) |
| `N` | ispočetka |
| `P` | pauza |
| `M` | zvuk uključen / isključen |
| `C` | kamera: iza aviona → kokpit (FPV) → sa strane |
| `Esc` | izbornik (misije, slobodno letenje, doba dana, vrijeme) |
| `H` | pomoć |

Kontrole su kao u pravom avionu: palicu povučeš prema sebi (`↓` / `S`) i nos ide gore.
Za mlađu djecu u izborniku postoji postavka **Palica: ⬆️ Gore = gore**, gdje `↑` / `W` diže nos.

Kotači se mogu uvući samo u zraku. S uvučenim kotačima avion je malo brži, a ako zaboraviš
izvući kotače, avion klizne po trbuhu i vrati se na početak.

### Gamepad (Xbox / PlayStation)

| Gumb | Radnja |
|---|---|
| lijeva gljiva | palica (prema sebi = nos gore, lijevo/desno = nagib) |
| `RT` / `LT` | više / manje gasa |
| `LB` / `RB` | kormilo |
| `A` / `✕` | kočnica |
| `B` / `○` | zakrilca |
| `X` / `◻` | kotači |
| `Y` / `△` | kamera |
| `Start` / `Back` | pauza / izbornik |

### Na mobitelu i tabletu

- **lijevo:** povuci klizač **GAS** prema gore (ostaje gdje ga pustiš)
- **desno:** palica upravlja avionom: prema sebi = nos gore, od sebe = nos dolje, lijevo/desno = nagib (na pisti: skretanje)
- **STOP:** kočnica dok ga držiš
- 🛬 zakrilca, 🛞 kotači, 🎥 kamera, ⏸ pauza, ☰ izbornik
- na Androidu igra prelazi na cijeli ekran i okreće se vodoravno

## Kako je složeno

```
src/
  main.ts                 – pokretanje, glavna petlja, poruke igraču
  core/Input.ts           – tipkovnica i gamepad → kontrole (-1..1), glatko pomicanje palice
  physics/FlightModel.ts  – fizika leta (fiksni korak 120 Hz): sile, uzgon, zakrilca, tlo, more, vjetar
  aircraft/catalog.ts     – 4 aviona: fizika, kamera, zvuk, model od osnovnih oblika, svjetla
  aircraft/airlines.ts    – aviokompanije i njihove boje
  aircraft/Aircraft.ts    – vidljivi avion koji prati fiziku
  game/missions.ts        – popis misija (lako dodati nove)
  game/MissionRun.ts      – tijek misije: prstenovi, slijetanja, brodić, tura, zvjezdice
  game/landing.ts         – ocjena slijetanja (1–3 zvjezdice)
  game/hillWarning.ts     – upozorenje „Pazi, brdo!"
  game/Progress.ts        – spremljeni napredak (zvjezdice, otkriveni otoci)
  world/islands.ts        – popis otoka i aerodroma (lako dodati nove)
  world/Terrain.ts        – visinske mape otoka, more, "koliko je visoko tlo ovdje?"
  world/Airport.ts        – pista, oznake, toranj, hangar, vjetrokaz, izravnavanje tla
  world/World.ts          – svjetlo, šume, sela, svjetionik, oblaci, imena otoka, noćna svjetla
  world/Environment.ts    – doba dana i vrijeme: nebo, sunce/mjesec, zvijezde, kiša, vjetar
  world/Sky.ts            – nebo (prijelaz boja, sjaj i disk sunca ili mjeseca)
  world/Sea.ts            – more: valići, odraz neba, odsjaj sunca, plićaci i pjena uz obalu
  world/Traffic.ts        – drugi avioni koji lete između aerodroma
  world/lights.ts         – svjetleće točke (pista, avioni, svjetionik)
  camera/CameraRig.ts     – 3 kamere (iza, kokpit/FPV, sa strane), nikad u brdu
  ui/HUD.ts               – brzina, visina iznad tla, gas, poruke, pomoć
  ui/Instruments.ts       – umjetni horizont, kompas, strelica do cilja
  ui/Menu.ts              – misije, slobodno letenje, doba dana, vrijeme
  ui/Minimap.ts           – mini-karta otoka, drugih aviona i cilja
  ui/TouchControls.ts     – klizač za gas, palica i kočnica za ekrane na dodir
  audio/Sound.ts          – motor, vjetar, kiša, kotači, upozorenje, efekti (Web Audio, bez datoteka)
```

**Fizika:** u izborniku biraš koliko je let stvaran:

- 🧸 **Arkadno** – avion leti točno kamo gleda nos, kao prije.
- ✈️ **Normalno** (zadano) – prave sile: avion ima težinu i zalet, uzgon raste s brzinom i
  kutom krila, u zaokretu treba malo povući. Pomagač izravna krila i drži visinu kad pustiš
  palicu, ne da više od 70° nagiba i 50° nosa, i ne da avionu da izgubi uzgon (stall).
- 🎓 **Realistično** – bez pomagača: može se napraviti looping, a ako previše povučeš
  ili jako usporiš, krilo izgubi uzgon i nos padne.

Zakrilca daju više uzgona pri maloj brzini (ali i više otpora). Blizu tla avion lakše
lebdi (efekt tla). Vjetar puše i u zraku, pa avion pri slijetanju malo „ide ukoso".
Pad samo vrati avion na pistu. Sletjeti se može i na travu; samo hidroavion smije na more.

## Faze

- [x] **Faza 0** – projekt (Vite + TypeScript + Three.js)
- [x] **Faza 1** – avion, fizika leta, kontrole, ravni svijet s pistom
- [x] **Faza 2** – pravi teren: 12 otoka, brda, more, 6 aerodroma
- [x] **Faza 3** – instrumenti, kamere, zvuk, mini-karta
- [x] **Faza 4** – bodovanje slijetanja
- [x] **Faza 5** – misije i izbornik
- [x] **Faza 6** – više aviona (4), aviokompanije (4), promet u zraku
- [x] **Faza 7** – doba dana, vrijeme, kontrole za mobitel
