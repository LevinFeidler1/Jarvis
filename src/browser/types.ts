/** One recorded browser step. Steps are replayed deterministically when a session is not warm. */
export type BrowserStep =
  | { type: "goto"; url: string }
  | { type: "click"; ref: string; fingerprint: string }
  | { type: "type"; ref: string; fingerprint: string; text: string; submit?: boolean };

export type BrowserAction =
  | BrowserStep
  | { type: "snapshot" }
  | { type: "screenshot" }
  | { type: "download"; url?: string; ref?: string; fingerprint?: string };

export interface PageElement {
  ref: string;
  tag: string;
  type: string | null;
  role: string | null;
  /** Visible label (text, aria-label, placeholder, value of buttons). */
  text: string;
  name: string | null;
  href: string | null;
  autocomplete: string | null;
  inForm: boolean;
  /** Heuristics for the permission engine. */
  formIsSearch: boolean;
  formHasPassword: boolean;
  formHasPayment: boolean;
}

export interface PageState {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
}

export interface BrowserRunRequest {
  taskId: string;
  steps: BrowserStep[];
  action: BrowserAction;
}

export interface BrowserRunResult {
  ok: boolean;
  error?: string;
  state?: PageState;
  /** JPEG, base64 (screenshot action). */
  screenshot?: string;
  download?: { name: string; mime: string; base64: string };
  /** The fingerprint of an element the action used (stored for replays). */
  fingerprint?: string;
}

export interface BrowserEngine {
  readonly kind: "local" | "remote";
  run(req: BrowserRunRequest): Promise<BrowserRunResult>;
}

export const fingerprintOf = (e: Pick<PageElement, "tag" | "type" | "text" | "name">) =>
  `${e.tag}|${e.type ?? ""}|${e.name ?? ""}|${e.text.slice(0, 60)}`;
