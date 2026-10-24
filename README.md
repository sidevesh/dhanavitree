# Dhanavitree

A WhatsApp-inspired web messaging workspace for a business and its customers. Runs independently of WhatsApp; Meta's Cloud API is an optional integration.

## Run locally

Use Node.js 24 and the existing checkout (no additional worktree needed).

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

Open the app on port 3000. No credentials or `.env` file are required for web messaging. Choose **Business owner** or **Customer** in the header to try both sides. In customer view, selecting a conversation lets you act as that demo customer. Open a second browser tab with the other perspective to see messages update, usually within two seconds.

Features include searchable conversations, a needs-a-reply filter, new customer conversations, multiline messages, quick replies, per-perspective drafts, emoji insertion, responsive mobile navigation, conversation details and on-disk message history. Four sample conversations are created on first run. The check marks mean saved to this workspace, not read by the other person.

**This is a shared demo, not an authenticated customer portal.** Everyone who can open the app can view all demo conversations and act as either participant. Do not use real customer information. Add authentication, authorization and rate limiting before a real customer launch. Web messaging does not send any WhatsApp messages.

## Deploy on Render

1. In Render choose **New → Blueprint** and connect `sidevesh/dhanavitree`.
2. Apply `render.yaml`. It creates a **paid Starter** web service and a 1 GB persistent disk; review current Render pricing first. No Meta secrets are requested.
3. Open the Render service URL. `/health` returns JSON with `status: "ok"` and indicates whether WhatsApp is enabled.

If a service was already created from the previous bot configuration, sync the updated Blueprint, or add a persistent disk mounted at `/var/data` and set `DATA_DIR=/var/data` manually. Old WhatsApp variables may be removed to disable that integration.

Local data lives in ignored `data/conversations.json`. Render stores it on the mounted disk so it survives restarts and deployments. Run a single instance with this file-based store; a multi-instance production app needs a database. Back up the data before deleting a service or disk. The provided tests create independent temporary data and do not modify the app's conversations.

## Optional WhatsApp integration

To enable the existing private-message webhook, set **all five** variables in `.env` locally or in Render's environment settings:

| Variable | Meaning |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | A random secret of your choosing; also enter it in Meta's webhook verification form |
| `META_APP_SECRET` | Meta app settings → Basic → App secret |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp → API Setup access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID, not the phone number |
| `WHATSAPP_GRAPH_VERSION` | A supported API version, for example `v23.0`; check your Meta API setup |

Restart the service, configure `https://YOUR-RENDER-HOST/webhook` in Meta and subscribe to **messages**. With Meta's test number, verify your personal number as a test recipient first. Temporary tokens expire; use appropriate production credentials for a real launch. Never commit credentials or send secrets through chat.

When enabled, this standalone webhook validates Meta's signature and sends a fixed greeting for incoming private text messages. It is **not connected to the web inbox yet**. It ignores media and status events. Its deduplication is bounded and in memory, so restarts and ambiguous send failures can produce duplicate replies. Add durable delivery handling before production. With missing configuration the web app still works and `/webhook` returns 503.

## Validation

`npm run typecheck` checks the server and tests. `npm test` exercises Meta signature checks, replies and retries using a mocked API, plus web chat creation, both message directions, validation, cross-origin protection and persistence across server restarts. A live Meta phone test is required separately if you enable WhatsApp.

## Product and UX direction

Open `/design` for the Dhanavi product design brief: branding, interactive owner/customer mockups, conversational onboarding, durable business memory, escalations, growth/creative workflows, model-provider routing, reference products and an implementation sequence. This is a proposal, not implemented authentication or AI functionality.

A self-contained copy is saved at `docs/dhanavi-product-design.html`. Open it in a browser or share it directly; it uses no external assets. Run `npm run design:export` after editing `public/design.html`, `public/design.css` or `public/design.js` to refresh that copy. The document includes Print / Save PDF, screen tabs and local-only sample interactions. Reference sites blocked automated inspection, which is disclosed in the reference library.
