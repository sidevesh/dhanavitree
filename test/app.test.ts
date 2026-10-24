import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.ts';

const config = { verifyToken: 'test-verification', appSecret: 'test-secret', accessToken: 'test-access', phoneNumberId: '123', graphVersion: 'v23.0' };

test('webhook verification, signed replies, duplicate events and retry behavior', async (t) => {
  const sent: Array<{ url: string; body: any }> = [];
  let fail = false;
  const server = createApp(config, (async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return new Response('{}', { status: fail ? 500 : 200 });
  }) as typeof fetch);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const event = (id: string, type = 'text', phone = '123') => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: phone },
      messages: [{ id, from: '919000000000', type, text: { body: 'Hello' } }],
    } }] }],
  });
  const post = (body: string, signed = true) => fetch(`${base}/webhook`, {
    method: 'POST', body,
    headers: signed ? { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', config.appSecret).update(body).digest('hex') } : {},
  });

  assert.equal(await (await fetch(`${base}/health`)).text(), 'ok');
  const verified = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=test-verification&hub.challenge=12345`);
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), '12345');
  assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`)).status, 403);
  assert.equal((await post(event('unsigned'), false)).status, 401);
  assert.equal(sent.length, 0);
  assert.equal((await post('{bad json')).status, 400);
  assert.equal((await post(event('one'))).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://graph.facebook.com/v23.0/123/messages');
  assert.equal(sent[0].body.to, '919000000000');
  assert.equal(sent[0].body.messaging_product, 'whatsapp');
  assert.match(sent[0].body.text.body, /assistant is connected/);
  assert.equal((await post(event('one'))).status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await post(event('image', 'image'))).status, 200);
  assert.equal((await post(event('other-phone', 'text', '456'))).status, 200);
  assert.equal((await post(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ status: 'delivered' }] } }] }] }))).status, 200);
  assert.equal(sent.length, 1);
  fail = true;
  assert.equal((await post(event('retry'))).status, 503);
  fail = false;
  assert.equal((await post(event('retry'))).status, 200);
  assert.equal(sent.length, 3);
});
