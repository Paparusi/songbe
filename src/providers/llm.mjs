// Text models for the writer: one question in, one answer out, on the person's own key.
// Anthropic directly when ANTHROPIC_API_KEY is set; otherwise the fal.ai key that already pays for voice and music, through fal's
// language-model endpoint. SONGBE_WRITER picks one outright, SONGBE_WRITER_MODEL another model.
const DEFAULT = { anthropic: 'claude-opus-5-5', fal: 'anthropic/claude-sonnet-4.5' };

// which provider would answer, given these keys (null when none can)
export function writerFor(env = process.env) {
  const want = env.SONGBE_WRITER;
  if (want === 'anthropic' || want === 'fal') return env[want === 'fal' ? 'FAL_KEY' : 'ANTHROPIC_API_KEY'] ? want : null;
  return env.ANTHROPIC_API_KEY ? 'anthropic' : env.FAL_KEY ? 'fal' : null;
}
export const modelFor = (provider, env = process.env) => env.SONGBE_WRITER_MODEL || DEFAULT[provider];

async function post(url, headers, body, name) {
  let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) }); }
  catch (e) { throw new Error(`${name} could not be reached: ${e.name === 'TimeoutError' ? 'no answer within three minutes' : e.message}`); }
  const text = await r.text();
  if (!r.ok) throw new Error(`${name} answered ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${name} sent something that is not JSON: ${text.slice(0, 200)}`); }
}

// { system, prompt } → { text, provider, model }. When Anthropic refuses (a wrong key, a model name it does not know) and a fal.ai
// key is there too, the question goes to fal instead and `note` says so.
export async function ask({ system, prompt, maxTokens = 6000 }, env = process.env) {
  const provider = writerFor(env), model = modelFor(provider, env);
  if (!provider) throw new Error('Writing needs a key: ANTHROPIC_API_KEY, or the FAL_KEY that also makes the voice and music.');
  const viaFal = async (name) => {
    const r = await post('https://fal.run/fal-ai/any-llm', { Authorization: 'Key ' + env.FAL_KEY }, { model: name, system_prompt: system, prompt, max_tokens: maxTokens }, 'fal.ai');
    if (r.error || !r.output) throw new Error('fal.ai returned no text' + (r.error ? `: ${String(r.error).slice(0, 200)}` : ''));
    return r.output;
  };
  if (provider === 'fal') return { text: await viaFal(model), provider, model };
  try {
    const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, 'Anthropic');
    const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new Error('Anthropic returned no text' + (r.stop_reason ? ` (stopped: ${r.stop_reason})` : ''));
    return { text, provider, model };
  } catch (e) {
    if (!env.FAL_KEY || env.SONGBE_WRITER === 'anthropic') throw e;
    return { text: await viaFal(DEFAULT.fal), provider: 'fal', model: DEFAULT.fal, note: `${e.message.slice(0, 160)} — written through fal.ai instead` };
  }
}
