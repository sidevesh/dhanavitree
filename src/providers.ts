import { randomUUID } from 'node:crypto';

export const textConfigured = () => !!(process.env.LLM_API_KEY && process.env.LLM_BASE_URL && (process.env.LLM_MODEL || process.env.OWNER_MODEL || process.env.CUSTOMER_MODEL));
export const metaConfigured = () => process.env.LLM_PROVIDER === 'meta' && textConfigured();
export const imageConfig = () => ({
  base: process.env.IMAGE_BASE_URL || (metaConfigured() ? process.env.LLM_BASE_URL : ''),
  key: process.env.IMAGE_API_KEY || (metaConfigured() ? process.env.LLM_API_KEY : ''),
  model: process.env.IMAGE_MODEL || (metaConfigured() ? 'muse-image-1.0' : ''),
});
export const agentId = (role: string) => process.env[`AGENTICORG_${role.toUpperCase()}_AGENT_ID`] || process.env.AGENTICORG_AGENT_ID;
export const agentConfigured = (role: string) => !!(process.env.AGENTICORG_API_KEY && agentId(role));

export async function runAgent(role: string, inputs: unknown) {
  if (!agentConfigured(role)) throw Error('AgenticOrg role is not configured');
  const base = (process.env.AGENTICORG_BASE_URL || 'https://agenticorg.hackathon.pinelabs.com').replace(/\/+$/, '');
  const response = await fetch(`${base}/api/v1/agents/${encodeURIComponent(agentId(role)!)}/run`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.AGENTICORG_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }), signal: AbortSignal.timeout(55_000),
  });
  // Provider bodies can contain secrets or customer data. Never expose them in errors.
  if (!response.ok) throw Error(`AgenticOrg unavailable (${response.status})`);
  const data = await response.json() as any;
  let output = data.output ?? data.result?.output;
  if (typeof output === 'string') { try { output = JSON.parse(output.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); } catch { /* Retain text. */ } }
  return { id: randomUUID(), runId: data.run_id || data.task_id || null, status: String(data.status || 'unknown'),
    hitl: !!data.hitl_trigger, output, failed: !!data.error || ['failed','cancelled'].includes(data.status) };
}

export async function complete(system: string, messages: any[], role = 'owner', forceModel?: string) {
  if (!textConfigured()) throw Error('Assistant not configured');
  const base = process.env.LLM_BASE_URL!.replace(/\/+$/, '');
  const model = forceModel || process.env[role === 'customer' ? 'CUSTOMER_MODEL' : 'OWNER_MODEL'] || process.env.LLM_MODEL;
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: 3000 }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw Error(`Assistant unavailable (${response.status})`);
  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw Error('Unsupported model response');
  try { return JSON.parse(content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')); }
  catch { return { reply: content }; }
}

export async function research(query: string) {
  if (!metaConfigured()) throw Object.assign(Error('Configure Meta Model API to enable web research.'), { status: 503 });
  const response = await fetch(process.env.LLM_BASE_URL!.replace(/\/+$/, '') + '/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OWNER_MODEL || process.env.LLM_MODEL,
      input: `Research this business topic using current web sources. Include source URLs, dates and uncertainties. Do not change business policies. Topic: ${query}`,
      tools: [{ type: 'web_search' }], max_output_tokens: 4000 }), signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw Object.assign(Error(`Meta research unavailable (${response.status})`), { status: 502 });
  const data = await response.json() as any;
  if (data.status && data.status !== 'completed') throw Object.assign(Error('Research did not complete. Please retry.'), { status: 502 });
  const blocks = (data.output || []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content || []).filter((c: any) => c.type === 'output_text');
  const text = blocks.map((c: any) => c.text).join('\n');
  const sources = blocks.flatMap((c: any) => c.annotations || []).filter((a: any) => a.type === 'url_citation' && /^https?:\/\//.test(a.url)).map((a: any) => `${a.title || 'Source'}: ${a.url}`);
  if (!text) throw Error('Research returned no answer');
  return text + (sources.length ? '\n\nSources:\n' + [...new Set(sources)].join('\n') : '\n\nNo source citations returned; verify this answer before acting.');
}
