# Destinos de comprovantes — homologação (03/11/2026)

> Registro histórico do envio por WhatsApp. Para o estado atual da confirmação de pagamento, migrations pendentes e publicação, consulte [RECEIPT_PAYMENT_VERIFIED_PUBLICATION_20261103.md](./RECEIPT_PAYMENT_VERIFIED_PUBLICATION_20261103.md). Este documento não comprova que a confirmação bancária esteja publicada.

Base: `main` em `a2014c0d150b374769cf56fc8ec7bc589afc0847` (PR #151 integrado).

## Contrato

- `food_get_receipt_destinations_v2(store_id, pickup_location_id)` devolve `general` com o WhatsApp da loja quando válido; para origem específica, `point` com o contato publicado daquele ponto; quando a loja não tem número e a origem é geral, `selection` com `pointId`, `slot`, nome público e telefone dos pontos ativos e públicos. `unassigned` e `unavailable` não fornecem destino.
- O link Pix resolve destinos no servidor com origem persistida em `food_order_receipt_sources`. O checkout legado consulta a mesma RPC com o `receiptPickupLocationId` retornado pelo servidor. O cliente não escolhe um `store_id` ou `point_id` arbitrário no link de pagamento.
- O cadastro de “Contato 1/2” sai da interface. Registros históricos permanecem no banco e são preservados pelo salvamento da política; o novo contrato não os publica. O WhatsApp da loja é salvo nas configurações gerais e cada ponto tem seu editor independente.
- Abrir WhatsApp não confirma recebimento. A declaração “Já enviei” é separada e depende de contrato, token, política e funções implantadas. Não habilitar `ORDER_RECEIPT_AUTOPAID_ENABLED` para equiparar clique/comprovante a crédito bancário.

## Implantação de 03/11/2026

Projeto Supabase `elttryavkeartoxgdgse` (`VendeWeb`, `ACTIVE_HEALTHY`). A migration `food_receipt_destinations_store_or_point_20261103` foi aplicada; consulta com papel `anon` confirmou `selection` com dois pontos ativos no link geral e `point` no link específico. A Edge Function `food-public-checkout` foi publicada na versão 19 (`verify_jwt=false`) com o wrapper transacional de origem; preflight HTTPS retornou 200 e CORS do domínio oficial. A função não gera token de declaração de pagamento.

Nesta revisão, a consulta de destinos no frontend é habilitada por padrão e não depende de flag de build. O checkout usa a RPC de origem instalada; não depende dos secrets `ORDER_RECEIPT_CONTACTS_ENABLED` ou `ORDER_PAYMENT_LINK_SECRET` para encaminhar ao WhatsApp. O envio continua sendo realizado pelo cliente na conversa e a loja confere o crédito.

`food-order-payment` não estava publicada no momento desta revisão; o link Pix compartilhável permanece condicionado a `VITE_PIX_PAYMENT_LINK_ENABLED` e `ORDER_PAYMENT_LINK_ENABLED`. Não foi ativada a declaração que marca pagamento pelo cliente, nem aplicada a migration `food_declare_order_receipt_v1`. Isso é separado do envio do comprovante na conclusão do checkout.

Após o merge, verificar o build/deploy do worker `foodweb` no Cloudflare e testar no domínio real com uma conta e um pedido de teste autorizados: loja com WhatsApp, loja sem WhatsApp e dois pontos, QR de ponto, origem geral, ausência de destino, pedido pendente e isolamento. Não usar um pedido real de cliente para smoke. Testes locais e preflight não comprovam entrega de mensagem no WhatsApp.
