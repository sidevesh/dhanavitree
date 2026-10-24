import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createPineLabs, paymentsConfigured } from './pinelabs.ts';
import { agentConfigured, runAgent } from './providers.ts';
type Row = Record<string, any>;
const fail = (message: string, status = 400): never => { throw Object.assign(Error(message), { status }); };
export function createCommerce(db: DatabaseSync, message: (thread: string, text: string) => void) {
  db.exec(`CREATE TABLE IF NOT EXISTS commerce_settings(business TEXT PRIMARY KEY,catalog TEXT NOT NULL DEFAULT '[]',auto_checkout INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,business TEXT NOT NULL,thread TEXT NOT NULL,request_key TEXT NOT NULL,items TEXT NOT NULL,customer TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,link_id TEXT,link_url TEXT,expires TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,UNIQUE(thread,request_key));
    CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY,business TEXT NOT NULL,role TEXT NOT NULL,scope TEXT,run_id TEXT,status TEXT NOT NULL,hitl INTEGER NOT NULL,output TEXT,created TEXT NOT NULL);`);
  // Additive migrations preserve existing catalogs, orders and in-flight Pine Labs links.
  for (const [table, column, definition] of [
    ['commerce_settings','upi_id',"TEXT NOT NULL DEFAULT ''"],
    ['orders','payment_method',"TEXT NOT NULL DEFAULT 'pinelabs'"],
    ['orders','upi_id',"TEXT NOT NULL DEFAULT ''"],
    ['orders','payment_reference',"TEXT NOT NULL DEFAULT ''"],
    ['orders','confirmation_source',"TEXT NOT NULL DEFAULT ''"],
    ['orders','original_amount',"INTEGER"],
    ['orders','owner_note',"TEXT NOT NULL DEFAULT ''"],
  ]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
  const now = () => new Date().toISOString();
  const pine = createPineLabs();
  const locks = new Set<string>();
  let closed = false;
  const settings = (business: string) => { const s = one('SELECT * FROM commerce_settings WHERE business=?', business); return { catalog: s ? JSON.parse(s.catalog) : [], autoCheckout: !!s?.auto_checkout, upiId: s?.upi_id || '' }; };
  const publicOrder = (o: Row) => ({ id: o.id, thread: o.thread, items: JSON.parse(o.items), amount: o.amount, currency: 'INR', status: o.status, paymentUrl: o.link_url, expires: o.expires, created: o.created, paymentMethod: o.payment_method, upiId: o.upi_id, paymentReference: o.payment_reference, confirmationSource: o.confirmation_source, originalAmount: o.original_amount ?? null, ownerNote: o.owner_note || '' });
  async function agent(business: string, role: string, scope: string, inputs: unknown) {
    try {
      const result = await runAgent(role, inputs);
      run('INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?)', result.id, business, role, scope, result.runId, result.status, result.hitl ? 1 : 0, JSON.stringify(result.output ?? null).slice(0,20000), now());
      return result;
    } catch (e: any) {
      // runAgent errors carry only the HTTP status, never provider bodies, so they are safe to log.
      console.warn(`AgenticOrg ${role} agent failed: ${e?.message}`);
      run('INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), business, role, scope, null, 'failed', 0, null, now());
      throw Object.assign(Error('An order review could not be prepared. Please try again later.'), { status: 502 });
    }
  }
  async function issue(o: Row, slug: string) {
    if (o.link_url || o.status !== 'approved') return;
    if (!paymentsConfigured()) {
      const upiId = settings(o.business).upiId;
      if (!upiId) fail('Add your UPI ID in Orders before requesting payment.',503);
      const b = one('SELECT profile FROM businesses WHERE id=?',o.business);
      const payee = b ? JSON.parse(b.profile).name || 'Business' : 'Business';
      const link = new URL('upi://pay');
      link.search = new URLSearchParams({pa:upiId,pn:payee,am:(o.amount/100).toFixed(2),cu:'INR',tr:o.id.replaceAll('-',''),tn:'Order '+o.id.slice(0,8)}).toString();
      db.exec('BEGIN');
      try {
        run("UPDATE orders SET status='upi_pending',payment_method='upi',upi_id=?,link_url=?,updated=? WHERE id=?",upiId,link.href,now(),o.id);
        message(o.thread,`Your order totals ₹${(o.amount/100).toFixed(2)}. Pay ${upiId} using the Open UPI app button below, or copy this UPI ID into your payment app. Check the recipient and amount before paying. Submit your payment reference here afterwards; the owner will confirm receipt.`);
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK');throw e; }
      return;
    }
    const link = await pine.create({ id: o.id, amount: o.amount, customer: JSON.parse(o.customer),
      description: JSON.parse(o.items).map((i: any) => `${i.quantity} × ${i.name}`).join(', '), slug, expires: o.expires });
    db.exec('BEGIN');
    try {
      run("UPDATE orders SET status='link_sent',link_id=?,link_url=?,updated=? WHERE id=?", link.id, link.url, now(), o.id);
      message(o.thread, `Your order totals ₹${(o.amount / 100).toFixed(2)}. Pay securely with Pine Labs: ${link.url}\nLink expires ${o.expires}. Payment will be confirmed after provider verification.`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  async function reconcile(o: Row) {
    if (o.status !== 'link_sent' || !o.link_id) return;
    const data = await pine.get(o.link_id);
    if (closed) return;
    if (data.payment_link_id !== o.link_id || data.merchant_payment_link_reference !== o.id || data.amount?.value !== o.amount || data.amount?.currency !== 'INR') fail('Payment details did not match this order.', 502);
    const status = data.status === 'PROCESSED' && data.amount_due?.value === 0 && data.amount_due?.currency === 'INR' ? 'paid' : data.status === 'EXPIRED' ? 'expired' : data.status === 'CANCELLED' ? 'cancelled' : '';
    if (!status) return;
    db.exec('BEGIN');
    try {
      const changed = run("UPDATE orders SET status=?,confirmation_source='pinelabs',updated=? WHERE id=? AND status='link_sent'", status, now(), o.id);
      if (changed.changes) message(o.thread, status === 'paid' ? `Payment of ₹${(o.amount / 100).toFixed(2)} verified by Pine Labs. Your order ${o.id.slice(0,8)} is paid. The business will arrange fulfilment.` : `The payment link for order ${o.id.slice(0,8)} is ${status}. Please contact the owner for a new order.`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  async function locked(id: string, fn: () => Promise<void>) {
    if (locks.has(id)) fail('Order is being processed. Please retry shortly.', 409);
    locks.add(id); try { await fn(); } finally { locks.delete(id); }
  }
  return {
    settings, agent, stop: () => { closed = true; },
    publicOrders: (thread: string) => all('SELECT * FROM orders WHERE thread=? ORDER BY rowid DESC', thread).map(publicOrder),
    ownerState: (business: string) => ({ ...settings(business), paymentsConfigured: paymentsConfigured(),
      orders: all('SELECT * FROM orders WHERE business=? ORDER BY rowid DESC', business).map(publicOrder),
      agents: Object.fromEntries(['owner','customer','order'].map(role => [role, agentConfigured(role)])),
      runs: all('SELECT id,role,scope,run_id,status,hitl,output,created FROM agent_runs WHERE business=? ORDER BY rowid DESC LIMIT 50', business).map(r => ({ ...r, output: r.output ? JSON.parse(r.output) : null })) }),
    saveSettings: (business: string, input: any) => {
      if (!Array.isArray(input.catalog) || input.catalog.length > 100) fail('Use up to 100 catalog items.');
      const ids = new Set();
      const catalog = input.catalog.map((i: any) => {
        if (!i || typeof i.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(i.id) || ids.has(i.id) || typeof i.name !== 'string' || !i.name.trim() || i.name.length > 150 || !Number.isSafeInteger(i.price) || i.price < 100 || i.price > 50_000_000) fail('Check that each product has a name and a valid price between ₹1 and ₹5,00,000.');
        ids.add(i.id); return { id: i.id, name: i.name.trim(), price: i.price };
      });
      const upiId = typeof input.upiId === 'string' ? input.upiId.trim() : settings(business).upiId;
      if (upiId && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(upiId)) fail('Enter a valid UPI ID, such as yourshop@bank.');
      run('INSERT INTO commerce_settings(business,catalog,auto_checkout,upi_id) VALUES(?,?,?,?) ON CONFLICT(business) DO UPDATE SET catalog=excluded.catalog,auto_checkout=excluded.auto_checkout,upi_id=excluded.upi_id', business, JSON.stringify(catalog), input.autoCheckout === true ? 1 : 0, upiId);
    },
    purchase: async (b: Row, thread: Row, input: any) => {
      if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestKey)) fail('A valid request key is required.');
      const lockId = thread.id + ':' + input.requestKey;
      let id = '';
      await locked(lockId, async () => {
        let o = one('SELECT * FROM orders WHERE thread=? AND request_key=?', thread.id, input.requestKey);
        if (!o) {
          const s = settings(b.id);
          if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) fail('Choose 1–50 items.');
          const ids = new Set();
          const items = input.items.map((i: any) => {
            const item = s.catalog.find((c: any) => c.id === i?.id);
            if (!item || ids.has(item.id) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 100) fail('Choose available products and quantities from 1–100.');
            ids.add(item.id); return { ...item, quantity: i.quantity };
          });
          const amount = items.reduce((total: number, i: any) => total + i.price * i.quantity, 0);
          if (!Number.isSafeInteger(amount) || amount > 50_000_000) fail('Order exceeds the ₹5,00,000 platform limit.');
          const customer = input.customer;
          if (!customer || typeof customer.name !== 'string' || !customer.name.trim() || customer.name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || customer.email.length > 254 || !/^\d{10}$/.test(customer.phone)) fail('Enter your name, email and 10-digit Indian mobile number.');
          const [first, ...rest] = customer.name.trim().split(/\s+/);
          id = randomUUID();
          const automatic = s.autoCheckout && (paymentsConfigured() || !!s.upiId);
          run('INSERT INTO orders(id,business,thread,request_key,items,customer,amount,status,link_id,link_url,expires,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id,b.id,thread.id,input.requestKey,JSON.stringify(items),JSON.stringify({first_name:first,last_name:rest.join(' ') || '-',email_id:customer.email,mobile_number:customer.phone,country_code:'91'}),amount,automatic?'approved':'requested',null,null,new Date(Date.now()+48*3600000).toISOString(),now(),now());
          message(thread.id, `Purchase request ${id.slice(0,8)} received: ${items.map((i:any)=>`${i.quantity} × ${i.name}`).join(', ')}. Total ₹${(amount/100).toFixed(2)}.${automatic?' Preparing your payment link.':' The owner will review it before a payment link is sent.'}`);
          o = one('SELECT * FROM orders WHERE id=?',id)!;
        }
        id = o.id;
        // Same order reference survives network failures/restarts; Pine Labs deduplicates creation.
        await locked(o.id, () => issue(o!, b.slug));
      });
      return publicOrder(one('SELECT * FROM orders WHERE id=?',id)!);
    },
    action: async (business: string, slug: string, id: string, action: string, thread?: string, input?: any) => {
      const o = one('SELECT * FROM orders WHERE id=? AND business=?' + (thread ? ' AND thread=?' : ''), id,business,...(thread?[thread]:[]));
      if (!o) fail('Order not found.',404);
      await locked(id,async()=>{
        if (action === 'report') {
          if (o!.payment_method !== 'upi' || !['upi_pending','awaiting_confirmation'].includes(o!.status)) fail('This order is not awaiting a UPI payment reference.',409);
          const reference = typeof input?.reference === 'string' ? input.reference.trim() : '';
          if (!/^[a-zA-Z0-9-]{6,80}$/.test(reference)) fail('Enter the transaction reference from your UPI app (6–80 letters, numbers or hyphens).');
          if (o!.payment_reference !== reference) {
            db.exec('BEGIN');
            try {run("UPDATE orders SET status='awaiting_confirmation',payment_reference=?,updated=? WHERE id=?",reference,now(),id);message(o!.thread,'Your payment reference has been sent to the owner. Payment is awaiting their confirmation.');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
          }
        } else if (action === 'confirm') {
          if (thread) fail('Only the owner can confirm a UPI payment.',403);
          if (o!.payment_method !== 'upi' || !['upi_pending','awaiting_confirmation'].includes(o!.status)) fail('This order cannot be manually confirmed.',409);
          if (input?.received !== true) fail('Confirm that you checked your UPI app or bank and received the full amount.');
          db.exec('BEGIN');
          try {run("UPDATE orders SET status='paid',confirmation_source='owner',updated=? WHERE id=?",now(),id);message(o!.thread,`The business owner confirmed receipt of ₹${(o!.amount/100).toFixed(2)} for order ${id.slice(0,8)}. Your order is paid. The business will arrange fulfilment.`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        } else if (action === 'reject') {
          if (thread) fail('Only the owner can reject an order.', 403);
          if (!['requested','approved'].includes(o!.status) || o!.link_url) fail('Only orders awaiting your approval can be rejected.', 409);
          const note = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
          db.exec('BEGIN');
          try {
            run("UPDATE orders SET status='rejected',owner_note=?,updated=? WHERE id=?", note, now(), id);
            message(o!.thread, `Sorry, the business couldn't accept order ${id.slice(0,8)}${note ? `: ${note}` : '.'} You're welcome to send a new request.`);
            db.exec('COMMIT');
          } catch (e) { db.exec('ROLLBACK'); throw e; }
        } else if (action === 'counter') {
          if (thread) fail('Only the owner can counter an order.', 403);
          if (!['requested','approved'].includes(o!.status) || o!.link_url) fail('Only orders awaiting your approval can be countered.', 409);
          const amount = Math.round(Number(input?.amount) * 100);
          if (!Number.isSafeInteger(amount) || amount < 100 || amount > 50_000_000) fail('Enter a counter amount between ₹1 and ₹5,00,000.');
          if (amount === o!.amount) fail('The counter amount is the same as the current total. Approve the order instead.');
          const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 300) : '';
          db.exec('BEGIN');
          try {
            run("UPDATE orders SET original_amount=COALESCE(original_amount,amount),amount=?,status='approved',owner_note=?,updated=? WHERE id=?", amount, note, now(), id);
            message(o!.thread, `The business has proposed ₹${(amount / 100).toFixed(2)} for order ${id.slice(0,8)} (your request was ₹${(o!.amount / 100).toFixed(2)})${note ? `. ${note}` : '.'} Paying the request below accepts this price.`);
            db.exec('COMMIT');
          } catch (e) { db.exec('ROLLBACK'); throw e; }
          // The payment request carries the countered amount.
          await issue(one('SELECT * FROM orders WHERE id=?', id)!, slug);
        } else if (action === 'refresh') await reconcile(o!);
        else if (action === 'approve') {
          if (o!.status === 'requested') { run("UPDATE orders SET status='approved',updated=? WHERE id=?",now(),id); o!.status='approved'; }
          if (o!.status === 'approved') await issue(o!,slug);
        } else if (action === 'review') {
          await agent(business,'order',id,{task:'order_review',order:{items:JSON.parse(o!.items),amount:o!.amount,currency:'INR',status:o!.status},instructions:'Return JSON {recommendation,reason,message}. Advisory only; never create payments or change prices.'});
        }
      });
      return publicOrder(one('SELECT * FROM orders WHERE id=?',id)!);
    },
    poll: async () => {
      if (!paymentsConfigured()) return;
      for (const o of all("SELECT * FROM orders WHERE status='link_sent' ORDER BY updated LIMIT 20")) {
        if (closed) return;
        if (locks.has(o.id)) continue;
        try { await locked(o.id, () => reconcile(o)); }
        catch { /* Keep pending and retry; never infer payment from a redirect. */ }
        finally { if (!closed) run('UPDATE orders SET updated=? WHERE id=?',now(),o.id); }
      }
    },
  };
}
