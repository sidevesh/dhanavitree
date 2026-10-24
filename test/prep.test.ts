import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebApp } from '../src/web.ts';

test('prepared questions: likely customer questions become saved answers the assistant reuses', async t => {
  process.env.DHANAVI_AUTO_PREP = 'off';
  const calls: any[] = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const request = JSON.parse(raw); calls.push(request);
    const system = String(request.messages[0]?.content || '');
    const content = system.startsWith('You prepare a small business')
      ? { questions: [{ question: 'Do you have parking?', suggestion: '' }, { question: 'Do you deliver?', suggestion: 'Delivery within 3 km.' }, { question: 'What are your hours?', suggestion: '' }] }
      : { answer: 'Yes, free parking is available behind the cafe.', needsOwner: false };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening'); const pa = provider.address(); assert(pa && typeof pa !== 'string');
  Object.assign(process.env, { LLM_BASE_URL: `http://127.0.0.1:${pa.port}/v1`, LLM_API_KEY: 'test', LLM_MODEL: 'test-model' });
  const dir = mkdtempSync(join(tmpdir(), 'dhanavi-prep-')); const server = createWebApp(join(dir, 'data.json'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const a = server.address(); assert(a && typeof a !== 'string');
  t.after(() => { server.closeAllConnections(); server.close(); provider.closeAllConnections(); provider.close(); rmSync(dir, { recursive: true, force: true }); for (const k of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'DHANAVI_AUTO_PREP']) delete process.env[k]; });
  const base = `http://127.0.0.1:${a.port}`; let cookie = '';
  const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }); if (!cookie) cookie = r.headers.get('set-cookie')!.split(';')[0]!; return r; };
  const me = async () => (await fetch(base + '/api/me', { headers: { Cookie: cookie } })).json() as any;

  await post('/api/auth/signup', { email: 'owner@example.com', password: 'correct-horse-123', name: 'Asha' });
  await post('/api/business', { profile: { name: 'Mogra Cafe', pricing: 'Coffee ₹120', location: 'Jayanagar', hours: '9 am–9 pm' }, published: true });
  let state;
  assert.equal((await post('/api/prep/refresh', {})).status, 200);
  state = await me();
  const questions = state.prep.questions.map((q: any) => q.question);
  assert.deepEqual(questions, ['Do you have parking?', 'Do you deliver?', 'What are your hours?']);
  assert.equal(state.prep.questions[1].suggestion, 'Delivery within 3 km.', 'suggestions are kept for the owner to confirm');
  const research = JSON.parse(calls.at(-1).messages.at(-1).content);
  assert.equal(research.profile.name, 'Mogra Cafe', 'the business profile is sent as context');

  // A second run does not duplicate questions.
  assert.equal((await (await post('/api/prep/refresh', {})).json() as any).added, 0);

  const [parking, delivery, hours] = state.prep.questions;
  assert.equal((await post(`/api/prep/${parking.id}/answer`, { answer: 'Free parking behind the cafe.' })).status, 200);
  assert.equal((await post(`/api/prep/${delivery.id}/dismiss`, {})).status, 200);
  assert.equal((await post(`/api/prep/${parking.id}/answer`, { answer: 'again' })).status, 404, 'a question is handled once');
  assert.equal((await post(`/api/prep/${hours.id}/answer`, { answer: '' })).status, 400);
  state = await me();
  assert.deepEqual(state.prep.questions.map((q: any) => q.question), ['What are your hours?']);
  assert.ok(state.facts.some((f: any) => f.question === 'Do you have parking?' && f.answer === 'Free parking behind the cafe.'), 'answers are saved to memory');
});
