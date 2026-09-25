# Plano de UI/UX para celular — Tatame

Data: 25/09/2026. Base: telas atuais em 360 px (Android pequeno) e 390 px (iPhone).
Princípio: **o professor resolve o dia com o polegar, em até 2 toques, sem ler instruções.**

## 1. Problemas encontrados (auditoria em 360 px)

| # | Onde | Problema | Impacto |
|---|---|---|---|
| P1 | Detalhe do aluno | Linha "Data / Horário / Adicionar" passa da largura da tela (botão cortado, rolagem lateral) | Bug visível |
| P2 | Todas | Cabeçalho ocupa ~40% da primeira tela (rótulo + título grande + frase) | Conteúdo útil fica abaixo da dobra |
| P3 | Todas | Textos de 10–12 px (rótulos, "check-ins", "a revisar", legenda do calendário, datas do histórico) | Difícil de ler no treino |
| P4 | Listas | Ações como texto pequeno ("Editar", "Encerrar", "Remover", "Recusar") e ícones soltos (lixeira, sair) | Toque errado; não fica claro o que fazem |
| P5 | Barra inferior | "Configurações" cortado; ícones finos; só 3 destinos para o professor, nenhum para "Hoje" | Navegação confusa |
| P6 | Fluxo do professor | Ver quem vem hoje e confirmar presenças exige Calendário → dia → aula (3+ toques e rolagem) | Tarefa diária mais importante está escondida |
| P7 | Detalhe do aluno | "Conceder grau / Promover" ficam no fim de um histórico longo | Ação principal exige muita rolagem |
| P8 | Calendário | Células pequenas, pontos de 7 px, legenda 11 px | Difícil de tocar e entender |
| P9 | Formulários | Muitos campos visíveis ao mesmo tempo; data em formato do navegador (MM/DD em alguns celulares) | Esforço e erro de digitação |
| P10 | Feedback | Mensagens de sucesso aparecem dentro do cartão, às vezes fora da tela | Professor não sabe se salvou |
| P11 | Aprovação de alunos | Cartão fica no meio da lista, sem destaque de urgência | Aluno novo espera sem motivo |

## 2. Padrões que valerão para o app inteiro (sistema de design mobile)

- **Alvo de toque mínimo 48 × 48 px**; espaço mínimo de 8 px entre alvos.
- **Texto base 16 px**, secundário ≥ 14 px; nada abaixo de 13 px. Números de destaque 28–32 px.
- **Botões sempre com ícone + palavra** (nunca só ícone, exceto fechar/voltar com rótulo acessível).
- **Uma ação principal por tela**, em botão largo fixo no rodapé da tela (acima da barra de navegação) quando for a tarefa da tela: "Salvar presenças", "Criar aula", "Vou treinar".
- **Ações destrutivas** (remover, recusar, cancelar aula) em menu "⋯" ou folha inferior com confirmação — fora do caminho do polegar.
- **Folhas inferiores (bottom sheets)** no lugar de telas longas para ações rápidas: confirmar presença, conceder grau, criar aula.
- **Cabeçalho compacto**: título de 22 px em uma linha; sem rótulo e frase decorativa nas telas internas.
- **Aviso de resultado (toast)** fixo na parte de baixo por 3 s: "Presença confirmada ✓", com "Desfazer" quando possível.
- **Estados vazios com ação**: "Nenhuma aula hoje · [Criar aula]".
- **Datas por extenso em português** ("sex, 25 set") e seletores próprios para dia/hora com botões rápidos (Hoje, Ontem, 7h, 19h).
- Acessibilidade: contraste AA, foco visível, rótulos em todos os botões, respeito a "reduzir movimento".

## 3. Nova estrutura de navegação

**Professor (4 abas, ícones 26 px, rótulos 13 px, sem cortes):**

| Aba | Conteúdo |
|---|---|
| **Hoje** (nova, abre por padrão) | Aulas de hoje em cartões grandes: horário, quem confirmou (avatares), botão **Fazer chamada**. Bloco "Pendências": alunos aguardando aprovação e presenças a revisar, com contador. |
| **Alunos** | Busca fixa no topo, lista com faixa colorida e aulas no ciclo; toque abre o aluno. |
| **Calendário** | Mês + lista do dia; **botão flutuante "+ Aula"**. |
| **Mais** | Código de acesso, meta, visual da equipe, notificações, horários padrão, sair. |

Contador vermelho na aba **Hoje** quando houver pendências.

**Aluno (3 abas):** **Treinar** (próxima aula com botão grande "Vou treinar" + último treino com foto), **Treinos** (calendário/diário), **Eu** (faixa, graus, contagens, histórico, sair).

## 4. Fluxos redesenhados (menos toques)

| Tarefa | Hoje | Depois |
|---|---|---|
| Fazer a chamada do treino | Calendário → dia → aula → rolar → marcar → salvar (5+) | Hoje → **Fazer chamada** → tocar nos nomes → **Salvar** (3). Lista com quem fez check-in já marcado; nomes grandes em linhas de 56 px, toque na linha inteira. |
| Adicionar fotos do treino | Calendário → dia → aula → rolar até o fim | Na chamada: botão **📷 Fotos** no topo; ou câmera direto pelo cartão da aula de hoje |
| Aprovar aluno novo | Aba Alunos, cartão no meio | Hoje → Pendências → **Aprovar** (1 toque) |
| Conceder grau | Aluno → rolar até o fim → confirmar | Aluno → botão fixo **Graduar** → folha com "+1 grau" / "Nova faixa" (2 toques) |
| Criar aula | Calendário → Nova aula → formulário longo | Botão **+ Aula** → folha com Hoje/Amanhã, horários frequentes em chips, nome sugerido; "Mais opções" para descrição/duração |
| Aluno fazer check-in | Início → rolar até próximas aulas | Aba Treinar: primeiro cartão = próxima aula com botão grande |

## 5. Ordem de implementação (cada fase: testes primeiro, depois código)

| Fase | Entrega | Testes (antes do código) |
|---|---|---|
| **1. Base visual** | Tokens de tamanho (toque, fontes), cabeçalho compacto, correção do estouro de largura (P1), barra inferior sem cortes, textos ≥ 13 px | Playwright em 360/390 px: sem rolagem lateral em **todas** as telas; alvos ≥ 44 px (script mede todos os botões); nenhum texto < 13 px |
| **2. Componentes** | Botão largo fixo, folha inferior, toast com desfazer, menu "⋯", estado vazio com ação, seletor rápido de data/hora | RTL: folha abre/fecha, foco preso e devolvido, Esc fecha; toast some e anuncia (aria-live); desfazer chama ação inversa |
| **3. Aba Hoje + Chamada** | Tela Hoje (professor) e fluxo "Fazer chamada" com fotos | Regras: quais aulas entram em "hoje" (virada do dia em SP), ordenação, pendências; e2e: chamada em 3 toques |
| **4. Aluno** | Abas Treinar/Treinos/Eu; check-in no primeiro cartão; último treino com foto | e2e: check-in em 1 toque a partir da abertura do app |
| **5. Ações do aluno (professor)** | Botão fixo Graduar com folha; histórico recolhido; ações destrutivas no "⋯" | e2e: conceder grau em 2 toques; desfazer pelo toast |
| **6. Criar aula rápido** | Folha "+ Aula" com chips Hoje/Amanhã e horários frequentes | Regras: horários frequentes vêm dos horários padrão; validações existentes continuam |
| **7. Mais + ajustes** | Aba Mais reorganizada; revisão de textos (microcopy) | Auditoria de acessibilidade automática (axe) nas telas principais |
| **8. Validação real** | Teste com 1 professor e 3 alunos em celulares físicos (Android e iPhone) | Tarefas cronometradas: chamada < 30 s; check-in < 5 s; aprovar aluno < 10 s |

## 6. Critérios de aceite

- Nenhuma tela com rolagem lateral em 360 px.
- 100% dos botões com área ≥ 44 px (meta 48 px).
- Nenhum texto funcional abaixo de 13 px.
- Chamada completa em até 3 toques a partir da abertura do app.
- Check-in do aluno em 1 toque a partir da abertura do app.
- Toda ação mostra resultado visível na tela atual.
- Todas as regras de negócio e testes existentes continuam passando.
