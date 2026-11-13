# Validação da entrega — 05/09/2026

- 22 testes unitários de regras passaram. Cobertura das regras: 100% de branches, funções, linhas e statements; mínimo configurado: 90%.
- 4 testes de componente passaram: envio único, confirmação, cancelamento, erro com nova tentativa e botão desabilitado.
- 14 testes PostgreSQL/PGlite passaram: migration real, isolamento por aluno, professor, visitante, código de entrada, metadados, escrita proibida, correções, graduação, revisão, reenvio e limites.
- 6 testes Playwright passaram: três percursos em Chromium com 360 px e em WebKit. Demonstração com presença, professor, grau e desfazer; offline/reconexão; rótulos, teclado e cadastro sem papel de professor.
- Build de produção e verificação de formatação passaram. Manifesto standalone e service worker gerados.
- PWA compilado testado no Chromium: nenhum erro de instalabilidade; 8 arquivos únicos em cache, nenhum endpoint de API; recarregamento offline mostra o aviso. A checagem de conexão usa `online.txt`, deliberadamente fora do cache.
- Capturas locais de aluno, professor e acesso conferidas; sem erro JavaScript nem rolagem horizontal a 360 px. Capturas em `.artifacts/` não entram na publicação.

## Equipe técnica, código de professor e troca de dono — 03/10/2026

- Migration `202610040001_professor_dono_conta.sql` criada: perfil e graduação da equipe técnica (dono gradua professor), `update_member_profile` (dono edita professores; professor edita alunos), `list_staff` com o resumo completo, código de professor (cadastro direto como professor ativo), `transfer_ownership` (antigo dono volta a ser professor) e `delete_my_account` (dono escolhe sucessor; registros de professor passam adiante, histórico de aluno é apagado).
- Suíte PGlite: 50 testes passaram, incluindo os novos (perfil/graduação de professor, código de professor com cadastro direto, eleger dono com troca e volta de papéis, exclusão de conta de dono com sucessor e de aluno sem sucessor).
- `npm test`: 182 testes passaram (16 arquivos). `npm run build` (tsc + vite) passou.
- Demonstração atualizada: perfil do dono com faixa preta, edição de perfil de professor e de aluno, eleger dono, código de professor visível em Configurações. Exclusão de conta é indisponível na demonstração.
- Não executado: `npm run test:e2e` e `npm run test:supabase` para os novos fluxos; validação em projeto Supabase real permanece pendente (o projeto não está conectado).

## Aluno sem conta no aplicativo — 11/11/2026

- Migration `202611110001_aluno_sem_conta.sql` criada: a identidade do aluno (`profiles.id`) passa a ser separada da conta de login (`profiles.auth_id`, vazio enquanto o aluno não entra). O aluno criado pelo professor nasce ativo na equipe, com as aulas anteriores já contando no total e na frequência — presença, graduação e lista funcionam como para qualquer outro aluno.
- Funções novas: `create_students` (lote atômico com nome, e-mail, aulas anteriores e foto), `set_student_email` (o professor informa ou troca o e-mail do aluno sem conta) e `remove_student` (apaga o aluno sem conta e o histórico dele; aluno com conta só fica inativo). A tabela `invited_students` e as funções de convite saem de cena.
- No cadastro, o e-mail informado bate com o aluno sem conta e a conta é vinculada a ele: entra ativo, com aulas anteriores, foto e presenças preservadas.
- Interface: folha "Adicionar alunos" (`src/components/NovoAluno.tsx`) cadastra vários alunos de uma vez (foto opcional); selo "sem conta" na lista de alunos; campo de e-mail no perfil do aluno; "Remover aluno" no menu do aluno.
- Suíte PGlite: 60 testes passaram, incluindo os novos (lote de três alunos, recusa do lote inteiro, e-mail repetido, foto fora da pasta do aluno, aluno sem conta com presença e graduação, entrada com o e-mail informado e remoção).
- `npm test`: 201 testes passaram (17 arquivos). Cobertura: 95,2% de branches (mínimo 90%). `npm run build` (tsc + vite) passou.
- Playwright em Chromium 360 px: 21 testes passaram, incluindo os dois novos (cadastro de vários alunos de uma vez e presença lançada para o aluno sem conta).
- Também corrigidos testes que já falhavam antes desta entrega: o localizador do calendário (`aula(s)` nunca casava com o rótulo real "1 aula"), o texto desatualizado da equipe técnica na Gestão e o acesso às ações do professor da equipe.
- Corrigidas as violações de acessibilidade da tela de acesso que o próprio projeto apontava: botão de mostrar senha com 40 px, texto de 12,5 px e contraste do aviso de preparação.
- Não executado: `npm run test:e2e` no WebKit (faltam `libicu74` e `libjpeg-turbo8` no sistema, que exigem sudo). A validação em projeto Supabase real permanece pendente: o Storage, as políticas de foto do aluno e o vínculo do cadastro com o aluno sem conta só podem ser confirmados com o projeto conectado.

## Supabase local e validação no banco real — 11/11/2026

- Causa do "não consigo logar" local: não existia `.env.local`, então `supabase` era `null` e a tela de acesso respondia "A equipe ainda não foi conectada" (`src/lib/api.ts`, `src/App.tsx`). O projeto foi entregue com a conexão preparada, não feita.
- Subido o Supabase local **com Podman** (o Docker não está instalado nesta máquina): `podman system service` + `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` e `npx supabase start`. As 15 migrations foram aplicadas no PostgreSQL real, incluindo `202611110001_aluno_sem_conta.sql`. O CLI também exigia o diretório `supabase/snippets`, que não existia (agora tem `.gitkeep`).
- `.env.local` criado com a URL local e a chave **anon** (o arquivo é ignorado pelo git). Com ele, o login passa a funcionar de verdade.
- `npm run test:supabase`: 3 testes HTTP passaram (Auth, PostgREST e concorrência) — a primeira execução dessa suíte.
- Fluxo validado no navegador contra o banco real: cadastro com "criar turma" (a conta vira dona da equipe e o código de entrada é gerado na hora), login, lista de alunos e a feature nova — aluno sem conta criado com foto, e-mail e 7 aulas anteriores, foto confirmada no Storage e exibida no perfil, total com as aulas anteriores. A foto do aluno no Storage e as políticas do bucket só puderam ser checadas aqui.
- `supabase/bootstrap.sql.example` estava desatualizado (referenciava a tabela `class_settings`, removida na v2, e o papel em `profiles.role`, obsoleto). Reescrito para o modelo atual: o caminho normal é "criar turma" no cadastro; o arquivo serve para ajustar uma conta existente e gerar um código de entrada.

## Histórico de aulas fora do calendário — 13/11/2026

- Migration `202611130001_historico_aulas.sql` criada: `add_student_history(uuid, integer)` soma aulas ao histórico do aluno (`team_members.initial_total`) — aulas que ele fez fora do aplicativo, sem criar aula no calendário. Entram no total e na frequência, do mesmo jeito que as aulas anteriores do cadastro; não viram presença nem mudam o ciclo da graduação. Mesmo teto do cadastro (1 a 10.000 por vez, histórico não passa de 10.000) e vale para qualquer aluno, inclusive inativo.
- Interface: item "Adicionar aulas ao histórico" no menu "Mais ações" do perfil do aluno (`TeacherActions`), com a folha `src/components/HistoricoAulas.tsx`. A validação vem das regras puras de `src/domain/alunos.ts` (`validaAulasHistorico`, `rotuloAulasFeitas`).
- Demonstração espelha o RPC (`add_student_history` em `src/lib/demo.ts`).
- Suítes no commit: `npm test` 204, `npm run test:db` 64 (bloco novo: soma sem criar aula, validação de quantidade/autor/aluno, teto de 10.000, aluno inativo), `npm run build` sem erro, Playwright Chromium 22 (teste novo: somar 4 aulas na demonstração, erro com zero e calendário idêntico antes e depois).
- Migração aplicada no Supabase local e RPC validado por HTTP com o JWT do professor: somar 3 → 204, total 7 → 10, `held` 10, nenhuma presença criada; 0 e 99999 recusados com "Informe quantas aulas ele fez."; estado do aluno restaurado depois do teste. Conexão direta ao Postgres sem JWT é recusada por `require_teacher()`, como esperado.

## Limites da validação

- O usuário ainda não possui Supabase na nuvem e pediu para deixar a conexão preparada. Cadastro, confirmação e recuperação por e-mail em um projeto real ainda precisam ser validados depois de conectar o projeto e configurar SMTP — o Inbucket local cobre o caminho, não a entrega real dos e-mails.
- O Supabase local roda com Podman nesta máquina (sem Docker); o comportamento do Auth e do Storage é o do software do Supabase, mas o servidor de e-mail é o Inbucket local. A suíte HTTP (`npm run test:supabase`) passou com essa instância.
- PGlite usa PostgreSQL real, mas em uma conexão. A verificação de duplicação local não comprova concorrência entre sessões do servidor. A suíte HTTP preparada verifica chamadas paralelas contra Supabase local quando o Docker estiver disponível.
- Emulação WebKit não equivale a instalação em iPhone físico. A instalação em Android e iPhone físicos e o ciclo real completo com e-mails permanecem para a ativação da turma.
- A publicação inicial serve para revisão privada; acesso dos alunos e persistência real exigem concluir a configuração descrita no README.
