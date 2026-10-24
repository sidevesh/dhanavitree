# Dhanavitree WhatsApp bot

A minimal private-message bot using Meta's official WhatsApp Cloud API. It verifies webhook signatures and replies to incoming text messages with a fixed greeting. No WhatsApp Web automation, AI integration, database, or group support is included yet.

## Deploy to Render

1. Push this project to `sidevesh/dhanavitree` on GitHub.
2. In Render, create a **Blueprint** from that repository. Render reads `render.yaml`. It selects a paid **Starter** instance to avoid idle sleeping; check current pricing before creating the service. You can change the plan in the blueprint first if desired, but sleeping instances can delay webhook responses.
3. Set the prompted environment variables securely in Render:

   | Variable | Where to find it |
   | --- | --- |
   | `META_APP_SECRET` | Meta app settings → Basic → App secret |
   | `WHATSAPP_ACCESS_TOKEN` | WhatsApp → API Setup → temporary access token for testing |
   | `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → Phone number ID, not the displayed phone number or Business Account ID |

   Render generates `WHATSAPP_VERIFY_TOKEN`. Copy its value from Render into Meta's webhook verification form. `WHATSAPP_GRAPH_VERSION` defaults to `v23.0`; select a currently supported version matching your Meta API setup if necessary.

4. Deploy and confirm the service's `/health` endpoint responds `ok`.

## Connect Meta and send the first message

1. Create or open a Meta developer app with the WhatsApp product/use case. Use Meta's provided test business number for the first demo.
2. In WhatsApp → API Setup, add and verify your personal phone as a test recipient. Send the provided `hello_world` template using Meta's test interface to confirm number and token access.
3. In WhatsApp webhook configuration, enter `https://YOUR-RENDER-HOST/webhook` as the callback URL and the exact `WHATSAPP_VERIFY_TOKEN` from Render as the verify token.
4. Subscribe to the WhatsApp Business Account **messages** webhook field. If your account flow requires it, also subscribe the app to your WhatsApp Business Account.
5. From your verified personal phone, reply to the test business number with a text message. The bot should respond: “Hello! Thanks for contacting us. Our WhatsApp assistant is connected. How can we help you?”

The app replies only after a customer sends a message. It does not initiate customer outreach or require an outbound template for these immediate replies. Test numbers are restricted to verified test recipients. For real customers, complete Meta's production phone/business setup and replace the temporary token with a suitable system-user token and WhatsApp messaging permissions. Temporary tokens expire; update Render's environment and redeploy when replacing them. Never commit tokens or paste secrets into chat.

## Local development

Requires Node.js 24 and npm. Use the existing checkout; no additional Git worktree is needed.

```sh
npm ci
cp .env.example .env
# Fill .env locally; it is ignored by Git.
npm run typecheck
npm test
npm run dev
```

The webhook must have a public HTTPS address for Meta to reach it; Render supplies that address. `/health` is a local/service health check, not proof of live Meta delivery.

## Scope and operational limits

- Private text messages only. Media and delivery-status events are acknowledged without a reply.
- Signature validation requires the app secret, which differs from the webhook verify token and access token.
- Sends time out after 8 seconds; API failures return HTTP 503 so Meta can retry. Logs omit credentials, message contents and phone numbers.
- Deduplication uses a bounded, one-day in-memory cache for a single instance. Restarts, multiple instances, ambiguous network failures, and crashes can produce duplicate replies. Before production, add a durable queue and persistent idempotency handling; batched messages are currently processed inline.
- The test suite mocks Meta's outbound endpoint. A real phone test after deployment is still required to verify Meta credentials, subscriptions, and end-to-end delivery.

If verification returns 403, check the verify token. If POSTs return 401, check the app secret. If sends fail, check Render logs for the HTTP status, then validate the access token, phone number ID, app permissions and test recipient in Meta's API Setup. Do not disable signature verification to troubleshoot.
