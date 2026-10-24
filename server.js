import "dotenv/config";
import fs from "node:fs";
import express from "express";
import {
  addMessage, allEvents, allLeads, allQuotes, createLead, exportAll, getLead, getQuote, logEvent, updateLead, updateQuote,
} from "./lib/store.js";
import { withPerPlate } from "./lib/pricing.js";
import { createPaymentLink, getPaymentLinkStatus, pineLabsConfigured } from "./lib/pinelabs.js";
import { agenticOrgConfigured, runDealDesk } from "./lib/agenticorg.js";
import { makeChat, chatProvider } from "./lib/chat.js";

// One JSON file per business in businesses/; each gets its own chat link (/?b=<id>) and owner desk.
const businesses = Object.fromEntries(
  fs.readdirSync("businesses").filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(`businesses/${f}`, "utf8"))).map((b) => [b.id, b]),
);
const DEFAULT_BIZ = process.env.DEFAULT_BUSINESS && businesses[process.env.DEFAULT_BUSINESS] ? process.env.DEFAULT_BUSINESS : Object.keys(businesses)[0];
const bizById = (id) => businesses[id] || businesses[DEFAULT_BIZ];
const bizOf = (lead) => bizById(lead.business_id);
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const OWNER_KEY = process.env.OWNER_KEY || "owner123";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ---------- Payment links ----------
async function issuePaymentLink(lead, quote) {
  const biz = bizOf(lead);
  const link = await createPaymentLink({ quote, lead, businessName: biz.name, publicUrl: PUBLIC_URL });
  updateQuote(quote, { status: "LINK_SENT", payment_link_id: link.payment_link_id, payment_link_url: link.payment_link_url, test_mode: link.test_mode });
  updateLead(lead, { stage: "LINK_SENT" });
  logEvent("system", "payment_link_created", lead.id, { quote_id: quote.id, advance: quote.advance, test_mode: link.test_mode, payment_link_id: link.payment_link_id });
  return link;
}

function markPaid(quote, source) {
  if (quote.status === "PAID") return;
  const lead = getLead(quote.lead_id);
  const biz = bizOf(lead);
  updateQuote(quote, { status: "PAID", paid_at: new Date().toISOString() });
  updateLead(lead, { stage: "CONFIRMED" });
  logEvent("system", "payment_captured", lead.id, { quote_id: quote.id, advance: quote.advance, source, test_mode: quote.test_mode });
  addMessage(lead, "assistant",
    `Payment of ₹${quote.advance} received. Your booking at ${biz.name} is confirmed: ${quote.guests} guests, ${quote.package_name}` +
    `${lead.fields.date ? `, on ${lead.fields.date}` : ""}. Balance ₹${quote.total - quote.advance} is payable on the day. See you soon!`);
}

// ---------- Deal desk (AgenticOrg) ----------
async function onNeedsApproval(lead, quote) {
  const biz = bizOf(lead);
  logEvent("system", "approval_requested", lead.id, { quote_id: quote.id, requested_per_plate: quote.per_plate, list: quote.list_per_plate });
  const run = await runDealDesk("negotiation_review", {
    business: biz.name,
    customer: lead.fields,
    package: quote.package_name,
    guests: quote.guests,
    list_price_per_plate: quote.list_per_plate,
    requested_price_per_plate: quote.per_plate,
    owner_floor_per_plate: quote.floor_per_plate,
    instructions:
      "Recommend APPROVE, COUNTER (with a price per plate between floor and list) or REJECT for the restaurant owner, " +
      "with a one-line reason and a short, warm draft reply to the customer. Never go below the floor.",
  });
  updateQuote(quote, { deal_desk: run });
  logEvent(run.source === "agenticorg" ? "agenticorg_agent" : "system", "deal_desk_recommendation", lead.id, {
    quote_id: quote.id, ok: run.ok, run_id: run.run_id, status: run.status, output: run.output, error: run.error,
  });
}

// ---------- Customer API ----------
const chats = Object.fromEntries(Object.values(businesses).map((biz) => [biz.id, makeChat({ biz, publicUrl: PUBLIC_URL, onNeedsApproval, issuePaymentLink })]));

app.post("/api/chat", async (req, res) => {
  const { lead_id, message, business_id } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: "message required" });
  let lead = lead_id && getLead(lead_id);
  if (lead && business_id && lead.business_id !== bizById(business_id).id) lead = null;
  if (!lead) {
    lead = createLead(bizById(business_id).id);
    logEvent("customer", "chat_started", lead.id);
  }
  try {
    await chats[bizOf(lead).id].reply(lead, String(message).slice(0, 2000));
    res.json({ lead_id: lead.id, messages: lead.messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ lead_id: lead.id, error: "The assistant had a problem. Please try again.", detail: String(err.message || err) });
  }
});

app.get("/api/lead/:id", (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: "not found" });
  res.json({ lead_id: lead.id, stage: lead.stage, messages: lead.messages });
});

app.get("/api/business", (req, res) => { const biz = bizById(req.query.b); res.json({ id: biz.id, name: biz.name, city: biz.city }); });

// ---------- Owner API ----------
function ownerOnly(req, res, next) {
  if ((req.query.key || req.get("x-owner-key")) !== OWNER_KEY) return res.status(401).json({ error: "bad owner key" });
  next();
}

app.get("/api/owner/state", ownerOnly, (req, res) => {
  const biz = bizById(req.query.b);
  const leads = allLeads().filter((l) => (l.business_id || DEFAULT_BIZ) === biz.id);
  const leadIds = new Set(leads.map((l) => l.id));
  const quotes = allQuotes().filter((q) => leadIds.has(q.lead_id));
  res.json({
    business: biz,
    integrations: { pine_labs: pineLabsConfigured(), agenticorg: agenticOrgConfigured() },
    businesses: Object.values(businesses).map((b) => ({ id: b.id, name: b.name })),
    leads: leads.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    quotes,
    events: allEvents().filter((e) => !e.lead_id || leadIds.has(e.lead_id)).slice(-200).reverse(),
    stats: {
      users: leads.filter((l) => l.fields.phone).length,
      quotes: quotes.length,
      paid: quotes.filter((q) => q.status === "PAID").length,
    },
  });
});

app.post("/api/owner/decide", ownerOnly, async (req, res) => {
  const { quote_id, action, per_plate } = req.body || {};
  const quote = getQuote(quote_id);
  if (!quote || quote.status !== "PENDING_APPROVAL") return res.status(400).json({ error: "quote not pending" });
  const lead = getLead(quote.lead_id);
  const biz = bizOf(lead);

  if (action === "reject") {
    updateQuote(quote, { status: "REJECTED" });
    updateLead(lead, { stage: "NEGOTIATING" });
    logEvent("owner", "approval_rejected", lead.id, { quote_id });
    addMessage(lead, "assistant",
      `${biz.owner_name} couldn't do ₹${quote.requested_per_plate}/plate, sorry. The best we can offer is the list price of ₹${quote.list_per_plate}/plate. Shall I send the payment link for that?`);
    return res.json({ ok: true });
  }

  const finalPerPlate = action === "counter" ? Math.round(Number(per_plate)) : quote.requested_per_plate;
  if (!finalPerPlate || finalPerPlate > quote.list_per_plate) return res.status(400).json({ error: "invalid price" });
  updateQuote(quote, { status: "APPROVED", ...withPerPlate(quote, biz, finalPerPlate), approved_by: "owner" });
  logEvent("owner", action === "counter" ? "approval_countered" : "approval_approved", lead.id, { quote_id, per_plate: finalPerPlate });

  try {
    const link = await issuePaymentLink(lead, quote);
    addMessage(lead, "assistant",
      (action === "counter"
        ? `${biz.owner_name} can do ₹${finalPerPlate}/plate for you. `
        : `Good news! ${biz.owner_name} approved ₹${finalPerPlate}/plate. `) +
      `Total ₹${quote.total} for ${quote.guests} guests. Pay the ₹${quote.advance} advance here to lock your date: ${link.payment_link_url}`);
    res.json({ ok: true });
  } catch (err) {
    logEvent("system", "payment_link_failed", lead.id, { quote_id, error: String(err.message || err) });
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Ask the AgenticOrg agent to draft a follow-up for a lead that went quiet.
app.post("/api/owner/followup", ownerOnly, async (req, res) => {
  const lead = getLead(req.body?.lead_id);
  if (!lead) return res.status(404).json({ error: "not found" });
  const biz = bizOf(lead);
  const quote = lead.current_quote && getQuote(lead.current_quote);
  const run = await runDealDesk("follow_up", {
    business: biz.name,
    customer: lead.fields,
    stage: lead.stage,
    quote: quote ? { package: quote.package_name, guests: quote.guests, total: quote.total, advance: quote.advance, link: quote.payment_link_url } : null,
    last_messages: lead.messages.slice(-6),
    instructions: "Draft one short, polite follow-up message to the customer to move the booking forward. No new discounts.",
  });
  updateLead(lead, { followup_draft: run });
  logEvent(run.source === "agenticorg" ? "agenticorg_agent" : "system", "followup_drafted", lead.id, { ok: run.ok, run_id: run.run_id, output: run.output, error: run.error });
  res.json(run);
});

app.post("/api/owner/send-followup", ownerOnly, (req, res) => {
  const lead = getLead(req.body?.lead_id);
  const text = String(req.body?.text || "").trim();
  if (!lead || !text) return res.status(400).json({ error: "lead and text required" });
  addMessage(lead, "assistant", text);
  logEvent("owner", "followup_sent", lead.id, { text });
  res.json({ ok: true });
});

app.get("/api/owner/export", ownerOnly, (_req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=proof-export.json");
  res.json(exportAll());
});

// ---------- Payment confirmations ----------
// Pine Labs webhook. Signature verification should be added once the webhook secret is known.
app.post("/webhooks/pinelabs", (req, res) => {
  const evt = req.body || {};
  const linkId = evt?.data?.payment_link_id;
  logEvent("pinelabs", "webhook_received", null, { event: evt.event, payment_link_id: linkId });
  const quote = allQuotes().find((q) => q.payment_link_id && q.payment_link_id === linkId);
  if (quote && /CAPTURED|PAID/i.test(`${evt.event} ${evt?.data?.status}`)) markPaid(quote, "webhook");
  res.json({ ok: true });
});

// Fallback: poll open links every 30s in case the webhook is not configured.
setInterval(async () => {
  if (!pineLabsConfigured()) return;
  for (const quote of allQuotes().filter((q) => q.status === "LINK_SENT" && !q.test_mode)) {
    try {
      const status = await getPaymentLinkStatus(quote.payment_link_id);
      if (["PAID", "CAPTURED", "PROCESSED"].includes(status)) markPaid(quote, "status_poll");
    } catch (err) {
      console.error("status poll", quote.id, err.message);
    }
  }
}, 30_000);

app.get("/paid", (req, res) => {
  const lead = getQuote(req.query.q) && getLead(getQuote(req.query.q).lead_id);
  res.redirect(lead ? `/?b=${bizOf(lead).id}&lead=${lead.id}` : "/");
});

// TEST-mode payment page, used only when Pine Labs credentials are missing.
app.get("/test-pay/:quoteId", (req, res) => {
  const quote = getQuote(req.params.quoteId);
  if (!quote || !quote.test_mode) return res.status(404).send("Not found");
  const biz = bizOf(getLead(quote.lead_id));
  res.send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<p style="background:#fff3cd;padding:8px;border-radius:6px"><b>TEST MODE</b>: Pine Labs credentials not set. No real money moves.</p>
<h2>${biz.name}</h2><p>Advance: <b>₹${quote.advance}</b> for ${quote.guests} guests (${quote.package_name})</p>
<form method=post action="/test-pay/${quote.id}"><button style="padding:12px 20px;font-size:16px">Simulate payment</button></form></body>`);
});
app.post("/test-pay/:quoteId", (req, res) => {
  const quote = getQuote(req.params.quoteId);
  if (!quote || !quote.test_mode) return res.status(404).send("Not found");
  markPaid(quote, "test_mode");
  res.redirect(`/?b=${bizOf(getLead(quote.lead_id)).id}&lead=${quote.lead_id}`);
});

app.listen(PORT, () => {
  console.log(`Party Closer running on ${PUBLIC_URL}`);
  for (const b of Object.values(businesses)) console.log(`[${b.id}] chat: ${PUBLIC_URL}/?b=${b.id}  owner: ${PUBLIC_URL}/owner.html?b=${b.id}&key=${OWNER_KEY}`);
  console.log(`Chat model: ${chatProvider()}`);
  console.log(`Pine Labs: ${pineLabsConfigured() ? "configured" : "TEST MODE"} | AgenticOrg: ${agenticOrgConfigured() ? "configured" : "NOT configured"}`);
});
