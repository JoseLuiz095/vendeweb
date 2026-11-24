import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeImageForUpload } from '../src/utils/imageUpload.ts';

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.createImageBitmap;
});

function browser({ encodedType = 'image/webp', encodedSize = 180_000 } = {}) {
  globalThis.window = {};
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 900, close() {} });
  globalThis.document = { createElement: () => ({
    getContext: () => ({ drawImage() {} }),
    toBlob: (callback) => callback(new Blob([new Uint8Array(encodedSize)], { type: encodedType })),
  }) };
}

test('compresses a typical large product image to a smaller WebP', async () => {
  browser();
  const original = new File([new Uint8Array(900_000)], 'produto.png', { type: 'image/png' });
  const result = await optimizeImageForUpload(original, 'product');
  assert.equal(result.type, 'image/webp');
  assert.equal(result.size, 180_000);
  assert.match(result.name, /\.webp$/);
});

test('preserves original PNG when WebP encoding is unsupported', async () => {
  browser({ encodedType: 'image/png' });
  const original = new File([new Uint8Array(2_000_000)], 'transparente.png', { type: 'image/png' });
  const result = await optimizeImageForUpload(original, 'product');
  assert.equal(result, original);
});

test('keeps small images and avoids unnecessary encoding', async () => {
  browser();
  const original = new File([new Uint8Array(60_000)], 'leve.png', { type: 'image/png' });
  assert.equal(await optimizeImageForUpload(original, 'product'), original);
});

test('keeps original when conversion would increase size', async () => {
  browser({ encodedSize: 1_000_000 });
  const original = new File([new Uint8Array(900_000)], 'produto.png', { type: 'image/png' });
  assert.equal(await optimizeImageForUpload(original, 'product'), original);
});
