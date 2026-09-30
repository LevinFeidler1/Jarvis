// JARVIS Web-UI. No framework, no inline HTML from data: everything user- or
// provider-supplied is rendered via textContent (XSS-safe).

const state = { csrf: null, conversationId: null, weekOffset: 0 };
const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-jarvis-csrf"] = state.csrf ?? "";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  if (res.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("Nicht angemeldet");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

const RISK = ["Lesen", "Niedrig", "Extern", "Kritisch"];
const STATUS = {
  planned: "geplant", executing: "läuft", succeeded: "erfolgreich", failed: "fehlgeschlagen",
  partially_succeeded: "teilweise erfolgreich", awaiting_confirmation: "wartet auf Bestätigung",
  rejected: "abgelehnt", expired: "abgelaufen", denied: "verweigert",
};
const fmtDateTime = (iso) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

// ─── Auth ──────────────────────────────────────────────────────────────────
function showLogin() {
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#token").focus();
}

async function boot() {
  const s = await api("/api/session");
  if (!s.authenticated) return showLogin();
  state.csrf = s.csrfToken;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await loadConversations();
  await refreshSetupBanner();
  const hash = location.hash.replace("#", "").split("?")[0];
  show(hash || "chat");
  pollBadges();
  setInterval(pollBadges, 30_000);
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try {
    const r = await api("/api/login", { method: "POST", body: { token: $("#token").value } });
    state.csrf = r.csrfToken;
    $("#token").value = "";
    boot();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

// ─── Navigation ────────────────────────────────────────────────────────────
const loaders = {
  chat: () => {},
  activity: loadActivity,
  calendar: loadCalendar,
  email: loadEmail,
  tasks: loadTasks,
  memory: loadMemory,
  settings: loadSettings,
};

function show(view) {
  if (!loaders[view]) view = "chat";
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".nav[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (!location.hash.startsWith(`#${view}`)) history.replaceState(null, "", `#${view}`);
  Promise.resolve(loaders[view]()).catch((err) => console.error(err));
}
document.querySelectorAll(".nav[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
document.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", () => loaders[b.dataset.refresh]()));

// ─── Chat ──────────────────────────────────────────────────────────────────
function addMessage(role, text, actions = []) {
  const node = el("div", { class: `msg ${role}` }, text);
  if (actions.length) {
    node.append(
      el("div", { class: "actions" }, actions.map((a) => el("span", { class: `pill ${a.status}`, title: a.error ?? a.description }, `${a.toolName}: ${STATUS[a.status] ?? a.status}`))),
    );
  }
  $("#messages").append(node);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return node;
}

function renderPending(list) {
  const box = $("#pending");
  box.replaceChildren();
  for (const p of list ?? []) box.append(confirmCard(p, (reply) => handleReply(reply)));
}

function confirmCard(p, onDone) {
  const card = el(
    "div",
    { class: `confirm-card ${p.risk >= 3 ? "r3" : ""}` },
    el("div", {}, el("strong", {}, "Bestätigung erforderlich "), el("span", { class: `risk risk-${p.risk}` }, `Stufe ${p.risk} · ${RISK[p.risk]}`)),
    el("div", { class: "desc" }, p.description),
    p.reasons?.length ? el("ul", { class: "reasons" }, p.reasons.map((r) => el("li", {}, r))) : null,
    el("div", { class: "muted" }, `Aktion: ${p.toolName} · gültig bis ${fmtTime(p.expiresAt)}`),
  );
  const buttons = el("div", { class: "buttons" });
  const decide = async (approve) => {
    buttons.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const reply = await api(`/api/confirmations/${p.id}`, { method: "POST", body: { approve } });
      onDone?.(reply);
    } catch (err) {
      alert(err.message);
      buttons.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  buttons.append(el("button", { class: "ok", onclick: () => decide(true) }, "Bestätigen & ausführen"), el("button", { class: "danger", onclick: () => decide(false) }, "Ablehnen"));
  card.append(buttons);
  return card;
}

function handleReply(reply) {
  if (!reply) return;
  if (state.conversationId !== reply.conversationId) {
    state.conversationId = reply.conversationId;
    loadConversations();
  }
  addMessage("assistant", reply.text, reply.actions);
  renderPending(reply.pendingActions);
  $("#security-banner").classList.toggle("hidden", !reply.securityWarning);
  pollBadges();
}

async function send(text) {
  if (!text.trim()) return;
  addMessage("user", text);
  const thinking = addMessage("assistant thinking", "…");
  $("#send-btn").disabled = true;
  try {
    const reply = await api("/api/chat", { method: "POST", body: { conversationId: state.conversationId ?? undefined, message: text } });
    thinking.remove();
    handleReply(reply);
  } catch (err) {
    thinking.remove();
    addMessage("assistant", `Fehler: ${err.message}`);
  } finally {
    $("#send-btn").disabled = false;
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chat-input").value;
  $("#chat-input").value = "";
  send(text);
});
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
document.querySelectorAll("#suggestions .chip").forEach((c) => c.addEventListener("click", () => send(c.textContent)));

async function loadConversations() {
  const list = await api("/api/conversations");
  const sel = $("#conv-select");
  sel.replaceChildren(el("option", { value: "" }, "— neue Unterhaltung —"), ...list.map((c) => el("option", { value: c.id, selected: c.id === state.conversationId }, c.title ?? "(ohne Titel)")));
}

$("#conv-select").addEventListener("change", async (e) => {
  state.conversationId = e.target.value || null;
  $("#messages").replaceChildren();
  renderPending([]);
  $("#security-banner").classList.add("hidden");
  if (!state.conversationId) return;
  const data = await api(`/api/conversations/${state.conversationId}/messages`);
  for (const m of data.messages) addMessage(m.role, m.text);
  renderPending(data.pendingActions);
  $("#security-banner").classList.toggle("hidden", !data.conversation.tainted);
});

$("#new-conv").addEventListener("click", () => {
  state.conversationId = null;
  $("#messages").replaceChildren();
  renderPending([]);
  $("#security-banner").classList.add("hidden");
  loadConversations();
});

async function refreshSetupBanner() {
  const setup = await api("/api/setup");
  const banner = $("#setup-banner");
  if (setup.complete) return banner.classList.add("hidden");
  banner.replaceChildren(
    el("strong", {}, "Willkommen bei JARVIS. "),
    el("span", {}, "Ein paar Schritte fehlen noch:"),
    el("ol", {}, setup.steps.map((s) => el("li", { class: s.done ? "done" : "" }, `${s.done ? "✓" : "○"} ${s.title}`, s.done ? "" : el("span", { class: "muted" }, ` — ${s.hint}`)))),
    el("button", { class: "ghost", onclick: () => show("settings") }, "Zu den Einstellungen"),
  );
  banner.classList.remove("hidden");
}

// ─── Activity ──────────────────────────────────────────────────────────────
async function loadActivity() {
  const [pending, activity, audit] = await Promise.all([api("/api/confirmations"), api("/api/activity"), api("/api/audit")]);
  $("#activity-pending").replaceChildren(...(pending.length ? pending.map((p) => confirmCard(p, (reply) => { loadActivity(); if (reply.conversationId === state.conversationId) handleReply(reply); })) : [el("div", { class: "empty" }, "Keine offenen Bestätigungen.")]));
  $("#activity-list").replaceChildren(
    ...(activity.length
      ? activity.map((a) =>
          el("div", { class: "item" },
            el("div", { class: "main" }, el("div", { class: "title" }, a.description.split("\n")[0]), el("div", { class: "sub" }, `${fmtDateTime(a.createdAt)} · ${a.toolName}${a.error ? ` · ${a.error}` : ""}`)),
            el("span", { class: `risk risk-${a.risk}` }, RISK[a.risk]),
            el("span", { class: `pill ${a.status}` }, STATUS[a.status] ?? a.status)))
      : [el("div", { class: "empty" }, "Noch keine Aktivität.")]),
  );
  $("#audit-list").replaceChildren(
    ...(audit.length
      ? audit.map((a) => el("div", { class: "item" }, `${a.ts.replace("T", " ").slice(0, 16)}  ACTION: ${a.action}  ${a.target ? `TARGET: ${a.target}  ` : ""}STATUS: ${a.status}  USER_CONFIRMATION: ${a.userConfirmation ? "YES" : "NO"}  RISK: ${a.risk}`))
      : [el("div", { class: "empty" }, "Audit-Log ist leer.")]),
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────────
function weekStart(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
async function loadCalendar() {
  const start = weekStart(state.weekOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  $("#cal-range").textContent = `${start.toLocaleDateString("de-DE")} – ${new Date(end - 1).toLocaleDateString("de-DE")}`;
  const body = $("#calendar-body");
  try {
    const events = await api(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = d.toDateString();
      const evs = events.filter((e) => new Date(e.allDay ? `${e.start}T00:00` : e.start).toDateString() === key);
      days.push(
        el("div", { class: `day ${key === new Date().toDateString() ? "today" : ""}` },
          el("h4", {}, d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })),
          evs.map((e) => el("div", { class: "ev" }, el("div", { class: "t" }, e.allDay ? "ganztägig" : `${fmtTime(e.start)}–${fmtTime(e.end)}`), e.title))),
      );
    }
    body.replaceChildren(...days);
  } catch (err) {
    body.replaceChildren(el("div", { class: "empty" }, err.message));
  }
}
$("#cal-prev").addEventListener("click", () => { state.weekOffset--; loadCalendar(); });
$("#cal-next").addEventListener("click", () => { state.weekOffset++; loadCalendar(); });

// ─── Email ─────────────────────────────────────────────────────────────────
async function loadEmail() {
  const list = $("#email-list");
  try {
    const mails = await api(`/api/email${$("#email-unread").checked ? "?unread=true" : ""}`);
    list.replaceChildren(
      ...(mails.length
        ? mails.map((m) =>
            el("div", { class: `item ${m.unread ? "unread" : ""}` },
              el("div", { class: "main" },
                el("div", { class: "title" }, m.subject),
                el("div", { class: "sub" }, `${m.from.name ?? m.from.email} · ${fmtDateTime(m.date)} · ${m.snippet}`))))
        : [el("div", { class: "empty" }, "Keine E-Mails.")]),
    );
  } catch (err) {
    list.replaceChildren(el("div", { class: "empty" }, err.message));
  }
}
$("#email-unread").addEventListener("change", loadEmail);

// ─── Tasks ─────────────────────────────────────────────────────────────────
async function loadTasks() {
  const [tasks, reminders] = await Promise.all([api("/api/tasks"), api("/api/reminders")]);
  $("#task-list").replaceChildren(
    ...(tasks.length
      ? tasks.map((t) =>
          el("div", { class: `item ${t.status === "done" ? "done" : ""}` },
            el("div", { class: "main" },
              el("div", { class: "title" }, t.priority === "high" ? el("span", { class: "prio-high" }, "! ") : "", t.title),
              el("div", { class: "sub" }, [t.due ? `fällig ${t.due.slice(0, 10)}` : null, t.project, t.notes].filter(Boolean).join(" · "))),
            el("div", { class: "controls" },
              t.status === "open" ? el("button", { class: "ghost", onclick: async () => { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); loadTasks(); } }, "Erledigt") : null,
              el("button", { class: "ghost", onclick: async () => { await api(`/api/tasks/${t.id}`, { method: "DELETE" }); loadTasks(); } }, "Löschen"))))
      : [el("div", { class: "empty" }, "Keine Aufgaben.")]),
  );
  $("#reminder-list").replaceChildren(
    ...(reminders.length
      ? reminders.map((r) => el("div", { class: "item" }, el("div", { class: "main" }, el("div", { class: "title" }, r.text), el("div", { class: "sub" }, fmtDateTime(r.remindAt))), el("span", { class: "pill" }, r.status)))
      : [el("div", { class: "empty" }, "Keine Erinnerungen.")]),
  );
}
$("#task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/tasks", { method: "POST", body: { title: $("#task-title").value, due: $("#task-due").value || undefined, priority: $("#task-prio").value } });
  e.target.reset();
  loadTasks();
});

// ─── Memory ────────────────────────────────────────────────────────────────
const CAT = { preference: "Präferenz", person: "Person", project: "Projekt", rule: "Regel", fact: "Fakt" };
async function loadMemory() {
  const entries = await api("/api/memory");
  $("#memory-list").replaceChildren(
    ...(entries.length
      ? entries.map((m) =>
          el("div", { class: "item" },
            el("div", { class: "main" },
              el("div", { class: "title" }, `${m.key}: ${m.value}`),
              el("div", { class: "sub" }, `${CAT[m.category]} · ${m.source === "user" ? "von dir" : `abgeleitet (${Math.round(m.confidence * 100)} %)`} · ${fmtDateTime(m.updatedAt)}`)),
            el("div", { class: "controls" },
              el("button", { class: "ghost", onclick: async () => { const v = prompt("Neuer Wert", m.value); if (v) { await api(`/api/memory/${m.id}`, { method: "PATCH", body: { value: v } }); loadMemory(); } } }, m.source === "user" ? "Ändern" : "Bestätigen/Ändern"),
              el("button", { class: "ghost", onclick: async () => { await api(`/api/memory/${m.id}`, { method: "DELETE" }); loadMemory(); } }, "Löschen"))))
      : [el("div", { class: "empty" }, "Noch nichts gespeichert. Tipp: Arbeitszeiten, bevorzugte Meetingdauer, Puffer zwischen Terminen, E-Mail-Signatur.")]),
  );
}
$("#memory-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/memory", { method: "POST", body: { category: $("#mem-cat").value, key: $("#mem-key").value, value: $("#mem-value").value } });
  e.target.reset();
  loadMemory();
  refreshSetupBanner();
});

// ─── Settings ──────────────────────────────────────────────────────────────
const CATS = { email: "E-Mail (Labels, gelesen, Entwürfe, archivieren)", calendar: "Kalender (Termine ohne Gäste)", contacts: "Kontakte anlegen/ändern", tasks: "Aufgaben", reminders: "Erinnerungen & Benachrichtigungen", memory: "Gedächtnis" };
async function loadSettings() {
  const flash = new URLSearchParams(location.hash.split("?")[1] ?? "").get("google");
  $("#settings-flash").classList.toggle("hidden", !flash);
  if (flash) $("#settings-flash").textContent = flash === "connected" ? "Google wurde verbunden." : `Google-Verbindung fehlgeschlagen: ${flash}`;

  const [setup, integrations, perms, status] = await Promise.all([api("/api/setup"), api("/api/integrations"), api("/api/settings/permissions"), api("/api/status")]);
  $("#setup-steps").replaceChildren(...setup.steps.map((s, i) => el("div", { class: "item" }, el("div", { class: "main" }, el("div", { class: "title" }, `Schritt ${i + 1} — ${s.title}`), el("div", { class: "sub" }, s.hint)), el("span", { class: s.done ? "state-connected" : "state-not_configured" }, s.done ? "✓ erledigt" : "offen"))));

  $("#integrations").replaceChildren(
    ...integrations.map((i) => {
      const controls = el("div", { class: "controls" });
      if (i.id === "google" && i.state === "not_configured") controls.append(el("button", { class: "primary", onclick: () => (location.href = "/api/integrations/google/connect") }, "Verbinden"));
      if (i.id === "google" && i.state === "connected")
        controls.append(el("button", { class: "danger", onclick: async () => { if (confirm("Google-Verbindung trennen und Zugriff widerrufen?")) { await api("/api/integrations/google/disconnect", { method: "POST" }); loadSettings(); } } }, "Trennen"));
      return el("div", { class: "item" }, el("div", { class: "main" }, el("div", { class: "title" }, i.name, i.account ? el("span", { class: "muted" }, ` · ${i.account}`) : ""), el("div", { class: "sub" }, i.detail)), el("span", { class: `state-${i.state}` }, { connected: "verbunden", not_configured: "nicht verbunden", credentials_missing: "nicht konfiguriert", planned: "geplant" }[i.state]), controls);
    }),
  );

  const settings = perms.settings;
  const save = async () => {
    await api("/api/settings/permissions", { method: "PUT", body: settings });
    refreshSetupBanner();
  };
  $("#perm-categories").replaceChildren(
    ...Object.entries(CATS).map(([cat, label]) => {
      const cb = el("input", { type: "checkbox", checked: settings.autoApproveLowRisk[cat] ?? false });
      cb.addEventListener("change", () => { settings.autoApproveLowRisk[cat] = cb.checked; save(); });
      return el("label", { class: "item" }, el("div", { class: "main" }, el("div", { class: "title" }, label), el("div", { class: "sub" }, cb.checked ? "Stufe 1 automatisch ausführen" : "Stufe 1 nur mit Bestätigung")), cb);
    }),
  );
  $("#perm-tools").replaceChildren(
    ...perms.tools.map((t) => {
      const cb = el("input", { type: "checkbox", checked: !settings.disabledTools.includes(t.name) });
      cb.addEventListener("change", () => {
        settings.disabledTools = cb.checked ? settings.disabledTools.filter((n) => n !== t.name) : [...settings.disabledTools, t.name];
        save();
      });
      return el("label", { class: "item" }, el("div", { class: "main" }, el("div", { class: "title mono" }, t.name), el("div", { class: "sub" }, t.description)), el("span", { class: `risk risk-${t.risk}` }, `Stufe ${t.risk} · ${t.riskLabel}`), cb);
    }),
  );
  $("#system-info").replaceChildren(el("div", { class: "item" }, `Modell: ${status.model} · ${status.llmConfigured ? "konfiguriert" : "nicht konfiguriert"} · Zeitzone: ${status.timezone}`));
}

// ─── Notifications & badges ────────────────────────────────────────────────
async function pollBadges() {
  try {
    const [pending, notifs] = await Promise.all([api("/api/confirmations"), api("/api/notifications")]);
    const unread = notifs.filter((n) => !n.read);
    $("#badge-confirm").textContent = pending.length;
    $("#badge-confirm").classList.toggle("hidden", pending.length === 0);
    $("#badge-notif").textContent = unread.length;
    $("#badge-notif").classList.toggle("hidden", unread.length === 0);
    $("#notif-list").replaceChildren(
      ...(notifs.length
        ? notifs.map((n) =>
            el("div", { class: `item ${n.read ? "" : "unread"}` },
              el("div", { class: "main" }, el("div", { class: "title" }, n.title), el("div", { class: "sub" }, `${n.body ?? ""} · ${fmtDateTime(n.createdAt)}`)),
              n.read ? null : el("button", { class: "ghost", onclick: async () => { await api(`/api/notifications/${n.id}/read`, { method: "POST" }); pollBadges(); } }, "✓")))
        : [el("div", { class: "empty" }, "Keine Benachrichtigungen.")]),
    );
  } catch {
    /* ignore */
  }
}
$("#notif-btn").addEventListener("click", () => $("#notif-panel").classList.toggle("hidden"));
$("#notif-close").addEventListener("click", () => $("#notif-panel").classList.add("hidden"));

boot().catch((err) => console.error(err));
