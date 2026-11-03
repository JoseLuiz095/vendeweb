# Fitness — auditoria e contrato backend (03/11/2026)

Base: `main` em `badee771aa991d396292a965c3008bd0b9276949`, obtida de `origin/main` em 03/11. Projeto Supabase conectado: `elttryavkeartoxgdgse` (`VendeWeb`, `ACTIVE_HEALTHY`). Leitura remota apenas; nenhuma migration, função ou dado foi alterado. Os documentos de outubro foram usados como histórico, não como prova de implantação.

## Matriz de prontidão

| Capacidade | Estado | Evidência em código e ambiente |
| --- | --- | --- |
| Tenant piloto | Parcial | `food_stores`/`food_business_profiles`: `fabriciofitness`, loja `ec06fb9a-9ba6-43e2-854d-c557745e5974`, ativa e online. Há 2 serviços, 0 alunos e 0 fichas no banco em 03/11. Dados comerciais, endereço e profissional ainda precisam de validação pelo proprietário. |
| Isenção SaaS da piloto | Existente no remoto | `food_store_subscriptions` da loja piloto: `active`, `billing_amount=0`, sem expiração, nota `FITNESS_PILOT_WAIVER`. Não foi modificada nem estendida a outra loja. |
| Catálogo e exemplos | Existente no código | `src/platform/FitnessCatalog.tsx`, `FitnessPilotExamples.tsx`; PRs #137/#138 integrados. Exemplos são fictícios e não criam oferta comercial. |
| Agenda Fitness básica | Parcial | RPC `food_fitness_book` instalada; `20261027182656_food_fitness_booking_20261027.sql` cria janelas, bloqueios e reservas. Não há vínculo obrigatório com pedido pago. |
| Identidade profissional e nutrição | Bloqueado no remoto | `20261030114215_service_professional_identity.sql` não consta no histórico remoto; `food_service_professionals` ausente. A nutricionista real não foi identificada nem validada. |
| Telefone e sessão Fitness por loja | Bloqueado no remoto | `20261030120000_food_fitness_phone_student_sessions.sql` e `20261030150000_food_fitness_phone_session_enforcement.sql` não instaladas; `food_fitness_student_sessions` ausente. Código em `FitnessStudentPortal.tsx` depende delas. Auth Phone/SMS/CAPTCHA não foi validado. |
| Oferta de ficha aprovada, pedido e conferência Pix | Parcial no código; bloqueado no remoto | `20261030170000_food_fitness_pilot_offers.sql` prevê `food_fitness_offer_orders` e `food_fitness_confirm_order_v1` com MFA/AAL2, lock e concessão transacional. Tabela e RPC ausentes remotamente. Somente `workout` pode publicar. |
| Aviso interno após pagamento/reembolso | Implementado localmente; bloqueado no remoto | A migration de ofertas agora grava `food_fitness_order_notifications` na mesma transação e a RPC `food_fitness_order_notifications_v1` exige sessão do aluno. `FitnessOfferCheckout.tsx` mostra os eventos. Push/SMS/WhatsApp não são prometidos. |
| Avaliação, combo e nutrição vendidos | Ausente | `offer_ready` bloqueia qualquer tipo além de `workout`; não existe relação pedido pago → agendamento/entrega. Manter rascunho. |
| Lembretes e mensagens profissionais | Parcial no código; bloqueado no remoto | `20261030143000_professional_content_student_reminders.sql` não instalado; `food_professional_publications` e `food_fitness_student_reminders` ausentes. `food-fitness-reminders` não está publicado. |
| Assinatura mensal do aluno | Sandbox local, bloqueada comercialmente | `docs/FITNESS_ACCESS_SANDBOX.md`, `food-fitness-checkout` e `food-fitness-billing` no repositório; funções não publicadas no projeto. Contrato distinto da assinatura SaaS da loja. |
| Feriados e plano alimentar individual | Ausente | Nenhum editor de prescrição nutricional ou fonte anual de feriados verificada. Não criar bloqueios automáticos. |

## Contrato para o Chat B

- Oferta publicada: somente `kind='workout'` com ficha aprovada pelo profissional CREF, preço real e módulo ativo. RPC `food_fitness_offers_v1(store, false)` é a fonte da vitrine; conteúdo demonstrativo não entra nela.
- Compra: `food_fitness_order_v1(store, offer, request_id)` retorna `pending`; `request_id` é idempotente por aluno e loja. Não libera direito.
- Conferência manual: `food_fitness_confirm_order_v1(store, order, 'confirm')` exige owner/admin com sessão AAL2 ativa. A operação só deve ser invocada após conferir crédito no extrato. Ela marca `paid`, atribui a ficha e cria aviso interno em uma transação. Repetição retorna `paid` sem duplicar concessão ou aviso.
- Reembolso: `food_fitness_confirm_order_v1(store, order, 'refund')` marca `refunded`, revisa a atribuição e cria um aviso interno. Atendimento já prestado exigirá fluxo próprio antes de habilitar serviços.
- Leitura do aluno: `food_fitness_my_orders_v1(store)` e `food_fitness_order_notifications_v1(store)` exigem sessão Fitness ativa. Mensagem `paid` significa ficha disponível em Meus treinos; `refunded` significa acesso revisto. Erros `42501`/`FITNESS_STUDENT_SESSION_REQUIRED` pedem novo acesso; `FITNESS_ADMIN_MFA_REQUIRED` pede MFA do administrador.
- Agenda paga: ainda sem contrato. Opção recomendada para a próxima etapa: **agendar somente após pagamento**. Evita reserva que expira durante Pix manual. O pedido pago sem slot deve permanecer `agendamento_pendente` e mostrar “Escolha seu horário”. A RPC futura precisa ligar pedido e reserva no banco, com lock por loja/profissional e idempotência; a agenda legada sem compra não deve ser reinterpretada como direito pago.

## Implantação e rollback operacional

Não executar `db push`: o histórico remoto usa versões/timestamps diferentes de arquivos locais e o projeto também atende FloriWeb. Falta homologação isolada confirmada. Antes de instalar, revisar em ordem identidade profissional, sessão por telefone, publicações/lembretes e ofertas, comparar o SQL efetivo com o remoto, testar Auth/SMS, RLS e fluxos de dois tenants, e conferir o diff de cada migration. Não criar profissional, endereço, oferta, preço nem dado clínico presumido. Se a migration de ofertas falhar, sua transação reverte integralmente; se passar mas a aplicação falhar, desabilitar a exposição das ofertas e preservar pedidos/auditoria até reconciliação, sem apagar histórico financeiro. O fluxo Food de vitrine, catálogo e operações serve como referência de navegação; `food_fitness_offer_orders` continua separado de `food_orders` porque o serviço tem entrega e autorização profissional próprias.
