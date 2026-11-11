import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownStoreSlugTaken, isStoreSlugConflict, storeSlugValidation, STORE_SLUG_TAKEN } from '../src/utils/storeSlug.ts';
import { slugify } from '../src/utils/format.ts';

test('normaliza o nome e identifica endereços conhecidos', () => {
  assert.equal(slugify('Doce Lua Doceria'), 'doce-lua-doceria');
  assert.equal(knownStoreSlugTaken('doce-lua', [{slug:'Doce-Lua'}]), true);
  assert.equal(knownStoreSlugTaken('doce-lua-2', [{slug:'doce-lua'}]), false);
  assert.equal(knownStoreSlugTaken('', [{slug:''}]), false);
});

test('trata somente conflito da constraint do endereço', () => {
  assert.equal(isStoreSlugConflict(new Error('duplicate key value violates unique constraint "food_stores_slug_key"')), true);
  assert.equal(isStoreSlugConflict(new Error('food_stores_name_normalized_uidx')), false);
  assert.match(STORE_SLUG_TAKEN, /endereço já está em uso/);
});

test('rejeita endereços curtos, longos ou reservados', () => {
  assert.notEqual(storeSlugValidation('ab'), '');
  assert.notEqual(storeSlugValidation('a'.repeat(81)), '');
  assert.notEqual(storeSlugValidation('admin'), '');
  assert.equal(storeSlugValidation('doce-lua'), '');
});
