/** Verifica o vínculo depois de o Auth já ter salvo a nova senha. */
export async function confirmPasswordChange(
  membershipId: string,
  updateMembership: () => Promise<Array<{ id: string; must_change_password: boolean }> | null>,
  refreshAccess: () => Promise<void>,
): Promise<void> {
  try {
    const updated = await updateMembership();
    if (!Array.isArray(updated) || updated.length !== 1 || updated[0].id !== membershipId || updated[0].must_change_password !== false) {
      throw new Error('Confirmação de vínculo indisponível.');
    }
    await refreshAccess();
  } catch {
    throw new Error('Sua nova senha foi salva, mas não foi possível concluir a liberação do acesso. Use a nova senha ao tentar novamente e entre em contato com a administração da plataforma.');
  }
}
