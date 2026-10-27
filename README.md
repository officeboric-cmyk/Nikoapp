# ✈️ Niko Leti

Arkadni simulator letenja za djecu koji radi u pregledniku (Three.js + TypeScript + Vite).

- **12 otoka**: Sunčani, Zeleni, Planinski, Pješčani, Borov, Dugi, Vulkan, Ledeni, Kameni, Gusarski, Otok dupina i Otok svjetionika
- **6 aerodroma**: asfaltna pista s pravim oznakama (brojevi, rubne crte, zona i točka dodira), betonska
  stajanka sa žutim linijama, kontrolni toranj, hangar od lima, terminal sa staklenom fasadom i imenom
  otoka, spremnici i cisterna goriva, reflektori, parkiralište s autima, parkirani avioni i vjetrokaz
- **5 aviona**: Mali avion, Mlažnjak, Hidroavion (smije na more!), Putnički avion i **Lovac** – vojni avion
  brži od zvuka (do ~1300 km/h s dodatnim izgaranjem, pa prasak i oblak pare kad probije zvučni zid), s
  **mitraljezom**: tragajući meci, nišan ⊕, 600 metaka koji se pune na aerodromu. Gađaju se baloni-mete
  (u slobodnom letu oko otoka s kojeg kreneš), a mogu se srušiti i drugi avioni (posada iskoči
  padobranima, a nakon minute poleti novi avion) te kuće, zvonici i parkirani avioni (gore, pa se nakon
  minute i pol opet sagrade)
- 🤖 **autopilot** (`T` ili 🤖): drži visinu, smjer i brzinu (sam vodi gas), u misijama vodi do cilja i
  penje se preko brda na putu; isključi se čim pomakneš palicu ili gas
- **4 aviokompanije** za putnički avion: Niko Air, Jadran Jet, Galeb Air i Otok Express
- **🎓 škola letenja**: 5 lekcija korak po korak (polijetanje, zaokreti, gore i dolje, zakrilca, slijetanje),
  uz savjet što pritisnuti i zvjezdice
- **14 misija** sa zvjezdicama: prstenovi, pošta, putnički letovi, spašavanje hidroavionom, tura po otocima,
  gašenje požara (hidroavion kliži po moru da napuni vodu i baca je na vatru: tipka `B` ili 💧),
  paketi s padobranom na mete na tri otoka (`B` ili 📦; plavi krug pokazuje gdje bi pao) i gađanje
  12 balona lovcem oko Kamenog otoka
- ⭐⭐⭐ za slijetanje (mekano, na sredini piste, ravnih krila), 🏝️ otkrivanje otoka
- ⛽ **gorivo** (u normalnom i realističnom načinu): troši se više uz više gasa, upozorenje na 25 % i 10 %,
  bez goriva motor stane i avion kliži; stani bilo gdje na aerodromu i rezervoar se napuni
- bez motora avion **ne gubi uzgon** dok ima brzine, nego kliži kao pravi: mali avion ~9 m naprijed za
  svaki metar spuštanja, hidroavion ~8 (plovci koče), mlažnjak ~11, putnički ~17; najdalje kod ~1,4×
  brzine gubitka uzgona. Propeler koji se vrti na vjetru koči više od ugašenog mlaznog motora, a izvučeni
  kotači i zakrilca klizanje skraćuju. U normalnom načinu pomoćnik sam drži najbolju brzinu klizanja
- 🏅 **20 znački** (prvi let, 100 slijetanja, svi aerodromi, looping, valjak, iznad oblaka, noćni pilot,
  vatrogasac, diploma škole…) i **rekordi** (najveća visina i brzina, najmekše slijetanje, preletjeni km)
- 👧👦 **više pilota** na istom uređaju: svaki ima svoje ime, zvjezdice, otoke i značke
- pomoć za slijetanje: **PAPI svjetla** uz svaku pistu (2 bijela + 2 crvena = dobar prilaz, sva bijela =
  previsoko, sva crvena = prenisko) i plavi **krugovi** koji vode do piste (u arkadnom i normalnom načinu)
- **dan, zalazak i noć** (sunce, mjesec, svjetla piste, svjetionik, zvijezde) i **vrijeme**: vedro, vjetar, kiša
- more s valićima, odrazom neba, plićacima i pjenom; palme na plažama
- **otoci kao na Jadranu**: livade sa suhim i bujnim dijelovima i pravim busenima trave oko aviona kad je
  nisko, borove šume, česmine, makija, čempresi, maslinici u redovima, suhozidi oko polja, sela od
  kamenih kuća s kupama kanalicama, škurama i dimnjacima, zvonici; noću svijetle prozori
- dim guma pri slijetanju, prašina na travi, prskanje vode, bijeli tragovi iza mlažnjaka
- glatki, detaljni avioni: aerodinamičan trup, krila s pravim profilom, kokpit s pilotom, prozori,
  motori s ventilatorom; pokretna krilca, kormila i zakrilca, kotači na oprugama, zamućeni propeler
- drugi avioni lete između aerodroma (pazi da se ne sudariš!)
- instrumenti (umjetni horizont, kompas), strelica do cilja, mini-karta, upozorenja „Pazi, brdo!" i „Pazi, avion ispred!"
- sudar s drugim avionom (u zraku ili parkiranim na aerodromu) je pad, kao i udar u brdo
- 3 kamere: iza aviona, iz kokpita (FPV) i sa strane; zvuk motora, vjetra i kiše
- **kokpit iznutra** u pogledu iz kokpita: brzinomjer, umjetni horizont, visinomjer, kompas, žaruljice
  (gas, zakrilca, kotači, gubitak uzgona), volan (u mlažnjaku palica) i ručica gasa koji se miču
- 📻 **kontrola leta**: toranj javlja „slobodno za polijetanje/slijetanje" s brojem piste i vjetrom, pozdravi
  nakon slijetanja i upozori na promet i kotače; govori hrvatskim glasom preglednika ako ga uređaj ima
  (inače samo tekst), utiša se s `M`
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
| `Razmak` | kočnica (u zraku s lovcem: mitraljez) |
| `X` | mitraljez (lovac) |
| `T` | autopilot uključi / isključi |
| `V` | zakrilca: 0 → pola → puno (sporije letiš, lakše slijetaš) |
| `G` | uvlačenje / izvlačenje kotača (mlažnjak i putnički avion) |
| `B` | baci (u misijama: voda na vatru ili paket s padobranom) |
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
| `A` / `✕` | kočnica (u zraku s lovcem: mitraljez) |
| `B` / `○` | zakrilca |
| `X` / `◻` | kotači |
| `Y` / `△` | kamera |
| `Start` / `Back` | pauza / izbornik |
| križ dolje | baci (misije) |
| križ gore | autopilot |

### Na mobitelu i tabletu

- **lijevo:** povuci klizač **GAS** prema gore (ostaje gdje ga pustiš)
- **desno:** palica upravlja avionom: prema sebi = nos gore, od sebe = nos dolje, lijevo/desno = nagib (na pisti: skretanje)
- **STOP:** kočnica dok ga držiš
- 🛬 zakrilca, 🛞 kotači, 🎥 kamera, ⏸ pauza, ☰ izbornik
- **📱 naginjanje** (izbornik → Upravljanje): umjesto palice naginješ uređaj kao volan –
  okreneš ga lijevo/desno za nagib, vrh prema sebi = nos gore. „Ravno" je kako držiš uređaj
  kad let počne; gumb **⟳ Ravno** to postavi ponovno. Na iPhoneu/iPadu preglednik prvo pita dopuštenje.
- na Androidu igra prelazi na cijeli ekran i okreće se vodoravno

## Kako je složeno

```
src/
  main.ts                 – pokretanje, glavna petlja, poruke igraču
  core/Input.ts           – tipkovnica i gamepad → kontrole (-1..1), glatko pomicanje palice
  core/Graphics.ts        – iscrtavanje i kvaliteta slike (Brzo / Lijepo: razlučivost, sjene, sjaj)
  core/AutoQuality.ts     – mjeri glatkoću igre i po potrebi sam smanji kvalitetu slike
  physics/FlightModel.ts  – fizika leta (fiksni korak 120 Hz): sile, uzgon, zakrilca, tlo, more, vjetar
  aircraft/catalog.ts     – 5 aviona: fizika, kamera, zvuk
  aircraft/models.ts      – 3D modeli aviona (trup, krila, rep, kotači, propeler, pilot, svjetla)
  aircraft/shapes.ts      – glatki oblici iz presjeka: trup od elipsa, krila od aeroprofila
  aircraft/airlines.ts    – aviokompanije i njihove boje
  aircraft/Aircraft.ts    – vidljivi avion koji prati fiziku
  game/missions.ts        – popis misija (lako dodati nove)
  game/MissionRun.ts      – tijek misije: prstenovi, slijetanja, brodić, tura, požar, zvjezdice
  game/lessons.ts         – škola letenja: lekcije i koraci
  game/landing.ts         – ocjena slijetanja (1–3 zvjezdice)
  game/hillWarning.ts     – upozorenje „Pazi, brdo!"
  game/collisions.ts      – sudari s drugim avionima i upozorenje „Pazi, avion ispred!"
  game/Progress.ts        – spremljeni napredak po pilotu (zvjezdice, otoci, rekordi, značke)
  game/badges.ts          – popis znački i kad se dobivaju
  game/FlightLog.ts       – rekordi leta i prepoznavanje loopinga i valjka
  game/Autopilot.ts       – autopilot: visina, smjer, brzina, do cilja, preko brda
  game/Gun.ts             – mitraljez lovca: meci, pogoci, udari u tlo i more
  world/Parachutes.ts     – posada oborenih aviona na padobranima
  game/Balloons.ts        – baloni-mete
  world/islands.ts        – popis otoka i aerodroma (lako dodati nove)
  world/Terrain.ts        – visinske mape otoka, "koliko je visoko tlo ovdje?"
  world/groundDetail.ts   – detalji livade u shaderu (suhi i bujni dijelovi, zrnatost izbliza)
  world/Grass.ts          – busenovi trave oko kamere
  world/vegetation.ts     – oblici stabala i grmlja (blizu detaljni, daleko jednostavni)
  world/buildings.ts      – kuće s dvostrešnim krovom
  world/textures.ts       – teksture nacrtane u pregledniku (zidovi, crijep, asfalt, beton, lim, staklo)
  world/Airport.ts        – pista, oznake, toranj, hangar, terminal, vjetrokaz, izravnavanje tla
  world/World.ts          – svjetlo, šume, palme, sela, svjetionik, oblaci, imena otoka, brojevi pista,
                            parkirani avioni, noćna svjetla
  world/Environment.ts    – doba dana i vrijeme: nebo, sunce/mjesec, zvijezde, kiša, vjetar
  world/Sky.ts            – nebo (prijelaz boja, sjaj i disk sunca ili mjeseca)
  world/Sea.ts            – more: valići, odraz neba, odsjaj sunca, plićaci i pjena uz obalu
  world/Effects.ts        – dim guma pri slijetanju, prašina na travi, prskanje vode, tragovi mlažnjaka
  world/LandingAids.ts    – PAPI svjetla uz piste i krugovi za prilaz
  world/Traffic.ts        – drugi avioni koji lete između aerodroma
  world/lights.ts         – svjetleće točke (pista, avioni, svjetionik)
  camera/CameraRig.ts     – 3 kamere (iza, kokpit/FPV, sa strane), nikad u brdu
  ui/HUD.ts               – brzina, visina iznad tla, gas, zakrilca, kotači, poruke, pomoć
  ui/Instruments.ts       – umjetni horizont, kompas, strelica do cilja
  ui/Cockpit.ts           – ploča s instrumentima, volan/palica i ručica gasa u pogledu iz kokpita
  ui/Menu.ts              – misije, slobodno letenje, doba dana, vrijeme
  ui/Minimap.ts           – mini-karta otoka, drugih aviona i cilja
  ui/TouchControls.ts     – klizač za gas, palica i kočnica za ekrane na dodir
  ui/TiltControls.ts      – upravljanje naginjanjem mobitela ili tableta
  audio/Sound.ts          – motor, vjetar, kiša, kotači, upozorenje, efekti (Web Audio, bez datoteka)
  audio/Radio.ts          – pozivi tornja (govor preglednika na hrvatskom)
```

**Fizika:** u izborniku biraš koliko je let stvaran:

- 🧸 **Arkadno** – avion leti točno kamo gleda nos, kao prije.
- ✈️ **Normalno** (zadano) – prave sile: avion ima težinu i zalet, uzgon raste s brzinom i
  kutom krila, u zaokretu treba malo povući. Pomagač izravna krila i drži visinu kad pustiš
  palicu, ne da više od 70° nagiba i 50° nosa, i ne da avionu da izgubi uzgon (stall).
- 🎓 **Realistično** – bez pomagača, kao pravi avion:
  - **automatski trim**: kad pustiš palicu, avion nastavi letjeti brzinom koju je imao
    (gas tada određuje penje li se ili spušta), pa ne moraš stalno držati tipku;
  - palica mijenja kut krila prema zraku; puna palica natrag dovodi do gubitka uzgona,
    a tada jedno krilo padne – pusti palicu i avion se izvuče;
  - kormila su meka pri maloj brzini, kormilo smjera (Q/E) i naginje avion,
    krila se ne mogu preopteretiti (putnički avion ~2,5 g, mlažnjak ~8 g);
  - motori su slabiji nego u ostalim načinima (bliže pravim avionima), pa je zalet dulji
    i penjanje blaže; looping je moguć, ali s putničkim avionom teško.

Zakrilca daju više uzgona pri maloj brzini (ali i više otpora). Blizu tla avion lakše
lebdi (efekt tla). Vjetar puše i u zraku, pa avion pri slijetanju malo „ide ukoso".
Pad samo vrati avion na pistu. Sletjeti se može i na travu; samo hidroavion smije na more.

**Slika:** u izborniku je i postavka kvalitete. ⚡ **Brzo** (zadano na mobitelu i tabletu)
crta izravno na ekran u nešto manjoj razlučivosti. ✨ **Lijepo** (zadano na računalu) crta
oštrije, s boljim sjenama i blagim sjajem (bloom) oko sunca, odsjaja na moru i svjetala noću.
Ako uređaj ne stigne crtati glatko (ispod ~28 sličica u sekundi), igra sama prijeđe na Brzo, a ako
ni to nije dovoljno, još malo smanji razlučivost. Kad sam izabereš postavku, igra je više ne mijenja.

## Faze

- [x] **Faza 0** – projekt (Vite + TypeScript + Three.js)
- [x] **Faza 1** – avion, fizika leta, kontrole, ravni svijet s pistom
- [x] **Faza 2** – pravi teren: 12 otoka, brda, more, 6 aerodroma
- [x] **Faza 3** – instrumenti, kamere, zvuk, mini-karta
- [x] **Faza 4** – bodovanje slijetanja
- [x] **Faza 5** – misije i izbornik
- [x] **Faza 6** – više aviona (4), aviokompanije (4), promet u zraku
- [x] **Faza 7** – doba dana, vrijeme, kontrole za mobitel
