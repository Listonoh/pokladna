# Pokladní systém čajovny Miska s Listím 🍵

Moderní, dotykově optimalizovaný a spolehlivý pokladní systém navržený na míru pro provoz malé čajovny **Miska s Listím**.

Aplikace funguje jako **PWA (Progressive Web App)** s architekturou **Offline-first** (IndexedDB / Dexie.js + synchronizační Outbox do Supabase PostgreSQL), celočíselnou haléřovou matematikou a striktním oddělením stavu plateb od stavu doručování na baru.

---

## 1. Rychlé spuštění (Instalace a běh)

### Požadavky
- **Node.js** v18+ (doporučeno v20 nebo v24)
- **npm** v9+

### Postup spuštění

1. **Instalace závislostí:**
   ```bash
   npm install
   ```

2. **Konfigurace prostředí:**
   Zkopírujte vzorový soubor `.env.example` do `.env`:
   ```bash
   cp .env.example .env
   ```
   *(Aplikace funguje plnohodnotně i bez okamžitého zadání Supabase klíčů v lokálním offline-first režimu).*

3. **Spuštění vývojového serveru:**
   ```bash
   npm run dev
   ```
   Aplikace poběží na adrese [http://localhost:5173](http://localhost:5173).

4. **Spuštění automatizovaných testů (všech 19 kritických scénářů):**
   ```bash
   npm test
   ```

5. **Sestavení produkční verze (PWA):**
   ```bash
   npm run build
   ```

---

## 2. Hlavní funkce a architektura systému

Systém se skládá ze 4 hlavních částí přístupných z horní lišty:

1. **Pokladna (`/pos`)**:
   - Dlaždice stolů s barevnou indikací stavu (*Volný*, *Otevřený účet*, *Čeká na doručení*, *Neuhrazený zůstatek*).
   - Rychlá mřížka oblíbených čajů pro přidání jedním dotykem.
   - Procházení kategorií nabídky (*Čaje*, *Ostatní nápoje*, *Drobné jídlo*, *Balené čaje*, *Ostatní*).
   - Průběžný účet stolu s úpravou množství, poznámkami k přípravě (*do konvičky*, *chladnější voda* apod.) a výpočtem zůstatku.
   - Vyúčtování: plná úhrada, částečná úhrada, kombinace hotovosti a karty.
2. **K doručení (`/delivery`)**:
   - Přehledná fronta přípravy pro bar a čajového mistra.
   - Seskupení položek podle stolů s časem od objednání.
   - Označení položky jako doručené na 1 dotyk.
   - Hromadné tlačítko „Doručit vše na stole“.
   - Bezpečné vrácení doručené položky zpět (*Undo*) s potvrzovacím dialogem.
3. **Přehled (`/reports`)**:
   - Denní uzávěrka v časovém pásmu `Europe/Prague` se správným ošetřením půlnočního předělu.
   - Přesné rozlišení přijatých plateb (hotovost vs. karta) a neuhrazených dluhů hostů na stolech.
   - Tržby a počty prodaných kusů podle kategorií a jednotlivých položek.
   - Export do formátů **CSV** a **JSON**.
4. **Správa (`/admin`)**:
   - Správa sortimentu: přidání nového produktu, úprava cen (v Kč, interně uloženo v haléřích).
   - Hvězdička pro rychlé oblíbené položky na 1 dotyk.
   - Aktivace a deaktivace produktů (s ochranou prodejní historie a historických účtů).

---

## 3. Finanční a datová integrita

- **Haléřová matematika**: Žádné zaokrouhlovací chyby plovoucí čárky. Všechny ceny a platby jsou uloženy v celých haléřích (`1 Kč = 100 haléřů`).
- **Cenové snapshoty**: Položka v účtu ukládá snapshot ceny i názvu platný v momentě objednání. Pozdější zdražení či přejmenování v administraci nezmění uzavřené ani rozpracované účty.
- **Idempotence plateb**: Každá platba má klientsky generované UUID. Opakované kliknutí ani opakovaná synchronizace nevytvoří duplicitní záznam.
- **Storno bez fyzického mazání**: Při stornu platby zůstává auditní stopa, důvod storna a vytvoří se kompenzační událost v `payment_events`.

---

## 4. Konfigurace Supabase a SQL migrace

V případě nasazení se Supabase backendem:

1. Založte nový projekt na [supabase.com](https://supabase.com).
2. V sekci **SQL Editor** spusťte migrační skript:
   [`supabase/migrations/20261014_init_pos.sql`](file:///C:/Users/leest/source/pokladna/supabase/migrations/20261014_init_pos.sql)
   Skript vytvoří:
   - Normalizované tabulky: `categories`, `products`, `tables`, `orders`, `order_items`, `order_item_events`, `payments`, `payment_events`.
   - Databázové indexy pro bleskové dotazy.
   - Bezpečnostní **Row Level Security (RLS)** politiky.
   - Transakční PostgreSQL procedury `process_payment` a `cancel_payment`.
3. Do souboru `.env` zadejte získanou URL a anonymní veřejný klíč:
   ```env
   VITE_SUPABASE_URL=https://vas-projekt.supabase.co
   VITE_SUPABASE_ANON_KEY=vas-anon-klic
   ```

---

## 5. Zálohování a obnova dat

### Záloha lokálních dat (IndexedDB)
- Zákaznická a provozní data jsou primárně uložena v IndexedDB prohlížeče (`MiskaSPokladnaDB`).
- Ze sekce **Přehled** lze kdykoli stáhnout kompletní export dne do **JSON** a **CSV**.

### Záloha Supabase (Cloud)
- Supabase provádí automatické denní zálohy celé PostgreSQL databáze.
- Manuální dump databáze:
  ```bash
  supabase db dump -f backup_$(date +%Y%m%d).sql
  ```

---

## 6. Automatizované testy (19/19 splněno)

Spuštěním `npm test` se ověřuje všech 19 povinných scénářů definovaných v zadání:

1. Přidání produktu k novému účtu se snapshotem ceny a názvu.
2. Opakované přidání stejného produktu (zvýšení množství bez duplikace řádku).
3. Imutabilita ceny v historii při změně ceny v číselníku.
4. Plná platba v hotovosti.
5. Plná platba kartou.
6. Kombinovaná platba hotově i kartou (rozdělení úhrady).
7. Částečná úhrada se správným zbývajícím dluhem.
8. Odmítnutí přeplatku (platba vyšší než dluh).
9. Ochrana proti duplicitní platbě (idempotence).
10. Storno platby a přepočet bilance.
11. Přidání položky k účtu s doručenými položkami (nová položka je pending).
12. Doručení jedné položky.
13. Hromadné doručení všech položek stolu na 1 dotyk.
14. Vrácení doručené položky do čekajících (Undo).
15. Vykázání plateb kolem půlnoci v pásmu `Europe/Prague`.
16. Obnova dat po obnovení stránky (F5).
17. Zařazení mutací do Outbox fronty.
18. Opakování synchronizace bez duplicit.
19. Export dat a ověření matematické konzistence součtů.

---

## 7. Známá omezení a budoucí rozšíření

- **Skladové hospodářství**: V souladu se zadáním zatím není napojena evidence gramáže čajových lístků ani odpis surovin. Schéma je však připraveno na rozšíření tabulkou `recipes` a `stock_items`.
- **Platební terminál**: Zaznamenává se typ platby (Karta / Hotovost). Aplikace nekomunikuje přímo s fyzickým bankovním terminálem přes protokol ZVT/BAP.