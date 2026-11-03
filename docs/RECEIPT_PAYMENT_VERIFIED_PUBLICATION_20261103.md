# Confirmação de comprovante e pagamento — estado e publicação

Data da verificação: 03/11/2026. Branch de trabalho baseada em `main` no commit `c2c502e`.

## Regra entregue

O cliente pode informar que enviou o comprovante pelo WhatsApp. Esse aviso mantém o pagamento pendente, não conclui a retirada e não baixa estoque. Um administrador autorizado da própria loja confere o crédito no banco e confirma com MFA/AAL2. Só então o pedido vira pago; a retirada e a baixa de estoque são concluídas na mesma transação quando a loja habilitou a retirada imediata naquele ponto e a reserva está íntegra.

Não foi encontrada integração de webhook Pix de lojista. As funções Asaas disponíveis no repositório atendem ao sandbox de assinatura Fitness, que é um contrato diferente. Portanto, o caixa do VendeWeb continua exigindo confirmação bancária da loja.

## Estado observado

Projeto confirmado pelo conector: Supabase `elttryavkeartoxgdgse` (`VendeWeb`), `ACTIVE_HEALTHY`, região `sa-east-1`, PostgreSQL 17.6.1.165.

| Parte | Estado | Evidência |
|---|---|---|
| Destinos de comprovante por loja/ponto e origem persistida | Existente | Migrations `20261031002455`, `20261031002542`, `20261031002717`, `20261031002732` e `20261103134946` constam no projeto; `food_order_receipt_sources` existe. |
| Aviso do cliente sem confirmar crédito | Preparado na branch; ausente em produção | Edge `food-order-payment`, colunas `payment_reported_by_customer` e `payment_receipt_version`, e RPC `food_declare_order_receipt_v1` não existem no projeto remoto. |
| Conferência Pix por administrador da loja com MFA | Preparada na branch; ausente em produção | RPC `food_review_receipt_report_v1` não existe no projeto remoto. A implementação valida AAL2 e `food_is_store_admin`; bloqueia alteração REST direta dos campos financeiros e não concede acesso financeiro ao Admin Master. |
| Retirada imediata por ponto, após conferência | Preparada na branch; ausente em produção | Coluna `food_pickup_locations.auto_pickup_on_receipt` não existe remotamente. O fechamento só ocorre para retirada do site sem agendamento, ponto público/ativo e reserva íntegra no local de estoque correspondente. |
| Baixa do estoque e crédito financeiro atômicos | Parcial | A plataforma já possui triggers transacionais de fulfillment e ledger; o novo RPC muda o status apenas após validar a reserva e registra crédito na mesma transação. Reserva incompleta, movimento de venda prévio ou estoque físico insuficiente mantém a retirada para conferência manual sem desfazer o crédito conferido. Precisa ser instalado e validado no projeto autorizado. |
| Webhook financeiro confiável para Pix da loja | Ausente | Nenhum webhook Pix de lojista está conectado; comprovante, retorno de WhatsApp e clique do cliente não são confirmação financeira. |
| Edge Function de pagamento | Ausente em produção | A listagem atual contém `food-public-checkout`, mas não `food-order-payment`. |
| Aplicação web publicada com os novos estados | Pendente | Alterações de frontend estão apenas nesta branch; não há workflow Cloudflare configurado neste checkout. |

## Arquivos da implementação

- `supabase/migrations/20261103190000_food_receipt_verified_payment_pickup.sql`: cliente apenas declara; revisão Pix requer AAL2; trigger bloqueia alteração REST direta do estado/timestamps/responsável financeiro; criação de venda Pix já recebida exige conta da própria loja com AAL2. A confirmação pode concluir retirada elegível e registra trilha de auditoria. Reserva incompleta, movimento de venda prévio ou saldo físico insuficiente mantém retirada para conferência manual. Declarações legadas pagas sem responsável administrativo voltam a pendentes, mantendo o estado físico e gravando auditoria.
- `supabase/functions/food-order-payment/`: capability de declaração isolada, resposta `reported` e consulta sem código Pix quando já declarado.
- `src/pages/store/OrderPayment.tsx` e `src/components/ReceiptDestination.tsx`: estados e texto do cliente sem indicar pagamento ou retirada concluídos.
- `src/pages/admin/Orders.tsx` e `src/components/admin/PaymentMfaDialog.tsx`: fila de declarações, revisão bancária e segundo fator TOTP.
- `src/components/admin/ReceiptContactsSettings.tsx`: texto das opções explica quando retirada/estoque serão concluídos.
- `.github/workflows/deploy-food-order-payment.yml`: workflow manual e restrito à branch `main` e ao projeto VendeWeb; publica somente a Edge Function de pagamento.

## Sequência de publicação

O histórico de migrations remoto ainda não inclui as migrations abaixo. Aplicar em ordem, após integrar esta branch à `main`, e interromper se qualquer pré-condição falhar:

1. `20261029171540_food_customer_receipt_payment.sql`
2. `20261030160000_food_pickup_receipt_closeout.sql`
3. `20261031004025_food_receipt_pickup_integrity.sql`
4. `20261103190000_food_receipt_verified_payment_pickup.sql`

Aplicar cada arquivo como migration versionada no projeto `elttryavkeartoxgdgse`, revisando o resultado antes de seguir. Não usar `db push` amplo: o histórico remoto tem lacunas e a sincronização automática poderia tentar instalar outras migrations pendentes. Depois:

1. Conferir colunas/RPCs e histórico remoto; a coluna e as RPCs do fluxo devem existir.
2. Na branch `main`, executar manualmente `Publicar confirmação Pix da loja` e escolher `PUBLICAR`. O workflow falha se o secret `SUPABASE_ACCESS_TOKEN` estiver ausente ou `SUPABASE_PROJECT_REF` não for exatamente `elttryavkeartoxgdgse`.
3. Publicar a versão web pelo processo Cloudflare da aplicação. A função deve estar publicada antes de habilitar a opção no painel.
4. Com conta de teste autorizada da loja, conferir pagamento pendente, aviso do cliente sem alteração de caixa/estoque, rejeição sem AAL2, confirmação após verificar o extrato, reprocessamento idempotente e uma retirada elegível com estoque reservado.
5. Só depois configurar WhatsApp/endereço operacional real e habilitar a opção de aviso na loja. Ativar fechamento de retirada por ponto somente após validar endereço, local de estoque e rotina de retirada imediata daquele ponto. Venda avulsa com pagamento Pix deve ser criada como “A receber”; depois da conferência bancária, use a fila de recebimentos com MFA.

## Operação e reversão

- O administrador que confere Pix precisa pertencer à loja e ter TOTP configurado. O Admin Master não recebe essa permissão automaticamente.
- O clique “Já enviei o comprovante” só cria uma declaração pendente; clientes não devem enviar outro Pix enquanto aguardam a loja.
- Retirada programada, entrega, pedidos sem origem/ponto válido e reservas incompletas não são concluídos automaticamente. A reserva incompleta mantém a confirmação financeira e exige conferência operacional do estoque.
- Não habilitar venda Fitness/nutrição por este fluxo nem tratar assinatura SaaS, assinatura do aluno e Pix da loja como o mesmo contrato.
- Se houver falha, desativar a opção de aviso da loja e a opção de retirada automática por ponto; não marcar pedido como pago manualmente sem conferir o banco. A migration é aditiva em schema, mas contém reclassificação auditada de declarações legadas sem responsável; não executar rollback automático de dados.

## Validação local

Executar antes de integrar/publicar: `npm run typecheck`, `npm run build`, `node --test scripts/receipt-payment-test.mjs`, `node scripts/receipt-payment-db-test.mjs` e a suíte Playwright focada em `receipt-payment`, `receipt-contacts` e `payment-status`. Os testes locais e as rotas simuladas não comprovam concorrência PostgreSQL, RLS ou entrega de WhatsApp no ambiente de produção.
