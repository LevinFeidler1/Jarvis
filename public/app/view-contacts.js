// Contacts view.

import { api } from "./api.js";
import { avatar, h, icon, set } from "./dom.js";
import { viewHead } from "./shell.js";
import { dialog, fail, toast } from "./ui.js";

// ─── View: Kontakte ─────────────────────────────────────────────────────────
const splitList = (v) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

function contactEditor(c) {
  return new Promise((resolve) => {
    const f = {
      name: h("input", { class: "field", id: "ct-name", maxlength: 200, required: true, placeholder: "Vor- und Nachname", value: c?.name ?? "" }),
      emails: h("input", { class: "field", id: "ct-emails", placeholder: "anna@example.com, …", value: (c?.emails ?? []).join(", ") }),
      phones: h("input", { class: "field", id: "ct-phones", type: "tel", placeholder: "+49 170 …", value: (c?.phones ?? []).join(", ") }),
      organization: h("input", { class: "field", id: "ct-org", maxlength: 200, placeholder: "Firma", value: c?.organization ?? "" }),
      role: h("input", { class: "field", id: "ct-role", maxlength: 200, placeholder: "Rolle, z.B. Geschäftsführerin", value: c?.role ?? "" }),
      notes: h("textarea", { class: "field", id: "ct-notes", rows: 3, maxlength: 2000, style: "height:auto;padding:10px 12px", placeholder: "Notizen (z.B. „duzen“, „bevorzugt WhatsApp“)" }, c?.notes ?? ""),
    };
    const err = h("div", { class: "error-text" });
    const close = (v) => { wrap.remove(); resolve(v); };
    const label = (text, forId) => h("label", { class: "small muted", for: forId }, text);
    const form = h("form", { class: "modal contact-modal", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const body = {
        name: f.name.value.trim(), emails: splitList(f.emails.value), phones: splitList(f.phones.value),
        organization: f.organization.value.trim(), role: f.role.value.trim(), notes: f.notes.value.trim(),
      };
      const bad = body.emails.find((m) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m));
      if (bad) { err.textContent = `Ungültige E-Mail-Adresse: ${bad}`; return; }
      try {
        const saved = c ? await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "PATCH", body }) : await api("/api/contacts", { method: "POST", body });
        close(saved);
      } catch (ex) { err.textContent = ex.message; }
    } },
      h("h3", {}, c ? "Kontakt bearbeiten" : "Neuer Kontakt"),
      label("Name", "ct-name"), f.name,
      label("E-Mail-Adressen (mehrere mit Komma)", "ct-emails"), f.emails,
      label("Telefonnummern", "ct-phones"), f.phones,
      h("div", { class: "grid2" }, f.organization, f.role),
      label("Notizen", "ct-notes"), f.notes,
      err,
      h("div", { class: "foot" },
        h("button", { class: "btn ghost", type: "button", onclick: () => close(null) }, "Abbrechen"),
        h("button", { class: "btn primary", type: "submit" }, "Speichern")));
    const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close(null) }, form);
    wrap.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(wrap);
    f.name.focus();
  });
}

export async function viewContacts(main) {
  const data = await api("/api/contacts");
  const contacts = data.contacts;
  const reload = () => viewContacts(main);

  const row = (c) => h("div", { class: "integration contact-row" },
    avatar(c.name),
    h("div", { class: "main" },
      h("div", { class: "title" }, c.name, c.source !== "jarvis" ? h("span", { class: "badge", style: "margin-left:8px" }, c.source === "other" ? "aus E-Mails" : "Google") : null),
      h("div", { class: "sub" }, [c.role, c.organization].filter(Boolean).join(" · ") || null),
      h("div", { class: "sub contact-links" },
        c.emails.map((m) => h("a", { href: `mailto:${m}` }, icon("mail"), m)),
        c.phones.map((p) => h("a", { href: `tel:${p.replace(/[^\d+]/g, "")}` }, icon("phone"), p))),
      c.notes ? h("div", { class: "sub" }, c.notes) : null),
    c.source === "jarvis" ? h("div", { class: "actions" },
      h("button", { class: "btn ghost icon sm", "aria-label": `${c.name} bearbeiten`, onclick: async () => { if (await contactEditor(c)) { toast("Gespeichert.", "ok"); reload(); } } }, icon("edit")),
      h("button", { class: "btn ghost icon sm", "aria-label": `${c.name} löschen`, onclick: async () => {
        if (!(await dialog({ title: `${c.name} löschen?`, text: "Der Kontakt wird aus JARVIS entfernt.", confirmLabel: "Löschen", danger: true }))) return;
        await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "DELETE" }).catch(fail); reload();
      } }, icon("trash"))) : null);

  const listBox = h("div", {});
  const googleBox = h("div", {});
  const renderList = (q) => {
    const needle = q.trim().toLowerCase();
    const hits = needle ? contacts.filter((c) => [c.name, c.organization, c.role, ...c.emails, ...c.phones].filter(Boolean).join(" ").toLowerCase().includes(needle)) : contacts;
    set(listBox, hits.length
      ? h("div", { class: "card" }, hits.map(row))
      : h("div", { class: "empty" }, contacts.length ? "Keine Treffer in deinen JARVIS-Kontakten." : "Noch keine Kontakte. Lege oben einen an, importiere eine .vcf-Datei oder sag JARVIS: „Speichere Anna Schmidt, anna@example.com“."));
  };
  let timer;
  const search = h("input", { class: "field", type: "search", placeholder: data.google ? "Suchen (auch in Google Kontakte) …" : "Kontakte durchsuchen …", "aria-label": "Kontakte durchsuchen",
    oninput: () => {
      renderList(search.value);
      clearTimeout(timer);
      set(googleBox);
      if (!data.google || search.value.trim().length < 2) return;
      timer = setTimeout(async () => {
        try {
          const r = await api(`/api/contacts?q=${encodeURIComponent(search.value.trim())}`);
          const remote = r.contacts.filter((c) => c.source !== "jarvis");
          set(googleBox,
            r.warning ? h("div", { class: "muted small" }, r.warning) : null,
            remote.length ? [h("div", { class: "section-title" }, "Aus Google Kontakte", h("span", { class: "badge" }, remote.length)), h("div", { class: "card" }, remote.map(row))] : null);
        } catch (e) { set(googleBox, h("div", { class: "muted small" }, e.message)); }
      }, 300);
    } });

  const file = h("input", { type: "file", accept: ".vcf,text/vcard,text/x-vcard", hidden: true, onchange: async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { toast("Datei zu groß (max. 4 MB).", "err"); return; }
    try {
      const r = await api("/api/contacts/import", { method: "POST", body: { vcf: await f.text() } });
      toast(`${r.imported} Kontakte importiert${r.skipped ? `, ${r.skipped} übersprungen (schon vorhanden)` : ""}.`, "ok");
      reload();
    } catch (e) { fail(e); } finally { file.value = ""; }
  } });

  set(main, h("div", { class: "view" },
    viewHead("Kontakte",
      `${contacts.length} in JARVIS${data.google ? " · Google Kontakte verbunden" : ""}`,
      h("button", { class: "btn", onclick: () => file.click() }, icon("upload"), h("span", {}, "Importieren")),
      contacts.length ? h("a", { class: "btn", href: "/api/contacts/export", download: "jarvis-kontakte.vcf" }, icon("download"), h("span", {}, "Exportieren")) : null,
      h("button", { class: "btn primary", onclick: async () => { if (await contactEditor(null)) { toast("Kontakt gespeichert.", "ok"); reload(); } } }, icon("plus"), h("span", {}, "Neuer Kontakt")),
      file),
    h("div", { class: "card", style: "padding:12px" }, search),
    listBox,
    googleBox,
    h("div", { class: "muted small", style: "margin-top:4px" },
      "Import: vCard-Datei (.vcf) vom iPhone (iCloud.com → Kontakte → Exportieren), Android, Outlook oder 1&1. ",
      data.google ? "Google-Kontakte werden bei der Suche automatisch mit durchsucht." : "Google Kontakte ist optional — JARVIS nutzt diese Kontakte auch ohne Google.")));
  renderList("");
}
