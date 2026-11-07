# Acesso do aluno Fitness — revisão e pendências

A alteração deste PR esclarece a identificação por loja, a espera pela confirmação do crédito e os passos de saída e recuperação já existentes. Não implementa a troca autônoma por SMS.

O usuário escolheu permitir que o aluno troque a sessão após um novo código enviado ao telefone cadastrado. Isso ainda requer um contrato de verificação no servidor, vinculado ao usuário, loja, sessão de destino e desafio, com validade curta, uso único, limitação de tentativas, auditoria e revogação atômica da sessão anterior. Quem controla o número pode assumir a sessão; a perda do número requer recuperação por canal seguro. Uma sessão não identifica um aparelho físico de modo infalível.

O JWT do Supabase não demonstra, por si só, que um `amr.method=otp` recente foi verificado por SMS: o mesmo método inclui OTP por e-mail e magic link. O telefone confirmado na conta também não comprova que o desafio recente usou esse telefone. Não autorizar a troca somente por claims `otp`, telefone ou por uma confirmação de interface. Revisar uma solução verificável no servidor e homologá-la em ambiente isolado com Phone Auth e provedor SMS reais de teste antes de ativar.

Em consulta somente leitura em 07/11/2026, as RPCs `food_fitness_student_status_v1`, `food_fitness_student_session_v1`, `food_fitness_student_session_admin_v1` e `food_fitness_entitlement_v1` não apareceram no catálogo público do projeto compartilhado. Isso não caracteriza a ausência de todas as rotas Fitness; confira cada dependência e o histórico de migrations no ambiente de homologação. A implantação de migrations, RLS, funções e Phone Auth não faz parte deste PR.

A confirmação de pagamento permanece separada do comprovante enviado. O código de ofertas contém conferência administrativa, mas sua presença na árvore não comprova implantação, funcionamento da conta piloto, isolamento ou fluxo financeiro em produção. Não criar contas, pagamentos ou mensagens reais para testar.

Antes de ativar: testes sintéticos de SMS incorreto, expirado e reaproveitado; sessões concorrentes; loja e aluno trocados; sessão antiga revogada; autorização por compra; pagamento pendente, confirmado e estornado; expiração; recuperação de número; isolamento de tenants; retentativas e execução concorrente. Fazer testes autenticados em ambiente isolado e verificar autorização efetiva em cada endpoint que entrega conteúdo. Preparar revisão de impacto e reversão antes de qualquer alteração no Supabase compartilhado.
