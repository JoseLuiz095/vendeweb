# Reconciliação Fitness — 25/11/2026

Estado: código preparado e testado localmente. Não aplicado no Supabase. A revisão automática rejeitou a execução por abrangência da alteração em produção. A liberação do ramo não foi homologada.

## Correção

A migration consolidada parte exclusivamente da baseline 27/10 + compatibilidade de fichas instalada em produção. Reutiliza sete migrations já existentes para identidade profissional, sessões, conteúdo, ofertas e agendamento pago. Recusa contratos divergentes e instalação parcial. Não usar `db push` para tentar aplicar indiscriminadamente o histórico antigo.

Preserva colunas avançadas existentes e notas na tabela privada; a coluna pública intermediária `professional_notes` é criada e removida dentro da mesma transação, sem copiar notas privadas para ela. Reinstala os contratos do editor com privacidade e verificação de sessão. Mantém a função anterior de ofertas públicas para lojas que não são Fitness e limita o novo trigger de profissional a Fitness. Não cria profissionais, alunos, ofertas ou pagamentos reais e não altera provedores Auth.

## Evidência

`npm run test:fitness-reconcile` passou: baseline já com colunas e notas privadas, preservação de ficha e nota preexistentes, recusa de reaplicação, compra pendente, confirmação/replay, agenda/vaga única, cancelamento/reembolso, versões de conteúdo, registro profissional, consentimento e isolamento entre lojas/alunos.

É teste em PostgreSQL local (PGlite), não SMS, OAuth, e-mail, integração bancária ou navegação autenticada real.

## Pendências para produção

- Revisar a migration consolidada e o impacto em permissões, triggers e agendamentos antes de autorizar sua aplicação.
- Após aplicação, conferir advisors e catálogo, consultar ofertas públicas e painel autenticado.
- Cadastrar/confirmar o profissional pelo proprietário com dados e registro reais, sem inferir CREF.
- Validar o provedor SMS ou reconciliar o acesso aprovado por e-mail/Google; não gerar código administrativo para fingir login do aluno.
- Executar José Luiz como aluno, consentimento, ficha atribuída, oferta, compra pendente e liberação após evidência de pagamento. Reembolso e isolamento devem ser homologados.
- Comparar com `fitness-continuacao` do Windows, ainda inacessível neste ambiente.

Nenhuma alegação de superioridade frente a concorrentes ou de prontidão integral é sustentada por estes testes locais.
