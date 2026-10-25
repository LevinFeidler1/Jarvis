// Toasts, dialogs, colour theme.

import { $, h, icon } from "./dom.js";

// ─── Toasts & dialogs ───────────────────────────────────────────────────────
export function toast(message, kind = "info") {
  let box = $(".toasts");
  if (!box) document.body.append((box = h("div", { class: "toasts", role: "status" })));
  const t = h("div", { class: `toast ${kind}` }, icon(kind === "err" ? "alert" : kind === "ok" ? "check" : "bolt"), h("span", {}, message));
  box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 6000 : 3500);
}
export const fail = (err) => toast(err?.message ?? String(err), "err");

export function dialog({ title, text, input, confirmLabel = "OK", danger = false }) {
  return new Promise((resolve) => {
    const field = input !== undefined ? h("textarea", { class: "field", rows: 3, style: "height:auto;padding:10px 12px" }, input) : null;
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = h("div", { class: "modal-wrap", onclick: (e) => e.target === wrap && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        h("h3", {}, title),
        text ? h("p", {}, text) : null,
        field,
        h("div", { class: "foot" },
          h("button", { class: "btn ghost", onclick: () => close(null) }, "Abbrechen"),
          h("button", { class: `btn ${danger ? "danger" : "primary"}`, onclick: () => close(field ? field.value : true) }, confirmLabel))));
    wrap.addEventListener("keydown", (e) => e.key === "Escape" && close(null));
    document.body.append(wrap);
    (field ?? wrap.querySelector(".btn.primary, .btn.danger")).focus();
  });
}

// ─── Theme ──────────────────────────────────────────────────────────────────
export function getTheme() { try { return localStorage.getItem("jarvis-theme") || "system"; } catch { return "system"; } }
export function applyTheme(t) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("jarvis-theme", t); } catch { /* ignore */ }
}
applyTheme(getTheme());
