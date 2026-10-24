import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createNetServer, connect, type Socket } from 'node:net';
for(const key of ['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','OWNER_MODEL','CUSTOMER_MODEL','VISION_MODEL']) delete process.env[key];
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebApp } from '../src/web.ts';

test('voice calls run owner setup and customer chat through the shared conversation turns', async t => {
 // Stand-in for the Pipecat service: records each proxied WebSocket handshake, accepts it and echoes bytes.
 const handshakes:string[]=[];const voiceSockets=new Set<Socket>();
 const voice=createNetServer(socket=>{voiceSockets.add(socket);let raw='';socket.on('data',function first(chunk){raw+=chunk;if(!raw.includes('\r\n\r\n'))return;socket.off('data',first);const [head,rest]=raw.split('\r\n\r\n');handshakes.push(head);socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');if(rest)socket.write('echo:'+rest);socket.on('data',c=>socket.write('echo:'+c));});});
 voice.listen(0,'127.0.0.1');await once(voice,'listening');const va=voice.address();assert(va&&typeof va!=='string');
 // Render's private-network reference has no scheme.
 process.env.VOICE_URL=`127.0.0.1:${va.port}`;process.env.VOICE_INTERNAL_SECRET='voice-secret-for-tests';
 const dir=mkdtempSync(join(tmpdir(),'dhanavi-voice-'));const server=createWebApp(join(dir,'data.json'));
 server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
 t.after(()=>{server.closeAllConnections();server.close();for(const s of voiceSockets)s.destroy();voice.close();rmSync(dir,{recursive:true,force:true});delete process.env.VOICE_URL;delete process.env.VOICE_INTERNAL_SECRET;});
 const request=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 // Opens a raw WebSocket upgrade through Node and returns the status line plus anything echoed back.
 const upgrade=(path:string,headers:Record<string,string>={},send='')=>new Promise<string>((resolve,reject)=>{const socket:Socket=connect(a.port,'127.0.0.1',()=>{socket.write([`GET ${path} HTTP/1.1`,`Host: 127.0.0.1:${a.port}`,'Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version: 13','Cookie: dhanavi_session=private',...Object.entries(headers).map(([k,v])=>`${k}: ${v}`)].join('\r\n')+'\r\n\r\n');if(send)setTimeout(()=>socket.write(send),50);});let out='';socket.on('data',c=>{out+=c;if(!send||out.includes('echo:'))socket.end();});socket.on('close',()=>resolve(out));socket.on('error',reject);setTimeout(()=>socket.destroy(),2000);});
 const turn=async(token:string,text='',secret='voice-secret-for-tests')=>{const r=await request('/api/voice/turn',{token,text},{'X-Voice-Secret':secret});return {status:r.status,...await r.json() as any};};

 const signup=await request('/api/auth/signup',{name:'Kavya',email:'kavya@example.com',password:'correct-horse-123'});const owner={Cookie:signup.headers.get('set-cookie')!.split(';')[0]};
 assert.equal((await(await request('/api/me',undefined,owner)).json()).voice,true);
 assert.equal((await request('/api/voice/start',{})).status,401,'voice needs a signed-in owner');
 const start=await request('/api/voice/start',{},owner);assert.equal(start.status,200);const ownerToken=(await start.json()).token;

 assert.match(await upgrade('/api/voice/ws?token=wrong'),/^HTTP\/1.1 401/);
 assert.match(await upgrade('/api/voice/ws?token='+ownerToken,{Origin:'https://evil.example'}),/^HTTP\/1.1 403/);
 assert.match(await upgrade('/api/voice/ws?token='+ownerToken,{Origin:`http://127.0.0.1:${a.port}`},'audio-bytes'),/^HTTP\/1.1 101[\s\S]*echo:audio-bytes/,'audio flows both ways');
 const handshake=handshakes.at(-1)!;
 assert.match(handshake,new RegExp(`^GET /ws\\?token=${ownerToken} `));assert.match(handshake,/X-Voice-Secret: voice-secret-for-tests/);assert.match(handshake,/sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==/);
 assert.doesNotMatch(handshake,/Cookie|dhanavi_session/i,'visitor cookies are not forwarded');
 assert.match(await upgrade('/api/voice/ws?token='+ownerToken),/^HTTP\/1.1 401/,'a token opens one call');

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
 const customerStart=await request('/api/public/'+me.business.slug+'/voice',{});assert.equal(customerStart.status,200);
 const guest={Cookie:customerStart.headers.get('set-cookie')!.split(';')[0]};const customerToken=(await customerStart.json()).token;
 assert.match((await turn(customerToken)).reply,/assistant for Mogra Studio/);
 assert.match((await turn(customerToken,'What are your opening hours?')).reply,/9 am/);
 const chat=await(await request('/api/public/'+me.business.slug,undefined,guest)).json();
 assert.deepEqual(chat.messages.map((m:any)=>m.sender),['customer','assistant']);

 assert.equal((await request('/api/voice/turn',{token:customerToken,end:true},{'X-Voice-Secret':'voice-secret-for-tests'})).status,200);
 assert.equal((await turn(customerToken,'Hello')).status,401,'ended calls cannot send more turns');
});
