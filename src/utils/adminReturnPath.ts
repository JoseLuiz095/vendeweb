/** Aceita somente rotas locais do painel administrativo da loja. */
export function adminReturnPath(value: unknown): string {
  return typeof value === 'string' && (value === '/admin' || value.startsWith('/admin/') || value.startsWith('/admin?')) ? value : '/admin';
}
