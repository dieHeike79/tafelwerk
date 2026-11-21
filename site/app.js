(() => {
  "use strict";

  // ---------------------------------------------------------------
  // Konfiguration
  // ---------------------------------------------------------------
  const CONFIG = {
    // Name der Cafeteria (Überschrift + Seitentitel)
    title: "Cafeteria im Max Planck Institut",
    // Quelle des Speiseplans: die "Im Web veröffentlichen"-URL (CSV) aus Google Sheets.
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT_fCihwVSW7KWjxZt0G5pkmDRnV_x2Dd81sZe8UQqz-l8rmkNrz3CP9XlqOt8wZiuS4XSw8979wiEg/pub?gid=150620554&single=true&output=csv",
    // Legende der Allergene (Tabellenblatt "Allergene": Allergen | Name de | Name en), ebenfalls als CSV veröffentlicht.
    // Leer lassen = eingebaute Standardliste a–n (siehe DEFAULT_ALLERGENS).
    allergensUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT_fCihwVSW7KWjxZt0G5pkmDRnV_x2Dd81sZe8UQqz-l8rmkNrz3CP9XlqOt8wZiuS4XSw8979wiEg/pub?gid=1917520558&single=true&output=csv",
    // Feste Zeilen am Ende der Tagesansicht/des Tagesdrucks, z. B. Salat und Dessert.
    // extern = großer Preis, intern = klein darunter. Preise wie "1,90"; leer = ohne Preis.
    // Gilt der Preis je Menge, das in den Namen schreiben, z. B. "Salat vom Büfett (je 100 g)".
    printExtras: [
      { de: "Salat vom Büfett", en: "Salad from the buffet", intern: "", extern: "" },
      { de: "Dessert", en: "Dessert", intern: "", extern: "" },
    ],
  };

  const CACHE_KEY = "cafeteria-menu-csv-v1";
  const ALLERGEN_CACHE_KEY = "cafeteria-allergens-csv-v1";
  const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
  const WEEKDAYS = [...DAY_NAMES, "Samstag", "Sonntag"];
  const MONTHS = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  const DAY_MS = 86400000;

  // ---------------------------------------------------------------
  // Datums-Helfer (alles in UTC, damit Zeitzonen/Sommerzeit nie stören)
  // ---------------------------------------------------------------
  const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  function mondayOf(date) {
    const offset = (date.getUTCDay() + 6) % 7; // Montag = 0
    return addDays(date, -offset);
  }

  function todayUtc() {
    const n = new Date();
    return utc(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  // Akzeptiert 2026-11-23 sowie 23.11.2026 (falls der Chef anders tippt).
  function parseDate(text) {
    const s = String(text || "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    let y, mo, d;
    if (m) {
      [y, mo, d] = [+m[1], +m[2], +m[3]];
    } else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) {
      [d, mo, y] = [+m[1], +m[2], +m[3]];
    } else {
      return null;
    }
    const date = utc(y, mo, d);
    // Ungültige Daten wie 31.02. ablehnen
    return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
  }

  function isoWeek(date) {
    const target = new Date(date.getTime());
    const dayNr = (date.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.getTime();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target.getTime()) / (7 * DAY_MS));
  }

  const formatDate = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

  function formatRange(monday) {
    const friday = addDays(monday, 4);
    const [d1, m1, y1] = [monday.getUTCDate(), monday.getUTCMonth(), monday.getUTCFullYear()];
    const [d2, m2, y2] = [friday.getUTCDate(), friday.getUTCMonth(), friday.getUTCFullYear()];
    if (y1 !== y2) return `${d1}. ${MONTHS[m1]} ${y1} – ${d2}. ${MONTHS[m2]} ${y2}`;
    if (m1 !== m2) return `${d1}. ${MONTHS[m1]} – ${d2}. ${MONTHS[m2]} ${y2}`;
    return `${d1}.–${d2}. ${MONTHS[m2]} ${y2}`;
  }

  // ---------------------------------------------------------------
  // CSV lesen
  // ---------------------------------------------------------------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const src = text.replace(/^﻿/, "");

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // Ein Tag erscheint nur, wenn "Freigegeben" ein Haken ist (TRUE/WAHR/ja/x/1); alles andere = nicht freigegeben.
  const isReleased = (value) => /^(true|wahr|ja|yes|x|1|✓|✔)$/i.test(String(value || "").trim());

  // "5,5" / "5.50" / "5,50 €" -> "5,50 €"; anderer Text bleibt unverändert; leer -> "".
  function formatPrice(text) {
    const t = text.replace(/\s*(€|eur)\s*$/i, "").trim();
    if (!t) return "";
    if (/^\d+(?:[.,]\d{1,2})?$/.test(t)) {
      return `${Number(t.replace(",", ".")).toFixed(2).replace(".", ",")} €`;
    }
    return text.trim();
  }

  // Standardliste, nur wenn CONFIG.allergensUrl leer ist: die 14 Pflichtallergene (LMIV Anhang II), a–n in dieser Reihenfolge.
  const DEFAULT_ALLERGENS = new Map(Object.entries({
    A: ["Glutenhaltiges Getreide", "Cereals containing gluten"],
    B: ["Krebstiere", "Crustaceans"],
    C: ["Eier", "Eggs"],
    D: ["Fisch", "Fish"],
    E: ["Erdnüsse", "Peanuts"],
    F: ["Soja", "Soy"],
    G: ["Milch (Laktose)", "Milk (lactose)"],
    H: ["Schalenfrüchte (Nüsse)", "Tree nuts"],
    I: ["Sellerie", "Celery"],
    J: ["Senf", "Mustard"],
    K: ["Sesam", "Sesame"],
    L: ["Sulfite (Schwefeldioxid)", "Sulphites"],
    M: ["Lupinen", "Lupin"],
    N: ["Weichtiere", "Molluscs"],
  }).map(([code, [de, en]]) => [code.toLowerCase(), { de, en }]));

  // Tabellenblatt "Allergene": Allergen (Kürzel) | Name de | Name en  ->  Map Kürzel -> { de, en }, in Tabellenreihenfolge.
  function parseAllergenSheet(rows) {
    if (!rows.length) throw new Error("Allergen-CSV ist leer");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const codeCol = col(/^(allergen|code|kürzel|kuerzel)/);
    const deCol = col(/^name\s*de|(^|\s)(de|deutsch)$/);
    const enCol = col(/^name\s*en|(^|\s)(en|englisch|english)$/);
    if (codeCol < 0 || deCol < 0) throw new Error("Spalten 'Allergen' und 'Name de' fehlen");
    const defs = new Map();
    for (const row of rows.slice(1)) {
      const code = (row[codeCol] || "").trim().toLowerCase(); // intern klein, angezeigt groß (displayCode)
      if (!code) continue;
      defs.set(code, { de: (row[deCol] || "").trim(), en: enCol >= 0 ? (row[enCol] || "").trim() : "" });
    }
    if (!defs.size) throw new Error("Allergen-Tabelle enthält keine Einträge");
    return defs;
  }

  // Kennzeichnungen hinter "Suppe" / "Gericht n"
  const TAGS = [
    { key: "vegan", de: "Vegan", en: "Vegan", re: /^vegan$/ },
    { key: "vegetarisch", de: "Vegetarisch", en: "Vegetarian", re: /^(vegetarisch|veggie|vegetarian)$/ },
    { key: "glutenfrei", de: "Glutenfrei", en: "Gluten-free", re: /^(gluten-?frei|gluten-?free)$/ },
  ];
  const findTag = (t) => TAGS.find((tag) => tag.re.test(t));

  // "vegan, glutenfrei" -> [{de, en}, …]. Unbekannte Begriffe werden unverändert angezeigt.
  function parseTags(text) {
    const found = [];
    const add = (tag) => { if (!found.some((f) => f.de === tag.de)) found.push(tag); };
    for (const piece of text.split(/[,;/&+\n]+/)) {
      const t = piece.trim().toLowerCase();
      if (!t) continue;
      const tag = findTag(t);
      if (tag) { add(tag); continue; }
      const words = t.split(/\s+/);
      if (words.length > 1 && words.every(findTag)) { words.forEach((w) => add(findTag(w))); continue; }
      add({ de: piece.trim(), en: "" });
    }
    // Was der Chef nennt, steht da: "vegan / vegetarisch" bedeutet z. B. vegan ohne, vegetarisch mit Käse.
    return found;
  }

  // "a, g,i" -> ["a", "g", "i"] (nur zerlegt; was die Kürzel bedeuten, steht erst beim Anzeigen fest).
  function tokenizeAllergens(text) {
    const tokens = [];
    for (const raw of text.split(/[\s,;./]+/)) {
      const t = raw.trim().toLowerCase();
      if (t && !tokens.includes(t)) tokens.push(t);
    }
    return tokens;
  }

  // Allergene direkt am Bestandteil: "Hackbällchen in Sahnesauce[a,g] dazu Kartoffelpüree[g]"
  // -> [{text: "Hackbällchen in Sahnesauce"}, {codes: ["a","g"]}, {text: " dazu Kartoffelpüree"}, {codes: ["g"]}]
  // Das Leerzeichen vor der Klammer entfällt, damit das Kürzel am Wort hängt.
  function splitInline(text) {
    const parts = [];
    let last = 0;
    const pushText = (s) => {
      if (!s) return;
      // direkt nach dem Kürzel folgt ein Wort: Leerzeichen ergänzen
      const afterCodes = parts.length && parts[parts.length - 1].codes && /^[\p{L}\p{N}]/u.test(s);
      parts.push({ text: afterCodes ? ` ${s}` : s });
    };
    for (const m of text.matchAll(/\s*\[([^\]]*)\]/g)) {
      pushText(text.slice(last, m.index));
      const codes = tokenizeAllergens(m[1]);
      if (codes.length) parts.push({ codes });
      last = m.index + m[0].length;
    }
    pushText(text.slice(last));
    return parts;
  }

  const inlineCodes = (parts) => parts.flatMap((p) => p.codes || []);

  // Rein numerische Kürzel (1, 2, 3 …) sind Zusatzstoffe, alles andere (a, g, a1 …) Allergene.
  const isAdditive = (code) => /^\d+$/.test(code);

  // Passt die Angaben zur Allergen-Tabelle: "ag" -> a, g (wenn es kein Kürzel "ag" gibt).
  // Reihenfolge: erst Allergene, dann Zusatzstoffe, jeweils wie in der Tabelle.
  // Unbekannte Angaben bleiben sichtbar (lieber zu viel als ein Allergen verschweigen) und stehen am Ende.
  function resolveAllergens(tokens, defs) {
    const out = [];
    const add = (t) => { if (!out.includes(t)) out.push(t); };
    for (const t of tokens) {
      if (!defs || defs.has(t)) add(t);
      else if (/^[a-z]+$/.test(t) && [...t].every((c) => defs.has(c))) [...t].forEach(add);
      else add(t);
    }
    if (!defs) return out.sort();
    const order = [...defs.keys()];
    const rank = (t) => {
      const i = order.indexOf(t);
      if (i < 0) return Infinity;
      return (isAdditive(t) ? order.length : 0) + i;
    };
    return out.sort((a, b) => (rank(a) - rank(b)) || (a < b ? -1 : a > b ? 1 : 0));
  }

  // "Suppe" -> Position 0, "Gericht 2" -> Position 2, "Hinweis" -> Tageshinweis (Feiertag / geschlossen).
  function parsePosition(text) {
    const t = String(text || "").trim().toLowerCase();
    if (t === "suppe") return { kind: "dish", order: 0, label: "Suppe" };
    const m = /^gericht\s*(\d+)$/.exec(t);
    if (m) return { kind: "dish", order: +m[1], label: `Gericht ${+m[1]}` };
    if (/^(hinweis|geschlossen|feiertag)$/.test(t)) return { kind: "note" };
    return null;
  }

  // Eine Zeile pro Gericht (Spaltenreihenfolge egal, Zuordnung über den Namen):
  //   Datum | Freigegeben | Position | Gericht | Englisch | Allergene | Kennzeichnung | Preis klein | Preis groß
  // Position: Suppe, Gericht 1, Gericht 2, … oder Hinweis (Gericht/Englisch enthalten dann den Hinweistext).
  // Allergene, Kennzeichnung und Preise sind optional.
  // Ergebnis: Map "yyyy-mm-dd" -> { dishes: [{label, de, en, allergens, tags, small, large}], note: {de, en} }
  // Preisspalte finden: beginnt mit "Preis", "Klein" oder "Groß", enthält die Größe und (nicht) das Wort "intern".
  function priceCol(header, sizeRe, internal) {
    return header.findIndex((h) => /^(preis|klein|gro)/.test(h) && sizeRe.test(h) && /intern/.test(h) === internal);
  }

  function parseMenu(rows) {
    if (!rows.length) throw new Error("CSV ist leer");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const cols = {
      date: col(/^datum/),
      released: col(/^freigegeben/),
      position: col(/^position/),
      de: col(/^gericht/),
      en: col(/^engl/),
      allergens: col(/^allergen/),
      tags: col(/^kennzeichnung/),
      // "Preis klein" / "Preis groß" = externe (normale) Preise: Wochenansicht, Tagesansicht groß;
      // "Preis klein intern" / "Preis groß intern" = interne Preise: nur Tagesansicht/-druck, klein darunter.
      small: priceCol(header, /klein/, false),
      large: priceCol(header, /gro(ß|ss)/, false),
      smallInt: priceCol(header, /klein/, true),
      largeInt: priceCol(header, /gro(ß|ss)/, true),
    };
    // Ohne Freigabe-Spalte wird bewusst nichts angezeigt (lieber leer als versehentlich veröffentlicht).
    if (cols.date < 0 || cols.released < 0 || cols.position < 0 || cols.de < 0) {
      throw new Error("Spalten 'Datum', 'Freigegeben', 'Position' und 'Gericht' fehlen");
    }

    const cell = (row, i) => (i >= 0 ? (row[i] || "").trim() : "");
    const menu = new Map();
    for (const row of rows.slice(1)) {
      const date = parseDate(row[cols.date]);
      const pos = parsePosition(row[cols.position]);
      if (!date || !pos || !isReleased(row[cols.released])) continue;

      const key = toKey(date);
      if (!menu.has(key)) menu.set(key, { dishes: [], note: { de: "", en: "" } });
      const entry = menu.get(key);
      const de = cell(row, cols.de);
      if (!de) continue;

      if (pos.kind === "note") {
        entry.note = { de, en: cell(row, cols.en) };
      } else {
        entry.dishes.push({
          order: pos.order,
          label: pos.label,
          de,
          en: cell(row, cols.en),
          deParts: splitInline(de),
          enParts: splitInline(cell(row, cols.en)),
          allergens: tokenizeAllergens(cell(row, cols.allergens)),
          tags: parseTags(cell(row, cols.tags)),
          small: formatPrice(cell(row, cols.small)),
          large: formatPrice(cell(row, cols.large)),
          smallInt: formatPrice(cell(row, cols.smallInt)),
          largeInt: formatPrice(cell(row, cols.largeInt)),
        });
      }
    }
    for (const entry of menu.values()) entry.dishes.sort((a, b) => a.order - b.order);
    return menu;
  }

  function readCache(key = CACHE_KEY) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function writeCache(text, key = CACHE_KEY) {
    try { localStorage.setItem(key, text); } catch { /* Speicher evtl. gesperrt */ }
  }

  // Allergen-Legende: frisch aus dem Tabellenblatt, sonst zuletzt gespeicherter Stand.
  // Absichtlich ohne eingebaute Ersatzliste: eine fremde Standardliste könnte andere Kürzel bedeuten als die des Chefs.
  async function loadAllergens() {
    if (!CONFIG.allergensUrl) return DEFAULT_ALLERGENS;
    try {
      const res = await fetch(CONFIG.allergensUrl, { cache: "no-cache", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const defs = parseAllergenSheet(parseCsv(text));
      writeCache(text, ALLERGEN_CACHE_KEY);
      return defs;
    } catch (err) {
      const cached = readCache(ALLERGEN_CACHE_KEY);
      if (cached) {
        try { return parseAllergenSheet(parseCsv(cached)); } catch { /* weiter */ }
      }
      throw err;
    }
  }

  // Lädt frisch; fällt bei Fehlern (oder nach 10 s ohne Antwort) auf den zuletzt gespeicherten Stand zurück.
  async function loadMenu() {
    try {
      const res = await fetch(CONFIG.csvUrl, { cache: "no-cache", signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const menu = parseMenu(parseCsv(text));
      writeCache(text);
      return { menu, stale: false };
    } catch (err) {
      const cached = readCache();
      if (cached) {
        try { return { menu: parseMenu(parseCsv(cached)), stale: true }; } catch { /* weiter */ }
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Darstellung (nur textContent, nie innerHTML)
  // ---------------------------------------------------------------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // Kürzel werden intern klein verglichen (a = A), aber immer großgeschrieben angezeigt: a1 -> A1.
  const displayCode = (code) => code.toUpperCase();

  // Allergene als kleine, hochgestellte Buchstaben direkt hinter dem Namen: "Gulasch mit Nudeln ᵃ,ⁱ"
  function renderAllergens(list) {
    const sup = el("sup", "allergens");
    sup.append(el("span", "sr-only", "Allergene und Zusatzstoffe: "), document.createTextNode(list.map(displayCode).join(",")));
    const defs = state.allergens;
    sup.title = list.map((k) => (defs && defs.has(k) && defs.get(k).de ? defs.get(k).de : k)).join(", ");
    return sup;
  }

  // Text mit eingebetteten Kürzeln: Teile aus splitInline, sonst der reine Text.
  function fillText(node, text, parts) {
    if (!parts) { node.textContent = text; return; }
    for (const p of parts) {
      node.append(p.codes ? renderAllergens(resolveAllergens(p.codes, state.allergens)) : document.createTextNode(p.text));
    }
  }

  // Deutscher Haupttext, dahinter die Allergene, die nicht schon am Bestandteil stehen (Spalte "Allergene"),
  // darunter (falls vorhanden) die englische Zeile.
  function appendBilingual(parent, { de, en, deParts, enParts }, allergens = []) {
    const main = el("span", "dish-de");
    fillText(main, de, deParts);
    if (allergens.length) main.append(renderAllergens(allergens));
    parent.append(main);
    if (en) {
      const line = el("span", "dish-en");
      fillText(line, en, enParts);
      line.lang = "en";
      parent.append(line);
    }
  }

  // Preise rechts. Sind beide Portionen angegeben, steht unter jedem Preis "Klein"/"Groß".
  // Gibt es nur einen Preis (z. B. Dessert), steht er ohne Beschriftung in der letzten Spalte.
  function renderPrices(dish) {
    const price = (value, label, cls) => {
      const cell = el("span", `price ${cls}`);
      cell.append(el("span", "price-value", value));
      if (label) cell.append(el("span", "price-label", label));
      return cell;
    };
    if (dish.small && dish.large) {
      return [price(dish.small, "Klein", "is-small"), price(dish.large, "Groß", "is-large")];
    }
    const single = dish.small || dish.large;
    if (!single) return [];
    return [price(single, "", "is-single")];
  }

  // Name (deutsch + englisch) mit Allergenen.
  // Was im Namen schon an einem Bestandteil steht, wird hinten nicht wiederholt; der Rest aus der Spalte bleibt sichtbar.
  function renderDishText(dish) {
    const text = el("div", "dish-text");
    const defs = state.allergens;
    const inline = new Set(resolveAllergens(inlineCodes(dish.deParts), defs));
    const trailing = resolveAllergens(dish.allergens, defs).filter((k) => !inline.has(k));
    appendBilingual(text, dish, trailing);
    return text;
  }

  // Kennzeichnungs-Pillen (vegan, vegetarisch, glutenfrei)
  function renderTags(dish, parent) {
    for (const tag of dish.tags) {
      const pill = el("span", tag.key ? `pill is-${tag.key}` : "pill", tag.de);
      if (tag.en) pill.title = tag.en;
      parent.append(pill);
    }
  }

  // Eine Zeile: "SUPPE  [Vegan]" darüber, darunter Name mit Allergenen, Englisch und rechts die Preise.
  function renderDish(dish, priceCols) {
    const item = el("li", "dish");
    const meta = el("div", "dish-meta");
    meta.append(el("span", "dish-pos", dish.label));
    renderTags(dish, meta);
    item.append(meta, renderDishText(dish));
    if (priceCols) item.append(...renderPrices(dish));
    return item;
  }

  function renderDay(date, index, entry, isToday) {
    const closed = !!(entry && entry.note.de);
    const card = el("article", "day");
    card.dataset.dow = String(index);
    if (isToday) { card.classList.add("is-today"); card.setAttribute("aria-current", "date"); }
    if (closed) card.classList.add("is-closed");

    const head = el("header", "day-head");
    // Hat der Tag Gerichte, ist das Datum ein Link zur Tagesansicht (dort auch drucken).
    const dateText = `${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}`;
    let dateEl;
    if (!closed && entry && entry.dishes.length) {
      dateEl = el("a", "day-date is-link", dateText);
      dateEl.href = `#tag/${toKey(date)}`;
      dateEl.title = "Tagesansicht öffnen und drucken";
    } else {
      dateEl = el("span", "day-date", dateText);
    }
    head.append(el("h3", "day-name", DAY_NAMES[index]), dateEl);
    if (isToday) head.append(el("span", "badge", "Heute"));

    const body = el("div", "day-body");
    if (closed) {
      const note = el("p", "closed-note");
      appendBilingual(note, entry.note);
      body.append(el("p", "closed-label", "Geschlossen · Closed"), note);
    } else if (entry && entry.dishes.length) {
      const list = el("ul", "dishes");
      // 0 = keine Preise, 1 = nur Einzelpreise, 2 = Preise für klein und groß
      const priceCols = entry.dishes.some((d) => d.small && d.large) ? 2
        : entry.dishes.some((d) => d.small || d.large) ? 1 : 0;
      list.dataset.prices = String(priceCols);
      for (const dish of entry.dishes) list.append(renderDish(dish, priceCols));
      body.append(list);
    } else {
      body.append(el("p", "pending", "Noch nicht geplant"));
    }

    card.append(head, body);
    return card;
  }

  // ---------------------------------------------------------------
  // Tagesansicht/-druck (A4): alle Gerichte mit externen und internen Preisen, dazu Salat und Dessert
  // ---------------------------------------------------------------

  // Ein Preis in der Tagesansicht: groß der externe Preis (wie in der Wochenansicht), klein darunter der interne,
  // darunter "Klein"/"Groß". Fehlt der externe Preis, steht der interne groß.
  function dayPrice(ext, int, label, cls) {
    const cell = el("span", `price ${cls}`);
    cell.append(el("span", "price-value", ext || int));
    if (ext && int) cell.append(el("span", "price-intern", `intern ${int}`));
    if (label) cell.append(el("span", "price-label", label));
    return cell;
  }

  function renderDayPrices(d) {
    const hasSmall = d.small || d.smallInt;
    const hasLarge = d.large || d.largeInt;
    if (hasSmall && hasLarge) {
      return [dayPrice(d.small, d.smallInt, "Klein", "is-small"), dayPrice(d.large, d.largeInt, "Groß", "is-large")];
    }
    if (hasSmall || hasLarge) return [dayPrice(d.small || d.large, d.smallInt || d.largeInt, "", "is-single")];
    return [];
  }

  // Tagesansicht/Tagesdruck: Gerichte wie in der Wochenkarte, danach Salat und Dessert (feste Zeilen aus CONFIG).
  function renderDayPrint(date, index, entry) {
    const extras = (CONFIG.printExtras || []).map((x) => ({
      de: x.de, en: x.en, small: "", large: formatPrice(String(x.extern || "")),
      smallInt: "", largeInt: formatPrice(String(x.intern || "")),
    }));
    const all = [...entry.dishes, ...extras];
    const list = el("ul", "dishes");
    list.dataset.prices = all.some((d) => (d.small || d.smallInt) && (d.large || d.largeInt)) ? "2"
      : all.some((d) => d.small || d.large || d.smallInt || d.largeInt) ? "1" : "0";

    for (const dish of entry.dishes) {
      const item = el("li", "dish");
      const meta = el("div", "dish-meta");
      meta.append(el("span", "dish-pos", dish.label));
      renderTags(dish, meta);
      item.append(meta, renderDishText(dish), ...renderDayPrices(dish));
      list.append(item);
    }
    extras.forEach((extra, i) => {
      const item = el("li", i === 0 ? "dish is-extra is-extra-first" : "dish is-extra");
      const text = el("div", "dish-text");
      appendBilingual(text, extra);
      item.append(text, ...renderDayPrices(extra));
      list.append(item);
    });

    const box = el("div", "dp");
    const head = el("div", "dp-head");
    head.append(el("h2", "dp-day", WEEKDAYS[index]), el("p", "dp-date", formatLongDate(date)));
    box.append(head, list);
    return box;
  }

  // Tagesansicht (#tag/2026-11-23): am Bildschirm genau das, was gedruckt wird.
  function renderDayView(date) {
    const index = (date.getUTCDay() + 6) % 7;
    const entry = state.menu.get(toKey(date));
    const monday = mondayOf(date);
    ui.printTitle.textContent = "Tagesmenü"; // Tag und Datum stehen groß darunter
    ui.backWeek.href = toKey(monday) === toKey(state.homeMonday) ? location.pathname + location.search : `#${toKey(monday)}`;
    ui.backWeek.textContent = `← Zurück zur Woche (KW ${isoWeek(date)})`;
    document.title = `Tagesmenü ${WEEKDAYS[index]}, ${formatDate(date)} – ${CONFIG.title}`;

    if (entry && entry.dishes.length && !entry.note.de) {
      ui.dayPrint.replaceChildren(renderDayPrint(date, index, entry));
      ui.printDay.hidden = false;
      // Legende nur für die Kürzel dieses Tages
      const defs = state.allergens;
      const used = new Set();
      for (const dish of entry.dishes) {
        const tokens = [...dish.allergens, ...inlineCodes(dish.deParts), ...inlineCodes(dish.enParts)];
        resolveAllergens(tokens, defs).forEach((k) => used.add(k));
      }
      if (!defs) renderLegend([], used.size > 0);
      else renderLegend([...defs.keys()].filter((k) => used.has(k)), false);
    } else {
      // Geschlossen, Wochenende oder noch nicht geplant
      const box = el("div", "dp");
      const head = el("div", "dp-head");
      head.append(el("h2", "dp-day", WEEKDAYS[index]), el("p", "dp-date", formatLongDate(date)));
      const msg = el("p", "pending");
      if (entry && entry.note.de) appendBilingual(msg, entry.note);
      else msg.textContent = index > 4 ? "Am Wochenende geschlossen." : "Für diesen Tag ist noch nichts geplant.";
      box.append(head, msg);
      ui.dayPrint.replaceChildren(box);
      ui.printDay.hidden = true;
      renderLegend([]);
    }
  }

  const formatLongDate = (d) => `${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

  // ---------------------------------------------------------------
  // Anwendung
  // ---------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const ui = {
    title: $("title"), weekTitle: $("weektitle"), weekRange: $("weekrange"),
    days: $("days"), status: $("status"), legend: $("legend"), legendList: $("legend-list"),
    legendAdd: $("legend-additives"), legendAddList: $("legend-additives-list"),
    prev: $("prev"), next: $("next"), today: $("today"), print: $("print"), printTitle: $("printtitle"),
    dayPrint: $("dayprint"), weekNav: $("weeknav"), dayNav: $("daynav"),
    backWeek: $("backweek"), printDay: $("printday"),
  };

  // allergens: Map Kürzel -> { de, en }, oder null, solange (oder falls) die Allergen-Tabelle nicht verfügbar ist
  const state = {
    menu: new Map(), monday: null, homeMonday: null, day: null,
    allergens: CONFIG.allergensUrl ? null : DEFAULT_ALLERGENS,
  };

  // Am Wochenende zeigen wir direkt die kommende Woche.
  function defaultMonday() {
    const today = todayUtc();
    const dow = (today.getUTCDay() + 6) % 7;
    return dow >= 5 ? addDays(mondayOf(today), 7) : mondayOf(today);
  }

  function render() {
    const dayView = !!state.day;
    document.body.classList.toggle("day-view", dayView);
    ui.weekNav.hidden = dayView;
    ui.dayNav.hidden = !dayView;
    if (dayView) { renderDayView(state.day); return; }
    ui.dayPrint.replaceChildren();
    document.title = `${CONFIG.title} – Speiseplan`;

    const monday = state.monday;
    ui.weekTitle.textContent = `KW ${isoWeek(monday)}`;
    ui.weekRange.textContent = formatRange(monday);
    ui.printTitle.textContent = `Speiseplan vom ${formatDate(monday)} – ${formatDate(addDays(monday, 4))}`;
    ui.today.hidden = toKey(monday) === toKey(state.homeMonday);

    const todayKey = toKey(todayUtc());
    const entries = DAY_NAMES.map((_, i) => {
      const date = addDays(monday, i);
      return { date, entry: state.menu.get(toKey(date)) };
    });

    if (entries.every(({ entry }) => !entry)) {
      ui.days.replaceChildren(el("p", "empty", "Der Menüplan für diese Woche folgt."));
      renderLegend([]);
      return;
    }
    ui.days.replaceChildren(
      ...entries.map(({ date, entry }, i) => renderDay(date, i, entry, toKey(date) === todayKey)),
    );
    // Legende nur für die Allergene, die in dieser Woche vorkommen (in der Reihenfolge der Allergen-Tabelle)
    const defs = state.allergens;
    const used = new Set();
    for (const { entry } of entries) {
      if (!entry || entry.note.de) continue;
      for (const dish of entry.dishes) {
        const tokens = [...dish.allergens, ...inlineCodes(dish.deParts), ...inlineCodes(dish.enParts)];
        resolveAllergens(tokens, defs).forEach((k) => used.add(k));
      }
    }
    if (!defs) renderLegend([], used.size > 0);
    else renderLegend([...defs.keys()].filter((k) => used.has(k)), false);
  }

  // keys: Kürzel mit Erklärung; unavailable: es kommen Kürzel vor, aber die Tabelle ließ sich nicht laden.
  // Zwei Blöcke: Allergene (Buchstaben) und Zusatzstoffe (Zahlen), jeweils nur wenn in der Woche benutzt.
  function renderLegend(keys, unavailable) {
    const defs = state.allergens;
    const fill = (box, list, codes) => {
      box.hidden = codes.length === 0;
      list.replaceChildren(
        ...codes.map((k) => {
          const { de, en } = defs.get(k);
          const item = el("li", "legend-item");
          item.append(el("b", "legend-key", displayCode(k)), document.createTextNode(de));
          if (en) {
            const enEl = el("span", "en", en);
            enEl.lang = "en";
            item.append(document.createTextNode(" "), enEl);
          }
          return item;
        }),
      );
    };
    ui.legendAdd.hidden = true;
    if (unavailable) {
      ui.legend.hidden = false;
      ui.legendList.replaceChildren(el("li", "legend-item", "Die Erklärung der Kürzel ist gerade nicht verfügbar. Bitte im Zweifel nachfragen."));
      return;
    }
    fill(ui.legend, ui.legendList, keys.filter((k) => !isAdditive(k)));
    fill(ui.legendAdd, ui.legendAddList, keys.filter(isAdditive));
  }

  function go(monday) {
    state.day = null;
    state.monday = monday;
    const key = toKey(monday);
    try {
      if (key === toKey(state.homeMonday)) history.replaceState(null, "", location.pathname + location.search);
      else history.replaceState(null, "", `#${key}`);
    } catch { /* ohne History-API weiter */ }
    render();
  }

  // #tag/yyyy-mm-dd = Tagesansicht, #yyyy-mm-dd = Woche, sonst aktuelle Woche
  function readHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith("tag/")) {
      const day = parseDate(hash.slice(4));
      if (day) return { day, monday: mondayOf(day) };
    }
    const date = parseDate(hash);
    return { day: null, monday: date ? mondayOf(date) : state.homeMonday };
  }

  async function init() {
    ui.title.textContent = CONFIG.title;
    document.title = `${CONFIG.title} – Speiseplan`;

    state.homeMonday = defaultMonday();
    Object.assign(state, readHash());

    ui.prev.addEventListener("click", () => go(addDays(state.monday, -7)));
    ui.next.addEventListener("click", () => go(addDays(state.monday, 7)));
    ui.today.addEventListener("click", () => go(state.homeMonday));
    ui.print.addEventListener("click", () => window.print());
    ui.printDay.addEventListener("click", () => window.print());
    window.addEventListener("hashchange", () => {
      const wasDay = !!state.day;
      Object.assign(state, readHash());
      render();
      if (!!state.day !== wasDay) window.scrollTo(0, 0);
    });

    render();
    // Die Legende lädt parallel; fällt sie aus, zeigt die Seite die Kürzel ohne Erklärung und weist darauf hin.
    const allergens = loadAllergens().catch((err) => {
      console.error("Allergen-Legende konnte nicht geladen werden:", err);
      return null;
    });
    try {
      const { menu, stale } = await loadMenu();
      state.menu = menu;
      ui.status.textContent = stale
        ? "Keine Verbindung – es wird der zuletzt gespeicherte Stand angezeigt."
        : "";
      ui.status.classList.toggle("is-warn", stale);
    } catch (err) {
      console.error("Menüplan konnte nicht geladen werden:", err);
      ui.status.textContent = "Der Menüplan konnte gerade nicht geladen werden. Bitte später erneut versuchen.";
      ui.status.classList.add("is-warn");
    }
    state.allergens = await allergens;
    render();
  }

  init();
})();
