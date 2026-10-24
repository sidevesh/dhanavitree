import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DB_PATH = path.resolve("data/db.json");

const empty = { leads: {}, quotes: {}, events: [] };
let db = empty;
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
} catch {
  db = structuredClone(empty);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }, 200);
}

export const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

// Append-only audit trail: this is the proof of users, approvals and payments for the judges.
export function logEvent(actor, type, leadId, payload = {}) {
  const event = { ts: new Date().toISOString(), actor, type, lead_id: leadId ?? null, payload };
  db.events.push(event);
  save();
  console.log(`[event] ${event.ts} ${actor} ${type} ${leadId ?? ""}`);
  return event;
}

export function getLead(leadId) {
  return db.leads[leadId];
}

export function createLead(businessId) {
  const lead = {
    id: id("lead"),
    business_id: businessId,
    stage: "NEW",
    fields: {},
    messages: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.leads[lead.id] = lead;
  save();
  return lead;
}

export function updateLead(lead, patch = {}) {
  Object.assign(lead, patch, { updated_at: new Date().toISOString() });
  save();
  return lead;
}

export function addMessage(lead, role, text) {
  lead.messages.push({ role, text, ts: new Date().toISOString() });
  lead.updated_at = new Date().toISOString();
  save();
}

export function createQuote(quote) {
  const q = { id: id("q"), created_at: new Date().toISOString(), ...quote };
  db.quotes[q.id] = q;
  save();
  return q;
}

export function getQuote(quoteId) {
  return db.quotes[quoteId];
}

export function updateQuote(quote, patch) {
  Object.assign(quote, patch, { updated_at: new Date().toISOString() });
  save();
  return quote;
}

export const allLeads = () => Object.values(db.leads);
export const allQuotes = () => Object.values(db.quotes);
export const allEvents = () => db.events;
export const exportAll = () => db;
