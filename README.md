# ✈️ Niko Leti

Arkadni simulator letenja za djecu koji radi u pregledniku (Three.js + TypeScript + Vite).

- **12 otoka**: Sunčani, Zeleni, Planinski, Pješčani, Borov, Dugi, Vulkan, Ledeni, Kameni, Gusarski, Otok dupina i Otok svjetionika
- **6 aerodroma** s pistom, tornjem, hangarom i vjetrokazom
- **4 aviona**: Mali avion, Mlažnjak, Hidroavion (smije na more!) i Putnički avion Niko Aira
- mini-karta s najbližim aerodromom, imena otoka na nebu, zvuk motora

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
| `W` `↑` / `S` `↓` | nos gore / dolje |
| `A` `←` / `D` `→` | nagib lijevo / desno (na pisti: skretanje) |
| `Q` / `E` | kormilo |
| `Razmak` | kočnica |
| `N` | ispočetka |
| `P` | pauza |
| `M` | zvuk uključen / isključen |
| `Esc` | izbornik (odabir aviona i aerodroma) |
| `H` | pomoć |

Kontrole nisu obrnute kao u pravom avionu: `↑` diže nos.

## Kako je složeno

```
src/
  main.ts                 – pokretanje, glavna petlja, poruke igraču
  core/Input.ts           – tipkovnica → kontrole (-1..1)
  physics/FlightModel.ts  – arkadna fizika leta (fiksni korak 120 Hz), tlo, more, strmine
  aircraft/catalog.ts     – 4 aviona: fizika, kamera, zvuk i model od osnovnih oblika
  aircraft/Aircraft.ts    – vidljivi avion koji prati fiziku
  world/islands.ts        – popis otoka i aerodroma (lako dodati nove)
  world/Terrain.ts        – visinske mape otoka, more, "koliko je visoko tlo ovdje?"
  world/Airport.ts        – pista, oznake, toranj, hangar, izravnavanje tla
  world/World.ts          – nebo, svjetlo, šume, sela, svjetionik, oblaci, imena otoka
  camera/ChaseCamera.ts   – kamera iza aviona, horizont uvijek ravan, nikad u brdu
  ui/HUD.ts               – brzina, visina iznad tla, gas, poruke, pomoć
  ui/Menu.ts              – odabir aviona i aerodroma
  ui/Minimap.ts           – mini-karta otoka
  audio/Sound.ts          – motor, vjetar, kotači, upozorenje, efekti (Web Audio, bez datoteka)
```

**Fizika za djecu:** avion leti kamo gleda nos. Kad pustiš tipke, sam se izravna.
Ne može se okrenuti naglavačke (najviše 60° nagiba i 45° nosa gore/dolje).
Gubi uzgon tek kad jako uspori. Pad samo vrati avion na pistu.
Sletjeti se može i na travu; samo hidroavion smije na more.

## Faze

- [x] **Faza 0** – projekt (Vite + TypeScript + Three.js)
- [x] **Faza 1** – avion, fizika leta, kontrole, ravni svijet s pistom
- [x] **Faza 2** – pravi teren: 12 otoka, brda, more, 6 aerodroma
- [ ] **Faza 3** – HUD instrumenti, više kamera (zvuk i mini-karta su gotovi)
- [ ] **Faza 4** – bodovanje slijetanja
- [ ] **Faza 5** – misije (prstenovi, slijetanje), izbornik
- [x] **Faza 6** – više aviona (4) i lokacija
- [ ] aviokompanije (boje i nazivi) za putnički avion
- [ ] **Faza 7** – vrijeme, dan/noć, kontrole za mobitel
