export const STORE_SLUG_TAKEN = 'Este endereço já está em uso. Escolha outro endereço para a loja.';
const reserved = new Set(['admin','admin-master','produto','carrinho','finalizar','pedido','404','fitness','profissional','modulos','login','cadastro','planos','lojas','api','assets']);

export function storeSlugValidation(slug: string): string {
  if (!slug) return '';
  if (slug.length < 3 || slug.length > 80) return 'Use um endereço entre 3 e 80 caracteres.';
  if (reserved.has(slug)) return 'Este endereço é reservado pelo sistema. Escolha outro.';
  return '';
}

// The unique constraint remains authoritative when this browser's store list is stale.
export function isStoreSlugConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /food_stores_slug_key/i.test(message);
}

export function knownStoreSlugTaken(slug: string, stores: readonly { slug: string }[]): boolean {
  return Boolean(slug) && stores.some(store => store.slug.toLowerCase() === slug.toLowerCase());
}
