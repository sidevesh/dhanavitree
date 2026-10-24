import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
// Background question preparation would add model calls this test counts.
process.env.DHANAVI_AUTO_PREP='off';
import { createWebApp } from '../src/web.ts';

test('research includes scoped business context, goals and INR catalog prices without other tenants or customer records', async t => {
  const keys = ['LLM_PROVIDER','LLM_API_KEY','LLM_BASE_URL','LLM_MODEL','OWNER_MODEL','AGENTICORG_API_KEY'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { LLM_PROVIDER: 'openai', LLM_API_KEY: 'fixture', LLM_BASE_URL: 'https://provider.test/v1', LLM_MODEL: 'research-test' });
  const dir = mkdtempSync(join(tmpdir(), 'dhanavi-research-'));
  const server = createWebApp(join(dir, 'data.json'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://provider.test/')) return realFetch(url, options);
    calls.push(JSON.parse(String(options?.body)));
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '**Local opportunity**', annotations: [{ type: 'url_citation', title: 'Official', url: 'https://example.com/events' }] }] }] });
  };
  t.after(async () => {
    globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    for (const k of keys) { if (original[k] === undefined) delete process.env[k]; else process.env[k] = original[k]; }
  });
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const signup = await post('/api/auth/signup', { name: 'Owner', email: 'research@example.com', password: 'correct-password' });
  const cookie = signup.headers.get('set-cookie')!.split(';')[0];
  await post('/api/business', { profile: { name: 'Mogra Studio', offerings: 'Bouquets', location: 'Jayanagar, Bengaluru', policies: 'No same-day delivery' }, published: true }, cookie);
  await post('/api/commerce', { catalog: [{ id: 'roses', name: 'Rose bouquet', price: 65000 }], autoCheckout: false }, cookie);
  // Seed each source directly to test exactly what leaves the backend, including tenant isolation.
  const db = new DatabaseSync(join(dir, 'platform.sqlite'));
  const business = db.prepare('SELECT id FROM businesses').get()!.id;
  db.prepare('INSERT INTO facts VALUES(?,?,?,?,?)').run('fact', business, 'Delivery radius?', 'Within 5 km', new Date().toISOString());
  db.prepare('INSERT INTO owner_messages VALUES(?,?,?,?,?)').run('goal', business, 'owner', 'My budget is ₹2,000 for a weekend campaign.', new Date().toISOString());
  db.prepare('INSERT INTO threads VALUES(?,?,?,?)').run('thread', business, 'guest', new Date().toISOString());
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run('customer-message', 'thread', 'customer', 'PRIVATE CUSTOMER CONVERSATION', new Date().toISOString());
  db.close();
  const other = await post('/api/auth/signup', { name: 'Other', email: 'other-research@example.com', password: 'correct-password' });
  const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
  await post('/api/business', { profile: { name: 'OTHER TENANT SECRET' } }, otherCookie);
  const response = await post('/api/research', { query: 'Upcoming events relevant to my shop' }, cookie);
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.match(request.instructions, /ask for clarification/);
  for (const value of ['Mogra Studio', 'Jayanagar, Bengaluru', 'No same-day delivery', 'Within 5 km', 'weekend campaign']) assert(request.input.includes(value));
  assert.match(request.input, /"price":650,"currency":"INR"/);
  assert(!request.input.includes('OTHER TENANT SECRET'));
  assert(!request.input.includes('research@example.com'));
  assert(!request.input.includes('PRIVATE CUSTOMER CONVERSATION'));
  const me = await (await fetch(base + '/api/me', { headers: { Cookie: cookie } })).json();
  assert.match(me.messages.at(-1).text, /\*\*Local opportunity\*\*/);
  assert.match(me.messages.at(-1).text, /https:\/\/example.com\/events/);
  for (const path of ['/vendor/marked.js','/vendor/purify.js','/markdown.js','/voice.js']) {
    const asset = await fetch(base + path); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type')!, /javascript/);
  }
});
