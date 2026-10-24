import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, type Config } from './app.ts';

type Message = { id: string; sender: 'business' | 'customer'; text: string; at: string };
type Conversation = { id: string; name: string; initials: string; color: string; topic: string; messages: Message[] };
export function createWebApp(dataFile: string, whatsapp?: Config) {
  mkdirSync(dirname(dataFile), { recursive: true });
  const save = () => { writeFileSync(dataFile + '.tmp', JSON.stringify(chats)); renameSync(dataFile + '.tmp', dataFile); };
  const now = Date.now();
  const message = (sender: Message['sender'], text: string, minutes: number): Message => ({ id: randomUUID(), sender, text, at: new Date(now - minutes * 60000).toISOString() });
  const chats: Conversation[] = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : [
    { id: 'maya', name: 'Maya Shah', initials: 'MS', color: 'peach', topic: 'Order #1042 · Delivery enquiry', messages: [message('customer', 'Hi! I placed an order yesterday. Could you help me with the delivery date?', 28), message('business', 'Hi Maya! Of course. Your order is packed and ready to go. 🌿', 26), message('business', 'We can deliver tomorrow between 10 am and 1 pm. Does that work for you?', 25), message('customer', 'That’s perfect, thank you! Could you also add a small gift note?', 2)] },
    { id: 'arjun', name: 'Arjun Mehta', initials: 'AM', color: 'blue', topic: 'Product enquiry', messages: [message('customer', 'Hello! Do you have the ceramic planters in stock?', 68), message('business', 'Yes, we have them in sage green and warm white. Happy to help you choose!', 60), message('customer', 'I’d love to see the sage green one.', 35)] },
    { id: 'neha', name: 'Neha Rao', initials: 'NR', color: 'purple', topic: 'Order #1038 · Completed', messages: [message('customer', 'My order just arrived and it looks beautiful. Thank you so much! 💚', 110), message('business', 'So happy to hear that, Neha! Thank you for supporting our small business.', 105)] },
    { id: 'kabir', name: 'Kabir Sethi', initials: 'KS', color: 'yellow', topic: 'Business enquiry', messages: [message('customer', 'Hi, do you accept bulk orders for office gifting?', 140)] },
  ];
  if (!existsSync(dataFile)) save();
  const webhook = whatsapp ? createApp(whatsapp) : undefined;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/webhook') {
      if (webhook) webhook.emit('request', req, res);
      else json(503, { error: 'WhatsApp integration is not configured' });
      return;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { status: 'ok', whatsapp: !!whatsapp });
      if (req.method === 'GET' && url.pathname === '/api/conversations') return json(200, chats);
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `https://${req.headers.host}` && req.headers.origin !== `http://${req.headers.host}`)) return json(403, { error: 'Cross-site request rejected' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 20000) return json(413, { error: 'Message too large' }); }
        let body;
        try { body = JSON.parse(raw); } catch { return json(400, { error: 'Invalid JSON' }); }
        if (url.pathname === '/api/conversations') {
          if (typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 80) return json(400, { error: 'Enter a name of 1–80 characters' });
          const name = body.name.trim();
          const chat: Conversation = { id: randomUUID(), name, initials: name.split(/\s+/).slice(0, 2).map((s: string) => s[0]).join('').toUpperCase(), color: 'peach', topic: 'New conversation', messages: [] };
          chats.unshift(chat); save(); return json(201, chat);
        }
        const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        const chat = match && chats.find(c => c.id === match[1]);
        if (!chat) return json(404, { error: 'Conversation not found' });
        if (!['business', 'customer'].includes(body?.sender) || typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 4000) return json(400, { error: 'Enter a message of 1–4000 characters' });
        const item: Message = { id: randomUUID(), sender: body.sender, text: body.text.trim(), at: new Date().toISOString() };
        chat.messages.push(item); save(); return json(201, item);
      }
      const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const file = files[url.pathname];
      if (req.method !== 'GET' || !file) return json(404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(readFileSync(new URL(`../public/${file[0]}`, import.meta.url)));
    } catch { if (!res.headersSent) json(500, { error: 'Unable to save changes. Please try again.' }); }
  });
}
