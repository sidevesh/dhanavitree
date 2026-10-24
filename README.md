# Party Closer

Party-booking agent for small restaurants: enquiry → quote → negotiation (owner approves) → Pine Labs advance → confirmed.

## Run locally
    cp .env.example .env   # fill in keys
    npm install && npm start
- Customer chat: http://localhost:3000/
- Owner desk:    http://localhost:3000/owner.html?key=<OWNER_KEY>

Missing Pine Labs keys → TEST MODE payment page. Missing AgenticOrg keys → the deal-desk card says "not configured".

## Deploy on Render
New → Web Service → this repo. Build `npm install`, start `npm start`. Add every variable from `.env.example`,
with `PUBLIC_URL` set to the Render URL. In the Pine Labs dashboard set the webhook to `<PUBLIC_URL>/webhooks/pinelabs`.
Data lives in `data/db.json` and is lost on redeploy: download the proof trail from the owner desk ("export JSON") before redeploying.

## Restaurant setup
Edit `business.json`: name, owner, packages (`price_per_plate`, `floor_per_plate` = lowest price the owner accepts,
`min_guests`), `max_auto_discount_pct` (agent may give this much without asking), `advance_pct`, `capacity`.

## AgenticOrg agent ("Deal Desk")
Create a custom agent and put its id/type in `AGENTICORG_AGENT`. Suggested prompt:

> You are the deal desk for a small restaurant. Input `task` is either `negotiation_review` or `follow_up`.
> For `negotiation_review`: recommend APPROVE, COUNTER (a price per plate between `owner_floor_per_plate` and
> `list_price_per_plate`) or REJECT, give a one-line reason, and write a short, warm draft reply to the customer.
> Never go below the floor. For `follow_up`: write one short, polite message that moves the booking forward,
> with no new discounts. Return JSON: {"recommendation", "price_per_plate", "reason", "message"}.
> The owner always makes the final decision.
