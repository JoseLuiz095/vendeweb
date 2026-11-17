import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const origins = new Set(['https://vendeweb.com.br', 'https://www.vendeweb.com.br', 'https://foodweb.joseluizacama.workers.dev']);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const key = Deno.env.get('GEMINI_API_KEY') || '';
  if (!url || !anon || !service || !key) return reply({ error: 'Diagnóstico de IA não configurado.' }, 503);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Autenticação necessária.' }, 401);
  try {
    const client = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return reply({ error: 'Sessão inválida.' }, 401);
    const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel(authorization.slice(7));
    if (assuranceError || assurance.currentLevel !== 'aal2') return reply({ error: 'Confirme o segundo fator para continuar.' }, 403);
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: master, error: masterError } = await admin.from('food_platform_admins').select('id').eq('user_id', user.id).eq('active', true).maybeSingle();
    if (masterError || !master) return reply({ error: 'Acesso restrito ao Admin Master.' }, 403);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gemini-diagnostic:${user.id}`));
    const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const { error: limitError } = await admin.rpc('food_modules_rate_limit', { p_key: fingerprint });
    if (limitError) return reply({ error: 'Limite atingido ou diagnóstico indisponível. Tente mais tarde.' }, 429);
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({ model, input: 'Responda em português: conexão de teste concluída.', store: false, generation_config: { max_output_tokens: 256 } }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      console.warn('gemini_diagnostic_provider_status', response.status);
      return reply({ error: response.status === 429 ? 'Limite do Gemini atingido.' : 'Gemini indisponível ou configuração inválida.' }, response.status === 429 ? 429 : 502);
    }
    const result = await response.json() as {status?:string;steps?:Array<{type?:string;content?:Array<{type?:string;text?:string}>}>};
    const text = result.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content || []).find(c => c.type === 'text' && typeof c.text === 'string')?.text?.trim();
    if (result.status !== 'completed' || !text) {
      console.warn('gemini_diagnostic_incomplete_response', result.status === 'completed' ? 'missing_text' : 'not_completed');
      return reply({ error: 'O Gemini não retornou uma resposta concluída.' }, 502);
    }
    return reply({ ok: true, model, text: text.slice(0, 500) });
  } catch {
    console.warn('gemini_diagnostic_request_failed');
    return reply({ error: 'Não foi possível concluir o diagnóstico de IA.' }, 502);
  }
});

