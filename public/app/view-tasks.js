// Tasks view.

import { api } from "./api.js";
import { $, fmt, h, icon, set, ymd } from "./dom.js";
import { viewHead } from "./shell.js";
import { fail } from "./ui.js";
import { startChat } from "./view-chat.js";

// ─── View: Aufgaben ─────────────────────────────────────────────────────────
export async function viewTasks(main) {
  const [tasks, reminders] = await Promise.all([api("/api/tasks"), api("/api/reminders")]);
  const today = ymd(new Date());
  const open = tasks.filter((t) => t.status === "open");
  const groups = [
    ["Überfällig", open.filter((t) => t.due && t.due.slice(0, 10) < today)],
    ["Heute", open.filter((t) => t.due && t.due.slice(0, 10) === today)],
    ["Demnächst", open.filter((t) => t.due && t.due.slice(0, 10) > today)],
    ["Ohne Datum", open.filter((t) => !t.due)],
    ["Erledigt", tasks.filter((t) => t.status === "done").slice(0, 15)],
  ];

  const title = h("input", { class: "field title", placeholder: "Neue Aufgabe hinzufügen …", maxlength: 300, required: true, "aria-label": "Titel" });
  const due = h("input", { class: "field small", type: "date", "aria-label": "Fällig am" });
  const prio = h("select", { class: "field small", "aria-label": "Priorität" }, h("option", { value: "normal" }, "Normal"), h("option", { value: "high" }, "Hoch"), h("option", { value: "low" }, "Niedrig"));
  const form = h("form", { class: "card quick-add", onsubmit: async (e) => {
    e.preventDefault();
    try {
      await api("/api/tasks", { method: "POST", body: { title: title.value, due: due.value || undefined, priority: prio.value } });
      viewTasks(main).then(() => $(".quick-add .title")?.focus());
    } catch (err) { fail(err); }
  } }, icon("plus"), title, due, prio, h("button", { class: "btn primary", type: "submit" }, "Hinzufügen"));

  const taskRow = (t) => h("div", { class: `task ${t.status === "done" ? "done" : ""}` },
    h("button", { class: `check ${t.status === "done" ? "done" : ""}`, "aria-label": t.status === "done" ? "Wieder öffnen" : "Erledigt",
      onclick: async () => { await api(`/api/tasks/${t.id}/${t.status === "done" ? "reopen" : "complete"}`, { method: "POST" }).catch(fail); viewTasks(main); } }, icon("check")),
    h("span", { class: `prio ${t.priority}`, title: `Priorität: ${t.priority}` }),
    h("div", { class: "main" }, h("div", { class: "title" }, t.title),
      (t.due || t.project || t.notes) ? h("div", { class: "meta" },
        t.due ? h("span", { class: t.status === "open" && t.due.slice(0, 10) < today ? "over" : "" }, new Date(t.due).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })) : null,
        t.project ? h("span", {}, `# ${t.project}`) : null, t.notes ? h("span", {}, t.notes) : null) : null),
    h("button", { class: "btn ghost icon sm del", "aria-label": "Löschen", onclick: async () => { await api(`/api/tasks/${t.id}`, { method: "DELETE" }).catch(fail); viewTasks(main); } }, icon("trash")));

  set(main, h("div", { class: "view" },
    viewHead("Aufgaben", `${open.length} offen`, h("button", { class: "btn", onclick: () => startChat("Was sollte ich heute erledigen? Berücksichtige Termine und Deadlines.") }, icon("bolt"), "Was zuerst?")),
    form,
    open.length === 0 && !tasks.length ? h("div", { class: "empty" }, "Keine Aufgaben. Sag JARVIS einfach „Erinnere mich an …“ oder lege oben eine an.") : null,
    groups.filter(([, list]) => list.length).map(([name, list]) =>
      h("div", {}, h("div", { class: "section-title" }, name, h("span", { class: "badge" }, list.length)), h("div", { class: "card" }, list.map(taskRow)))),
    h("div", { class: "section-title" }, icon("bell2"), "Erinnerungen"),
    h("div", { class: "card" }, reminders.length ? reminders.map((r) =>
      h("div", { class: "task" }, icon("clock"),
        h("div", { class: "main" }, h("div", { class: "title" }, r.text), h("div", { class: "meta" }, fmt.dt(r.remindAt))),
        h("span", { class: `badge ${r.status === "scheduled" ? "accent" : ""}` }, { scheduled: "geplant", fired: "erinnert", cancelled: "storniert" }[r.status]),
        r.status === "scheduled" ? h("button", { class: "btn ghost icon sm", "aria-label": "Stornieren", onclick: async () => { await api(`/api/reminders/${r.id}`, { method: "DELETE" }).catch(fail); viewTasks(main); } }, icon("x")) : null))
      : h("div", { class: "card-body", style: "padding:18px" }, h("div", { class: "empty" }, "Keine Erinnerungen. Beispiel: „Erinnere mich morgen um 9 an den Zahnarzt.“")))));
}
