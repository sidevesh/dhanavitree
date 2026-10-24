// Pine Labs Plural payment links. Falls back to a clearly labelled TEST link when credentials are missing.

const BASE = process.env.PINELABS_BASE_URL || "https://pluraluat.v2.pinepg.in";
const CLIENT_ID = process.env.PINELABS_CLIENT_ID;
const CLIENT_SECRET = process.env.PINELABS_CLIENT_SECRET;

export const pineLabsConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

let cached = { token: null, expiresAt: 0 };

async function token() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(`${BASE}/api/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Pine Labs token failed (${res.status}): ${JSON.stringify(body)}`);
  const ttlMs = (Number(body.expires_in) || 3600) * 1000;
  cached = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  return cached.token;
}

export async function createPaymentLink({ quote, lead, businessName, publicUrl }) {
  const name = (lead.fields.name || "Guest").trim().split(/\s+/);
  if (!pineLabsConfigured()) {
    return {
      payment_link_id: `test_${quote.id}`,
      payment_link_url: `${publicUrl}/test-pay/${quote.id}`,
      test_mode: true,
    };
  }
  const expiry = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${BASE}/api/pay/v1/payment-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({
      merchant_payment_link_reference: quote.id,
      payment_link_amount: { value: quote.advance * 100, currency: "INR" },
      description: `${businessName}: advance for ${quote.guests} guests (${quote.package_name})`.slice(0, 250),
      customer: {
        first_name: name[0],
        last_name: name.slice(1).join(" ") || "-",
        mobile_number: String(lead.fields.phone || "").replace(/\D/g, "").slice(-10),
        country_code: "91",
        email_id: lead.fields.email || "guest@example.com",
      },
      expiry_date: expiry,
      callback_url: `${publicUrl}/paid?q=${quote.id}`,
      notes: `lead=${lead.id}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.payment_link_url) throw new Error(`Pine Labs link failed (${res.status}): ${JSON.stringify(body)}`);
  return { payment_link_id: body.payment_link_id, payment_link_url: body.payment_link_url, test_mode: false };
}

export async function getPaymentLinkStatus(paymentLinkId) {
  const res = await fetch(`${BASE}/api/pay/v1/payment-links/${paymentLinkId}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pine Labs status failed (${res.status}): ${JSON.stringify(body)}`);
  return String(body.status || "").toUpperCase();
}
