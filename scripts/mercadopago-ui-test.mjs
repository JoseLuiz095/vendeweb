import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { adminReturnPath } from '../src/utils/adminReturnPath.ts';
const source = readFileSync(new URL('../src/services/mercadoPagoTestApi.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleSource = `const getSupabaseClient = () => globalThis.mockClient;\n${compiled}`;
const api = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('callback retira credenciais da URL preservando outros parâmetros', () => {
  const previous = globalThis.window; let replaced = '';
  globalThis.window = { location: { href: 'https://site.test/admin/configuracoes?aba=pix&code=secret&state=nonce#pix' }, history: { state: null, replaceState: (_state, _unused, url) => { replaced = url; } } };
  try {
    assert.deepEqual(api.readMercadoPagoCallback(), { code: 'secret', state: 'nonce' });
    api.clearMercadoPagoCallback();
    assert.equal(replaced, '/admin/configuracoes?aba=pix#pix');
  } finally { globalThis.window = previous; }
});

test('conexão valida origem e respostas do backend de teste', async () => {
  let result; const requests = [];
  globalThis.mockClient = { functions: { invoke: async (name, options) => { requests.push({name, body:options.body}); return { data: result, error: null }; } } };
  try {
    result = { connected: true, environment: 'test' };
    assert.equal((await api.mercadoPagoTestStatus('store-a')).connected, true);
    result = { connected: true, environment: 'production' };
    await assert.rejects(() => api.mercadoPagoTestStatus('store-a'));
    result = { authorizationUrl: 'https://auth.mercadopago.com/authorization?state=abc' };
    assert.match(await api.startMercadoPagoTest('store-a'), /^https:\/\/auth\.mercadopago\.com\/authorization/);
    for (const url of ['https://auth.mercadopago.com.evil.test/authorization', 'http://auth.mercadopago.com/authorization', 'https://auth.mercadopago.com/other']) {
      result = { authorizationUrl: url }; await assert.rejects(() => api.startMercadoPagoTest('store-a'));
    }
    result = { connected: true, environment: 'test' };
    await api.completeMercadoPagoTest('store-a', { code: 'code', state: 'nonce' });
    result = { disconnected: true }; await api.disconnectMercadoPagoTest('store-a');
    assert.deepEqual(requests.at(-1), {name:'food-mercadopago-oauth', body:{action:'disconnect', storeId:'store-a'}});
  } finally { delete globalThis.mockClient; }
});

test('painel piloto exige ativação explícita e loja designada', () => {
  assert.equal(api.showMercadoPagoPilot(false, 'store-a', 'store-a'), false);
  assert.equal(api.showMercadoPagoPilot(true, '', ''), false);
  assert.equal(api.showMercadoPagoPilot(true, 'store-a', 'store-b'), false);
  assert.equal(api.showMercadoPagoPilot(true, 'STORE-A', 'store-a'), true);
});

test('código maior que o limite aceito pelo handler é recusado', () => {
  const previous = globalThis.window;
  globalThis.window = { location: { href: `https://site.test/admin/configuracoes?code=${'a'.repeat(2049)}&state=nonce` } };
  try { assert.deepEqual(api.readMercadoPagoCallback(), { error: true }); }
  finally { globalThis.window = previous; }
});

test('retorno após login preserva callback local e recusa destinos externos', () => {
  const callback = '/admin/configuracoes?code=abc&state=xyz';
  assert.equal(adminReturnPath(callback), callback);
  for (const value of [undefined, 'https://example.com', '//evil.example/admin', '/admin-master', '/admin-lixo'])
    assert.equal(adminReturnPath(value), '/admin');
});
