# Impressão 3D — evolução e verificação

Base inicial: `JoseLuiz095/vendeweb`, main `13bf16277696303018c017b20814245af004fe32` (27/11/2026). Alterações concorrentes da main `c1076dda611c63ab6b0d05761b19bd184dd609f9`, árvore `096ddc3a07f4be241f4137b38d457bd385192a91`, foram preservadas na cópia de testes; nenhum dos arquivos existentes tocados pelo trabalho divergiu entre essas bases. Classificação arquitetural: vertical `shared_future`, sem mudar o núcleo multissetorial ou namespaces históricos.

## Requisitos e andamento

| Área | Base encontrada | Trabalho previsto | Estado |
|---|---|---|---|
| Produção | Fila, aprovação, consumo transacional, correção por diferença, histórico, tentativas | Classificação privada/catálogo, importação e origem, reimpressão explícita | Implementado e testado no banco local; visual pendente |
| Estoque | Insumos, unidade g/kg, custo médio, compras e prevenção de baixa por ficha duplicada | Preservar controles, validar correções e duplicidade da importação | Testes locais aprovados; sem movimentar estoque real |
| Cliente | Compra de catálogo e CTA WhatsApp; anexos somente pelo lojista | Solicitação persistida com arquivos privados, foto, descrição e assistência | Implementado; servidor testado com dependências simuladas; visual pendente |
| IA | OpenAI para profissionais fitness; Gemini autenticado para lojistas | Reaproveitar acesso OpenAI no servidor para briefing 3D, com consentimento | Implementado e testado com resposta simulada; conta/modelo reais pendentes |
| Custos | Filamento, energia, hora máquina, mão de obra, acabamento e margem | Perdas, taxas, embalagem, outros, composição e lucro estimado | Fórmulas cliente/SQL verificadas; padrões por loja persistem |
| Integração Bambu | Nenhuma identificada | Importação assistida 3MF/G-code; telemetria como etapa dependente de hardware | Leitor testado com arquivos sintéticos; A1 e arquivo real pendentes |

## Decisões

- Não instalar outro ERP/estoque: preservar o estoque existente como fonte do débito. Spoolman é opção futura de sincronização, evitando dois saldos concorrentes.
- Não copiar código AGPL do Bambu Studio. Usar especificações observadas em documentação/código como referência de formato; leitor próprio e biblioteca MIT já presente no ecossistema Three.js para ZIP.
- Dados do slicer são estimativas. Consumo só baixa na confirmação e mantém origem; telemetria não é pesagem real.
- A importação é local e passiva: não executa G-code, não envia comandos à impressora, não baixa arquivos de URLs arbitrárias. Hash identifica arquivo/mesa repetidos; nova tentativa permanece explícita.
- Modelos MakerWorld exigem conferir licença comercial de cada criador; registrar link/licença, sem supor API pública nem autorização de revenda.
- Usuário decidiu: sem serviço pago de geração 3D. Entregar ideia, anexos e revisão. A assistência textual usa o provedor já previsto no projeto, quando configurado; não foi ativado ou contratado um gerador de malha.
- Produção e banco compartilhado: preparar e testar alterações isoladamente antes de qualquer publicação. Não há autorização implícita para confundir testes locais com publicação.

## Fontes pesquisadas (27/11/2026)

| Ferramenta/fonte | Licença e manutenção observada | Compatibilidade, custo e decisão |
|---|---|---|
| [Bambu Studio](https://github.com/bambulab/BambuStudio) e [formato 3MF](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp) | AGPL-3.0; repositório oficial ativo | Exportação fatiada reaproveita prediction, weight e filamentos. Ler metadados; não incorporar código nem executar slicer no Worker. Sem tarifa de API na importação local. |
| [fflate](https://github.com/101arrowz/fflate) / [Three.js](https://github.com/mrdoob/three.js) | MIT; já há Three.js no projeto | Reaproveitar leitor ZIP distribuído em Three.js; limitar arquivo e descompressão. Sem nova assinatura. |
| [ha-bambulab](https://github.com/greghesp/ha-bambulab) | MIT; README e notas de releases com suporte A1 | Ponte local/Home Assistant possível; exige dispositivo ligado, credenciais e validação do firmware. Não cabe conexão LAN direta pelo SaaS hospedado. Não instalado nesta etapa. |
| [Spoolman](https://github.com/Donkie/Spoolman) | MIT; releases e atividade verificadas | Gestão de bobinas/API auto-hospedada. Serviço adicional e sincronização exigiriam operação/backup; manter estoque VendeWeb, não introduzir dependência duplicada. |
| [Bambu Connect e modo desenvolvedor](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/) | Software/protocolo do fabricante; restrições de autorização | MQTT/FTP variam por firmware/modo. Não desabilitar segurança nem abrir impressora à internet. Validação depende da A1 e da rede do lojista. |
| [MakerWorld — licença comercial](https://blog.bambulab.com/empowering-our-creators-with-new-commercial-license-membership/) | Licenças por modelo/criador; algumas exigem assinatura | Guardar referência e declaração da licença. Download manual; API pública adequada não comprovada. Custo depende do criador. |
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | MIT no repositório; inferência padrão informa cerca de 6 GB VRAM | Reconstrução de imagem viável em servidor GPU, incompatível com Worker/Supabase Edge sem serviço externo. Precisão, escala e malha requerem revisão. Não ativado. |
| [Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE) | Licença comunitária específica, limitações territoriais e comerciais | GPU/serviço externo e revisão de licença; não escolhido como dependência do SaaS. |
| [OpenAI visão](https://developers.openai.com/api/docs/guides/images-vision) | Serviço pago por uso, sujeito à conta/modelo configurado | Reaproveitar credencial de servidor existente para interpretar foto e organizar briefing. Visão não equivale a CAD/STL nem confirma dimensões ocultas. |

## Matriz de dados

| Dado | Importação | Real ou estimativa | Alternativa |
|---|---|---|---|
| Nome, mesa, identificação do arquivo | 3MF/G-code quando presente | Referência do arquivo | Descrição manual |
| Tempo e peso | Metadados do fatiamento | Estimativa | Informar/conferir tempo e pesar consumo |
| Tipo e cor por filamento | 3MF quando preenchido | Configuração planejada | Selecionar insumo local |
| Custo do filamento | Custo médio do insumo associado | Custo registrado; não presume preço no MakerWorld | Ajustar calculadora/compra |
| Energia, mão de obra e perdas | Configuração da loja/orçamento | Estimativa salvo medição externa | Ajustar valores por projeto |
| Telemetria da impressora | Exige ponte local e hardware | Estado/tempo; gramas podem continuar estimadas | Importar arquivo e confirmar resultado |

## Verificações e pendências

- Código local anterior tinha exportação com CRLF; cópia isolada normalizada e comparada por SHA Git com árvore remota. Arquivos divergentes atualizados pela conexão GitHub, preservando os outros trabalhos locais.
- Navegação publicada: slug correto `/duoforma-impressoes-3d`; produto “floco de neve” abriu a R$ 10,00 e “Comprar agora” abriu o checkout com entrega/retirada, contato e resumo de R$ 10,00. Não foi enviado pedido nem feito pagamento real. A loja ainda tem categorias herdadas (“Lanches”, etc.); não foram renomeados dados do lojista.
- Supabase compartilhado confirmado saudável; RPC de produção existente. Nenhuma alteração remota realizada.
- Testes: `npm run test:printing3d`: 9 testes de parser, custos e handler + 74 verificações PostgreSQL/PGlite descartável. Incluem RLS entre lojas, produto externo, hash e mesa repetidos, reimpressão idempotente, edição da tentativa, correção de consumo, histórico, origem estimada/manual, taxa/margem incompatível, snapshot aprovado preservado, capability expirada/errada, cinco anexos e ausência de execução pelo público.
- Regressão: 177 verificações smoke; 122 contratos de fluxo crítico; 14 verificações do carrinho + 6 de disponibilidade. São verificações automáticas de código/comportamento isolado, não uma compra completa em produção.
- TypeScript e build passaram. Também foi compilado o fluxo público com `VITE_PRINTING3D_PUBLIC_ENABLED=true`. Build local avisa que a chave Turnstile não está configurada nesta cópia; não foi substituída por credencial real ou desabilitada a verificação.
- O teste de edição revelou uma ambiguidade preexistente (`plan=plan`) na rotina SQL. A nova migration corrige apenas a expressão revisada, usando um bloco identificado; teste confirmou que a edição e a preparação de nova tentativa funcionam. Consulta somente leitura confirmou a presença da expressão na função remota. A migration falha explicitamente se o corpo remoto não tiver essa expressão; não altera migrations históricas.
- Nova interface não foi validada visualmente: o servidor local iniciou, porém conexões receberam `EACCES`/timeout no ambiente. A tentativa pelo Edge foi encerrada pelo usuário via Escape. Nenhuma navegação adicional foi executada depois dessa interrupção. Celular e computador para as telas novas continuam pendentes.
- Foi criada uma demonstração reproduzível com dados fictícios (`qa/printing3d-harness.html` e `scripts/build-printing3d-preview.mjs`); ela não acessa a loja nem a IA real. Build não equivale a teste visual.

## Implantação e limites

**Estado: fonte implementada para revisão/testes; sem publicação de banco, função ou frontend. Não pronta para declarar homologação concluída.**

1. Revisar o diff de `20261127184058_food_printing3d_workflow.sql` e comparar as funções/schema com o ambiente alvo; não executar `db push` sobre o projeto compartilhado. A CLI criou o arquivo de migration; a configuração transitória da CLI ficou dentro da pasta de resultados de teste.
2. Aplicar a migration em homologação isolada. Ela usa tabelas e RPCs `food_*`, sem alterar dados FloriWeb ou buckets públicos. Leitura de produção continua por RLS existente. Novos comandos passam por autenticação, loja, módulo, chave idempotente e revisão do registro.
3. Publicar `food-printing3d-public` no ambiente de teste; manter `PRINTING3D_PUBLIC_ENABLED=false` até configurar origens e verificar SQL/Storage. A função usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY` e `PUBLIC_APP_ORIGINS`. Nunca colocar esses secrets em `VITE_*`. Para ajuda por IA, reutilizar `OPENAI_API_KEY` e `OPENAI_MODEL` compatível com visão já previstos no projeto. Se ausentes, o formulário continua aceitando projetos e mostra indisponibilidade da assistência.
4. A ação Turnstile do formulário é `print3d`. Configurar chave pública no build e origem/hostname do preview antes de validar criação/assistência. Não usar chave fictícia fora da demonstração local.
5. Só depois habilitar `PRINTING3D_PUBLIC_ENABLED=true` no servidor e `VITE_PRINTING3D_PUBLIC_ENABLED=true` no build de teste. A vitrine conserva o contato WhatsApp. Os campos novos do lojista só aparecem quando a resposta de configurações contém a coluna nova de custos, evitando comandos sem implantação do SQL.
6. Validar os cenários abaixo e revisar a entrega antes de publicação real.

| Pendente | Acesso/dado necessário | Critério de conclusão |
|---|---|---|
| Interface de administração e cliente | Navegador com acesso ao teste; validação foi interrompida | Conferir 320/390/768/1366 px, teclado, mensagens e anexos |
| Importação A1 | `.gcode.3mf` real exportado após fatiar no Bambu Studio | Comparar mesa, tempo, peso, materiais e cores com o Studio; nenhuma baixa antes de confirmar |
| IA real | Credencial/modelo de servidor já configurados e consentimento no formulário | Foto+descrição geram briefing revisável; falha permite envio manual; nenhum STL prometido |
| Solicitação ponta a ponta | SQL/Edge/Storage/Turnstile implantados no teste | Orçamento e até cinco anexos chegam ao lojista; retry não duplica; outra loja não lê |
| Compra completa de catálogo | Ambiente e dados de teste para checkout | Recebimento do pedido, preço e isolamento confirmados; pagamento real separado |
| Telemetria automática | A1, firmware/modo e ponte local autorizada | Descobrir dados realmente disponíveis e verificar sem expor MQTT/FTP à internet |
| Custos reais | Tarifa de energia, potência média/medição, custo dos insumos, máquina, trabalho e taxas da loja | Conferir cálculo e distinguir custo médio/estimativa de medição e lucro realizado |

Não foi instalada ponte MQTT, Spoolman, Home Assistant ou GPU. Não há geração automática de STL. Importação não repõe automaticamente o estoque de peças prontas; associação ao produto identifica a produção. Produtos com baixa automática por ficha exigem revisão antes da associação, para prevenir consumo duplo. A cotação de cada trabalho usa um snapshot; registrar consumo não reajusta o preço acordado.

Se precisar recuar a exposição pública, desabilitar a flag do servidor e reconstruir a vitrine com a flag pública desligada; manter os dados e o histórico. Não remover colunas/tabelas ou executar rollback destrutivo.

## Revisão de código

PR em rascunho: https://github.com/JoseLuiz095/vendeweb/pull/276 — branch codex/impressao3d-fluxo-integrado-20261127, commit inicial 759a491bf3a6db87c2830fe6a396d64b93dfcd14. Os 28 arquivos enviados foram conferidos por SHA Git contra os arquivos locais. Sem merge; o documento não autoriza tratar a homologação como concluída.
