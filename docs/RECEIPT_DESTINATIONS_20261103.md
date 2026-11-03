# Destinos de comprovantes — homologação (03/11/2026)

Base: `main` em `a2014c0d150b374769cf56fc8ec7bc589afc0847` (PR #151 integrado).

## Contrato

- `food_get_receipt_destinations_v2(store_id, pickup_location_id)` devolve `general` com o WhatsApp da loja quando válido; para origem específica, `point` com o contato publicado daquele ponto; quando a loja não tem número e a origem é geral, `selection` com `pointId`, `slot`, nome público e telefone dos pontos ativos e públicos. `unassigned` e `unavailable` não fornecem destino.
- O link Pix resolve destinos no servidor com origem persistida em `food_order_receipt_sources`. O checkout legado consulta a mesma RPC com o `receiptPickupLocationId` retornado pelo servidor. O cliente não escolhe um `store_id` ou `point_id` arbitrário no link de pagamento.
- O cadastro de “Contato 1/2” sai da interface. Registros históricos permanecem no banco e são preservados pelo salvamento da política; o novo contrato não os publica. O WhatsApp da loja é salvo nas configurações gerais e cada ponto tem seu editor independente.
- Abrir WhatsApp não confirma recebimento. A declaração “Já enviei” é separada e depende de contrato, token, política e funções implantadas. Não habilitar `ORDER_RECEIPT_AUTOPAID_ENABLED` para equiparar clique/comprovante a crédito bancário.

## Situação remota observada

Projeto Supabase `elttryavkeartoxgdgse` (`VendeWeb`, `ACTIVE_HEALTHY`). A RPC v1 e dois contatos de ponto existem; v2 e `food_declare_order_receipt_v1` não existem; `food-order-payment` não aparece entre as Edge Functions publicadas; `food-public-checkout` está na versão 18. Portanto, o link Pix de #151 e a seleção nova exigem implantação coordenada e smoke autenticado antes de ativar tráfego.

## Sequência de homologação

1. Revisar/aplicar a migration `20261103160000_food_receipt_destinations_store_or_point.sql` no projeto correto. Validar grants `anon/authenticated/service_role`, RLS dos pontos, duas lojas e ponto privado/inativo. Não aplicar migrations de declaração de pagamento sem revisão própria.
2. Implantar `food-order-payment` e `food-public-checkout` da revisão aprovada; conferir origem persistida e configurar `ORDER_PAYMENT_LINK_SECRET` e allowlist de origens. Ativar `ORDER_RECEIPT_CONTACTS_ENABLED` apenas depois da RPC v2; `ORDER_RECEIPT_AUTOPAID_ENABLED` permanece desativado.
3. Publicar frontend com `VITE_RECEIPT_CONTACTS_ENABLED=true` e, somente após o link de pagamento funcionar em homologação, `VITE_PIX_PAYMENT_LINK_ENABLED=true`. Revisar WhatsApp real da loja ou dos pontos, Pix, pedido pendente, link geral sem telefone, link do ponto, indisponibilidade, loja suspensa e separação entre tenants. Testar mobile e WhatsApp em dispositivo real.

Nenhuma migration ou Edge Function deste trabalho foi implantada remotamente. Teste local PGlite e API simulada não demonstram operação real.
