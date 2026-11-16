# Pix Mercado Pago — homologação DuoForma

## Estado verificado em 16/11/2026

O PR #226 foi integrado à `main`. No projeto Supabase compartilhado, a DuoForma é a única loja na lista de autorização OAuth de teste; não há conexão válida nem tentativa de cobrança da loja, e a opção de checkout de teste está desativada. As funções OAuth e checkout de teste estão publicadas; a função de webhook de teste não estava publicada na consulta. A presença de uma função ativa não comprova que suas variáveis estejam configuradas ou seu fluxo funcione.

O fluxo de teste registra uma confirmação em `food_mp_test_pix_ledger` e não marca `food_orders.payment_status` como pago. Uma transação simulada nunca deve ser usada como confirmação bancária de um pedido operacional. A integração de produção exige implementação e validação separadas, incluindo os efeitos sobre atendimento, retirada, entrega e estoque.

## Pontos a resolver na homologação

- Validar a autorização OAuth com a conta vendedora de teste, na mesma sessão de administrador da DuoForma, sem transportar credenciais pelo chat.
- Garantir que a criação da cobrança de teste e sua eventual simulação fiquem restritas a uma jornada identificada de teste, sem desviar clientes reais nem alterar pedidos operacionais indevidamente.
- Verificar a resposta real da consulta à order de teste: o webhook atual exige `live_mode: false` no retorno da API, mas o exemplo oficial de resposta Pix não inclui esse campo. Não remover a verificação sem estabelecer outra prova confiável do ambiente de teste.
- Configurar e validar notificações de teste assinadas, origem e conta recebedora, vínculo de identificadores, valor, status, reenvios e concorrência. Revisar timeout, renovação de token, estorno e conciliação.
- Antes de produção, implementar confirmação transacional com dados bancários reais e testes para pedido cancelado ou alterado, duplicatas, consequências financeiras e de estoque. Pagamento confirmado libera atendimento; não comprova entrega. Retirada futura continua aguardando retirada; retirada no mesmo dia segue a regra aplicável do negócio.

Referências: [teste Pix com Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix) e [notificações de orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).

## Validação local

Em 16/11/2026, 18 testes de OAuth, webhook e adaptador passaram usando transportes e dados simulados. Eles não constituem homologação com o Mercado Pago, teste de produção ou validação dos efeitos em estoque.

