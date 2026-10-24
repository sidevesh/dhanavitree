import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { JSDOM }=createRequire(import.meta.url)('jsdom');

function fixture(t:any,{supported=true,prefixed=false,app=false,customer=false}={}){
  const dom=new JSDOM(app?'<div id="app"></div><div id="toast" hidden></div>':'<form class="compose"><textarea id="message" maxlength="100"></textarea><button type="submit">Send</button></form>',{url:customer?'https://shop.test/b/mogra':'https://shop.test/app',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());const w=dom.window,doc=w.document;const instances:any[]=[],errors:string[]=[],drafts:string[]=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  class Recognition{
    onstart?:()=>void;onend?:()=>void;onerror?:(event:any)=>void;onresult?:(event:any)=>void;aborted=false;stopped=false;
    constructor(){instances.push(this);}
    start(){this.onstart?.();}
    stop(){this.stopped=true;}
    abort(){this.aborted=true;this.onend?.();}
    result(entries:[string,boolean][]){this.onresult?.({results:entries.map(([transcript,isFinal])=>Object.assign([{transcript}],{isFinal}))});}
  }
  if(supported)w[prefixed?'webkitSpeechRecognition':'SpeechRecognition']=Recognition;
  for(const file of app?['node_modules/marked/lib/marked.umd.js','node_modules/dompurify/dist/purify.min.js','public/markdown.js','public/voice.js']:['public/voice.js'])w.eval(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  if(!app)w.DhanaviVoice.attach({form:doc.querySelector('form'),input:doc.querySelector('textarea'),onDraft:(v:string)=>drafts.push(v),onError:(e:string)=>errors.push(e)});
  const choose=(code='en-IN')=>{doc.querySelector('.voice-button').click();doc.querySelector(`[data-language="${code}"]`).click();return instances.at(-1);};
  return{dom,w,doc,instances,errors,drafts,choose};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('every Voice click asks for English, Hindi or Kannada before starting recognition',t=>{
  const {w,doc,instances,choose}=fixture(t,{prefixed:true});
  doc.querySelector('.voice-button').click();assert.equal(instances.length,0,'opening the picker never starts the microphone');
  assert.deepEqual([...doc.querySelectorAll('.voice-language')].map((b:any)=>[b.getAttribute('aria-label'),b.dataset.language]),[['English','en-IN'],['Hindi','hi-IN'],['Kannada','kn-IN']]);
  doc.querySelector('.voice-cancel').click();assert.equal(w.DhanaviVoice.isBusy(),false);assert.equal(instances.length,0);
  for(const code of ['en-IN','hi-IN','kn-IN']){
    const r=choose(code);assert.equal(r.lang,code);assert.equal(r.continuous,true);assert.equal(r.interimResults,true);assert.equal(doc.querySelector('.voice-button').getAttribute('aria-pressed'),'true');
    r.onend();assert.equal(w.DhanaviVoice.isBusy(),false);assert.equal(doc.querySelector('.voice-button').getAttribute('aria-pressed'),'false');
  }
});

test('dictation updates interim words without duplication, preserves typed text and never auto-sends',t=>{
  const {doc,choose,drafts}=fixture(t);const input=doc.querySelector('textarea');input.value='Draft';input.setSelectionRange(5,5);let sends=0;doc.querySelector('form').addEventListener('submit',(e:any)=>{e.preventDefault();sends++;});
  const r=choose('hi-IN');r.result([['नम',false]]);assert.equal(input.value,'Draft नम');
  r.result([['नमस्ते',true],['दु',false]]);assert.equal(input.value,'Draft नमस्ते दु');
  r.result([['नमस्ते',true],['दुनिया',true]]);assert.equal(input.value,'Draft नमस्ते दुनिया');
  doc.querySelector('.voice-button').click();assert.equal(r.stopped,true);r.result([['नमस्ते',true],['दुनिया!',true]]);r.onend();
  assert.equal(input.value,'Draft नमस्ते दुनिया!');assert.equal(drafts.at(-1),input.value);assert.equal(sends,0);
});

test('view changes and manual edits stop the mic and ignore late results; submit commits only final words',t=>{
  const {w,doc,choose}=fixture(t);const input=doc.querySelector('textarea');input.value='Existing';input.setSelectionRange(8,8);
  const old=choose('kn-IN');old.result([['ನಮಸ್ಕಾರ',true],['unfinished',false]]);w.DhanaviVoice.reset();
  assert.equal(input.value,'Existing ನಮಸ್ಕಾರ');assert.equal(old.aborted,true);old.result([['LATE',true]]);assert.equal(input.value,'Existing ನಮಸ್ಕಾರ');
  const current=choose();current.result([['voice draft',false]]);input.value='Manually edited';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(current.aborted,true);
  current.result([['overwrite',true]]);assert.equal(input.value,'Manually edited');
  input.setSelectionRange(input.value.length,input.value.length);const next=choose();next.result([['ready',true],['not final',false]]);
  let sent='';doc.querySelector('form').addEventListener('submit',(e:any)=>{e.preventDefault();sent=input.value;});doc.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal(sent,'Manually edited ready');assert.equal(next.aborted,true);assert.equal(w.DhanaviVoice.isBusy(),false);
});

test('unsupported browsers, denied microphones and unavailable languages preserve drafts and offer typing',t=>{
  const unsupported=fixture(t,{supported:false});unsupported.doc.querySelector('textarea').value='Keep this';unsupported.doc.querySelector('.voice-button').click();assert.match(unsupported.errors[0],/not supported/);assert.equal(unsupported.doc.querySelector('textarea').value,'Keep this');
  const {w,doc,choose,errors}=fixture(t);const input=doc.querySelector('textarea');input.value='Existing draft';input.setSelectionRange(input.value.length,input.value.length);
  const r=choose();r.onerror({error:'not-allowed'});assert.equal(input.value,'Existing draft');assert.equal(r.aborted,true);assert.equal(w.DhanaviVoice.isBusy(),false);assert.match(errors.at(-1)!,/Microphone access was blocked/);
  const kn=choose('kn-IN');kn.onerror({error:'language-not-supported'});assert.match(errors.at(-1)!,/Kannada/);assert.equal(input.value,'Existing draft');assert.equal(doc.querySelector('button[type="submit"]').disabled,false);
});

test('dictation respects message limits without truncating existing text around the cursor',t=>{
  const {doc,choose}=fixture(t);const input=doc.querySelector('textarea');input.value='ABCDE';input.maxLength=8;input.setSelectionRange(2,2);const r=choose();r.result([['xyz',true]]);r.onend();assert.equal(input.value,'AB x CDE');assert.equal(input.selectionStart,4);assert.match(doc.querySelector('.voice-status').textContent,/limit/);
});

function stateFixture(){return{owner:{name:'Owner',email:'owner@example.com'},business:{profile:{name:'Mogra'},step:1,published:true,slug:'mogra'},questions:[],threads:[],facts:[],drafts:[],creatives:[],orders:[],catalog:[],commerce:{orders:[]},messages:[],setup:{complete:false,question:'What are your prices?',messages:[{sender:'assistant',text:'What are your prices?',created:new Date().toISOString()}]}};}

test('owner polling cannot replace a dictation draft, including an already in-flight request',async t=>{
  const {w,doc,choose}=fixture(t,{app:true});const state=stateFixture();let poll:()=>void;let requests=0;let resolvePending:(value:any)=>void;let defer=false;
  w.setInterval=(fn:()=>void)=>{poll=fn;return 1;};
  w.fetch=async()=>{requests++;if(defer)return new Promise(resolve=>{resolvePending=resolve;});return{ok:true,json:async()=>state};};
  w.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));await tick();doc.querySelector('[data-view="assistant"]').click();
  defer=true;poll!();const input=doc.querySelector('#owner-input');const r=choose();r.result([['Keep this dictation',true]]);
  resolvePending!({ok:true,json:async()=>({...state,messages:[{sender:'assistant',text:'new message',created:new Date().toISOString()}]})});await tick();
  assert.equal(doc.querySelector('#owner-input'),input);assert.equal(input.value,'Keep this dictation');const before=requests;poll!();assert.equal(requests,before);
  doc.querySelector('[data-view="today"]').click();assert.equal(r.aborted,true);doc.querySelector('[data-view="assistant"]').click();assert.equal(doc.querySelector('#owner-input').value,'Keep this dictation');
});

test('setup and customer dictation send only text, and the Voice button never submits chat',async t=>{
  for(const customer of [false,true]){
    const {w,doc,choose,instances}=fixture(t,{app:true,customer});const state=stateFixture();const posts:any[]=[];
    w.fetch=async(path:string,options:any)=>{if(options?.body)posts.push({path,body:JSON.parse(options.body)});return{ok:true,json:async()=>options?.body?{ok:true}:state};};
    w.eval(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));await tick();
    if(!customer)doc.querySelector('[data-go="setup"]').click();
    doc.querySelector('.voice-button').click();assert.equal(posts.length,0);assert.equal(instances.length,0);doc.querySelector('.voice-cancel').click();
    const r=choose('kn-IN');r.result([['ನಮಸ್ಕಾರ',true]]);r.onend();assert.equal(posts.length,0);
    const form=doc.querySelector('form.compose');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.equal(posts.length,1);assert.equal(posts[0].path,customer?'/api/public/mogra/messages':'/api/owner/setup');assert.deepEqual(posts[0].body,{text:'ನಮಸ್ಕಾರ'});assert.equal(doc.querySelector('button[type="submit"]').disabled,false);
  }
});
