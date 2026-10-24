import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

function renderer() {
  const dom = new JSDOM('<div id="result"></div>', { url: 'https://shop.test/app', runScripts: 'outside-only' });
  for (const file of ['node_modules/marked/lib/marked.umd.js', 'node_modules/dompurify/dist/purify.min.js', 'public/markdown.js']) {
    dom.window.eval(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  }
  return dom;
}

test('assistant Markdown renders headings, lists, tables, code and safe citation links', () => {
  const dom = renderer();
  const result = dom.window.document.querySelector('#result');
  result.innerHTML = dom.window.renderAssistantMarkdown('# Ideas\n\n**Bouquets** and *gifts*\n\n1. Start local\n2. Share a draft\n\n| Item | Price |\n| --- | --- |\n| Roses | ₹650 |\n\n```html\n<script>alert(1)</script>\n```\n\n[Official source](https://example.com/events)');
  assert.equal(result.querySelector('h1').textContent, 'Ideas');
  assert.equal(result.querySelector('strong').textContent, 'Bouquets');
  assert.equal(result.querySelectorAll('ol li').length, 2);
  assert.equal(result.querySelector('td').textContent, 'Roses');
  assert.equal(result.querySelector('pre code').textContent.trim(), '<script>alert(1)</script>');
  assert.equal(result.querySelector('script'), null);
  const link = result.querySelector('a');
  assert.equal(link.href, 'https://example.com/events');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  dom.window.close();
});

test('model HTML cannot execute scripts, embed remote images or create unsafe links', () => {
  const dom = renderer();
  const result = dom.window.document.querySelector('#result');
  result.innerHTML = dom.window.renderAssistantMarkdown('<script>alert(1)</script><img src="https://tracker.test/pixel" onerror="alert(1)"><iframe src="https://evil.test"></iframe><svg onload="alert(1)"></svg>\n\n[bad](javascript:alert%281%29) [data](data:text/html,evil)\n\n<a href="jav&#x61;script:alert(1)" onclick="alert(1)">encoded</a><p style="position:fixed" id="app">hello</p>');
  assert.equal(result.querySelector('script,img,iframe,svg,[onclick],[onerror],[onload],[style],[id]'), null);
  for (const link of result.querySelectorAll('a')) assert.equal(link.hasAttribute('href'), false);
  assert.match(result.textContent, /hello/);
  dom.window.close();
});

test('owner and public conversations format assistant replies while preserving user text literally', async () => {
  for (const customer of [false, true]) {
    const dom = renderer();
    dom.reconfigure({ url: customer ? 'https://shop.test/b/mogra' : 'https://shop.test/app' });
    dom.window.document.body.innerHTML = '<div id="app"></div><div id="toast" hidden></div>';
    const messages = [
      { sender: customer ? 'customer' : 'owner', text: '**literal** <img src=x onerror=alert(1)>', created: new Date().toISOString() },
      { sender: 'assistant', text: '**Formatted** [source](https://example.com)', created: new Date().toISOString() },
    ];
    const state = { owner: { name: 'Owner', email: 'owner@example.com' }, business: { profile: { name: 'Mogra' }, published: true, step: 4, slug: 'mogra' }, messages, questions: [], threads: [], facts: [], drafts: [], orders: [], catalog: [] };
    dom.window.fetch = async () => ({ ok: true, json: async () => state });
    dom.window.eval(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    if (!customer) dom.window.document.querySelector('[data-view="assistant"]').click();
    assert.equal(dom.window.document.querySelector('.mine .message-content').textContent, messages[0].text);
    assert.equal(dom.window.document.querySelector('.mine strong,.mine img'), null);
    assert.equal(dom.window.document.querySelector('.markdown strong').textContent, 'Formatted');
    assert.equal(dom.window.document.querySelector('.markdown a').rel, 'noopener noreferrer');
    dom.window.close();
  }
});

test('Continue setup opens its own log and sends answers to setup without mixing chat drafts', async t => {
  const dom=renderer();t.after(()=>dom.window.close());dom.window.document.body.innerHTML='<div id="app"></div><div id="toast" hidden></div>';
  const state:any={owner:{name:'Owner',email:'owner@example.com'},business:{profile:{name:'Mogra'},step:1,published:false,slug:'mogra'},questions:[],threads:[],facts:[],drafts:[],creatives:[],commerce:{orders:[]},messages:[{sender:'assistant',text:'RESEARCH_ONLY **findings**',created:new Date().toISOString()}],setup:{complete:false,question:'What are your prices?',messages:[{sender:'assistant',text:'SETUP_ONLY What are your prices?',created:new Date().toISOString()}]}};
  const posts:any[]=[];
  dom.window.fetch=async(path:string,options:any)=>{
    if(options?.body){posts.push({path,body:JSON.parse(options.body)});state.setup.messages.push({sender:'owner',text:JSON.parse(options.body).text,created:new Date().toISOString()});}
    return{ok:true,json:async()=>options?.body?{ok:true}:state};
  };
  dom.window.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));await new Promise(resolve=>setImmediate(resolve));
  const doc=dom.window.document;
  doc.querySelector('[data-view="assistant"]').click();doc.querySelector('#owner-input').value='CHAT_DRAFT';
  doc.querySelector('[data-view="today"]').click();doc.querySelector('[data-go="setup"]').click();
  assert.match(doc.querySelector('#owner-messages').textContent,/SETUP_ONLY/);assert.doesNotMatch(doc.querySelector('#owner-messages').textContent,/RESEARCH_ONLY/);
  assert.equal(doc.querySelector('#setup-input').value,'');assert(doc.querySelector('#skip-step'));
  doc.querySelector('#setup-input').value='Bouquets ₹650';doc.querySelector('#owner-compose').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(posts[0].path,'/api/owner/setup');assert.deepEqual(posts[0].body,{text:'Bouquets ₹650'});
  doc.querySelector('[data-view="assistant"]').click();assert.match(doc.querySelector('#owner-messages').textContent,/RESEARCH_ONLY/);assert.doesNotMatch(doc.querySelector('#owner-messages').textContent,/SETUP_ONLY/);
  assert.equal(doc.querySelector('#owner-input').value,'CHAT_DRAFT');assert.equal(doc.querySelector('#skip-step'),null);
  state.business.step=4;state.setup.complete=true;
  doc.querySelector('[data-view="today"]').click();assert.equal(doc.querySelector('[data-go="setup"]'),null);
  dom.window.close();
});
