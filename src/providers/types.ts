/**
 * Provider interfaces (ARCHITECTURE.md §5). The agent core and the tools only
 * depend on these, so Gmail can be swapped for Outlook without touching them.
 */

// ─── Email ────────────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet: string;
  date: string; // ISO
  unread: boolean;
  labels: string[];
  hasAttachments: boolean;
  /** Mailbox the message belongs to (set when several accounts are connected). */
  account?: string;
}

export interface Email extends EmailSummary {
  cc: EmailAddress[];
  bodyText: string;
  messageIdHeader?: string;
  references?: string;
  listUnsubscribe?: string;
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
}

export interface ListEmailsQuery {
  /** Provider search syntax is abstracted: free text + structured filters. */
  text?: string;
  from?: string;
  unreadOnly?: boolean;
  newerThanDays?: number;
  label?: string;
  inboxOnly?: boolean;
  maxResults?: number;
  /** Restrict to one mailbox (account e-mail address). */
  account?: string;
}

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** When set, the message is sent as a reply in that thread. */
  replyToMessageId?: string;
  /** Sending mailbox (account e-mail address). Replies always use the original's mailbox. */
  fromAccount?: string;
}

export interface EmailAccountInfo {
  email: string;
  name: string;
  kind: "gmail" | "imap";
  isDefault: boolean;
}

export interface MultiListResult {
  emails: EmailSummary[];
  /** Mailboxes that could not be read (reported honestly, never hidden). */
  failures: Array<{ account: string; error: string }>;
}

export interface EmailDraft {
  id: string;
  messageId?: string;
}

export interface SendResult {
  id: string;
  threadId?: string;
}

export interface EmailProvider {
  readonly name: string;
  listEmails(query: ListEmailsQuery): Promise<EmailSummary[]>;
  readEmail(id: string): Promise<Email>;
  draftEmail(input: OutgoingEmail): Promise<EmailDraft>;
  sendEmail(input: OutgoingEmail): Promise<SendResult>;
  forwardEmail(id: string, to: string[], note?: string): Promise<SendResult>;
  modifyLabels(id: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
  markRead(id: string, read: boolean): Promise<void>;
  archive(id: string): Promise<void>;
  trash(id: string): Promise<void>;
}

// ─── Calendar ─────────────────────────────────────────────────────────────

export interface Attendee {
  email: string;
  name?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  organizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO date-time, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees: Attendee[];
  organizer?: string;
  status: "confirmed" | "tentative" | "cancelled";
  /** false = event does not block time (e.g. "free"). */
  busy: boolean;
  htmlLink?: string;
}

export interface NewEvent {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
  timezone?: string;
}

export interface CalendarProvider {
  readonly name: string;
  listEvents(q: { timeMin: string; timeMax: string; text?: string; maxResults?: number }): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent>;
  createEvent(input: NewEvent, notifyAttendees: boolean): Promise<CalendarEvent>;
  updateEvent(id: string, patch: Partial<NewEvent>, notifyAttendees: boolean): Promise<CalendarEvent>;
  deleteEvent(id: string, notifyAttendees: boolean): Promise<void>;
  respondToInvitation(id: string, response: "accepted" | "declined" | "tentative"): Promise<CalendarEvent>;
}

// ─── Contacts ─────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
  organization?: string;
  role?: string;
  notes?: string;
  /** "jarvis" = maintained in JARVIS, "contacts" = Google contact, "other" = auto-collected from past emails. */
  source: "jarvis" | "contacts" | "other";
}

export interface ContactInput {
  name: string;
  emails?: string[];
  phones?: string[];
  organization?: string;
  role?: string;
  notes?: string;
}

export interface ContactProvider {
  readonly name: string;
  searchContacts(query: string, max?: number): Promise<Contact[]>;
  getContact(id: string): Promise<Contact>;
  createContact(input: ContactInput): Promise<Contact>;
  updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact>;
}

// ─── Tasks & notifications ────────────────────────────────────────────────

export type TaskStatus = "open" | "done";
export type TaskPriority = "low" | "normal" | "high";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskProvider {
  readonly name: string;
  list(filter: { status?: TaskStatus | "all"; dueBefore?: string; project?: string }): Promise<Task[]>;
  create(input: { title: string; notes?: string; due?: string; priority?: TaskPriority; project?: string }): Promise<Task>;
  update(
    id: string,
    patch: { title?: string; notes?: string | null; due?: string | null; priority?: TaskPriority; project?: string | null },
  ): Promise<Task>;
  complete(id: string): Promise<Task>;
  delete(id: string): Promise<void>;
}

export interface Reminder {
  id: string;
  text: string;
  remindAt: string;
  status: "scheduled" | "fired" | "cancelled";
  createdAt: string;
}

export interface NotificationProvider {
  readonly name: string;
  notify(title: string, body?: string, opts?: { url?: string; tag?: string }): Promise<{ id: string; pushed?: number }>;
}
