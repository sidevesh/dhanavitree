import { randomUUID } from 'node:crypto';
export const paymentsConfigured = () => !!(process.env.PINELABS_CLIENT_ID && process.env.PINELABS_CLIENT_SECRET && process.env.PUBLIC_URL);
export function createPineLabs() {
  let token = '', expires = 0;
  const base = () => (process.env.PINELABS_BASE_URL || 'https://pluraluat.v2.pinepg.in').replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', 'Request-ID': randomUUID(), 'Request-Timestamp': new Date().toISOString() });
  async function accessToken() {
    if (!paymentsConfigured()) throw Object.assign(Error('Pine Labs is not configured. Add merchant credentials and PUBLIC_URL.'), { status: 503 });
    if (token && Date.now() < expires - 60_000) return token;
    const response = await fetch(base() + '/api/auth/v1/token', { method: 'POST', headers: headers(), body: JSON.stringify({
      client_id: process.env.PINELABS_CLIENT_ID, client_secret: process.env.PINELABS_CLIENT_SECRET, grant_type: 'client_credentials',
    }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Object.assign(Error(`Pine Labs authentication unavailable (${response.status})`), { status: 502 });
    const data = await response.json() as any;
    if (typeof data.access_token !== 'string') throw Error('Pine Labs returned no access token');
    token = data.access_token;
    expires = Date.parse(data.expires_at) || Date.now() + (Number(data.expires_in) || 300) * 1000;
    return token;
  }
  async function request(path: string, input?: unknown) {
    const response = await fetch(base() + '/api/pay/v1/paymentlink' + path, {
      method: input === undefined ? 'GET' : 'POST', headers: { ...headers(), Authorization: `Bearer ${await accessToken()}` },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) { if (response.status === 401) { token = ''; expires = 0; } throw Object.assign(Error(`Pine Labs request unavailable (${response.status})`), { status: 502 }); }
    return await response.json() as any;
  }
  return {
    create: async (order: { id: string; amount: number; description: string; customer: unknown; slug: string; expires: string }) => {
      const callback = new URL(`/b/${order.slug}`, process.env.PUBLIC_URL);
      const data = await request('', { merchant_payment_link_reference: order.id,
        amount: { value: order.amount, currency: 'INR' }, description: order.description.slice(0, 250),
        expire_by: order.expires, customer: order.customer, callback_url: callback.href, part_payment: false });
      if (typeof data.payment_link_id !== 'string' || typeof data.payment_link !== 'string' || !data.payment_link.startsWith('https://')) throw Error('Invalid Pine Labs payment link response');
      return { id: data.payment_link_id, url: data.payment_link };
    },
    get: (id: string) => request('/' + encodeURIComponent(id)),
  };
}
