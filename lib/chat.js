// Customer-facing booking assistant (Claude + tools). It talks; the tools in this file decide.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { publicProfile, checkAvailability, priceQuote } from "./pricing.js";
import { addMessage, createQuote, getQuote, logEvent, updateLead } from "./store.js";

// OpenAI is used when OPENAI_API_KEY is set; otherwise Anthropic.
const PROVIDER = process.env.OPENAI_API_KEY ? "openai" : "anthropic";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const anthropic = PROVIDER === "anthropic" ? new Anthropic() : null;
const openai = PROVIDER === "openai" ? new OpenAI() : null;
export const chatProvider = () => `${PROVIDER} (${PROVIDER === "openai" ? OPENAI_MODEL : CLAUDE_MODEL})`;

const REQUIRED = ["name", "phone", "occasion", "date", "guests"];

const tools = [
  {
    name: "get_business_profile",
    description: "Restaurant details, party packages with list prices, capacity, advance % and FAQ.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_lead",
    description:
      "Save what you have learned about the customer. Call as soon as you learn any field, and again when you learn more.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        occasion: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string" },
        guests: { type: "integer" },
        food_preference: { type: "string", description: "veg / non-veg / mixed" },
        budget_per_plate: { type: "integer" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "check_availability",
    description: "Check whether a date and guest count can be hosted.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" }, guests: { type: "integer" } },
      required: ["date"],
    },
  },
  {
    name: "create_quote",
    description:
      "Create a priced quote. Pass requested_price_per_plate only if the customer asked for a lower price. Returns READY (can send payment link) or PENDING_APPROVAL (owner must decide).",
    input_schema: {
      type: "object",
      properties: {
        package_id: { type: "string" },
        guests: { type: "integer" },
        requested_price_per_plate: { type: "integer" },
      },
      required: ["package_id", "guests"],
    },
  },
  {
    name: "send_payment_link",
    description: "Create the advance payment link for a READY or APPROVED quote. Share the returned URL with the customer.",
    input_schema: { type: "object", properties: { quote_id: { type: "string" } }, required: ["quote_id"] },
  },
  {
    name: "handoff_to_owner",
    description: "Hand the conversation to the owner (complaints, refunds, unusual requests, anything you are unsure about).",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
];

function systemPrompt(biz) {
  return `You are the party-booking assistant for ${biz.name} (${biz.city}), replying on behalf of the owner ${biz.owner_name}.
Goal: turn every party enquiry into a confirmed booking with an advance paid, without losing any details.

Rules:
1. Call get_business_profile before talking about packages or prices.
2. Collect: name, phone, occasion, date, guest count, food preference. Call save_lead whenever you learn something.
3. NEVER state a price, discount, total or advance that did not come back from create_quote.
4. If the customer negotiates, call create_quote with requested_price_per_plate. If it returns PENDING_APPROVAL, say you will check with ${biz.owner_name} and get back shortly. Never promise the discount.
5. Only share payment links returned by send_payment_link. The booking is confirmed ONLY after the advance is paid; never say "confirmed" before that.
6. Reply in the customer's language (English, Hindi or Hinglish). Keep replies short, warm, and one question at a time.
7. Complaints, refunds or anything unusual: call handoff_to_owner.
Today is ${new Date().toISOString().slice(0, 10)}.`;
}

export function makeChat({ biz, publicUrl, onNeedsApproval, issuePaymentLink }) {
  async function runTool(lead, name, input) {
    switch (name) {
      case "get_business_profile":
        return publicProfile(biz);

      case "save_lead": {
        const fields = { ...lead.fields };
        for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null && v !== "") fields[k] = v;
        const firstSignup = !lead.fields.phone && fields.phone;
        updateLead(lead, { fields });
        const missing = REQUIRED.filter((f) => !fields[f]);
        if (lead.stage === "NEW" && missing.length === 0) updateLead(lead, { stage: "QUALIFIED" });
        logEvent("agent", firstSignup ? "lead_signed_up" : "lead_updated", lead.id, { fields });
        return { saved: true, missing_fields: missing };
      }

      case "check_availability":
        return checkAvailability(biz, input);

      case "create_quote": {
        const priced = priceQuote(biz, input);
        if (priced.error) return { error: priced.error };
        const quote = createQuote({
          lead_id: lead.id,
          package_id: priced.package.id,
          package_name: priced.package.name,
          guests: priced.guests,
          list_per_plate: priced.list_per_plate,
          requested_per_plate: priced.per_plate,
          per_plate: priced.per_plate,
          floor_per_plate: priced.floor_per_plate,
          total: priced.total,
          advance: priced.advance,
          discount_pct: priced.discount_pct,
          below_floor: priced.below_floor,
          status: priced.status,
        });
        updateLead(lead, { stage: priced.status === "READY" ? "QUOTED" : "PENDING_APPROVAL", current_quote: quote.id });
        logEvent("agent", "quote_created", lead.id, { quote_id: quote.id, status: quote.status, per_plate: quote.per_plate, total: quote.total });
        if (quote.status === "PENDING_APPROVAL") onNeedsApproval(lead, quote);
        return {
          quote_id: quote.id,
          status: quote.status,
          ...(quote.status === "READY"
            ? { package: quote.package_name, per_plate: quote.per_plate, guests: quote.guests, total: quote.total, advance: quote.advance }
            : { message: `Owner approval needed for ₹${quote.per_plate}/plate.` }),
        };
      }

      case "send_payment_link": {
        const quote = getQuote(input.quote_id);
        if (!quote || quote.lead_id !== lead.id) return { error: "Unknown quote." };
        if (!["READY", "APPROVED", "LINK_SENT"].includes(quote.status)) return { error: `Quote is ${quote.status}; cannot send a link yet.` };
        if (quote.status === "LINK_SENT") return { payment_link_url: quote.payment_link_url, advance: quote.advance };
        const link = await issuePaymentLink(lead, quote);
        return { payment_link_url: link.payment_link_url, advance: quote.advance, total: quote.total };
      }

      case "handoff_to_owner":
        updateLead(lead, { stage: "HANDOFF", handoff_reason: input.reason });
        logEvent("agent", "handoff_to_owner", lead.id, input);
        return { ok: true, message: "Owner notified." };

      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  async function reply(lead, userText) {
    addMessage(lead, "user", userText);
    logEvent("customer", "message", lead.id, { text: userText });

    const messages = lead.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.text }));
    // The API needs the conversation to start with a user turn.
    while (messages.length && messages[0].role !== "user") messages.shift();

    const text = PROVIDER === "openai" ? await openaiLoop(lead, messages) : await anthropicLoop(lead, messages);
    const finalText = text || "Let me check this with the owner and get back to you shortly.";
    addMessage(lead, "assistant", finalText);
    return finalText;
  }

  async function openaiLoop(lead, history) {
    const messages = [{ role: "system", content: systemPrompt(biz) }, ...history];
    const oaTools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    for (let i = 0; i < 8; i++) {
      const res = await openai.chat.completions.create({ model: OPENAI_MODEL, messages, tools: oaTools });
      const msg = res.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls?.length) return (msg.content || "").trim();
      for (const call of msg.tool_calls) {
        let out;
        try {
          out = await runTool(lead, call.function.name, JSON.parse(call.function.arguments || "{}"));
        } catch (err) {
          out = { error: String(err.message || err) };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
      }
    }
    return null;
  }

  async function anthropicLoop(lead, messages) {
    for (let i = 0; i < 8; i++) {
      const res = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: systemPrompt(biz),
        tools,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") {
        return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      }
      const results = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        let out;
        try {
          out = await runTool(lead, block.name, block.input || {});
        } catch (err) {
          out = { error: String(err.message || err) };
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }
    return null;
  }

  return { reply };
}
