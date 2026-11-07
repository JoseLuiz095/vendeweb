# Contrato da confirmação de pagamento informado

A função pública ao cliente é `food-order-payment`, ação `report_receipt`, usando a autorização específica (`receiptToken`) emitida no checkout. O token é validado na Edge Function e identifica loja, pedido, valor e versão; a função invoca `food_declare_order_receipt_v1(store_id, order_id, amount, version)` com a credencial do servidor. A RPC não é concedida a `anon` ou `authenticated`.

O resultado `{ok, status: 'paid', paymentReportedByCustomer: true, autoPickedUp}` indica pagamento informado pelo cliente, não crédito bancário confirmado. O clique é idempotente enquanto o pedido e a versão permanecem válidos. Alteração de valor/versão, cancelamento, estoque insuficiente ou inconsistência do local invalida ou reverte a operação. Para pedido de retirada com ponto selecionado e local correspondente, a operação conclui a retirada e aciona a baixa na mesma transação; sem ponto, não conclui a retirada. Não chamar diretamente a RPC pelo navegador nem implementar uma segunda baixa no canal de mensagens.

O canal de chat deve realizar sua própria autenticação/autorização, preservando este contrato; envio de mensagem/anexo e confirmação de pagamento precisam de estratégia explícita para falhas, repetição e reconciliação. Essa branch não implementa mensageria, anexos ou notificação.
