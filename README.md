# Dhanavi

A functional business-owner workspace and customer chat, built with Node.js 24, SQLite and a lightweight web UI. WhatsApp is optional.

## Start

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

Open port 3000. Create an account with email and password (at least 8 characters). **No email verification is required.** Passwords are salted and hashed with scrypt; login sessions use HTTP-only cookies. Password reset and email verification are not implemented yet.

1. Talk to Dhanavi to provide your business name, offerings, location/Maps link, contact, hours and policies. You may skip a detail.
2. Open **Business**, review the information, choose a customer-link slug and publish.
3. Share `/b/YOUR-SLUG`. Customers chat without signing up, using a separate guest session. They cannot access other visitors' conversations or your owner workspace.
4. Unknown questions appear in **Today** and **Customers**. Answer them and optionally save the answer to **Memory**. The reply appears in the waiting customer's browser; saved facts are available for future questions.

The owner can also reply directly in Customers. This initial version does not pause subsequent AI responses when an owner replies. Guest history is tied to that browser's cookie; clearing cookies or changing devices starts a new conversation. Owner notifications are in-app; email/push notifications are not connected.

## Render

Create or sync a Render Blueprint from this repository. `render.yaml` uses a **paid Starter instance and 1 GB persistent disk**; review Render pricing before deploying. It sets `DATA_DIR=/var/data`. No API keys are required for basic mode. Existing services should add the disk and DATA_DIR if not managed through the updated Blueprint.

Accounts, sessions, conversations, knowledge, uploads and creative records live in `platform.sqlite` under DATA_DIR. Keep one instance with this SQLite store. Back up the disk and use HTTPS. Old shared-demo `conversations.json` files are preserved but are not imported into private owner accounts.

## Connect OpenAI (default), Meta Muse or another compatible LLM

Set these securely in Render environment settings, or in an ignored local `.env` copied from `.env.example`:

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `openai` (default) or `meta`; both enable built-in web search and shared image credentials |
| `LLM_BASE_URL` | API root, e.g. `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`; do not append `/chat/completions` |
| `LLM_API_KEY` | Provider key; server-side only |
| `LLM_MODEL` | Default model ID supported by the provider |
| `OWNER_MODEL` | Optional stronger owner-conversation model override |
| `CUSTOMER_MODEL` | Optional customer-response model override |
| `VISION_MODEL` | Optional vision model for menu/image extraction |

Restart/redeploy after changing environment variables. The app sends OpenAI Chat Completions-shaped requests. It asks models for JSON, but does not require proprietary structured-output options. Verify compatibility with your chosen models.

**Without an LLM:** conversational setup works as a six-question guided conversation; common questions about offerings, hours, location and contact use confirmed profile information. Exact previously answered questions reuse saved facts. Other questions go to the owner. Free-form advice and semantic knowledge matching require a configured LLM. After setup, `hours: Mon–Sat 9–6` creates an update draft even in basic mode.

**With an LLM:** the owner can have free-form business conversations and receive suggestions; proposed profile changes require confirmation. Customer responses use that business's profile and saved facts, and missing answers are escalated. Model hallucination remains possible; review important policies. Payment amounts are calculated from the structured catalog, never from model-generated prices.

## Voice conversations (Pipecat)

Owners can do the setup conversation by voice, and customers can talk to the business assistant on `/b/YOUR-SLUG`. The **🎙 Talk** button appears beside **Send** once voice is configured. Spoken turns are saved as normal chat messages, so they appear in the typed chat and in **Customers**.

How it works: [Pipecat](https://github.com/pipecat-ai/pipecat) runs as a separate Python service in `voice/`. It handles speech only:

```
browser mic ──WebRTC──▶ voice/bot.py: Silero VAD → OpenAI speech-to-text
                                         │ transcript (one turn after a 1.2 s pause)
                                         ▼
                        Node /api/voice/turn → same owner setup / customer answer as typed chat
                                         │ reply text
browser speaker ◀─WebRTC── OpenAI text-to-speech
```

The browser sends its WebRTC offer to Node (`/api/voice/offer` for owners, `/api/public/SLUG/voice` for customers). Node checks the owner session or guest cookie, creates a one-hour voice token and forwards the offer to the voice service. The voice service listens on `127.0.0.1` and only accepts requests carrying `VOICE_INTERNAL_SECRET`. The setup steps, escalation to the owner and saved knowledge are not duplicated in Python.

Run it locally (Python 3.10+):

```sh
npm run voice:setup        # once: creates voice/.venv and installs Pipecat
# in .env: LLM_API_KEY (an OpenAI key), VOICE_URL=http://127.0.0.1:7860, VOICE_INTERNAL_SECRET=<openssl rand -hex 32>
npm run dev                # terminal 1
npm run voice              # terminal 2
```

Speech uses OpenAI `gpt-4o-transcribe` and `gpt-4o-mini-tts`. If `LLM_PROVIDER` is not OpenAI, set `VOICE_OPENAI_API_KEY`. Microphone access requires HTTPS or `localhost`. Limitations:

- Speech recognition is set to English.
- Wait for the bot to finish before answering. Speech that starts while it is talking is ignored as echo, and the bot does not stop when interrupted.
- Each setup answer ends after a pause of about 1.2 seconds, set by `VOICE_TURN_PAUSE_SECS`. A longer pause in the middle of an answer sends the rest as the answer to the next question. Correct any mistakes in **Business** before publishing.
- Saying "skip" skips a setup question.

**Deployment:** `render.yaml` runs only the Node service. Voice needs the Python service running beside it, plus media connectivity between the browser and the voice service. WebRTC audio flows directly between them over UDP, not through Node. If the voice service is not reachable over UDP, as on typical PaaS web services, set `VOICE_ICE_SERVERS` to a TURN relay, or switch Pipecat to a hosted transport such as Daily.

## Files, search and creatives

- Owners can upload JPG, PNG, WebP, PDF or plain text, up to 5 MB. Files are private to their owner. Text files create an offerings draft; vision models can extract offerings from images for review. PDFs are retained for download; PDF extraction is not implemented yet.
- Internet research in **Ideas** uses the provider's built-in `web_search` on `/responses`. For OpenAI set `LLM_PROVIDER=openai` and `LLM_API_KEY` (base URL defaults to `https://api.openai.com/v1`, model to `gpt-4.1`); for Meta set `LLM_PROVIDER=meta`, `LLM_BASE_URL=https://api.meta.ai/v1`, `LLM_API_KEY` and `LLM_MODEL`. No Tavily key or integration is required. Answers, source URLs when returned, and retrieval time are saved in the owner conversation. Search is explicit in Ideas; ordinary customer answers stay grounded in approved business facts.
- With OpenAI or Meta configured, image generation shares the text API key/base URL and defaults to `gpt-image-2` (OpenAI) or `muse-image-1.0` (Meta). With `LLM_PROVIDER=openai`, leftover `muse-*` model names are ignored. For other providers it requires `IMAGE_BASE_URL`, `IMAGE_API_KEY`, and `IMAGE_MODEL` for an OpenAI **Images API-compatible** endpoint. The app appends `/images/generations`. This is separate from the text gateway; OpenRouter chat-based image generation is not implemented in this adapter. Providers returning base64 or HTTPS image URLs are supported. Provider URLs may expire; download important output. Review all generated text and claims. Nothing is automatically posted or sent externally.

Text, image and payment adapters have mocked contract tests. Validate your credentials against the enabled models and merchant configuration before live use. Deployment secrets are set separately; local `.env` is ignored by Git.

## Knowledge and account limitations

Owner-approved answers persist until deleted; they do not automatically expire. Remove temporary stock, old prices and expired offers from Memory. Profile edits affect live customer answers immediately once published. Deleting a saved answer does not delete historical messages. This first release has no self-service account deletion/export, account recovery, staff roles, granular audit log or automatic backups. Add these as the product grows.

Basic request limits and cross-origin protections are included. A production rollout should also configure gateway-level abuse controls, a data-retention policy, monitoring and backups. Email identity is unverified as requested; do not use an email address alone as proof of identity for payments or privileged invitations.

## Optional WhatsApp

The standalone webhook is retained. Set all of `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_GRAPH_VERSION`; then configure `/webhook` in Meta and subscribe to messages. It sends a fixed greeting for private text messages and is **not connected to the web inbox**. Its test coverage uses a mocked Meta API. Official group messaging is not implemented.

## Design document

The design sources are retained as developer documentation; they are not linked or served in the application. `docs/dhanavi-product-design.html` is the self-contained export. Run `npm run design:export` after editing the design assets. Proposed features in that document may extend beyond the implemented release described above.

## Checks

`npm test` covers Meta signature handling, password authentication, owner isolation, guest isolation, conversational setup, publication, owner handoffs, saved knowledge, private uploads, sessions and database persistence. A mocked compatible provider checks owner/customer model routing and confirmation before knowledge updates. Browser checks exercise signup → onboarding → publish → customer question → owner answer → logout/login.

## Muse setup

Use `LLM_PROVIDER=meta`, `LLM_BASE_URL=https://api.meta.ai/v1`, `LLM_MODEL=muse-spark-1.2-contributor` and your server-side `LLM_API_KEY`. Spark handles owner/customer conversations and image understanding; research calls its Responses API with `web_search`; Muse Image generates creatives. They use the same provider account, with separate model IDs/endpoints. Contributor mode permits Meta to use submitted content for training and is selected for this setup. Use `muse-spark-1.2` when switching to Standard. Keep passwords, keys and card details out of prompts. Native research is not enabled for generic chat-compatible gateways.

## Orders and Pine Labs

1. In **Orders**, enter a structured catalog: `product-id | name | rupee price`. Prices are stored as integer paise. Publishing the business exposes the catalog on its customer page.
2. Customers choose quantities and provide their contact details through **Request to buy**. The server validates product IDs and calculates totals. Each request snapshots the agreed catalog items/prices.
3. By default the owner chooses **Approve & send payment link**. Enabling automatic checkout authorizes link generation for catalog orders at those exact prices. Custom chat enquiries continue through owner handoff; there is no automatic free-text order extraction or invented quote.
4. Configure `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET`, `PINELABS_BASE_URL` (UAT by default), and `PUBLIC_URL`. Merchant onboarding must enable Pay by Link. Approved orders generate a Pine Labs hosted URL and deliver it into the customer's existing private chat. No dummy links or fabricated customer details are used. Browser checkout is the implemented delivery channel; WhatsApp/email/SMS delivery is not connected.
5. Status reconciliation runs every 30 seconds for up to 20 pending orders per batch, and **Check payment** forces a check. It uses Pine Labs’ authenticated GET endpoint and verifies the provider link ID, merchant reference, total, currency, `PROCESSED` status and zero amount due before recording paid. Partial payments remain pending. A browser redirect cannot mark paid. Payment confirmation is separate from fulfilment.

Orders and agent runs persist in the existing SQLite database. Repeating a request with the same guest/request key reuses its order and provider reference. Creation failures leave approved orders retryable; owners can retry the link without issuing a fresh order. Retry creation uses the same merchant reference, which Pine Labs documents as idempotent. Expired/cancelled orders require a new request. Limits: INR only, Indian customer mobile numbers, ₹5,00,000 per order, one configured platform merchant. Per-business merchant onboarding/settlement routing, refunds, tax/shipping computation, inventory reservation and signed webhooks are future work. Do not operate unrelated merchants through a single merchant account without the required Pine Labs arrangement.

API reference: [create link](https://www.pinelabs.com/docs/online-payments/api/payment-links/create-payment-link), [retrieve link](https://www.pinelabs.com/docs/online-payments/api/payment-links/get-payment-link-by-id), [authentication](https://www.pinelabs.com/docs/online-payments/api/authentication/generate-token).

## AgenticOrg integration from party-closer

The source branch has a restaurant-specific Deal Desk agent, flat JSON persistence, a shared owner key, and payment adapters. This implementation reuses its agent-run protocol while retaining main's authenticated owners, tenant isolation and SQLite. It replaces the branch's older plural `/payment-links` payload with the current singular `/paymentlink` API and avoids its unsigned webhook payment confirmation and test checkout fallback.

Set `AGENTICORG_API_KEY` (execute permission), `AGENTICORG_BASE_URL` and role IDs:

- `AGENTICORG_OWNER_AGENT_ID`: owner advice/profile-update proposals.
- `AGENTICORG_CUSTOMER_AGENT_ID`: approved-profile customer answers and owner handoffs.
- `AGENTICORG_ORDER_AGENT_ID`: advisory order review from the owner desk.
- `AGENTICORG_AGENT_ID`: optional fallback for any role without an explicit mapping.

The adapter calls `POST /api/v1/agents/{id}/run` with `{inputs:{task,system,messages}}` for chats, and `{inputs:{task:"order_review",order,instructions}}` for reviews, using Bearer authentication as in party-closer. Configure agents in the AgenticOrg console; remote agent creation/editing and workflow deployment APIs have not been verified. These environment variables route platform roles to those managed agents.

Chat agents must return completed output as JSON: owner `{reply,updates:{}}`, customer `{answer,needsOwner}`. Their system instructions and context are supplied on each run. Profile proposals still require owner approval. Run IDs, status, human-review flags and outputs are retained privately for diagnostics. The owner sees readable order suggestions instead of raw run data. Completed chat responses, including usable `hitl_triggered` responses, are accepted; owner profile edits still require confirmation. Agent failures or empty/pending output fall back to the configured direct text model. Async continuation/HITL resolution is handled in AgenticOrg. Agent output never creates payments or marks orders paid. Without a configured role, ordinary text chat uses the direct LLM provider. Order review is advisory and cannot approve, discount or mark an order paid.

Authentication was verified against the execution endpoint: the supplied key returns E1005 NOT_FOUND for a deliberately nonexistent agent, while an invalid control key returns HTTP 401 Invalid API key. Agent-list and OpenAPI endpoints return HTTP 401 with this key; those checks do not establish whether execution authentication works. The run protocol matches party-closer. A successful live agent run still requires the actual agent ID/type configured in that application; none is committed in that branch.

## Interim UPI payments

Until Pine Labs merchant credentials are available, owners enter a UPI ID in **Orders** and save it with their catalog. Pine Labs is shown as a disabled option when unconfigured. Approved or auto-checkout orders use the saved UPI ID to generate a `upi://pay` intent containing the payee name, exact rupee amount and order reference. Customers can open a compatible UPI app or copy the ID and pay manually. Device/PSP restrictions can prevent deep links from opening; copying the ID is the fallback. Enter an ID that the business is authorised to collect payments through.

A UPI ID alone provides no authenticated bank confirmation. Opening the intent, returning to the browser or submitting a customer transaction reference **never marks paid**. The customer submits a reference; the owner checks the UPI app/bank for the full amount and explicitly confirms receipt. The order and chat label this as owner-confirmed rather than Pine Labs-verified. Existing UPI orders retain their original payee and method if the owner later changes the ID or enables Pine Labs. UPI intents cannot be revoked or expired by this app; coordinate any stale or duplicate transfer directly with the owner. No UPI PIN or card details are collected.

UPI field reference: [Google Pay India payment requests](https://developers.google.com/pay/india/api/web/create-payment-method).
