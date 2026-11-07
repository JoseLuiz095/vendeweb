# Conversa por pedido — diagnóstico e contrato pendente

Base: `458e486dc473ee171cc80e8713c0837c78bc0b5b`. Classificação proposta: core multissetorial. Este documento é planejamento, não habilita recursos nem autoriza implantação.

## Estado observado

- `food-order-payment` já emite uma capability de declaração de comprovante com duração de 24 horas e versão ligada ao pedido. É específica para o pagamento: não concede acesso ao histórico nem substitui uma credencial de conversa revogável.
- As alterações de status do painel incluem PATCH direto em `food_orders`, inclusive em lote, e o envio de modelo ao cliente pelo WhatsApp é acionado no painel. Uma mensagem criada apenas pelo frontend perderia atualizações feitas por outros caminhos ou poderia falhar depois do status.
- `customer_message_templates` já contém os modelos por status, com campos como `outForDelivery` e `pickedUp`. A renderização deve ter o mesmo mapeamento e variáveis que a implementação existente, com testes de paridade.
- Há suporte a service worker e subscrições push no projeto. Isso não comprova que assinaturas de clientes anônimos, envio de push para esta conversa ou configuração de produção estejam implementados.
- Trabalho paralelo observado no checkout, seletor de ponto e `ReceiptDestination.tsx`, além de edição local em `OrderDetailsModal.tsx`. Não alterar essas áreas sem conciliar o diff e a versão final.

## Proposta técnica sujeita a validação

1. Uma conversa por pedido e mensagens persistentes por `store_id` e `order_id`, com vínculo por FK composta, integridade entre lojas, RLS e autorização por associação ativa do funcionário à loja selecionada. A aplicação deve verificar a permissão concreta de atendimento existente, não apenas estar autenticado.
2. Link de acesso com token aleatório de alta entropia, guardando somente hash no servidor, com expiração, revogação e rotação por pessoal autorizado. Token na parte fragmento da URL, retirada imediata do histórico de navegação, `Referrer-Policy: no-referrer` e sem logs. Uma pessoa com o link poderá acessar o pedido: orientar a não compartilhá-lo. Recuperação por emissão de novo link pela loja após conferir identidade por canal existente; revogar o anterior, sem tentar autenticar pelo número do pedido ou telefone informado sozinho. Definir duração e retenção conforme operação antes do lançamento.
3. Operações do cliente mediadas por servidor, que valida token, validade, revogação, escopo e limites em cada ação; não confiar em `store_id` ou `order_id` fornecidos pelo navegador. Limitar tentativas, tamanho, frequência e armazenamento com controles efetivos no servidor, inclusive por pedido e origem. Evitar expor token em URL de download, logs, notificações e telemetria.
4. Anexo em bucket privado dedicado `food-*`; limite inicial proposto de 5 MiB, JPEG/PNG/PDF, validação de bytes e tipo no servidor, nome aleatório, rejeição de SVG e arquivos ativos, controle de quantidade e limpeza de uploads órfãos. Download autorizado por requisição ou URL assinada curta emitida após verificação; nunca divulgar URL pública. Avaliar análise antimalware, retenção e proteção contra conteúdo malicioso antes de ativar. O arquivo não constitui confirmação bancária.
5. Mudança de status e evento da conversa na mesma transação, inclusive PATCH, lote e operações do banco. Trigger transacional ou operação central deve usar o modelo vigente, com tratamento de falha explícito e evitar duplicação em atualizações sem mudança real; testar criação inicial e todos os estados. Nunca usar envio push como parte crítica da transação: outbox transacional para entrega posterior, com deduplicação e retry.
6. Mensagens recebem idempotency key gerada pelo cliente e persistida até resposta definitiva; unicidade por conversa e chave, conflitos de payload rejeitados. Recarregamento recupera estado do servidor; erros e reenvio preservam o texto e anexo sem inserir duplicatas.
7. Preferência da loja começa em WhatsApp, mantendo o fluxo atual. Mensageria interna só pode ser selecionada quando o recurso completo e suas dependências estiverem ativos. Não substituir nem quebrar o WhatsApp existente.
8. Pedir permissão de notificações somente por ação do usuário; detectar APIs e contexto suportado. Subscrição escopada à conversa e revogada com seu acesso; payload mínimo sem nome, texto ou token. Exibir fallback dentro da conversa. Push depende de configuração, serviço, permissões e sistema operacional, sem garantia de entrega; não presumir funcionamento em segundo plano apenas por existir Notification.

## Contrato necessário do Chat 1

Solicitar referência exata do commit/branch e assinatura da operação canônica para informar pagamento/retirada: parâmetros, identidade autorizada, semântica transacional, idempotência, erros e resposta para cada tipo de pedido e ponto. A declaração deve manter `payment_reported_by_customer` e não afirmar verificação bancária. Confirmar como associar a inserção da mensagem e do anexo à operação de forma atômica ou por outbox idempotente com recuperação. Não reimplementar estoque ou conclusão no chat e não conectar ao handler anterior por suposição.

## Validação antes da liberação

Ambiente isolado com duas lojas e dois pedidos; usuários autorizados e não autorizados; tokens adulterados, expirados, rotacionados e revogados; concorrência de mensagens e status; retries com a mesma chave; uploads válidos, inválidos, acima do limite e objeto de outra loja; falha em cada etapa; limpeza; estados de push e fallback. Avaliar vazamento por URLs, cache, logs e payloads. Comparar migrations locais com ambiente alvo, executar verificações de segurança e revisar diff/dependências antes de qualquer alteração remota. A aprovação visual mobile deve preceder a conclusão da interface.

## Validade para pedidos agendados e encomendas — prévia visual aprovada

A capability de conversa é separada da capability de comprovante de 24 horas. Política inicial preparada em `supabase/functions/_shared/orderConversationLifetime.ts`, ainda não integrada a nenhum endpoint:

- Emissão: no mínimo 30 dias e, quando houver data, até pelo menos sete dias após o agendamento; prevalece a data mais tardia.
- Em renovação autorizada ou reagendamento, uma capability ainda válida pode ser estendida por mais 30 dias ou até sete dias após a nova data; reagendar para antes não diminui o prazo já concedido. A extensão deve ocorrer de modo transacional no servidor; a função pura não a realiza automaticamente.
- Na conclusão ou cancelamento, considera-se sete dias para acompanhamento. Se o atendimento estiver em aberto perto do prazo, a loja deverá poder conceder novo acesso após verificar a identidade; a definição final de retenção será separada da validade do link.
- Revogação prevalece sobre qualquer prazo. Um token expirado ou revogado jamais é reativado: a loja emite outro após conferência por canal existente. Reagendamento posterior à expiração não restabelece o token antigo.
- Prazo de produção (`production_days` / `party_lead_time_days`) é antecedência e não data do evento. Em `food_orders`, considerar `scheduled_for`. Encomendas em `food_custom_requests` usam `due_at` e pedidos de módulo têm outra estrutura; a vinculação e autorização de cada modelo ainda precisam de implementação e testes, sem presumir que sejam o mesmo pedido.
- O acesso é uma credencial de portador: qualquer pessoa com o link pode acessar o pedido enquanto válido. Nunca incluir conteúdo sensível em notificações; permitir revogação e orientar o cliente a não compartilhar.

Validação local da política pura: `node --test scripts/order-conversation-lifetime-test.mjs` cobre agendamentos, extensão, reagendamento antecipado, expiração, revogação, prazo final e valores inválidos. Isso não testa banco, emissão de link, alterações de data, tela ou integração real. Nenhuma migration ou deploy foi executado.

## Coordenação com a branch de ponto e estoque — 07/11/2026

A branch remota `codex/ponto-estoque-principal-20261107` contém `docs/contratos/comprovante-ponto-estoque.md`: descreve a Edge Function `food-order-payment` com ação `report_receipt`, capability própria, e a RPC de servidor `food_declare_order_receipt_v1(store_id, order_id, amount, version)`. A resposta distingue `paymentReportedByCustomer` e `autoPickedUp`; não é comprovação bancária. O chat deverá autenticar sua própria capability, respeitar idempotência e tratar a consistência entre mensagem, anexo e operação. Essa branch continua em desenvolvimento; contrato e implantação precisam ser confirmados na versão definitiva antes da integração.

Divergência observada: a migration dessa branch identifica retirada automática pelo ponto selecionado sem verificar `scheduled_for`. O responsável posteriormente especificou que pedidos de hoje podem seguir a conclusão imediata, enquanto pedidos de outro dia aguardam a data e a disponibilidade de estoque. Esta branch de chat não altera estoque nem aplica a migration; a regra deve ser conciliada e validada no Chat 1 antes de conectar qualquer operação. Conclusão de pedido não deve encerrar a conversa no mesmo dia, preservando a janela de acompanhamento.
