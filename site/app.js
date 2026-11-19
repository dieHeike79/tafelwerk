(() => {
  "use strict";

  // ---------------------------------------------------------------
  // Konfiguration
  // ---------------------------------------------------------------
  const CONFIG = {
    // Name der Cafeteria (Überschrift + Seitentitel)
    title: "Cafeteria",
    // Quelle des Speiseplans: die "Im Web veröffentlichen"-URL (CSV) aus Google Sheets.
    csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vT_fCihwVSW7KWjxZt0G5pkmDRnV_x2Dd81sZe8UQqz-l8rmkNrz3CP9XlqOt8wZiuS4XSw8979wiEg/pub?gid=55366281&single=true&output=csv",
  };

  const CACHE_KEY = "cafeteria-menu-csv-v1";
  const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
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

  // Erwartete Spalten (Reihenfolge egal, Zuordnung über Name und Nummer):
  //   Datum | Freigegeben | Gericht 1 | Englisch 1 | Gericht 2 | Englisch 2 | … | Hinweis | Hinweis Englisch
  // Ergebnis: Map "yyyy-mm-dd" -> { dishes: [{de, en}], note: {de, en} }
  function parseMenu(rows) {
    if (!rows.length) throw new Error("CSV ist leer");
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const dateCol = header.findIndex((h) => h.startsWith("datum"));
    const releasedCol = header.findIndex((h) => h.startsWith("freigegeben"));
    const noteCol = header.findIndex((h) => /^hinweis(?!.*engl)/.test(h));
    const noteEnCol = header.findIndex((h) => /^hinweis.*engl/.test(h));

    const slots = new Map(); // Nummer -> { de: Spalte, en: Spalte }
    header.forEach((h, i) => {
      let m = /^gericht\s*(\d+)/.exec(h);
      if (m) { slots.set(+m[1], { ...slots.get(+m[1]), de: i }); return; }
      m = /^engl\w*\s*(\d+)/.exec(h);
      if (m) slots.set(+m[1], { ...slots.get(+m[1]), en: i });
    });
    const dishCols = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, cols]) => cols);
    // Ohne Freigabe-Spalte wird bewusst nichts angezeigt (lieber leer als versehentlich veröffentlicht).
    if (dateCol < 0 || releasedCol < 0 || !dishCols.some((c) => c.de !== undefined)) {
      throw new Error("Spalten 'Datum', 'Freigegeben' und 'Gericht 1 …' fehlen");
    }

    const cell = (row, col) => (col >= 0 && col !== undefined ? (row[col] || "").trim() : "");
    const menu = new Map();
    for (const row of rows.slice(1)) {
      const date = parseDate(row[dateCol]);
      if (!date || !isReleased(row[releasedCol])) continue;
      const dishes = dishCols
        .map((c) => ({ de: cell(row, c.de), en: cell(row, c.en) }))
        .filter((d) => d.de);
      const note = { de: cell(row, noteCol), en: cell(row, noteEnCol) };
      menu.set(toKey(date), { dishes, note });
    }
    return menu;
  }

  function readCache() {
    try { return localStorage.getItem(CACHE_KEY); } catch { return null; }
  }

  function writeCache(text) {
    try { localStorage.setItem(CACHE_KEY, text); } catch { /* Speicher evtl. gesperrt */ }
  }

  // Lädt frisch; fällt bei Fehlern auf den zuletzt gespeicherten Stand zurück.
  async function loadMenu() {
    try {
      const res = await fetch(CONFIG.csvUrl, { cache: "no-cache" });
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

  // Deutscher Haupttext, darunter (falls vorhanden) die englische Zeile.
  function appendBilingual(parent, { de, en }) {
    parent.append(el("span", "dish-de", de));
    if (en) {
      const line = el("span", "dish-en", en);
      line.lang = "en";
      parent.append(line);
    }
  }

  function renderDay(date, index, entry, isToday) {
    const closed = !!(entry && entry.note.de);
    const card = el("article", "day");
    card.dataset.dow = String(index);
    if (isToday) { card.classList.add("is-today"); card.setAttribute("aria-current", "date"); }
    if (closed) card.classList.add("is-closed");

    const head = el("header", "day-head");
    head.append(
      el("h3", "day-name", DAY_NAMES[index]),
      el("span", "day-date", `${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}`),
    );
    if (isToday) head.append(el("span", "badge", "Heute"));

    const body = el("div", "day-body");
    if (closed) {
      const note = el("p", "closed-note");
      appendBilingual(note, entry.note);
      body.append(el("p", "closed-label", "Geschlossen · Closed"), note);
    } else if (entry && entry.dishes.length) {
      const list = el("ul", "dishes");
      for (const dish of entry.dishes) {
        const item = el("li");
        appendBilingual(item, dish);
        list.append(item);
      }
      body.append(list);
    } else {
      body.append(el("p", "pending", "Noch nicht geplant"));
    }

    card.append(head, body);
    return card;
  }

  // ---------------------------------------------------------------
  // Anwendung
  // ---------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const ui = {
    title: $("title"), weekTitle: $("weektitle"), weekRange: $("weekrange"),
    days: $("days"), status: $("status"),
    prev: $("prev"), next: $("next"), today: $("today"),
  };

  const state = { menu: new Map(), monday: null, homeMonday: null };

  // Am Wochenende zeigen wir direkt die kommende Woche.
  function defaultMonday() {
    const today = todayUtc();
    const dow = (today.getUTCDay() + 6) % 7;
    return dow >= 5 ? addDays(mondayOf(today), 7) : mondayOf(today);
  }

  function render() {
    const monday = state.monday;
    ui.weekTitle.textContent = `KW ${isoWeek(monday)}`;
    ui.weekRange.textContent = formatRange(monday);
    ui.today.hidden = toKey(monday) === toKey(state.homeMonday);

    const todayKey = toKey(todayUtc());
    const entries = DAY_NAMES.map((_, i) => {
      const date = addDays(monday, i);
      return { date, entry: state.menu.get(toKey(date)) };
    });

    if (entries.every(({ entry }) => !entry)) {
      ui.days.replaceChildren(el("p", "empty", "Der Menüplan für diese Woche folgt."));
      return;
    }
    ui.days.replaceChildren(
      ...entries.map(({ date, entry }, i) => renderDay(date, i, entry, toKey(date) === todayKey)),
    );
  }

  function go(monday) {
    state.monday = monday;
    const key = toKey(monday);
    try {
      if (key === toKey(state.homeMonday)) history.replaceState(null, "", location.pathname + location.search);
      else history.replaceState(null, "", `#${key}`);
    } catch { /* ohne History-API weiter */ }
    render();
  }

  function mondayFromHash() {
    const date = parseDate(location.hash.slice(1));
    return date ? mondayOf(date) : null;
  }

  async function init() {
    ui.title.textContent = CONFIG.title;
    document.title = `${CONFIG.title} – Speiseplan`;

    state.homeMonday = defaultMonday();
    state.monday = mondayFromHash() || state.homeMonday;

    ui.prev.addEventListener("click", () => go(addDays(state.monday, -7)));
    ui.next.addEventListener("click", () => go(addDays(state.monday, 7)));
    ui.today.addEventListener("click", () => go(state.homeMonday));
    window.addEventListener("hashchange", () => {
      state.monday = mondayFromHash() || state.homeMonday;
      render();
    });

    render();
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
    render();
  }

  init();
})();
