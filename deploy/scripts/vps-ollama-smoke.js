const body = {
  model: 'llama3.2',
  prompt: 'Say OK',
  stream: false,
  options: { num_predict: 8 },
};

const tags = await fetch('http://ollama:11434/api/tags').then((r) => r.json());
console.log('models', (tags.models || []).map((m) => m.name).join(','));

const res = await fetch('http://ollama:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('generate_status', res.status);
console.log(text.slice(0, 400));
