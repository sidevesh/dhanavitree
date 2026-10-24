import { onboardingFixture } from './fixtures/onboarding.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebApp } from '../src/web.ts';

test('HITL chat answers are usable, profile edits need approval, and agent failures fall back',async t=>{
  const keys=['AGENTICORG_BASE_URL','AGENTICORG_API_KEY','AGENTICORG_OWNER_AGENT_ID','AGENTICORG_CUSTOMER_AGENT_ID','AGENTICORG_AGENT_ID','LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','OWNER_MODEL','CUSTOMER_MODEL'];
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  let failure=false,empty=false,directCalls=0;
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
    if(req.url?.endsWith('/run')){
      assert.equal(req.headers.authorization,'Bearer fixture-agent-key');
      if(failure){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"temporary failure"}');return;}
      const output=onboardingFixture(input.inputs.system,input.inputs.messages)|| (req.url.includes('customer-agent')?{answer:'Bouquets start at ₹650.',needsOwner:false}:{reply:'I prepared your new hours for review.',updates:{hours:'Monday–Friday 10–6'}});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({run_id:'fixture-run',status:'hitl_triggered',hitl_trigger:true,output:empty?null:JSON.stringify(output)}));return;
    }
    assert.equal(req.url,'/v1/chat/completions');directCalls++;
    assert.equal(input.model,'fallback-model');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Your assistant is available. What would you like to work on?',updates:{}})}}]}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');const pa=provider.address();assert(pa&&typeof pa!=='string');
  Object.assign(process.env,{AGENTICORG_BASE_URL:`http://127.0.0.1:${pa.port}`,AGENTICORG_API_KEY:'fixture-agent-key',AGENTICORG_OWNER_AGENT_ID:'owner-agent',AGENTICORG_CUSTOMER_AGENT_ID:'customer-agent',LLM_BASE_URL:`http://127.0.0.1:${pa.port}/v1`,LLM_API_KEY:'fixture-model-key',LLM_MODEL:'fallback-model'});
  const dir=mkdtempSync(join(tmpdir(),'dhanavi-agents-'));const server=createWebApp(join(dir,'data.json'));server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
  t.after(async()=>{server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>provider.close(r))]);rmSync(dir,{recursive:true,force:true});for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
  const post=(path:string,body:unknown,cookie='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  const signup=await post('/api/auth/signup',{name:'Kavya',email:'agent-owner@example.com',password:'correct-password'});assert.equal(signup.status,201);const cookie=signup.headers.get('set-cookie')!.split(';')[0];
  const me=async()=>await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();
  for(const text of ['Mogra','Bouquets from ₹650','Bengaluru, shop@example.com','Monday–Saturday 9–7'])assert.equal((await post('/api/owner/setup',{text},cookie)).status,201);
  await post('/api/business',{published:true},cookie);
  await post('/api/owner/chat',{text:'Change our hours to Monday–Friday 10–6.'},cookie);
  let state=await me();assert.match(state.messages.at(-1).text,/prepared/);assert.equal(state.business.profile.hours,'Monday–Saturday 9–7');assert.equal(state.drafts[0].changes.hours,'Monday–Friday 10–6');assert.equal(state.commerce.runs[0].hitl,1);assert.equal(directCalls,1,'onboarding validation uses AgenticOrg; only catalog extraction calls the text model directly');
  const customer=await post('/api/public/'+state.business.slug+'/messages',{text:'How much is a bouquet?'});assert.equal(customer.status,201);const guest=customer.headers.get('set-cookie')!.split(';')[0];
  const chat=await(await fetch(base+'/api/public/'+state.business.slug,{headers:{Cookie:guest}})).json();assert.equal(chat.messages.at(-1).text,'Bouquets start at ₹650.');
  failure=true;await post('/api/owner/chat',{text:'Help me plan next week.'},cookie);state=await me();assert.match(state.messages.at(-1).text,/assistant is available/);assert.equal(directCalls,2);assert.equal(state.commerce.runs[0].status,'failed');
  failure=false;empty=true;await post('/api/owner/chat',{text:'What can I improve?'},cookie);assert.equal(directCalls,3,'empty HITL output falls back to the text model');
});
