import assert from 'node:assert/strict';
import { summarizeRecentOrders } from '../src/utils/analyticsOrderFlow.ts';
const now = Date.parse('2026-11-07T15:00:00Z');
const orders = [
 {id:'old',status:'received',createdAt:'2026-11-07T10:00:00Z'},
 {id:'due',status:'ready',createdAt:'2026-11-07T12:00:00Z',scheduledFor:'2026-11-07T14:00:00Z'},
 {id:'future',status:'confirmed',createdAt:'2026-11-07T13:00:00Z',scheduledFor:'2026-11-08T14:00:00Z'},
 {id:'invalid',status:'preparing',createdAt:'2026-11-07T14:00:00Z',scheduledFor:'invalid'},
 {id:'done',status:'delivered',createdAt:'2026-11-07T08:00:00Z',scheduledFor:'2026-11-07T09:00:00Z'},
 {id:'cancel',status:'cancelled',createdAt:'2026-11-07T08:00:00Z'},
];
const result = summarizeRecentOrders(orders, now);
assert.equal(result.activeCount, 4);
assert.equal(result.pastScheduleCount, 1);
assert.deepEqual(result.sorted.map(order => order.id), ['due','old','future','invalid']);
assert.equal(summarizeRecentOrders([], now).activeCount, 0);
assert.equal(orders[0].id, 'old');
console.log('Resumo de pedidos: concluídos, agendados, tempos inválidos e prioridade verificados.');
