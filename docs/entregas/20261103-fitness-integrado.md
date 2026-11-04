# Fitness integrado — candidato de homologação

Base verificada por fetch em 03/11/2026: `148b268` (main, PR #153). Branch `codex/fitness-complete-20261103`. Classificação: `shared_future`, restrita ao namespace Food/Fitness.

## Levantamento anterior à edição

| Capacidade | Estado | Evidência |
| --- | --- | --- |
| Projeto correto | Existente | Conector: VendeWeb `elttryavkeartoxgdgse`, ACTIVE_HEALTHY. Academia `vnpoinodvchmmbyxpacj` separado/inativo, não alterado. |
| Piloto | Existente | SELECT de `food_stores`: slug `fabriciofitness`, ID `ec06fb9a-9ba6-43e2-854d-c557745e5974`. Não equivale a validação comercial/profissional. |
| RPC de ofertas | Ausente remoto | `pg_proc` não retorna `food_fitness_offers_v1`; contrato frontend `{p_store,p_admin}` corresponde ao SQL `20261030170000`. Não é apenas texto de erro/cache. |
| RPC de sessões Admin | Ausente remoto | `pg_proc` não retorna `food_fitness_student_session_admin_list_v1`; contrato `{p_store}` corresponde a `20261030150000`. |
| Migrations | Parcial remoto | Instaladas cinco bases Fitness de 27/10; identidade profissional, sessões, conteúdos e ofertas de 30/10 ausentes. Timestamps históricos Food diferem: não executar db push indiscriminado. |
| Funções Fitness | Ausente remoto | Listagem de Edge Functions sem `food-fitness-*` nem `food-professional-assistant`. Sandbox mensal não comercial. |
| Homologação/contas | Bloqueado | Conector lista somente branch main. Nenhuma sessão de teste autorizada encontrada em `qa/.auth`. Docker instalado, daemon indisponível. Validação local não comprova Supabase real. |
| Vitrine | Parcial | Navegação real em `https://www.vendeweb.com.br/fabriciofitness`: três exemplos fictícios e prato ilustrativo visíveis; consulta comercial depende da RPC ausente. |
| Mídia | Parcial | `FitnessPilotExamples.tsx`: somente agachamento 2D/GLB, fora da sequência individual. Outros oito movimentos sem ilustração por exercício. Acervo de vídeos não utilizado. |
| Compra e entrega | Parcial | `FitnessOffersAdmin.tsx`, `FitnessOfferCheckout.tsx`, `fitnessOffersApi.ts`, SQL de ofertas: somente ficha pronta. Pix verificado com MFA e aviso interno transacional já existem no código. |
| Agenda | Parcial | `FitnessBookingOffers.tsx`, `fitnessApi.ts` e SQL booking: recorrência, bloqueios, cancelamento/reagendamento; sem vínculo obrigatório com pedido pago nem local por oferta. |
| Ficha | Parcial | `FitnessWorkouts.tsx`, `FitnessWorkoutSession.tsx`: editor básico, aprovação/atribuição, séries temporárias; faltam campos estruturados, dias, histórico. |
| Nutrição | Ausente funcional | `FitnessNutritionExample.tsx` é somente ilustração; portal informa ausência de plano. Nenhum plano individual persistido nem profissional CRN confirmado. |
| Mensagens | Parcial | `FitnessStudentPreferences.tsx`, SQL professional_content/student_reminders e Edge worker existentes; portal novo não os conecta e cliente de auth precisa ser coerente. |
| Reuso Alimentício | Existente | `src/pages/store/Checkout.tsx`, `OrderPayment.tsx`, `src/pages/admin/Settings.tsx`, `food-public-checkout`: padrões de catálogo/Pix/fila reutilizáveis. Pedidos físicos/estoque permanecem no contrato Food; entrega clínica usa contrato Fitness. Não criar cobrança paralela. |

Documentos históricos consultados: PILOTO_FITNESS_CHAT1, FITNESS_ACCESS_SANDBOX, FITNESS_PILOT_MEDIA, auditoria de 30/10 e handoffs #149/#150. A main já incorpora #137/#138/#149/#150: sem cherry-pick/reimplementação dessas entregas.

## Decisões

- Agendamento somente após pagamento confirmado; não segurar slot durante Pix manual. Pedido pago sem slot exige escolha explícita. Nenhum horário inferido.
- Nutrição e conteúdo personalizado exigem revisão do profissional identificado e consentimento separado. Owner/Master não herdam autorização clínica.
- Não instalar SQL no Supabase compartilhado sem ambiente controlado e baseline reconciliado. Preparar migrations aditivas e verificação de assinaturas/grants, preservando o erro real enquanto a implantação estiver pendente.
- Não criar endereço, preço, registro profissional, conta ou dado clínico presumido. Demonstrações visuais não geram compras nem direitos.
