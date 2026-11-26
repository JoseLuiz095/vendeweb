/** Registro declarado pela loja; não representa verificação externa do conselho. */
export function professionalCredential(council?: string | null, registration?: string | null): string {
  const number = registration?.trim();
  return number ? ` · ${council?.trim() || 'Registro'} ${number}` : '';
}
