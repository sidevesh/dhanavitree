import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCommerce } from '../src/commerce.ts';
import { research, imageConfig, complete } from '../src/providers.ts';

test('approved prices, durable idempotency, payment verification and tenant isolation', async t => {
  const keys=['PINELABS_CLIENT_ID','PINELABS_CLIENT_SECRET','PINELABS_BASE_URL','PUBLIC_URL','AGENTICORG_API_KEY','AGENTICORG_ORDER_AGENT_ID'];
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{PINELABS_CLIENT_ID:'fixture',PINELABS_CLIENT_SECRET:'fixture',PINELABS_BASE_URL:'https://pine.test',PUBLIC_URL:'https://shop.test',AGENTICORG_API_KEY:'fixture',AGENTICORG_ORDER_AGENT_ID:'reviewer'});
  const db=new DatabaseSync(':memory:');const messages:string[]=[];let c=createCommerce(db,(_thread,text)=>messages.push(text));
  const realFetch=globalThis.fetch;let creates=0,failCreate=true,status='CREATED',reference='',value=130000;
  const references:string[]=[];
  globalThis.fetch=async (url,options)=>{
    const path=new URL(String(url)).pathname;const input=options?.body?JSON.parse(String(options.body)):null;
    if(path==='/api/auth/v1/token')return Response.json({access_token:'fixture',expires_at:new Date(Date.now()+3600000).toISOString()});
    if(path==='/api/pay/v1/paymentlink'&&options?.method==='POST'){
      creates++;references.push(input.merchant_payment_link_reference);reference=input.merchant_payment_link_reference;
      assert.deepEqual(input.amount,{value:130000,currency:'INR'});assert.equal(input.customer.email_id,'guest@example.com');assert.equal(input.part_payment,false);
      if(failCreate)throw Error('Simulated timeout after provider may have created a link');
      return Response.json({payment_link_id:'pine-1',payment_link:'https://pay.test/link-1'});
    }
    if(path==='/api/pay/v1/paymentlink/pine-1')return Response.json({payment_link_id:'pine-1',merchant_payment_link_reference:reference,amount:{value,currency:'INR'},amount_due:{value:status==='PROCESSED'?0:130000,currency:'INR'},status});
    if(path.endsWith('/reviewer/run'))return Response.json({run_id:'run-1',status:'completed',hitl_trigger:true,output:'{"recommendation":"APPROVE"}'});
    throw Error('Unexpected external request '+path);
  };
  t.after(()=>{globalThis.fetch=realFetch;db.close();for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
  c.saveSettings('shop',{catalog:[{id:'flowers',name:'Bouquet',price:65000}],autoCheckout:true});
  assert.throws(()=>c.saveSettings('shop',{catalog:[{id:'bad',name:'Bad',price:1.5}]}),/price/);
  const b={id:'shop',slug:'flowers'},thread={id:'guest-thread'};
  const input={requestKey:'request-1234',items:[{id:'flowers',quantity:2,price:1}],customer:{name:'Test Guest',email:'guest@example.com',phone:'9999999999'}};
  await assert.rejects(()=>c.purchase(b,thread,{...input,items:[{id:'missing',quantity:1}]}),/available/);
  await assert.rejects(()=>c.purchase(b,thread,input),/timeout/);
  let order=c.publicOrders(thread.id)[0];assert.equal(order.status,'approved');assert.equal(order.amount,130000);assert.equal(messages.length,1);
  // Rebuild the service against the same database to simulate restart after a lost response.
  c=createCommerce(db,(_thread,text)=>messages.push(text));failCreate=false;
  order=await c.purchase(b,thread,input);assert.equal(order.status,'link_sent');assert.equal(c.publicOrders(thread.id).length,1);assert.equal(creates,2);assert.equal(references[0],references[1]);
  await c.purchase(b,thread,input);assert.equal(creates,2,'replayed request reuses existing link');
  assert.equal(c.ownerState('another-shop').orders.length,0);
  await assert.rejects(()=>c.action('another-shop',b.slug,order.id,'approve'),/not found/);
  await assert.rejects(()=>c.action(b.id,b.slug,order.id,'refresh','another-guest'),/not found/);
  await c.action(b.id,b.slug,order.id,'review');assert.equal((c.ownerState(b.id).runs[0] as Record<string,unknown>).hitl,1);assert.equal(c.publicOrders(thread.id)[0].status,'link_sent','agent review cannot mark paid');
  status='PARTIAL_PROCESSED';await c.action(b.id,b.slug,order.id,'refresh');assert.equal(c.publicOrders(thread.id)[0].status,'link_sent');
  status='PROCESSED';value=1;await assert.rejects(()=>c.action(b.id,b.slug,order.id,'refresh'),/did not match/);assert.equal(c.publicOrders(thread.id)[0].status,'link_sent');
  value=130000;const correct=reference;reference='wrong-order';await assert.rejects(()=>c.action(b.id,b.slug,order.id,'refresh'),/did not match/);reference=correct;
  await c.action(b.id,b.slug,order.id,'refresh');assert.equal(c.publicOrders(thread.id)[0].status,'paid');
  await c.action(b.id,b.slug,order.id,'refresh');assert.equal(messages.filter(m=>m.includes('verified by Pine Labs')).length,1);
  c.saveSettings('shop',{catalog:[{id:'flowers',name:'Bouquet',price:65000}],autoCheckout:false});
  const requested=await c.purchase(b,thread,{...input,requestKey:'manual-request'});assert.equal(requested.status,'requested');assert.equal(creates,2);
  await c.action(b.id,b.slug,requested.id,'review');assert.equal(c.publicOrders(thread.id)[0].status,'requested','HITL review cannot approve a payment request');
  await c.action(b.id,b.slug,requested.id,'approve');assert.equal(c.publicOrders(thread.id)[0].status,'link_sent');
});

test('Meta research uses Responses search with citations and shares image credentials',async t=>{
  const keys=['LLM_PROVIDER','LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','IMAGE_BASE_URL','IMAGE_API_KEY','IMAGE_MODEL'];const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{LLM_PROVIDER:'meta',LLM_BASE_URL:'https://meta.test/v1',LLM_API_KEY:'fixture',LLM_MODEL:'muse-spark-1.2-contributor'});for(const k of ['IMAGE_BASE_URL','IMAGE_API_KEY','IMAGE_MODEL'])delete process.env[k];
  const realFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=realFetch;for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
  assert.deepEqual(imageConfig(),{base:'https://meta.test/v1',key:'fixture',model:'muse-image-1.0'});
  globalThis.fetch=async(url,options)=>{
    const input=JSON.parse(String(options?.body));
    if(String(url).endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'{"reply":"Hello"}'}}]});
    assert.equal(String(url),'https://meta.test/v1/responses');assert.deepEqual(input.tools,[{type:'web_search'}]);assert.equal(input.model,'muse-spark-1.2-contributor');
    return Response.json({status:'completed',output:[{type:'reasoning'},{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:'A cited finding.',annotations:[{type:'url_citation',title:'Official',url:'https://example.com/finding'}]}]}]});
  };
  assert.deepEqual(await complete('System',[{role:'user',content:'Hello'}]),{reply:'Hello'});
  const result=await research('Local events');assert.match(result,/cited finding/);assert.match(result,/https:\/\/example.com\/finding/);
});

test('UPI fallback snapshots payee and requires explicit owner confirmation',async t=>{
  const keys=['PINELABS_CLIENT_ID','PINELABS_CLIENT_SECRET','PUBLIC_URL'];const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE businesses(id TEXT,profile TEXT)');db.prepare('INSERT INTO businesses VALUES(?,?)').run('shop','{"name":"Mogra & More"}');
  const messages:string[]=[];const c=createCommerce(db,(_thread,text)=>messages.push(text));
  t.after(()=>{db.close();for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}});
  assert.throws(()=>c.saveSettings('shop',{catalog:[],upiId:'not-an-id'}),/valid UPI/);
  c.saveSettings('shop',{catalog:[{id:'flowers',name:'Bouquet',price:65000}],upiId:'shop@bank',autoCheckout:true});
  const order=await c.purchase({id:'shop',slug:'mogra'},{id:'visitor'},{requestKey:'upi-request',items:[{id:'flowers',quantity:1}],customer:{name:'Test Guest',email:'test@example.com',phone:'9999999999'}});
  assert.equal(order.status,'upi_pending');assert.equal(order.paymentMethod,'upi');assert.equal(order.upiId,'shop@bank');
  const url=new URL(order.paymentUrl);assert.equal(url.protocol,'upi:');assert.equal(url.searchParams.get('pa'),'shop@bank');assert.equal(url.searchParams.get('pn'),'Mogra & More');assert.equal(url.searchParams.get('am'),'650.00');assert.equal(url.searchParams.get('cu'),'INR');
  c.saveSettings('shop',{catalog:[],upiId:'newshop@bank',autoCheckout:false});assert.equal(c.publicOrders('visitor')[0].upiId,'shop@bank','existing payee must not change');
  await c.action('shop','mogra',order.id,'refresh','visitor');assert.equal(c.publicOrders('visitor')[0].status,'upi_pending');
  await assert.rejects(()=>c.action('shop','mogra',order.id,'confirm','visitor',{received:true}),/Only the owner/);
  await assert.rejects(()=>c.action('shop','mogra',order.id,'report','another-visitor',{reference:'123456789012'}),/not found/);
  await c.action('shop','mogra',order.id,'report','visitor',{reference:'123456789012'});assert.equal(c.publicOrders('visitor')[0].status,'awaiting_confirmation');
  await assert.rejects(()=>c.action('shop','mogra',order.id,'confirm',undefined,{received:false}),/checked your UPI/);
  await c.action('shop','mogra',order.id,'confirm',undefined,{received:true});const paid=c.publicOrders('visitor')[0];assert.equal(paid.status,'paid');assert.equal(paid.confirmationSource,'owner');assert.equal(paid.paymentReference,'123456789012');assert.match(messages.at(-1)!,/owner confirmed receipt/);
});

test('owner can approve, reject or counter a requested order', async t => {
  const keys=['PINELABS_CLIENT_ID','PINELABS_CLIENT_SECRET'];
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const k of keys)delete process.env[k];
  const db=new DatabaseSync(':memory:');const messages:string[]=[];
  db.exec("CREATE TABLE businesses(id TEXT PRIMARY KEY,profile TEXT NOT NULL)");db.prepare('INSERT INTO businesses VALUES(?,?)').run('cafe',JSON.stringify({name:'Barfae Foods'}));
  const c=createCommerce(db,(_thread,text)=>messages.push(text));
  t.after(()=>{c.stop();db.close();for(const k of keys){if(original[k]!==undefined)process.env[k]=original[k];}});
  c.saveSettings('cafe',{catalog:[{id:'kids',name:'Kids Birthday Pack',price:22900}],autoCheckout:false,upiId:'barfae@upi'});
  const b={id:'cafe',slug:'barfae'},thread={id:'parent-thread'};
  const order=(key:string)=>c.purchase(b,thread,{requestKey:key,items:[{id:'kids',quantity:20}],customer:{name:'Amit Kumar',email:'amit@example.com',phone:'9123456780'}});

  const countered=await order('request-counter');assert.equal(countered.status,'requested');
  await assert.rejects(()=>c.action('cafe',b.slug,countered.id,'counter',thread.id,{amount:4000}),/Only the owner/);
  await assert.rejects(()=>c.action('cafe',b.slug,countered.id,'counter',undefined,{amount:4580}),/same as the current total/);
  const after=await c.action('cafe',b.slug,countered.id,'counter',undefined,{amount:4300,note:'Best price for 20 kids'});
  assert.equal(after.amount,430000);assert.equal(after.originalAmount,458000);assert.equal(after.status,'upi_pending');
  assert.match(after.paymentUrl,/am=4300\.00/);assert.ok(messages.some(m=>/proposed ₹4300\.00/.test(m)&&/Best price for 20 kids/.test(m)));
  await assert.rejects(()=>c.action('cafe',b.slug,countered.id,'reject'),/awaiting your approval/);

  const rejected=await order('request-reject');
  const r=await c.action('cafe',b.slug,rejected.id,'reject',undefined,{reason:'Fully booked that evening'});
  assert.equal(r.status,'rejected');assert.equal(r.ownerNote,'Fully booked that evening');
  assert.ok(messages.some(m=>/couldn't accept/.test(m)&&/Fully booked/.test(m)));
  assert.equal((await c.action('cafe',b.slug,rejected.id,'approve')).status,'rejected','a rejected order cannot be approved');

  const approved=await order('request-approve');
  assert.equal((await c.action('cafe',b.slug,approved.id,'approve')).status,'upi_pending');
});
