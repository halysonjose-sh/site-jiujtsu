# Tatame · Minha turma

PWA mobile-first em português para uma turma de jiu-jítsu. React, TypeScript, Vite, Tailwind CSS e Supabase. Começamos pelos testes: a primeira execução das regras teve 11 falhas esperadas de funcionalidades ainda não implementadas; depois as regras foram implementadas e validadas.

## Executar

Requer Node.js 24 e npm. Use `npm ci` e `npm run dev`.

Sem variáveis de ambiente, a tela de acesso informa que a turma está em preparação. **Conhecer a demonstração** abre dados fictícios em memória, permite alternar entre aluno e professor e não salva registros. Recarregar a página reinicia a demonstração. A demonstração nunca se conecta ao banco real.

## Conectar o Supabase

1. Crie um projeto Supabase dedicado e aplique **todas** as migrations de `supabase/migrations/`, na ordem dos nomes (é o que o CLI faz). No SQL Editor do Supabase, cole os arquivos em ordem; o primeiro é `202609050001_tatame.sql`.
2. Copie `.env.example` para `.env.local`. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a URL e a chave **pública** publishable/anon. Nunca use `service_role` em variáveis `VITE_*`. Sem esse arquivo (ou com a chave de exemplo `your-public-anon-key`), o aplicativo fica no modo "equipe não conectada" e não há login.
3. Em Authentication, habilite e-mail/senha, confirmação por e-mail e senha mínima de 8 caracteres. Configure Site URL e a lista de redirecionamentos para a origem HTTPS publicada e, no desenvolvimento, `http://localhost:5173` e `http://127.0.0.1:5173`. Configure um provedor SMTP para uso real; o envio padrão do ambiente não substitui essa configuração.
4. Cadastre sua conta pelo aplicativo escolhendo **criar turma**: a conta vira dona de uma equipe nova e o código de entrada é gerado na hora (Configurações → Acesso). Para transformar uma conta já existente em dona da equipe "Minha turma", use `supabase/bootstrap.sql.example`. Entre novamente depois de confirmar o e-mail.
5. Compartilhe o código com seus alunos. Você pode trocá-lo em Configurações. A mudança vale para novos cadastros; alunos existentes continuam com acesso. Para um professor entrar direto na equipe, gere o **código de professor** em Configurações: quem se cadastra com ele já entra como professor ativo, sem passar pela aprovação de aluno.
6. Execute `npm run build` novamente e publique `dist` por HTTPS. As variáveis Vite são incorporadas durante a compilação; alterá-las depois exige uma nova compilação.

Nenhum projeto Supabase foi criado automaticamente: o usuário optou por deixar essa conexão preparada. A versão entregue permite revisar o aplicativo pela demonstração; uso com alunos reais depende das etapas acima.

### Supabase local (Docker ou Podman)

Para rodar com dados de verdade na máquina, sem projeto na nuvem:

1. `npx supabase start` — sobe o stack local (precisa de um runtime de contêiner).
2. `npx supabase db reset` — aplica as migrations. Só em instância local descartável: o reset apaga os dados.
3. Copie a URL (`http://127.0.0.1:54321`) e a chave **anon** que o CLI imprime para `.env.local`.
4. `npm run dev` e cadastre-se escolhendo "criar turma".
5. O e-mail de confirmação sai pelo Inbucket local: `http://127.0.0.1:54324`.

Sem Docker, o CLI também funciona com Podman — suba a API do Podman e aponte o CLI para ela:

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
podman system service --time=0 unix://$XDG_RUNTIME_DIR/podman/podman.sock &
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
npx supabase start
```

O `npm run test:supabase` usa essa mesma instância e recusa URL remota.

## Regras e proteção dos dados

- Uma turma e um professor; público só cadastra alunos, independentemente do papel enviado no formulário. O código é verificado pelo trigger do Auth, antes de concluir a transação, e removido dos metadados. O banco guarda somente hash com salt. O hash não é exposto ao navegador. O cadastro também aceita o código de professor, que entra direto como professor ativo; os dois códigos não podem colidir entre equipes.
- Equipe técnica: professores têm perfil (faixa, graus, contato, nascimento) editável pelo dono, que também define a situação inicial e concede graus e faixas a eles; qualquer professor edita o perfil dos alunos. O dono elege um professor como sucessor em Configurações e volta a ser professor — a equipe nunca fica sem dono. Ao excluir a própria conta, o dono escolhe o professor que assume; o que ele registrou como professor (presenças, graduações, aulas, avisos) passa para o sucessor e o histórico dele como aluno é apagado.
- Aluno cadastrado pelo professor: o professor cria o aluno direto na equipe (nome, foto, e-mail opcional e quantas aulas ele já fez), vários de uma vez, e ele passa a existir como qualquer outro aluno — presença, graduação e contagem. O aluno ainda não tem login: a identidade do aluno (`profiles.id`) é separada da conta de login (`profiles.auth_id`, vazio enquanto ele não entrar). O e-mail informado pelo professor é o que permite a entrada: no cadastro, o e-mail bate com o aluno sem conta e a conta é vinculada a ele, com todo o histórico preservado. Sem e-mail, ele continua na equipe normalmente. O professor pode informar ou trocar o e-mail no perfil do aluno e remover quem ele criou e nunca entrou no app; aluno que já entrou vira "inativo". Depois, o professor soma aulas ao histórico do aluno a qualquer momento ("Mais ações" no perfil do aluno): aulas que o aluno fez fora do aplicativo, sem criar aula no calendário — entram no total e na frequência dele, do mesmo jeito que as aulas anteriores do cadastro.
- Presença do aluno não recebe data nem ID do cliente: usa `auth.uid()` e a data do servidor em `America/Sao_Paulo`. A chave aluno/data impede duplicatas. Professor pode acrescentar ou remover datas passadas e de hoje.
- Faixas branca → azul → roxa → marrom → preta. Até quatro graus nas faixas anteriores à preta; não acompanha graus da preta. Meta inteira positiva opcional, apenas informativa.
- Graduação sempre usa o dia atual. A presença desse dia pertence ao ciclo encerrado, mesmo que seja corrigida depois. Próximo ciclo começa no dia seguinte; total histórico nunca reinicia.
- Situação inicial é registrada uma vez, antes de qualquer graduação, inclusive graduação posteriormente desfeita. Não adiciona aulas nem reinicia contagem. Se não definida, o aluno começa na branca sem graus.
- Só a última graduação válida pode ser desfeita. Cancelamento preserva histórico, autor e data; presenças permanecem intactas.
- Mutações são funções PostgreSQL transacionais. Graduações usam trava por aluno, revisão otimista e identificador de operação para reenvios. A mesma requisição não soma outro grau; telas desatualizadas recebem erro para atualizar.
- RLS limita leitura a dados próprios ou professor; não há escrita direta para os clientes. Funções internas não têm permissão pública. O papel vem de `profiles`, não de metadados editáveis do Auth.
- Dados pessoais ficam somente na memória da interface. O Supabase persiste a sessão de autenticação; o service worker só guarda arquivos estáticos da aplicação. Não há fila offline nem cache das APIs. Sem conexão, a interface esconde os dados e bloqueia ações.

Referências: [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [service worker do Vite PWA](https://vite-pwa-org.netlify.app/guide/inject-manifest).

## Testes

| Comando                 | Valida                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm test`              | Regras unitárias e componentes React                                                |
| `npm run test:coverage` | Cobertura de regras, com mínimo de 90% de branches                                  |
| `npm run test:db`       | Migration, funções e RLS em PostgreSQL via PGlite, sem Docker                       |
| `npm run test:e2e`      | Fluxos da demonstração, offline e acessibilidade básica em Chromium 360 px e WebKit |
| `npm run test:supabase` | Auth, PostgREST e concorrência por HTTP no Supabase local descartável               |
| `npm run build`         | TypeScript, produção, manifesto e service worker                                    |
| `npm run format:check`  | Formatação do código                                                                |

Os testes PGlite executam a migration real e simulam apenas o schema de autenticação e os papéis fornecidos pelo Supabase. Eles validam regras e RLS, mas não substituem Auth/PostgREST nem concorrência entre conexões PostgreSQL reais. Os testes HTTP adicionais existem para essa camada e **recusam URL remota**.

Para a integração completa: inicie o Docker Desktop em modo Linux, execute `npx supabase start`, `npx supabase db reset` **somente em uma instância local descartável**, e `npm run test:supabase`. O reset apaga dados locais. Os testes HTTP criam contas temporárias e restauram as configurações ao terminar. Não use uma instância local contendo dados que deseja preservar.

## PWA e publicação

`npm run build` gera `dist/manifest.webmanifest`, ícones e `dist/sw.js`. `npm run preview -- --port 4173` permite testar o build; em outra janela, `node scripts/pwa-check.mjs` verifica instalação no Chromium, cache estático e abertura offline com aviso. O modo de desenvolvimento não instala o service worker.

Android: menu do navegador → Instalar aplicativo. iPhone: Safari → Compartilhar → Adicionar à Tela de Início. A disponibilidade da opção depende do navegador; a interface também mostra as instruções. Testes WebKit em desktop não equivalem a validar a instalação em um iPhone físico.

A hospedagem Sites fica vinculada em `.openai/hosting.json`. A prévia publicada é privada para revisão do proprietário. Antes de liberar aos alunos, conecte Supabase/SMTP, configure os redirecionamentos, recompile e ajuste o acesso da hospedagem para o público pretendido. Valide instalação em Android/iPhone físicos e o percurso cadastro → confirmação → presença → professor → grau em um projeto Supabase de teste.

## Estrutura

- `src/domain`: regras puras e testes.
- `src/lib`: adaptador Supabase e demonstração em memória.
- `src/App.tsx`, `src/components`: telas e ações com confirmação, estado de envio e erros.
- `supabase/migrations`: esquema, permissões e operações do servidor.
- `supabase/tests` e `supabase/integration`: testes PostgreSQL e integração HTTP.
- `e2e`: percursos no navegador; `scripts`: validação de PWA, capturas e ícones.

Fora desta versão: pagamentos, agenda, notificações, importação de aulas anteriores, crianças, graus de faixa preta e sincronização offline.
