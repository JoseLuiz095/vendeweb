# Comparação Pix com credencial de teste

O diagnóstico publicado na versão 21 identificou uma conta brasileira de teste diferente da conta OAuth da DuoForma. O usuário informou o ID 3835760583 para a credencial de comparação; a conta OAuth permanece 3840680792. Essa diferença não prova a causa da recusa OAuth.

A nova ação explícita `compare_pix` confere via GET a identidade exata 3835760583, país MLB e tag test_user antes do POST. Usa cenário Pix com APRO e test_payer@example.com, conforme https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix. Não substitui o OAuth nem vincula a order alternativa a pagamentos da loja ou assinaturas.

Somente administrador autorizado do piloto pode executar. Valor fixo R$ 50,00, referência e idempotência derivadas da reserva local persistida. Repetições e concorrência reutilizam a chave, sem gerar outra chave automaticamente após falhas. A resposta passa por verificação de recebedor, referência, país, moeda quando presente, valor total e da transação, método Pix e indicador de produção explícita; um GET posterior verifica novamente o mesmo ID. Não expõe QR, credenciais ou payload bruto. Não aplica pagamento, entrega ou estoque.

Validação local: 28 testes simulados passaram (controle, identidade, handler e reconciliação); typecheck do frontend passou. Sem pagamento aprovado comprovado no provedor nesta mudança. Cartão permanece pendente de validação própria.

Depois de revisar e mesclar, publicar a função preservando as dependências implantadas que diferem do repositório, em particular o helper OAuth; o controle não muda a emissão de tokens. A publicação da interface segue o build do repositório. Usar o botão Comparar Pix com credencial de teste e registrar o ID e status da order de controle antes de concluir sobre OAuth. Um status processed de controle não comprova a homologação da loja.
