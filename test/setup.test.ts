import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWebApp } from '../src/web.ts';
import { onboardingFixture } from './fixtures/onboarding.ts';

test('setup is durable and isolated from everyday chat, research, uploads and other owners', async t => {
  const keys=['DHANAVI_AUTO_PREP','LLM_PROVIDER','LLM_API_KEY','LLM_BASE_URL','LLM_MODEL','OWNER_MODEL','AGENTICORG_API_KEY'];
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const key of keys)delete process.env[key];
  Object.assign(process.env,{DHANAVI_AUTO_PREP:'off',LLM_PROVIDER:'openai',LLM_API_KEY:'fixture',LLM_BASE_URL:'https://setup.test/v1',LLM_MODEL:'fixture'});
  const dir=mkdtempSync(join(tmpdir(),'dhanavi-setup-'));let server=createWebApp(join(dir,'data.json'));let base='';
  const start=async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');base=`http://127.0.0.1:${a.port}`;};
  const stop=async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));};
  const realFetch=globalThis.fetch;const calls:any[]=[];
  globalThis.fetch=async(url,options)=>{
    if(!String(url).startsWith('https://setup.test/'))return realFetch(url,options);
    const body=JSON.parse(String(options?.body));calls.push(body);
    if(String(url).endsWith('/responses'))return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'**Research result:** local campaign opportunities.',annotations:[]}]}]});
    const output=onboardingFixture(body.messages[0].content,body.messages)||{reply:'Let’s work through your question.',updates:{}};
    return Response.json({choices:[{message:{content:JSON.stringify(output)}}]});
  };
  t.after(async()=>{globalThis.fetch=realFetch;if(server.listening)await stop();rmSync(dir,{recursive:true,force:true});for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
  await start();let cookie='';
  const post=(path:string,body:unknown,c=cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:c},body:JSON.stringify(body)});
  const me=async(c=cookie)=>await(await fetch(base+'/api/me',{headers:{Cookie:c}})).json();
  const signup=await post('/api/auth/signup',{name:'Owner',email:'setup@example.com',password:'correct-password'});cookie=signup.headers.get('set-cookie')!.split(';')[0];
  let state=await me();assert.match(state.setup.messages[0].text,/business called/);assert.equal(state.setup.question,state.setup.messages[0].text);assert.equal(state.setup.complete,false);
  assert.equal((await post('/api/owner/setup',{text:'skip'},'')).status,401);
  await post('/api/owner/chat',{text:'How can I get more customers?'});
  state=await me();assert.equal(state.business.step,0);assert.equal(state.setup.messages.length,1);assert.match(state.messages.at(-1).text,/Research result/);
  await post('/api/owner/setup',{text:'Mogra Studio'});
  state=await me();assert.equal(state.business.step,1);assert.equal(state.business.profile.name,'Mogra Studio');assert.equal(state.setup.messages.length,3);
  assert(!state.messages.some((m:any)=>m.text==='Mogra Studio'));assert(!state.setup.messages.some((m:any)=>m.text.includes('Research result')));
  const extraction=JSON.parse(calls.at(-1).messages.at(-1).content);assert(!JSON.stringify(extraction.conversation).includes('more customers'));
  await post('/api/owner/chat',{text:'Help me plan my workday.'});
  assert.match(calls.at(-1).messages[0].content,/Mogra Studio/);assert(!calls.at(-1).messages.some((m:any)=>m.content==='Mogra Studio'));
  state=await me();assert.equal(state.business.step,1);const mainLog=state.messages;
  await post('/api/files',{name:'menu.txt',mime:'text/plain',content:Buffer.from('Bouquets from ₹650').toString('base64'),context:'setup'});
  state=await me();assert.deepEqual(state.messages,mainLog);assert.match(state.setup.messages.at(-1).text,/menu.txt/);assert.equal(state.business.step,1);
  const setupLog=state.setup.messages;
  await stop();server=createWebApp(join(dir,'data.json'));await start();
  state=await me();assert.deepEqual(state.setup.messages,setupLog);assert.deepEqual(state.messages,mainLog);assert.equal(state.business.step,1);
  const other=await post('/api/auth/signup',{name:'Other',email:'other-setup@example.com',password:'correct-password'});const otherCookie=other.headers.get('set-cookie')!.split(';')[0];
  const otherState=await me(otherCookie);assert.equal(otherState.setup.messages.length,1);assert(!JSON.stringify(otherState).includes('Mogra Studio'));
  for(let i=0;i<3;i++)assert.equal((await post('/api/owner/setup',{text:'skip'})).status,201);
  state=await me();assert.equal(state.business.step,4);assert.equal(state.setup.complete,true);assert.equal(state.setup.question,null);assert.deepEqual(state.messages,mainLog);
  const completedLog=state.setup.messages;assert.equal((await post('/api/owner/setup',{text:'Another answer'})).status,409);assert.deepEqual((await me()).setup.messages,completedLog);
});

test('existing mixed history and profile remain intact while setup resumes from its saved question',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'dhanavi-legacy-'));let server=createWebApp(join(dir,'data.json'));let base='';
  const start=async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');base=`http://127.0.0.1:${a.port}`;};
  const stop=async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));};
  t.after(async()=>{if(server.listening)await stop();rmSync(dir,{recursive:true,force:true});});await start();
  const signup=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Legacy',email:'legacy@example.com',password:'correct-password'})});const cookie=signup.headers.get('set-cookie')!.split(';')[0];
  await stop();const db=new DatabaseSync(join(dir,'platform.sqlite'));
  // Reproduce a database from before setup had a separate table.
  db.exec('DROP TABLE setup_messages');const profile={name:'Legacy Shop',offerings:'Flowers',pricing:'Bouquets ₹650'};
  db.prepare('UPDATE businesses SET step=2,profile=?').run(JSON.stringify(profile));const b=db.prepare('SELECT id FROM businesses').get()!;
  db.prepare('INSERT INTO owner_messages VALUES(?,?,?,?,?)').run('old-research',b.id,'assistant','Legacy research and onboarding history',new Date().toISOString());db.close();
  server=createWebApp(join(dir,'data.json'));await start();const me=async()=>await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();
  let state=await me();assert.equal(state.business.step,2);assert.deepEqual(state.business.profile,profile);assert.match(state.setup.messages[0].text,/Where are you/);assert.equal(state.setup.messages.length,1);assert(state.messages.some((m:any)=>m.id==='old-research'));
  const logs={setup:state.setup.messages,chat:state.messages};await stop();server=createWebApp(join(dir,'data.json'));await start();state=await me();assert.deepEqual(state.setup.messages,logs.setup);assert.deepEqual(state.messages,logs.chat);
});
