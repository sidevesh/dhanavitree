import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
type Row = Record<string, any>;
// Payment state is owned by the server, never by model output or a payment-app redirect.
export function createPayments(db: DatabaseSync, message: (table: 'messages'|'owner_messages', scope: string, sender: string, text: string) => unknown) {
 db.exec(`CREATE TABLE IF NOT EXISTS payment_settings(business TEXT PRIMARY KEY,upi TEXT NOT NULL,paise INTEGER NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0,revision TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,business TEXT NOT NULL,thread TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL,upi TEXT,paise INTEGER,payee TEXT,created TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking ON bookings(thread) WHERE status!='confirmed';`);
 const one = (sql:string,...args:any[]) => db.prepare(sql).get(...args) as Row|undefined;
 const all = (sql:string,...args:any[]) => db.prepare(sql).all(...args) as Row[];
 const run = (sql:string,...args:any[]) => db.prepare(sql).run(...args);
 const fail = (status:number,error:string):never => {throw Object.assign(Error(error),{status});};
 const settings = (business:string) => one('SELECT * FROM payment_settings WHERE business=?',business);
 const active = (thread:string) => one("SELECT * FROM bookings WHERE thread=? AND status!='confirmed'",thread);
 const amount = (paise:number) => (paise/100).toFixed(2);
 function present(booking:Row) {
  const result={...booking};
  if(booking.status==='requested') {
   const params=new URLSearchParams({pa:booking.upi,pn:booking.payee,am:amount(booking.paise),cu:'INR',tn:'Booking advance',tr:booking.id});
   result.upiUrl='upi://pay?'+params;
   result.googlePayUrl='gpay://upi/pay?'+params;
  }
  return result;
 }
 function requestAdvance(booking:Row) {
  const s=settings(booking.business);
  if(!s?.confirmed) {
   message('messages',booking.thread,'assistant',"Your booking details are recorded. I'll ask the owner to confirm their receiving UPI ID and how much advance you should pay. Please wait before paying; your booking is not confirmed yet.");
   message('owner_messages',booking.business,'assistant',`A customer is waiting to book: ${booking.details}\nHow much advance should they pay, and which UPI ID should receive it? Review and confirm these in Booking advances on Today.`);
   return;
  }
  const business=one('SELECT profile FROM businesses WHERE id=?',booking.business)!;
  run("UPDATE bookings SET status='requested',upi=?,paise=?,payee=? WHERE id=?",s.upi,s.paise,JSON.parse(business.profile).name||'Business',booking.id);
  message('messages',booking.thread,'assistant',`The owner has confirmed an advance of ₹${amount(s.paise)} for your booking. Use the payment buttons in your booking card to pay ${s.upi}. Have you paid the advance? Your booking still needs owner confirmation.`);
 }
 function report(booking:Row) {
  if(['reported','received','confirmed'].includes(booking.status))return;
  if(booking.status!=='requested')fail(409,'Wait for the owner-confirmed advance request before reporting payment.');
  run("UPDATE bookings SET status='reported' WHERE id=?",booking.id);
  message('messages',booking.thread,'assistant',"Thanks. I've told the owner you report paying the advance. They'll verify receipt before confirming your booking.");
  message('owner_messages',booking.business,'assistant',`Customer reports paying ₹${amount(booking.paise)} to ${booking.upi}. Booking: ${booking.details}\nPayment is unverified. Check your bank or UPI app, then verify receipt in Today.`);
 }
 return {
  settings,
  ownerBookings:(business:string)=>all('SELECT * FROM bookings WHERE business=? ORDER BY rowid DESC',business),
  publicBookings:(thread:string)=>all('SELECT * FROM bookings WHERE thread=? ORDER BY rowid DESC',thread).map(present),
  chat(b:Row,thread:Row,text:string) {
   const booking=active(thread.id);
   const last=one("SELECT text FROM messages WHERE thread=? AND sender!='customer' ORDER BY rowid DESC LIMIT 1",thread.id)?.text||'';
   if(booking?.status==='requested'&&(/^(?:yes[,!. ]*)?(?:i(?:'ve| have)? )?(?:paid|have paid|payment (?:done|sent)|paid the advance)[.! ]*$/i.test(text)||(/^yes[.! ]*$/i.test(text)&&last.includes('Have you paid the advance?')))) {report(booking);return true;}
   if(/\b(book(?:ing)?|reserve|reservation|advance|deposit)\b/i.test(text)) {
    message('messages',thread.id,'assistant',booking?'Please use your booking card below to follow the advance and confirmation steps.':'Please fill in the booking card below with the service, date/time, contact details and any other requirements, then review and confirm the details. I’ll request an advance only after the owner confirms the payment settings.');return true;
   }
   return false;
  },
  publicAction(b:Row,thread:Row,action:string,input:Row) {
   if(action==='bookings') {
    const existing=active(thread.id);if(existing)return {booking:present(existing)};
    const details=typeof input.details==='string'?input.details.trim():'';
    if(!details||details.length>2000||input.confirmed!==true)fail(400,'Review and confirm booking details of up to 2,000 characters.');
    const id=randomUUID();run("INSERT INTO bookings(id,business,thread,details,status,created) VALUES(?,?,?,?,'awaiting_settings',?)",id,b.id,thread.id,details,new Date().toISOString());
    message('messages',thread.id,'customer',`I confirm these booking details: ${details}`);
    requestAdvance(one('SELECT * FROM bookings WHERE id=?',id)!);
    return {ok:true};
   }
   if(action==='paid') {const booking=one('SELECT * FROM bookings WHERE id=? AND thread=? AND business=?',input.id,thread.id,b.id);if(!booking)fail(404,'Booking not found.');report(booking!);return {ok:true};}
   return undefined;
  },
  ownerAction(b:Row,path:string,input:Row) {
   if(path==='/api/payments/settings') {
    const upi=typeof input.upi==='string'?input.upi.trim():'';
    const value=typeof input.amount==='string'?input.amount:'';
    if(!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(upi))fail(400,'Enter a valid receiving UPI ID, for example shop@bank.');
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))fail(400,'Enter an advance in rupees with up to two decimal places.');
    const paise=Math.round(Number(value)*100);if(paise<1||paise>100000000)fail(400,'Enter an advance between ₹0.01 and ₹10,00,000.');
    run('INSERT INTO payment_settings VALUES(?,?,?,0,?) ON CONFLICT(business) DO UPDATE SET upi=excluded.upi,paise=excluded.paise,confirmed=0,revision=excluded.revision',b.id,upi,paise,randomUUID());
    message('owner_messages',b.id,'assistant',`Should customers pay ₹${amount(paise)} in advance to ${upi}? Review and confirm in Booking advances on Today. No new advance requests will be sent until you confirm.`);
    return {ok:true};
   }
   if(path==='/api/payments/confirm') {
    const s=settings(b.id);if(!s||input.revision!==s.revision)fail(409,'Payment settings changed. Review the current UPI ID and amount again.');
    if(!s!.confirmed) {
     run('UPDATE payment_settings SET confirmed=1 WHERE business=?',b.id);
     message('owner_messages',b.id,'assistant',`Confirmed: request ₹${amount(s!.paise)} in advance to ${s!.upi} after customers confirm their booking details.`);
     for(const booking of all("SELECT * FROM bookings WHERE business=? AND status='awaiting_settings'",b.id))requestAdvance(booking);
    }
    return {ok:true};
   }
   const match=path.match(/^\/api\/bookings\/([^/]+)\/(verify|not-received|confirm)$/);
   if(!match)return undefined;
   const booking=one('SELECT * FROM bookings WHERE id=? AND business=?',match[1],b.id);if(!booking)fail(404,'Booking not found.');
   const target=match[2]==='verify'?'received':match[2]==='not-received'?'requested':'confirmed';
   if(booking!.status===target)return {ok:true};
   if(booking!.status!==(match[2]==='confirm'?'received':'reported'))fail(409,'Refresh this booking before updating it. Verify receipt before confirming a booking.');
   run('UPDATE bookings SET status=? WHERE id=?',target,booking!.id);
   message('messages',booking!.thread,'business',target==='received'?'I verified receipt of your advance. Your booking is awaiting my final confirmation.':target==='requested'?"I couldn't verify receipt of the advance. Please check the recipient and payment status in your UPI app. Have you paid the advance?":`Your booking is confirmed: ${booking!.details}`);
   return {ok:true};
  }
 };
}
