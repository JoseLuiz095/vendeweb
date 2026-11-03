# Fitness — papel B, interface e contratos pendentes (03/11/2026)

Base examinada: `main` em `badee771aa991d396292a965c3008bd0b9276949`. Projeto remoto consultado somente em leitura: VendeWeb `elttryavkeartoxgdgse`, `ACTIVE_HEALTHY`. A loja `FabricioFITNESS` (`fabriciofitness`, `ec06fb9a-9ba6-43e2-854d-c557745e5974`) existe com segmento `fitness`, um profissional Fitness ativo e nenhum aluno registrado na consulta de 03/11. Os documentos de outubro que dizem que a loja não existe estão desatualizados.

## Matriz da integração

| Parte | Estado observado | Evidência / consequência |
| --- | --- | --- |
| Loja, ficha e agenda básica | Parcial | `food_fitness_workouts` e RPCs `food_fitness_list_workouts`, `food_fitness_my_appointments` no catálogo remoto; loja existente. Sem teste autenticado de aluno e profissional. |
| Galeria demonstrativa e GLB | Existente | `FitnessPilotExamples.tsx`, `fitness-demo-squat.glb`, `FITNESS_PILOT_MEDIA.md`; apenas um movimento esquemático. Esta mudança remove valores fictícios da amostra. |
| Editor de ficha base | Parcial | `FitnessWorkouts.tsx`, `food_fitness_save_workout`; título, nível, descrição, séries, repetições, descanso, esforço, execução e alternativa. Não há colunas/contrato de dias A/B/C, músculos, objetivo, equipamento, versões ou mídia por exercício. Não gravar esses campos apenas no cliente. |
| Sessão do aluno por SMS | Bloqueado no remoto | `20261030120000_food_fitness_phone_student_sessions.sql` e `20261030150000_food_fitness_phone_session_enforcement.sql` no repositório, sem entradas no histórico remoto; `food_fitness_student_sessions` e `food_fitness_student_status_v1` ausentes no catálogo. O portal atual depende dessas RPCs. |
| Oferta e Pix manual | Bloqueado no remoto | `20261030170000_food_fitness_pilot_offers.sql` no repositório; `food_fitness_offers` e `food_fitness_offers_v1` ausentes. Apenas `workout` aprovada tem prontidão para publicação no SQL local. Nada foi cobrado ou confirmado. |
| Identidade CREF/CRN e nutrição | Bloqueado no remoto | `20261030114215_service_professional_identity.sql` não consta do histórico; `food_service_professionals` ausente. Não há nutricionista habilitada nem editor/plano individual persistido. |
| Mensagens, preferências e lembretes | Bloqueado no remoto | `20261030143000_professional_content_student_reminders.sql` no repositório; `food_professional_publications` ausente e nenhuma Edge Function Fitness publicada. Não prometer push/SMS neste ambiente. |
| Agendamento vinculado à compra | Ausente | `food_fitness_book` cobre reserva básica; o SQL de oferta local não publica avaliação, combo ou nutrição. Não há confirmação atômica de slot após pedido pago. |
| Feriados e endereço da unidade | Ausente | Nenhum editor/contrato aprovado de sugestão de feriado ou endereço por atendimento foi identificado no fluxo Fitness; não inventar local nem bloquear calendário por calendário civil. |
| Estoque físico | Existente em fluxo separado | `FitnessCatalog.tsx` conserva produto físico em detalhe próprio; publicação/compra depende das regras comerciais e de estoque atuais, não de direito a ficha. |

## Alterações desta branch

- Catálogo separa ofertas publicadas, filtra por tipo, sinaliza falha da consulta e não confunde exemplos com preço real. Galeria fictícia não mostra preços comerciais; prato ilustrativo é explicitamente fictício, com lista textual e sem proporção por peso.
- Portal agrupa Início, Meus treinos, Minha alimentação, Agenda, Mensagens e Perfil. A agenda consulta `food_fitness_my_appointments` e apresenta horário em `America/Sao_Paulo`, sem inventar endereço. Nutrição e mensagens exibem seu estado pendente; não fazem leitura clínica ou cache offline.
- Ficha atribuída oferece sequência, marcação temporária de séries e cronômetro. Não afirma persistência/histórico: o contrato atual não tem gravação de progresso. A aprovação/atribuição profissional no Admin continua na RPC existente.
- Checkout manual preserva a chave de idempotência quando a leitura posterior falha, limita consentimento à oferta selecionada, exibe Pix somente após pedido pendente, oferece cópia e deixa claro que o pagamento depende de conferência do crédito. Admin destaca fila de pedidos pendentes. Nenhuma dessas mudanças confirma dinheiro no navegador.

## Contratos necessários da frente A

1. Reconciliar migrations locais e remotas individualmente antes de implantação; verificar `to_regclass`, assinaturas, grants, RLS, Auth SMS e MFA/AAL2. Não usar `db push` em lote no banco compartilhado. Informar PR, commit, versões aplicadas e contrato real de cada RPC. Nenhuma migration ou função foi publicada por B.
2. Uma leitura do aluno autorizada por loja, identidade e sessão para `orders`, direitos, agendamentos e revisão pendente. O retorno precisa distinguir pagamento pendente, pago, serviço aguardando escolha de slot, slot confirmado, cancelado e reembolsado, com `offer_id`, preço/termos congelados, profissional, duração, local/modalidade e próxima ação. O front não derivará direito de um redirect ou comprovante.
3. Para avaliação/consulta/combos, listar slots reais e realizar reserva ou confirmação atômica após pagamento. Conflito de capacidade, expiração, cancelamento e reagendamento precisam de códigos estáveis; o front não reservará por relógio local. O endereço deve vir da unidade configurada.
4. Para fichas, definir dias, campos de exercício, versões e progresso/histórico com guards de sessão e consentimento. O progresso desta branch é só temporário. Conteúdo clínico individual exige revisão CREF.
5. Para Nutrição, definir identidade CRN validada, consentimento separado, RLS por loja/aluno/profissional/finalidade, rascunho/versão/validade/aprovação, porções com estado e unidade, alternativas aprovadas, revogação, auditoria e retenção. Sem esse contrato, nenhum plano individual é criado ou publicado pela interface.
6. Mensagens e preferências devem expor disponibilidade real dos canais, estado de entrega e retry sem conteúdo clínico no push. Ao ligar o módulo, substituir os estados pendentes do portal pelos componentes já existentes e cobrir revogação da autorização.

## Configuração e aceite

O proprietário ainda deve confirmar preços reais, recebedor Pix, serviços, termos de cancelamento, duração, unidade/endereço, horários/exceções e textos. Publicação de Nutrição exige profissional real com CRN/região verificados, vínculo, consentimento do aluno e revisão. SMS/push dependem de provedor, credenciais e opt-in. Os 50 vídeos antigos exigem confirmação individual de direitos; o GLB atual é apenas esquemático.

Após a frente A disponibilizar contratos em homologação, testar com **duas lojas e dois alunos**: rascunho versus publicado; pendente sem direito; confirmação e replay idempotente; ficha pronta e personalizada; disputa pelo último slot; cancelamento/reembolso; permissão CRN revogada; sessão revogada; isolamento e rede lenta/mobile. PGlite e tráfego Playwright simulado não demonstram RLS, pagamento ou envio remoto. Não publicar oferta comercial do piloto até confirmar esses casos no ambiente autorizado.

Validação desta branch: `npm run typecheck`, `npm run build`, `npm run test:fitness` e `npm run test:fitness-pilot-db` passaram localmente. Playwright Chromium passou nos oito novos cenários de galeria/portal em 320/390/768/1280 px. A suíte completa passou em 24 de 29; cinco testes antigos procuravam textos anteriores à vitrine atual. Os cinco foram ajustados sem remover verificações de comportamento e passaram em execução focada. Não houve conta de teste autenticada no projeto remoto, teste de pagamento real, migração, Edge Function, deploy ou seed.
