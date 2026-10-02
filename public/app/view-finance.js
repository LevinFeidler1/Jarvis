// Finance view.

import { api } from "./api.js";
import { avatar, fmt, h, icon, set, ymd } from "./dom.js";
import { viewHead } from "./shell.js";
import { fail, toast } from "./ui.js";

// ─── View: Finanzen ─────────────────────────────────────────────────────────
const euro = (c) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const INTERVAL_LABEL = { weekly: "wöchentlich", monthly: "monatlich", quarterly: "vierteljährlich", yearly: "jährlich" };

export async function viewFinance(main) {
  const { overview: o, items } = await api("/api/finance");
  const reload = () => viewFinance(main);
  const setStatus = async (id, status) => { await api(`/api/finance/${id}`, { method: "PATCH", body: { status } }).catch(fail); reload(); };
  const scanBtn = h("button", { class: "btn", onclick: async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    set(b, h("span", { class: "spin-v" }), "Durchsuche Postfach …");
    try { const r = await api("/api/finance/scan", { method: "POST" }); toast(r.added ? `${r.added} neue Einträge gefunden.` : "Nichts Neues gefunden.", "ok"); reload(); }
    catch (err) { fail(err); b.disabled = false; set(b, icon("refresh"), "Postfach durchsuchen"); }
  } }, icon("refresh"), "Postfach durchsuchen");

  const today = ymd(new Date());
  const invoiceRow = (i) => {
    const overdue = i.dueDate && i.dueDate < today && i.status === "open";
    return h("div", { class: `fin-row ${overdue ? "overdue" : ""}` },
      avatar(i.vendor),
      h("div", { class: "main" }, h("div", { class: "title" }, i.vendor), h("div", { class: "sub" }, i.title)),
      h("div", { class: "fin-amt" }, h("b", {}, i.amountCents !== null ? euro(i.amountCents) : "–"),
        h("span", { class: `muted small ${overdue ? "err-text" : ""}` }, i.dueDate ? `${overdue ? "überfällig seit" : "fällig"} ${new Date(`${i.dueDate}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}` : i.source === "mail" ? "aus E-Mail" : "")),
      h("div", { class: "fin-actions" },
        h("button", { class: "btn sm ok", onclick: () => setStatus(i.id, "paid") }, icon("check"), "Bezahlt"),
        h("button", { class: "btn ghost icon sm", title: "Keine Rechnung / ausblenden", "aria-label": "Ausblenden", onclick: () => setStatus(i.id, "ignored") }, icon("x"))));
  };
  const amount = h("input", { class: "field", type: "number", step: "0.01", min: "0", placeholder: "Betrag €" });
  const vendor = h("input", { class: "field", placeholder: "Wer? (z.B. Vermieter, Netflix)", maxlength: "80" });
  const kind = h("select", { class: "field" }, h("option", { value: "invoice" }, "Rechnung"), h("option", { value: "subscription" }, "Abo / Fixkosten"));
  const due = h("input", { class: "field", type: "date", "aria-label": "Fällig am" });
  const paid = items.filter((i) => i.status === "paid").slice(0, 10);

  set(main, h("div", { class: "view finance-view" },
    viewHead("Finanzen", o.lastScanAt ? `Postfach zuletzt geprüft ${fmt.rel(o.lastScanAt)}` : "Rechnungen und Abos aus deinen E-Mails — automatisch erkannt", scanBtn),
    h("div", { class: "fin-tiles" },
      h("div", { class: "card fin-tile" }, h("span", { class: "l" }, "Offen"), h("b", { class: "gold-text" }, euro(o.openTotalCents)), h("span", { class: "muted small" }, `${o.openCount} Rechnung${o.openCount === 1 ? "" : "en"}`)),
      h("div", { class: `card fin-tile ${o.overdue.length ? "warn" : ""}` }, h("span", { class: "l" }, "Fällig in 7 Tagen"), h("b", {}, String(o.dueSoon.length)), h("span", { class: "muted small" }, o.overdue.length ? `${o.overdue.length} überfällig` : "nichts überfällig")),
      h("div", { class: "card fin-tile" }, h("span", { class: "l" }, "Abos & Fixkosten"), h("b", {}, euro(o.subscriptionsMonthlyCents)), h("span", { class: "muted small" }, "pro Monat")),
      h("div", { class: "card fin-tile" }, h("span", { class: "l" }, "Diesen Monat"), h("b", {}, euro(o.thisMonthCents)), h("span", { class: "muted small" }, "Rechnungen"))),
    h("div", { class: "section-title" }, icon("euro"), "Offene Rechnungen"),
    h("div", { class: "card" }, h("div", { class: "card-body" }, o.open.length ? o.open.map(invoiceRow) : h("div", { class: "empty" }, "Keine offenen Rechnungen. ", h("button", { class: "btn sm", onclick: () => scanBtn.click() }, "Postfach durchsuchen")))),
    h("div", { class: "section-title" }, icon("refresh"), "Abos & Fixkosten"),
    h("div", { class: "card" }, h("div", { class: "card-body" }, o.subscriptions.length ? o.subscriptions.map((sub) =>
      h("div", { class: "fin-row" }, avatar(sub.vendor), h("div", { class: "main" }, h("div", { class: "title" }, sub.vendor), h("div", { class: "sub" }, INTERVAL_LABEL[sub.interval] ?? "")),
        h("div", { class: "fin-amt" }, h("b", {}, sub.amountCents !== null ? euro(sub.amountCents) : "–"), sub.monthlyCents !== null && sub.interval !== "monthly" ? h("span", { class: "muted small" }, `≈ ${euro(sub.monthlyCents)} / Monat`) : null),
        h("div", { class: "fin-actions" }, h("button", { class: "btn ghost icon sm", "aria-label": "Ausblenden", onclick: () => setStatus(sub.id, "ignored") }, icon("x")))))
      : h("div", { class: "empty" }, "Keine Abos erkannt."))),
    h("div", { class: "section-title" }, icon("plus"), "Manuell erfassen"),
    h("div", { class: "card" }, h("div", { class: "card-body fin-form" }, kind, vendor, amount, due,
      h("button", { class: "btn primary", onclick: async () => {
        if (!vendor.value.trim()) return toast("Bitte angeben, an wen.", "err");
        await api("/api/finance", { method: "POST", body: { kind: kind.value, vendor: vendor.value.trim(), amountEur: amount.value ? Number(amount.value) : undefined, dueDate: due.value || undefined, interval: kind.value === "subscription" ? "monthly" : undefined } }).catch(fail);
        reload();
      } }, icon("plus"), "Hinzufügen"))),
    paid.length ? h("details", { class: "fold" }, h("summary", { class: "section-title" }, icon("check"), `Bezahlt (${paid.length})`),
      h("div", { class: "card" }, h("div", { class: "card-body" }, paid.map((i) => h("div", { class: "fin-row paid" }, avatar(i.vendor), h("div", { class: "main" }, h("div", { class: "title" }, i.vendor), h("div", { class: "sub" }, i.title)), h("div", { class: "fin-amt" }, h("b", {}, i.amountCents !== null ? euro(i.amountCents) : "–")),
        h("div", { class: "fin-actions" }, h("button", { class: "btn ghost sm", onclick: () => setStatus(i.id, "open") }, "Wieder offen"))))))) : null,
    h("p", { class: "muted small", style: "margin-top:18px" }, "JARVIS erkennt Rechnungen per Mustererkennung in Betreff und Vorschau (ohne KI, kostenlos) und erinnert 2 Tage vor Fälligkeit. Er überweist nie selbst.")));
}
