import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
for(const key of ['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','OWNER_MODEL','CUSTOMER_MODEL','VISION_MODEL']) delete process.env[key];
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebApp } from '../src/web.ts';

test('voice calls run owner setup and customer chat through the shared conversation turns', async t => {
 // Stand-in for the Pipecat service: records each offer and returns an SDP answer.
 const offers:any[]=[];
 const voice=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;offers.push({secret:req.headers['x-voice-secret'],body:JSON.parse(raw)});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sdp:'answer-sdp',type:'answer',pc_id:'pc-1'}));});
 voice.listen(0,'127.0.0.1');await once(voice,'listening');const va=voice.address();assert(va&&typeof va!=='string');
 process.env.VOICE_URL=`http://127.0.0.1:${va.port}`;process.env.VOICE_INTERNAL_SECRET='voice-secret-for-tests';
 const dir=mkdtempSync(join(tmpdir(),'dhanavi-voice-'));const server=createWebApp(join(dir,'data.json'));
 server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
 t.after(()=>{server.closeAllConnections();server.close();voice.closeAllConnections();voice.close();rmSync(dir,{recursive:true,force:true});delete process.env.VOICE_URL;delete process.env.VOICE_INTERNAL_SECRET;});
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const turn=async(token:string,text='',secret='voice-secret-for-tests')=>{const r=await request('/api/voice/turn',{token,text},{'X-Voice-Secret':secret});return {status:r.status,...await r.json() as any};};

 const signup=await request('/api/auth/signup',{name:'Kavya',email:'kavya@example.com',password:'correct-horse-123'});const owner={Cookie:signup.headers.get('set-cookie')!.split(';')[0]};
 assert.equal((await(await request('/api/me',undefined,owner)).json()).voice,true);
 assert.equal((await request('/api/voice/offer',{sdp:'offer-sdp',type:'offer'})).status,401,'voice needs a signed-in owner');
 assert.equal((await request('/api/voice/offer',{sdp:'offer-sdp',type:'answer'},owner)).status,400);
 const offer=await request('/api/voice/offer',{sdp:'offer-sdp',type:'offer'},owner);assert.equal(offer.status,200);assert.deepEqual(await offer.json(),{sdp:'answer-sdp',type:'answer'});
 assert.equal(offers.at(-1).secret,'voice-secret-for-tests');assert.equal(offers.at(-1).body.sdp,'offer-sdp');const ownerToken=offers.at(-1).body.request_data.token;

 assert.equal((await turn(ownerToken,'hello','wrong-secret-for-the-tests')).status,403);
 assert.equal((await turn('not-a-token','hello')).status,401);
 assert.match((await turn(ownerToken)).reply,/I'm Dhanavi/,'opening line repeats the current setup question');
 assert.match((await turn(ownerToken,'Mogra Studio')).reply,/Got it/);
 assert.match((await turn(ownerToken,'Skip.')).reply,/Got it/,'spoken "Skip." skips the detail');
 await turn(ownerToken,'Jayanagar, Bengaluru');await turn(ownerToken,'Mon–Sat, 9 am–7 pm');
 let me=await(await request('/api/me',undefined,owner)).json();
 assert.equal(me.business.step,4);assert.equal(me.business.profile.name,'Mogra Studio');assert.equal(me.business.profile.pricing,undefined);
 assert.deepEqual(me.messages.filter((m:any)=>m.sender==='owner').map((m:any)=>m.text),['Mogra Studio','Skip.','Jayanagar, Bengaluru','Mon–Sat, 9 am–7 pm'],'spoken turns appear in the typed chat');

 assert.equal((await request('/api/business',{published:true},owner)).status,200);
 assert.equal((await(await request('/api/public/'+me.business.slug)).json()).voice,true);
 const customerOffer=await request('/api/public/'+me.business.slug+'/voice',{sdp:'customer-offer',type:'offer'});assert.equal(customerOffer.status,200);
 const guest={Cookie:customerOffer.headers.get('set-cookie')!.split(';')[0]};const customerToken=offers.at(-1).body.request_data.token;
 assert.match((await turn(customerToken)).reply,/assistant for Mogra Studio/);
 assert.match((await turn(customerToken,'What are your opening hours?')).reply,/9 am/);
 const chat=await(await request('/api/public/'+me.business.slug,undefined,guest)).json();
 assert.deepEqual(chat.messages.map((m:any)=>m.sender),['customer','assistant']);

 assert.equal((await request('/api/voice/turn',{token:customerToken,end:true},{'X-Voice-Secret':'voice-secret-for-tests'})).status,200);
 assert.equal((await turn(customerToken,'Hello')).status,401,'ended calls cannot send more turns');
});
