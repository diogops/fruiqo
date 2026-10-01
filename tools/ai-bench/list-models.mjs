// Lista os modelos que cada chave enxerga (só nomes), para escolher o que comparar.
import { KEYS } from './keys.mjs';

async function list(name, url, headers, pick) {
  if (!headers) return console.log(`${name}: sem chave`);
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return console.log(`${name}: HTTP ${r.status}`);
    const ids = pick(await r.json()).sort();
    console.log(`${name} (${ids.length}): ${ids.join(', ')}`);
  } catch (e) {
    console.log(`${name}: erro ${e.message}`);
  }
}

await list('anthropic', 'https://api.anthropic.com/v1/models?limit=100', KEYS.anthropic && { 'x-api-key': KEYS.anthropic, 'anthropic-version': '2023-06-01' }, (j) => j.data.map((m) => m.id));
await list('openai', 'https://api.openai.com/v1/models', KEYS.openai && { authorization: `Bearer ${KEYS.openai}` }, (j) =>
  j.data.map((m) => m.id).filter((id) => /^(gpt|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|codex)/.test(id)),
);
await list('gemini', `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${KEYS.gemini}`, KEYS.gemini && {}, (j) =>
  j.models.filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace('models/', '')).filter((id) => /^gemini-/.test(id) && !/(tts|image|embedding|live|audio)/.test(id)),
);
await list('mistral', 'https://api.mistral.ai/v1/models', KEYS.mistral && { authorization: `Bearer ${KEYS.mistral}` }, (j) =>
  [...new Set(j.data.filter((m) => m.capabilities?.completion_chat).map((m) => m.id))].filter((id) => /latest$/.test(id)),
);
