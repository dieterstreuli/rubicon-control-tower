import { aiModelLabel } from '../plugins/api-core.js'
import assert from 'node:assert'

assert.strictEqual(aiModelLabel({}), 'claude-sonnet-4-6', 'ohne Provider -> lokale CLI')
assert.strictEqual(aiModelLabel({ RUBICON_AI_PROVIDER: 'anthropic', RUBICON_AI_MODEL: 'claude-sonnet-5' }), 'claude-sonnet-5', 'Vertex Claude')
assert.strictEqual(aiModelLabel({ RUBICON_AI_PROVIDER: 'google', RUBICON_AI_MODEL: 'gemini-3.6-flash' }), 'gemini-3.6-flash', 'Vertex Gemini')
assert.strictEqual(aiModelLabel({ RUBICON_AI_PROVIDER: 'anthropic' }), 'unbekannt', 'Provider ohne Modell')
console.log('ALL PASS')
