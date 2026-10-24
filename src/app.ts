import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export type Config = {
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
};

type Message = { id?: string; from?: string; type?: string; text?: { body?: string } };
type Webhook = {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: {
    metadata?: { phone_number_id?: string };
    messages?: Message[];
  } }> }>;
};

export function createApp(config: Config, send: typeof fetch = fetch) {
  // Single-instance MVP: bounded in-memory deduplication, cleared on restart.
  const processed = new Map<string, number>();
  const pending = new Set<string>();
  return createServer(async (req, res) => {
    const respond = (status: number, body: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
    };
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return respond(200, 'ok');
    if (url.pathname !== '/webhook') return respond(404, 'Not found');
    if (req.method === 'GET') {
      if (url.searchParams.get('hub.mode') === 'subscribe' &&
          url.searchParams.get('hub.verify_token') === config.verifyToken &&
          url.searchParams.has('hub.challenge')) {
        return respond(200, url.searchParams.get('hub.challenge')!);
      }
      return respond(403, 'Verification failed');
    }
    if (req.method !== 'POST') return respond(405, 'Method not allowed');
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 1_048_576) return respond(413, 'Payload too large');
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks);
      const signature = req.headers['x-hub-signature-256'];
      const expected = 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex');
      if (typeof signature !== 'string' || Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return respond(401, 'Invalid signature');
      }
      let payload: Webhook;
      try { payload = JSON.parse(raw.toString()); }
      catch { return respond(400, 'Invalid JSON'); }
      if (!payload || payload.object !== 'whatsapp_business_account') return respond(200, 'Ignored');
      for (const [id, time] of processed) {
        if (Date.now() - time > 86_400_000) processed.delete(id);
      }
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (change.field !== 'messages' || value?.metadata?.phone_number_id !== config.phoneNumberId) continue;
          for (const message of value.messages ?? []) {
            if (message.type !== 'text' || !message.id || !message.from || !message.text?.body) continue;
            if (processed.has(message.id)) continue;
            if (pending.has(message.id)) return respond(503, 'Message in progress; retry webhook');
            pending.add(message.id);
            try {
              const response = await send(
                `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: message.from,
                    type: 'text',
                    text: { body: 'Hello! Thanks for contacting us. Our WhatsApp assistant is connected. How can we help you?' },
                  }),
                  signal: AbortSignal.timeout(8_000),
                },
              );
              if (!response.ok) {
                // Do not log API response bodies, tokens, phone numbers or customer text.
                console.error(`WhatsApp send failed (HTTP ${response.status})`);
                return respond(503, 'Delivery failed; retry webhook');
              }
              processed.set(message.id, Date.now());
              if (processed.size > 10_000) processed.delete(processed.keys().next().value!);
            } finally { pending.delete(message.id); }
          }
        }
      }
      return respond(200, 'EVENT_RECEIVED');
    } catch {
      console.error('Webhook processing failed');
      if (!res.headersSent) respond(503, 'Processing failed; retry webhook');
    }
  });
}
