// E-mail view.

import { api, state } from "./api.js";
import { avatar, fmt, h, icon, set } from "./dom.js";
import { notConfigured, viewHead } from "./shell.js";
import { startChat } from "./view-chat.js";

// ─── View: E-Mail ───────────────────────────────────────────────────────────
export async function viewEmail(main) {
  const head = viewHead("E-Mail", "Posteingang",
    h("button", { class: `chip ${state.mailUnread ? "active" : ""}`, onclick: () => { state.mailUnread = !state.mailUnread; viewEmail(main); } }, "Nur ungelesen"),
    h("button", { class: "btn", onclick: () => startChat("Sortiere mein Postfach: Was ist wichtig, was braucht eine Antwort, was ist Newsletter/Werbung? Schlag Aktionen vor."), "aria-label": "Mit JARVIS sortieren" }, icon("bolt"), h("span", {}, "Mit JARVIS sortieren")),
    h("button", { class: "btn ghost icon", onclick: () => viewEmail(main), "aria-label": "Aktualisieren" }, icon("refresh")));
  set(main, h("div", { class: "view" }, head, h("div", { class: "card", style: "padding:40px" }, h("div", { class: "spinner", style: "margin:auto" }))));

  let mails, failures, accountsInfo;
  try {
    const qs = new URLSearchParams();
    if (state.mailUnread) qs.set("unread", "true");
    if (state.mailAccount) qs.set("account", state.mailAccount);
    const [res, acc] = await Promise.all([api(`/api/email?${qs}`), api("/api/email-accounts")]);
    mails = res.emails;
    failures = res.failures ?? [];
    accountsInfo = [...(acc.gmail ? [acc.gmail] : []), ...acc.accounts.map((a) => a.email)];
  } catch (err) {
    set(main, h("div", { class: "view" }, head, err.status === 409 ? notConfigured("E-Mail ist noch nicht verbunden.") : h("div", { class: "empty" }, err.message)));
    return;
  }

  const reader = h("div", { class: "card reader" });
  const wrap = h("div", { class: "mail" });
  const listScroll = h("div", { class: "scroll" });
  const select = async (m, itemEl) => {
    state.mailSelected = m.id;
    listScroll.querySelectorAll(".mail-item").forEach((x) => x.classList.toggle("active", x === itemEl));
    wrap.classList.add("reading");
    set(reader, h("div", { class: "spinner", style: "margin:40px auto" }));
    try {
      const full = await api(`/api/email/${encodeURIComponent(m.id)}`);
      const from = full.from.name ? `${full.from.name} <${full.from.email}>` : full.from.email;
      set(reader, 
        h("button", { class: "btn ghost sm", style: "margin-bottom:10px", onclick: () => wrap.classList.remove("reading") }, icon("back"), "Zurück"),
        h("h2", {}, full.subject),
        h("div", { class: "meta" }, avatar(full.from.name ?? full.from.email),
          h("div", { style: "flex:1;min-width:0" }, h("div", { style: "font-weight:600" }, from), h("div", { class: "muted small" }, `an ${full.to.map((t) => t.email).join(", ")} · ${fmt.dt(full.date)}`)),
          full.listUnsubscribe ? h("span", { class: "badge" }, "Newsletter") : null),
        h("div", { class: "actions" },
          h("button", { class: "btn primary sm", onclick: () => startChat(`Hilf mir, auf die E-Mail von ${from} mit dem Betreff „${full.subject}" (ID ${full.id}) zu antworten. Entwurf: `, { send: false }) }, icon("reply"), "Mit JARVIS antworten"),
          h("button", { class: "btn sm", onclick: () => startChat(`Fasse die E-Mail „${full.subject}" (ID ${full.id}) kurz zusammen: Anliegen, ob eine Antwort nötig ist und bis wann.`) }, icon("bolt"), "Zusammenfassen")),
        full.attachments?.length ? h("div", { class: "muted small", style: "margin-bottom:12px" }, `📎 ${full.attachments.map((a) => a.filename).join(", ")}`) : null,
        h("div", { class: "body" }, full.bodyText || full.snippet));
    } catch (err) {
      set(reader, h("div", { class: "empty" }, err.message));
    }
  };
  for (const m of mails) {
    const item = h("div", { class: `mail-item ${m.unread ? "unread" : ""}`, onclick: () => select(m, item) },
      avatar(m.from.name ?? m.from.email),
      h("div", { class: "main" },
        h("div", { class: "top" }, h("div", { class: "from" }, m.from.name ?? m.from.email), h("div", { class: "date" }, fmt.rel(m.date))),
        h("div", { class: "subj" }, m.subject), h("div", { class: "snip" }, m.snippet),
        m.account && accountsInfo.length > 1 ? h("div", { class: "acct" }, m.account) : null));
    listScroll.append(item);
    if (m.id === state.mailSelected) queueMicrotask(() => select(m, item));
  }
  if (!mails.length) listScroll.append(h("div", { class: "empty", style: "margin:12px" }, "Keine E-Mails."));
  const multi = accountsInfo.length > 1;
  const accountBar = multi
    ? h("div", { class: "filters", style: "margin-bottom:12px" },
        [["", "Alle Postfächer"], ...accountsInfo.map((a) => [a, a])].map(([v, l]) =>
          h("button", { class: `chip ${(state.mailAccount ?? "") === v ? "active" : ""}`, onclick: () => { state.mailAccount = v || null; viewEmail(main); } }, l)))
    : null;
  const failBanner = failures.length
    ? h("div", { class: "banner warn", style: "max-width:none" }, icon("alert"), h("div", {}, failures.map((f) => h("div", {}, `${f.account}: ${f.error}`))))
    : null;
  reader.append(h("div", { class: "empty", style: "margin-top:20vh;border:0" }, icon("mail"), h("div", {}, "Wähle eine E-Mail aus.")));
  wrap.append(h("div", { class: "card mail-list" }, listScroll), reader);
  set(main, h("div", { class: "view" }, head, failBanner, accountBar, wrap));
}
