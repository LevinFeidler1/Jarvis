// Notes & lists view.

import { api } from "./api.js";
import { fmt, h, icon, set } from "./dom.js";
import { cardHead, go, viewHead } from "./shell.js";
import { fail } from "./ui.js";

// ─── View: Notizen & Listen ─────────────────────────────────────────────────
export async function viewNotes(main, params) {
  const q = params.get("q") ?? "";
  const [lists, notes] = await Promise.all([api("/api/lists"), api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`)]);
  const reload = () => viewNotes(main, params);

  const listCard = (l) => {
    const input = h("input", { class: "field", placeholder: "Neuer Eintrag …", maxlength: "200", "aria-label": `Eintrag für ${l.name}` });
    const add = async () => {
      const items = input.value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
      if (!items.length) return;
      await api(`/api/lists/${encodeURIComponent(l.name)}/items`, { method: "POST", body: { items } }).catch(fail);
      reload();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());
    const doneCount = l.items.filter((i) => i.done).length;
    return h("div", { class: "card list-card" },
      cardHead(l.name, "list", h("span", { class: "badge" }, `${l.open} offen`),
        doneCount ? h("button", { class: "btn ghost icon sm", title: "Erledigte entfernen", "aria-label": "Erledigte entfernen", onclick: async () => { await api(`/api/lists/${encodeURIComponent(l.name)}/clear-done`, { method: "POST" }).catch(fail); reload(); } }, icon("trash")) : null),
      h("div", { class: "card-body" },
        h("div", { class: "list-items" }, l.items.map((it) => {
          const row = h("div", { class: `list-item ${it.done ? "done" : ""}` },
            h("button", { class: "jc-li-btn", "aria-label": it.done ? "Wieder öffnen" : "Abhaken", onclick: async () => {
              const done = !row.classList.contains("done");
              row.classList.toggle("done", done);
              await api(`/api/list-items/${it.id}`, { method: "PATCH", body: { done } }).catch((e) => { row.classList.toggle("done", !done); fail(e); });
            } }, h("span", { class: "tick" }, icon("check"))),
            h("span", { class: "txt" }, it.text),
            h("button", { class: "btn ghost icon sm", "aria-label": "Entfernen", onclick: async () => { await api(`/api/list-items/${it.id}`, { method: "DELETE" }).catch(fail); row.remove(); } }, icon("x")));
          return row;
        })),
        h("div", { class: "list-add" }, input, h("button", { class: "btn primary", onclick: add }, icon("plus"), "Hinzufügen"))));
  };

  const newList = h("input", { class: "field", placeholder: "Neue Liste, z.B. Packliste Urlaub", maxlength: "80" });
  const noteText = h("textarea", { class: "field note-input", placeholder: "Notiz schreiben … (Idee, Info, Text zum Merken)", rows: "3", maxlength: "10000" });
  const search = h("input", { class: "field", type: "search", placeholder: "Notizen durchsuchen …", value: q, "aria-label": "Notizen durchsuchen" });
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => go("notes", search.value.trim() ? `?q=${encodeURIComponent(search.value.trim())}` : ""), 400); });

  set(main, h("div", { class: "view notes-view" },
    viewHead("Notizen & Listen", "Sag einfach: „Schreib Milch auf die Einkaufsliste.“"),
    h("div", { class: "section-title" }, icon("list"), "Listen"),
    h("div", { class: "list-grid" },
      lists.length ? lists.map(listCard) : h("div", { class: "empty" }, "Noch keine Liste."),
      h("div", { class: "card new-list" }, h("div", { class: "card-body" },
        h("div", { class: "muted small", style: "margin-bottom:8px" }, "Neue Liste"),
        h("div", { class: "list-add" }, newList, h("button", { class: "btn", onclick: async () => {
          const name = newList.value.trim();
          if (!name) return;
          const first = prompt(`Erster Eintrag für „${name}“:`);
          if (!first?.trim()) return;
          await api(`/api/lists/${encodeURIComponent(name)}/items`, { method: "POST", body: { items: [first.trim()] } }).catch(fail);
          reload();
        } }, icon("plus")))))),
    h("div", { class: "section-title" }, icon("note"), "Notizen"),
    h("div", { class: "card" }, h("div", { class: "card-body note-new" }, noteText,
      h("div", { class: "head-actions" }, h("button", { class: "btn primary", onclick: async () => {
        if (!noteText.value.trim()) return;
        await api("/api/notes", { method: "POST", body: { body: noteText.value.trim() } }).catch(fail);
        reload();
      } }, icon("plus"), "Speichern")))),
    h("div", { style: "margin:14px 0" }, search),
    h("div", { class: "note-grid" }, notes.length ? notes.map((n) =>
      h("div", { class: `card note ${n.pinned ? "pinned" : ""}` },
        h("div", { class: "card-body" },
          n.title ? h("div", { class: "note-title" }, n.title) : null,
          h("div", { class: "note-body" }, n.body),
          h("div", { class: "note-foot" }, h("span", { class: "muted small" }, fmt.rel(n.updatedAt)),
            h("button", { class: "btn ghost icon sm", "aria-label": n.pinned ? "Lösen" : "Anheften", onclick: async () => { await api(`/api/notes/${n.id}`, { method: "PATCH", body: { pinned: !n.pinned } }).catch(fail); reload(); } }, icon("pin")),
            h("button", { class: "btn ghost icon sm", "aria-label": "Löschen", onclick: async () => { if (!confirm("Notiz löschen?")) return; await api(`/api/notes/${n.id}`, { method: "DELETE" }).catch(fail); reload(); } }, icon("trash"))))))
      : h("div", { class: "empty" }, q ? "Nichts gefunden." : "Noch keine Notizen."))));
}
