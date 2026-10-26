# ✈️ Niko Leti

Arkadni simulator letenja za djecu koji radi u pregledniku (Three.js + TypeScript + Vite).

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
| `H` | pomoć |

Kontrole nisu obrnute kao u pravom avionu: `↑` diže nos.

## Kako je složeno

```
src/
  main.ts                 – pokretanje, glavna petlja, poruke igraču
  core/Input.ts           – tipkovnica → kontrole (-1..1)
  physics/FlightModel.ts  – arkadna fizika leta (fiksni korak 120 Hz)
  aircraft/Aircraft.ts    – low-poly avion od osnovnih oblika
  world/World.ts          – livada, pista, šume, sela, oblaci, svjetlo
  camera/ChaseCamera.ts   – kamera iza aviona, horizont uvijek ravan
  ui/HUD.ts               – brzina, visina, gas, poruke, pomoć
  audio/Sound.ts          – motor, vjetar, kotači, upozorenje, efekti (Web Audio, bez datoteka)
```

**Fizika za djecu:** avion leti kamo gleda nos. Kad pustiš tipke, sam se izravna.
Ne može se okrenuti naglavačke (najviše 60° nagiba i 45° nosa gore/dolje).
Gubi uzgon tek kad jako uspori. Pad samo vrati avion na pistu.

## Faze

- [x] **Faza 0** – projekt (Vite + TypeScript + Three.js)
- [x] **Faza 1** – avion, fizika leta, kontrole, ravni svijet s pistom
- [ ] **Faza 2** – pravi teren (otok, brda, more)
- [ ] **Faza 3** – HUD instrumenti, više kamera, zvuk
- [ ] **Faza 4** – bodovanje slijetanja
- [ ] **Faza 5** – misije (prstenovi, slijetanje), izbornik
- [ ] **Faza 6** – više aviona i lokacija
- [ ] **Faza 7** – vrijeme, dan/noć, kontrole za mobitel
