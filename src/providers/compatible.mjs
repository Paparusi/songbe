// Text models asked through the chat-completions interface that OpenAI defined and others kept, each with the person's own API
// key: OpenAI's API and xAI's (Grok). The model names below are the ones their makers' pages named in October 2026;
// SONGBE_WRITER_MODEL names another.
export const DOORS = {
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-6.1-sol' },
  xai: { name: 'xAI', url: 'https://api.x.ai/v1', key: 'XAI_API_KEY', model: 'grok-4.7' },
};
// { system, prompt } → text. `json` asks for one JSON object where the maker's API can promise it.
export async function text(door, { system, prompt, model, maxTokens = 8000, json = false }, env = process.env) {
  const d = DOORS[door], key = env[d.key];
  if (!key) throw new Error(`${d.key} is not set`);
  let r; try { r = await fetch(`${env.SONGBE_WRITER_URL || d.url}/chat/completions`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ model: model || d.model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], max_completion_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) }) }); }
  catch (e) { throw new Error(`${d.name} could not be reached: ${e.name === 'TimeoutError' ? 'no answer within five minutes' : e.message}`); }
  const body = await r.text(); let j = null; try { j = JSON.parse(body); } catch {}
  if (!r.ok) throw new Error(`${d.name} answered ${r.status}: ${String(j?.error?.message || j?.error || body).slice(0, 300)}`);
  const out = j?.choices?.[0]?.message?.content;
  if (!out) throw new Error(`${d.name} returned no text`);
  return typeof out === 'string' ? out : out.map((p) => p.text || '').join('');
}
