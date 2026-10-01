import { RiskLevel } from "../core/types.js";
import type { PageElement } from "./types.js";

const CRITICAL_WORDS =
  /\b(kauf|kaufen|jetzt kaufen|bestell|zahlungspflichtig|bezahl|zahlung|checkout|kasse|buchen|buchung|reservier|abonnier|abo abschließen|vertrag|unterschreib|einloggen|anmelden|login|log in|sign in|registrier|konto erstellen|passwort|pay|purchase|buy|order|book now|subscribe|sign up|place order|confirm order|kostenpflichtig)/i;
const SUBMIT_WORDS = /\b(senden|absenden|abschicken|submit|send|weiter|bestätigen|confirm|speichern|save|anfragen|anfrage senden|kontakt aufnehmen|eintragen)\b/i;
const SECRET_FIELD = /(pass|pwd|kennwort|pin|tan|otp|card|karte|cvc|cvv|iban|bic|konto|ssn|steuer-?id)/i;

/**
 * Risk of interacting with a concrete element (based on the last page state).
 * Navigation and search are low risk; submitting forms reaches other people
 * (level 2); logins, payments, orders, bookings and contracts are level 3.
 */
export function elementRisk(el: PageElement | undefined, kind: "click" | "type", opts: { text?: string; submit?: boolean } = {}): { risk: RiskLevel; reasons: string[] } {
  if (!el) return { risk: RiskLevel.EXTERNAL, reasons: ["Element unbekannt — Seite wird vor der Aktion neu geprüft."] };
  const label = `${el.text} ${el.name ?? ""} ${el.href ?? ""}`;
  if (kind === "type") {
    if (el.type === "password" || (el.autocomplete ?? "").startsWith("cc-") || el.autocomplete === "one-time-code" || SECRET_FIELD.test(`${el.name ?? ""} ${el.text}`)) {
      return { risk: RiskLevel.CRITICAL, reasons: ["Eingabe in ein Passwort-, Zahlungs- oder Sicherheitsfeld."] };
    }
    if (opts.submit) return submitRisk(el, label);
    return { risk: RiskLevel.LOW, reasons: [] };
  }
  if (CRITICAL_WORDS.test(label)) return { risk: RiskLevel.CRITICAL, reasons: [`Klick auf „${el.text || el.tag}“ kann einen Kauf, eine Buchung, einen Vertrag oder eine Anmeldung auslösen.`] };
  const isSubmit = (el.tag === "button" && (el.type === null || el.type === "submit") && el.inForm) || (el.tag === "input" && (el.type === "submit" || el.type === "image"));
  if (isSubmit || (el.inForm && SUBMIT_WORDS.test(label))) return submitRisk(el, label);
  return { risk: RiskLevel.LOW, reasons: [] };
}

function submitRisk(el: PageElement, label: string): { risk: RiskLevel; reasons: string[] } {
  if (el.formHasPassword || el.formHasPayment || CRITICAL_WORDS.test(label)) {
    return { risk: RiskLevel.CRITICAL, reasons: ["Formular mit Anmelde- oder Zahlungsdaten wird abgeschickt."] };
  }
  if (el.formIsSearch) return { risk: RiskLevel.LOW, reasons: [] };
  return { risk: RiskLevel.EXTERNAL, reasons: ["Formular wird abgeschickt — Daten gehen an die Website."] };
}
