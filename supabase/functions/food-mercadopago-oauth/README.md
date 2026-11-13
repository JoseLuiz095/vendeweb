# Mercado Pago OAuth: handler de teste não implantável

`handler.ts` é um núcleo testável e `index.ts` é um adaptador desativado por padrão. Não publicar nem ligar a UI antes de completar e revisar a infraestrutura abaixo. Os RPCs `food_mp_test_oauth_authorize_v1`, `status_v1`, `start_v1`, `consume_v1`, `commit_v1` e `disconnect_v1` ainda precisam ser implementados e sua execução restringida ao service_role; a ausência deles causa falha fechada.

- Identificar o usuário pela autenticação verificada do Supabase, reavaliar AAL/MFA conforme política e exigir vínculo ativo owner/admin da loja correta sem `must_change_password`.
- Implementar transações restritas ao serviço para salvar/consumir o estado uma única vez, com validade e vínculo ao usuário e loja. Commit da conexão precisa comparar a geração e verificar a associação na mesma transação; desconexão invalida estados e gerações para impedir reconexão tardia. Testar concorrência e isolamento com Postgres, além dos mocks.
- Guardar apenas segredos cifrados em tabela com RLS e sem acesso a anon/authenticated, e chave AES-256 em cofre separado; implementar rotação, renovação segura e descarte. Sem chave não ligar.
- No adaptador HTTP enviar somente ao endpoint fixo HTTPS do Mercado Pago, sem redirects, limites de tempo/tamanho e sem registrar código, state, payload, credenciais ou respostas em logs; não confiar em erro textual do provedor.
- Obter `redirectUri`, `clientId` e `clientSecret` exclusivamente de configuração confiável no servidor, usar URL estática cadastrada no Mercado Pago e garantir que o callback limpe code/state do navegador imediatamente. Revisar o retorno após autorização na mesma sessão autorizada.
- Validação `live_mode:false` e `test_token:true` falha fechada, mas não substitui configuração segregada por ambiente nem homologação real com conta de teste.
- Não cria cobranças, não recebe webhooks nem altera pagamento, entrega ou estoque. Antes de liberar o piloto, validar OAuth real, sem vazamento de segredo, revogação e concorrência; preservar fallback de pagamento manual.
