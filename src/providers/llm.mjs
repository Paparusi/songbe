// Text models for the writer: one question in, one answer out, on the person's own account.
// With a key: Anthropic (ANTHROPIC_API_KEY), Google (GEMINI_API_KEY), OpenAI (OPENAI_API_KEY), xAI (XAI_API_KEY), or the fal.ai key
// that already pays for voice and music. Without one: a ChatGPT plan, when the person has signed in with ChatGPT (chatgpt.mjs).
// The first that is there writes, in that order, unless one is chosen: SONGBE_WRITER, or the writer picked in the app's settings.
// SONGBE_WRITER_MODEL names another model.
import fs from 'node:fs';
import path from 'node:path';
import * as chatgpt from './chatgpt.mjs';
import * as compatible from './compatible.mjs';
import * as google from './google.mjs';
import { dataDir, mkdir } from '../util.mjs';

const DEFAULT = { anthropic: 'claude-opus-5-5', google: 'gemini-pro-latest', chatgpt: null, openai: compatible.DOORS.openai.model, xai: compatible.DOORS.xai.model, fal: 'anthropic/claude-sonnet-4.5' };
const KEY = { anthropic: ['ANTHROPIC_API_KEY'], google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], chatgpt: [], openai: ['OPENAI_API_KEY'], xai: ['XAI_API_KEY'], fal: ['FAL_KEY'] };
export const WRITERS = { anthropic: 'Claude, with your Anthropic API key', google: 'Gemini, with your Google API key', chatgpt: 'Your ChatGPT plan (signed in with ChatGPT)', openai: 'OpenAI, with your API key', xai: 'Grok, with your xAI API key', fal: 'fal.ai, with your fal key' };
const has = (provider, env) => (provider === 'chatgpt' ? chatgpt.signedIn() : KEY[provider].some((k) => env[k]));
export const NO_KEY = 'needs a key (ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, XAI_API_KEY or FAL_KEY) or a ChatGPT sign-in.';
// the writer picked in the app's settings, kept with Songbe's own files
const settings = () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), 'settings.json'), 'utf8')); } catch { return {}; } };
export const chosenWriter = () => (KEY[settings().writer] ? settings().writer : null);
export function chooseWriter(writer) { if (writer && !KEY[writer]) throw new Error(`"${writer}" is not one of ${Object.keys(KEY).join(', ')}`); const s = settings(); if (writer) s.writer = writer; else delete s.writer; fs.writeFileSync(path.join(mkdir(dataDir()), 'settings.json'), JSON.stringify(s, null, 1)); }
// every writer that could answer now
export const writersFor = (env = process.env) => Object.keys(KEY).filter((p) => has(p, env));

// which provider would answer, given these keys (null when none can). One named in SONGBE_WRITER is the only one asked; one
// picked in the settings is preferred while it is there.
export function writerFor(env = process.env) {
  if (KEY[env.SONGBE_WRITER]) return has(env.SONGBE_WRITER, env) ? env.SONGBE_WRITER : null;
  const picked = chosenWriter();
  return (picked && has(picked, env) ? picked : null) || Object.keys(KEY).find((p) => has(p, env)) || null;
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
// key is there too, the question goes to fal instead and `note` says so. `json` tells a provider that can promise it that the
// answer is one JSON value.
export async function ask({ system, prompt, maxTokens = 6000, json = false }, env = process.env) {
  const provider = writerFor(env), model = modelFor(provider, env);
  if (!provider) throw new Error('Writing ' + NO_KEY);
  if (provider === 'google') return { text: await google.text({ model, system, prompt, maxTokens: Math.max(maxTokens, 16000), json }, env), provider, model };      // its thinking counts against the same allowance
  if (provider === 'chatgpt') { const r = await chatgpt.text({ system, prompt, model: env.SONGBE_WRITER_MODEL }); return { text: r.text, provider, model: r.model }; }
  if (provider === 'openai' || provider === 'xai') return { text: await compatible.text(provider, { system, prompt, model, maxTokens: Math.max(maxTokens, 12000), json }, env), provider, model };
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
