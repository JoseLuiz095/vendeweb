# Fitness: acesso inicial sem contratação de serviços

## Decisão e alcance

O usuário priorizou manter o plano gratuito e autorizou recuperação assistida temporária. O portal passa a aceitar e-mail e senha de conta confirmada; não envia recuperação ou cadastro automático por e-mail. Primeiro acesso de uma conta nova depende de preparação e verificação pelo suporte autorizado. Não foi desativada a confirmação de e-mail do Supabase nem criado cadastro anônimo.

SMS só aparece se estiver habilitado no Auth; o caminho legado permanece no portal. A vitrine direciona a autenticação ao portal, usando o cliente e o armazenamento específicos do aluno. Sessões de administrador são preservadas. Google depende de credencial própria e segue fora desta entrega.

A migration restrita ao Fitness reconhece e-mail confirmado ou telefone confirmado diretamente no Auth. Contas com MFA verificado continuam exigindo AAL2. Mantém sessão única por aluno/loja, consentimento, acesso após confirmação de compra e permissões administrativas. Não associa um contato existente por coincidência de e-mail, não cria papel de profissional e não altera dados do Auth.

## Recuperação assistida

O responsável da loja encaminha a solicitação ao suporte autorizado da plataforma. Um lojista não recebe permissão para redefinir a conta global de um aluno, que pode pertencer a outras lojas.

1. Confirmar a identidade pelo procedimento seguro de atendimento da plataforma, antes de alterar credenciais ou ativar uma conta.
2. Localizar a conta existente e preservar seu identificador, vínculos e histórico. Não excluir/recriar a conta, trocar e-mail ou desativar MFA como atalho.
3. Realizar a recuperação pelos controles oficiais do Supabase com operador autorizado e participação do titular. Senhas, links de recuperação e códigos não devem ser enviados à IA nem registrados no atendimento ou no repositório.
4. Revogar sessões anteriores no Auth e liberar a sessão Fitness com MFA, quando necessário, antes da nova entrada. Conferir as lojas afetadas e o segundo fator.
5. O titular entra pelo portal e confere seus dados. O teste real deve evidenciar a conta e a loja corretas; uma resposta simulada não prova recuperação de conta.

Nenhuma senha é criada ou redefinida por esta alteração. Não existe senha padrão, recuperação pública privilegiada ou chave administrativa no navegador.

## Plano gratuito observado em 26/11/2026

O painel da organização mostrou Free, SMTP próprio desativado, telefone e Google desativados e e-mail habilitado. O envio padrão de Auth é limitado à equipe do projeto, conforme documentação oficial; e-mail habilitado não comprova entrega para alunos externos.

O ciclo anterior registrou 5,859 GB de tráfego em cache para franquia de 5 GB. No ciclo atual a consulta mostrou aproximadamente 0,10 GB, banco de 42,67 MB e armazenamento de aproximadamente 0,09 GB. O aviso indicava período de tolerância até 24/12/2026. Estes números são uma observação, não garantia de permanência no Free conforme o uso crescer. Não foi contratado serviço nem alterado plano.

## Evidência e limites

Há testes locais de identidade, telefone não confirmado, MFA, sessão única/expirada/revogada, isolamento, consentimento e compra simulada. Há testes de interface para login, recuperação assistida, MFA, métodos indisponíveis, SMS legado, responsividade e preservação da sessão administrativa. Registrar o resultado efetivo do CI antes do merge.

Aplicação da migration, publicação da interface e teste com José Luiz precisam ser comprovados separadamente. Pagamento bancário e liberação automática em produção permanecem sem homologação.

O histórico global de migrations possui divergências já identificadas. Esta entrega não executa db push nem repara indiscriminadamente o histórico do projeto compartilhado.
