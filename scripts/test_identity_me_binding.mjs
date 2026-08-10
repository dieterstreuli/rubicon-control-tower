import { ownerMeDenied } from '../plugins/identity.js'
import assert from 'node:assert'

const D = { viaIap: true, person: 'Dieter Streuli' }
assert.strictEqual(ownerMeDenied(D, 'Owner', 'Jemand Anders'), true, 'Owner+fremdes me unter IAP -> denied')
assert.strictEqual(ownerMeDenied(D, 'Owner', 'Dieter Streuli'), false, 'Owner+eigenes me -> erlaubt')
assert.strictEqual(ownerMeDenied(D, 'CoS', 'Jemand Anders'), false, 'CoS -> nie ge-me-bindet')
assert.strictEqual(ownerMeDenied({ viaIap: false, person: 'x' }, 'Owner', 'Jemand Anders'), false, 'ohne IAP -> frei')
assert.strictEqual(ownerMeDenied(D, 'Owner', undefined), false, 'kein me -> No-op')
console.log('ALL PASS')
