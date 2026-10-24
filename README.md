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

## Connect an OpenAI-compatible LLM

Set these securely in Render environment settings, or in an ignored local `.env` copied from `.env.example`:

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL` | API root, e.g. `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`; do not append `/chat/completions` |
| `LLM_API_KEY` | Provider key; server-side only |
| `LLM_MODEL` | Default model ID supported by the provider |
| `OWNER_MODEL` | Optional stronger owner-conversation model override |
| `CUSTOMER_MODEL` | Optional customer-response model override |
| `VISION_MODEL` | Optional vision model for menu/image extraction |

Restart/redeploy after changing environment variables. The app sends OpenAI Chat Completions-shaped requests. It asks models for JSON, but does not require proprietary structured-output options. Verify compatibility with your chosen models.

**Without an LLM:** conversational setup works as a six-question guided conversation; common questions about offerings, hours, location and contact use confirmed profile information. Exact previously answered questions reuse saved facts. Other questions go to the owner. Free-form advice and semantic knowledge matching require a configured LLM. After setup, `hours: Mon–Sat 9–6` creates an update draft even in basic mode.

**With an LLM:** the owner can have free-form business conversations and receive suggestions; proposed profile changes require confirmation. Customer responses use that business's profile and saved facts, and missing answers are escalated. Model hallucination remains possible; review important policies and don't use this initial version for consequential guarantees or transactions.

## Files, search and creatives

- Owners can upload JPG, PNG, WebP, PDF or plain text, up to 5 MB. Files are private to their owner. Text files create an offerings draft; vision models can extract offerings from images for review. PDFs are retained for download; PDF extraction is not implemented yet.
- Internet research in **Ideas** uses Tavily. Set `SEARCH_API_KEY`. Results, URLs and retrieval timestamp are saved to the owner conversation. This is an explicit owner search action, not automatic background browsing. Business advice does not claim fresh local/festival data unless you provide it.
- Image generation in **Ideas** requires `IMAGE_BASE_URL`, `IMAGE_API_KEY`, and `IMAGE_MODEL` for an OpenAI **Images API-compatible** endpoint. The app appends `/images/generations`. This is separate from the text gateway; OpenRouter chat-based image generation is not implemented in this adapter. Providers returning base64 or HTTPS image URLs are supported. Provider URLs may expire; download important output. Review all generated text and claims. Nothing is automatically posted or sent externally.

Provider credentials and live APIs have not been supplied or validated. Tests use a local mock for text model routing. A provider that uses different native tools/image formats needs an additional adapter.

## Knowledge and account limitations

Owner-approved answers persist until deleted; they do not automatically expire. Remove temporary stock, old prices and expired offers from Memory. Profile edits affect live customer answers immediately once published. Deleting a saved answer does not delete historical messages. This first release has no self-service account deletion/export, account recovery, staff roles, granular audit log or automatic backups. Add these as the product grows.

Basic request limits and cross-origin protections are included. A production rollout should also configure gateway-level abuse controls, a data-retention policy, monitoring and backups. Email identity is unverified as requested; do not use an email address alone as proof of identity for payments or privileged invitations.

## Optional WhatsApp

The standalone webhook is retained. Set all of `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_GRAPH_VERSION`; then configure `/webhook` in Meta and subscribe to messages. It sends a fixed greeting for private text messages and is **not connected to the web inbox**. Its test coverage uses a mocked Meta API. Official group messaging is not implemented.

## Design document

`/design` contains the interactive product/UX proposal. `docs/dhanavi-product-design.html` is the self-contained export. Run `npm run design:export` after editing the design assets. Proposed features in that document may extend beyond the implemented release described above.

## Checks

`npm test` covers Meta signature handling, password authentication, owner isolation, guest isolation, conversational setup, publication, owner handoffs, saved knowledge, private uploads, sessions and database persistence. A mocked compatible provider checks owner/customer model routing and confirmation before knowledge updates. Browser checks exercise signup → onboarding → publish → customer question → owner answer → logout/login.
