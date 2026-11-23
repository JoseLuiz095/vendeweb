# Operação de aluguel — 23/11/2026

Classificação: `shared_future`, exclusivamente equipamentos e reservas do módulo opcional de aluguel. Não altera agendas comuns, pedidos convencionais, estoque de alimentação, Fitness ou impressão 3D. Módulos e permissões não são habilitados automaticamente.

## Estado confirmado

Base da revisão: `main` e023a6c, checkout novo e limpo. No projeto Supabase VendeWeb `elttryavkeartoxgdgse`, a leitura inicial confirmou 2 equipamentos e nenhuma reserva. Não foram criados pedidos ou clientes de teste em produção.

O modelo existente usa uma oferta por equipamento físico, reserva de quantidade 1, períodos `[início, término)`, transação com lock da oferta e do ativo, manutenção global, checklists e sinal manual. Não existe frota quantitativa nem intervalo configurável para montagem/limpeza. A implementação reutiliza esse modelo.

## Regras e implementação

- `/admin/modulos?tab=rentals`: resumo de saídas nos próximos 7 dias, equipamentos em uso, devoluções atrasadas e manutenção; lista compacta, busca, filtros, detalhes e consulta no servidor por período.
- Saída e devolução são eventos explícitos, com data do servidor e responsável. Datas ou checklists não comprovam movimentação. Reserva vencida sem saída mostra **Saída não registrada**, nunca devolução atrasada. Registros anteriores sem evento não recebem datas inventadas.
- Uma devolução salva suas condições e o checklist na mesma transação e pode encaminhar para manutenção. Não conclui manutenção preexistente. Repetir saída/devolução não duplica eventos nem sobrescreve o evento original.
- Cancelamento conserva a movimentação física: equipamento retirado continua em uso até registrar devolução, mesmo se o pedido foi cancelado. A devolução conserva o status comercial cancelado e os valores do sinal.
- A consulta diferencia disponibilidade **no período** de **em uso agora**. O período planejado continua sem intervalos adicionais. Atraso real estende a indisponibilidade até o momento atual; reservas futuras fora desse intervalo continuam possíveis, com aviso de saída sem devolução. Uma segunda saída é bloqueada enquanto outra ainda não foi devolvida.
- Lock existente da oferta/ativo é reaproveitado. Trigger de reserva protege também gravações fora do checkout, inclusive equipamento cancelado mas ainda em uso em período conflitante. Saída antecipada/tardia não pode invadir outra reserva.
- O sinal continua manual, com referência. O saldo após sinal é uma estimativa, não consulta bancária. A cobrança e a conciliação do pedido não são recalculadas, evitando mudança financeira silenciosa. Quando o pedido consta pago, isso é exibido sem subtrair novamente o sinal. Caução, multas e descontos não foram criados.
- Acompanhamento é uma anotação interna, sem envio de mensagens.
- RLS e permissões existentes por loja são reutilizadas; owner/admin/manager operam, financeiro conserva leitura, Master exige AAL2. Visões com `security_invoker` preservam as restrições dos cabeçalhos de outra loja.
- Equipamentos e reservas usam paginação por chave; histórico carrega páginas de 50 eventos. Histórico começa na implantação, sem reconstrução fictícia do passado. IDs dos responsáveis são exibidos porque o módulo não oferece diretório seguro de nomes.

## Migração e implantação

**Aplicada no VendeWeb em 23/11/2026**, versão remota `20261123163621`, nome `food_rental_operations_20261123`; arquivo local gerado pela CLI `20261123162215_food_rental_operations.sql`. Não reaplicar com outro nome nem enviar todas as migrations históricas. Antes/depois: 2 equipamentos, nenhuma reserva, checksums idênticos. Nenhum dado operacional de teste foi gravado em produção. Consulta autorizada e negação sem vínculo foram verificadas com `SET LOCAL ROLE authenticated` e rollback; anônimo não executa as novas RPCs e cliente não insere no histórico.

O frontend está no PR #254, ainda sem merge/publicação em produção. A jornada autenticada com navegador e dados reais em produção depende dessa publicação. O SQL remoto foi verificado; isso não equivale à homologação completa da tela em produção.

`supabase/migrations/20261123162215_food_rental_operations.sql` adiciona campos de eventos, histórico com RLS, duas visões invocadoras, RPCs de disponibilidade e comando, triggers e encaminhamento dos dois comandos legados de aluguel. Não apaga nem reclassifica registros existentes. O encaminhamento valida a presença do trecho esperado na função atual antes de instalar; o restante do comando multissetorial é preservado.

Aplicar somente este arquivo após revisão, sem `db push` indiscriminado: versões históricas locais e remotas não coincidem. Implantar banco antes do frontend. Aplicações antigas continuam usando os comandos existentes. Para reversão visual, retornar o frontend anterior e conservar colunas/histórico; não remover eventos registrados nem apagar dados para desfazer a versão.

## Verificação

- `npm run build`: tipos e build aprovados localmente.
- `node scripts/modules-db-test.mjs`: 86 verificações com PostgreSQL PGlite descartável, incluindo isolamento, papéis, sinal, manutenção, cancelamento, saída e devolução.
- `node scripts/rental-operations-test.mjs`: 12 casos de situação, atraso e períodos.
- `FOOD_DB_TEST_RUNTIME=<runtime>/node_modules node scripts/rental-postgres-test.mjs`: repete os testes com PostgreSQL 17 e disputa real de reservas, manutenção, saída e devolução em duas sessões. Dependências temporárias: embedded-postgres@17.9.0-beta.17 e pg@8.16.3, conforme padrão existente do projeto.
- `cd qa && ./node_modules/.bin/playwright test --config rentals.config.ts`: jornada em 320/390/768/1366 px e falha/invalidação de disponibilidade. HTTP simulado: valida interface; não substitui autenticação real em produção.
- Workflow `Operação de aluguel` executa os testes de concorrência e navegador em runner isolado. Localmente, abertura de sockets/navegador foi bloqueada. A suíte antiga `test:modules` depende do commit histórico `9d5c79f`, ausente no clone raso; os testes de banco e situação foram executados diretamente.

### Resultados finais

- [Workflow Operação de aluguel, execução 3](https://github.com/JoseLuiz095/vendeweb/actions/runs/45218042400): aprovado. PostgreSQL 17 real repetiu as 86 verificações; duas sessões comprovaram disputa de reserva, manutenção, saída e devolução sem duplicação. As falhas iniciais do runner eram representação de bigint na fixture e permissão da conexão de observação de locks, corrigidas no teste.
- Cinco jornadas Playwright aprovadas, em 320/390/768/1366 px, incluindo falha e invalidação da consulta. Axe verificou WCAG A/AA na área de aluguel em 390 px sem violações; imagens mobile/desktop foram inspecionadas. [Relatório e imagens do runner](https://github.com/JoseLuiz095/vendeweb/actions/runs/45218042400/artifacts/14839003497), retenção de 7 dias.
- Testes gerais de segmentos aprovados e 122 verificações do fluxo crítico aprovadas. Checkout convencional e funções `food_modules_customer`/`food_modules_release` conservaram os hashes no banco; a função de comando comum mudou exclusivamente para encaminhar os dois comandos de aluguel.
- Advisors revisados: as duas novas RPCs são intencionalmente SECURITY DEFINER, com search_path vazio, EXECUTE revogado de PUBLIC/anon e autorização explícita por loja/perfil. O aviso genérico de execução por autenticados é esperado para estas APIs; RLS permanece no histórico e as visões são invocadoras. Isso não declara que todos os avisos preexistentes do projeto foram resolvidos.

## Evoluções não ativadas

Frota por quantidade/unidade, caução, intervalo de montagem/limpeza, fotos, assinatura, contrato eletrônico, mensagens automáticas e novas regras de cobrança exigem definição própria. Não foram introduzidos novos serviços nem dependências de execução na aplicação.
