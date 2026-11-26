import type { SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '../lib/config';

export type FitnessStudentAuthMethods = { email: boolean; phone: boolean };
let methodsRequest: Promise<FitnessStudentAuthMethods> | null = null;

/** Public Auth configuration; never contains credentials or user information. */
export function fitnessStudentAuthMethods(): Promise<FitnessStudentAuthMethods> {
  if (!methodsRequest) methodsRequest = (async () => {
    const response = await fetch(`${appConfig.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: appConfig.supabaseAnonKey }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Não foi possível consultar as formas de entrada. Tente novamente.');
    const data = await response.json();
    if (typeof data?.external?.email !== 'boolean' || typeof data?.external?.phone !== 'boolean') {
      throw new Error('O serviço de acesso não retornou uma configuração válida.');
    }
    return { email: data.external.email, phone: data.external.phone };
  })().catch(error => { methodsRequest = null; throw error; });
  return methodsRequest;
}

export async function fitnessStudentMfaFactor(auth: SupabaseClient, token: string): Promise<string | null> {
  const { data, error } = await auth.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if (error) throw new Error('Não foi possível verificar a proteção da conta. Entre novamente.');
  if (data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') return null;
  const { data: factors, error: factorError } = await auth.auth.mfa.listFactors();
  if (factorError) throw new Error('Não foi possível consultar o autenticador da conta.');
  const factor = factors.totp.find(item => item.status === 'verified');
  if (!factor) throw new Error('Esta conta exige segundo fator. Procure o suporte para concluir a entrada com segurança.');
  return factor.id;
}
