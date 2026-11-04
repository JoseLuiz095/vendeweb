# Mídia demonstrativa Fitness

O catálogo oferece duas formas de visualizar exercícios:

- **Loops 3D:** 31 movimentos selecionados de uma biblioteca de 435 animações da [Desk Break](https://github.com/shlomorsh/desk-break), criada por Shlomy Reshef sob licença MIT. O arquivo GLB e a licença estão em `public/assets/fitness-desk-break.glb` e `public/assets/licenses/desk-break-MIT.txt`. Revisão de origem: `8d475aa476b2c0e9ec6d09d8558faf17161e19ef`.
- **Referências 2D:** 105 exercícios de academia da biblioteca gratuita [RepDB](https://github.com/RepDB/exercise-dataset), seleção da revisão `66c4298af8d99b9dc397dad6699e508fb871d249`. São 104 pares de poses (início e movimento) e uma referência de pose única. As imagens locais estão em `public/assets/fitness-exercises/`.

RepDB permite uso pessoal e comercial dentro de aplicações com atribuição visível; a licença e o arquivo de atribuição estão em `public/assets/licenses/repdb-LICENSE-DATA.md` e `public/assets/licenses/repdb-ATTRIBUTION.md`. Cada referência 2D mostra a atribuição “Ilustrações de exercício por RepDB”. O conteúdo não está sendo publicado como banco de dados ou serviço independente.

As opções do cadastro são rótulos em português ligados ao ID original da pose/animação. O player 3D é carregado sob demanda; reproduz em loop sem áudio, respeita `prefers-reduced-motion`, pausa quando sai da área visível ou quando a aba fica em segundo plano, e oferece controles manuais. As duas poses 2D ajudam a reconhecer o movimento, mas não são vídeo nem substituem instrução profissional. O manequim 3D é ilustrativo e não representa carga, amplitude individual, diferenças corporais ou revisão técnica.

O modelo azul `fitness-demo-squat.glb` e as cinco ilustrações 2D esquemáticas são originais do piloto Vendeweb e permanecem disponíveis. Só devem ser adicionados MP4/WebM após confirmação de licença, autoria e compatibilidade do movimento com o exercício indicado.
