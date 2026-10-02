// Memory view.

import { api } from "./api.js";
import { h, icon, set } from "./dom.js";
import { cardHead, viewHead } from "./shell.js";
import { dialog, fail, toast } from "./ui.js";

// ─── View: Gedächtnis ───────────────────────────────────────────────────────
const CATS = { preference: ["Präferenzen", "settings"], person: ["Personen", "chat"], project: ["Projekte", "tasks"], rule: ["Regeln", "shield"], fact: ["Fakten", "memory"] };
export async function viewMemory(main) {
  const entries = await api("/api/memory");
  const cat = h("select", { class: "field", "aria-label": "Kategorie" },
    Object.entries({ preference: "Präferenz", person: "Person", project: "Projekt", rule: "Regel", fact: "Fakt" }).map(([k, l]) => h("option", { value: k }, l)));
  const key = h("input", { class: "field", placeholder: "z.B. Meetingdauer", maxlength: 200, required: true, "aria-label": "Schlüssel" });
  const value = h("input", { class: "field", placeholder: "z.B. 30 Minuten, 10 Min. Puffer", maxlength: 2000, required: true, "aria-label": "Wert" });
  const form = h("form", { class: "card mem-form", onsubmit: async (e) => {
    e.preventDefault();
    try { await api("/api/memory", { method: "POST", body: { category: cat.value, key: key.value, value: value.value } }); toast("Gespeichert.", "ok"); viewMemory(main); } catch (err) { fail(err); }
  } }, cat, key, value, h("button", { class: "btn primary", type: "submit" }, "Merken"));

  const cards = Object.entries(CATS).map(([k, [label, ic]]) => {
    const list = entries.filter((e) => e.category === k);
    return h("div", { class: "card" }, cardHead(label, ic, h("span", { class: "badge" }, list.length)),
      list.length ? list.map((m) => h("div", { class: "mem" },
        h("div", { class: "main" }, h("div", { class: "k" }, m.key), h("div", { class: "v" }, m.value),
          h("div", { style: "margin-top:4px" }, m.source === "user" ? h("span", { class: "badge ok" }, "von dir") : h("span", { class: "badge warn" }, `vermutet · ${Math.round(m.confidence * 100)} %`))),
        h("div", { class: "actions" },
          h("button", { class: "btn ghost icon sm", "aria-label": "Bearbeiten", onclick: async () => {
            const v = await dialog({ title: m.key, text: m.source === "user" ? "Wert ändern" : "Vermuteten Wert bestätigen oder korrigieren", input: m.value, confirmLabel: "Speichern" });
            if (v) { await api(`/api/memory/${m.id}`, { method: "PATCH", body: { value: v } }).catch(fail); viewMemory(main); }
          } }, icon("edit")),
          h("button", { class: "btn ghost icon sm", "aria-label": "Löschen", onclick: async () => {
            if (await dialog({ title: "Eintrag löschen?", text: `„${m.key}: ${m.value}“`, confirmLabel: "Löschen", danger: true })) { await api(`/api/memory/${m.id}`, { method: "DELETE" }).catch(fail); viewMemory(main); }
          } }, icon("trash")))))
        : h("div", { class: "card-body" }, h("div", { class: "muted small" }, "Noch leer.")));
  });

  set(main, h("div", { class: "view" },
    viewHead("Gedächtnis", "Was JARVIS über dich weiß — sichtbar, änderbar, löschbar."),
    form,
    h("div", { class: "mem-grid" }, cards)));
}
