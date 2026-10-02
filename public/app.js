// JARVIS Web-UI — no framework, no build step. Entry point: the modules live in
// public/app/ (one per area), plain ES modules served as they are.
// Security: all data from the server/providers is rendered via textContent or
// DOM nodes (never innerHTML). Only the static icon markup in dom.js uses innerHTML.

import { state } from "./app/api.js";
import { $ } from "./app/dom.js";
import { boot, go, registerViews } from "./app/shell.js";
import { viewActivity } from "./app/view-activity.js";
import { viewAutomations } from "./app/view-automations.js";
import { viewCalendar } from "./app/view-calendar.js";
import { viewChat } from "./app/view-chat.js";
import { viewContacts } from "./app/view-contacts.js";
import { viewEmail } from "./app/view-email.js";
import { viewFiles } from "./app/view-files.js";
import { viewFinance } from "./app/view-finance.js";
import { viewJarvis } from "./app/view-home.js";
import { viewMemory } from "./app/view-memory.js";
import { viewNotes } from "./app/view-notes.js";
import { viewReview } from "./app/view-review.js";
import { viewSettings } from "./app/view-settings.js";
import { viewTasks } from "./app/view-tasks.js";

registerViews({ notes: viewNotes, finance: viewFinance, jarvis: viewJarvis, chat: viewChat, activity: viewActivity, calendar: viewCalendar, email: viewEmail, tasks: viewTasks, contacts: viewContacts, files: viewFiles, automations: viewAutomations, review: viewReview, memory: viewMemory, settings: viewSettings });

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "") && state.csrf) {
    e.preventDefault();
    if (state.view !== "chat") go("chat"); else $("#chat-input")?.focus();
  }
});

boot();
