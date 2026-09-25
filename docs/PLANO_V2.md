# Tatame v2 — Plano de implementação

Data: 25/09/2026. Base analisada: commit `4014e5c` (v1).

## 0. Diagnóstico do que existe

| Item | Situação na v1 | Impacto na v2 |
|---|---|---|
| Banco | Uma migration (`202609050001_tatame.sql`), 4 tabelas, RPCs `security definer`, RLS | Precisa ganhar `team_id` em tudo |
| Turma | `class_settings` com **uma linha só** (`id boolean`), código com hash+salt | Vira `teams` (várias equipes) |
| Papel | `profiles.role` global + índice `one_teacher` (um professor no banco inteiro) | Papel passa a ser por equipe (`team_members`) |
| Cadastro | Trigger em `auth.users` valida `class_code` dos metadados | Troca para chave individual (convite) |
| Presença | PK `(student_id, training_date)`, sem aula nem foto | Ganha `session_id`, foto, status |
| Front | `App.tsx` com 1112 linhas, navegação por `useState('page')`, sem roteador | Dividir antes de crescer |
| Demo | `src/lib/demo.ts` em memória | Decidir: manter atualizada ou congelar |
| PWA | Manifesto fixo no `vite.config.ts` (nome/ícone "Tatame") | White label no ícone instalado exige manifesto dinâmico |
| Testes | 22 unit (100% branches), 4 componente, 14 PGlite, 6 Playwright; HTTP **nunca rodou** (Docker desligado) | PGlite não simula Storage nem Edge Functions |
| Supabase | **Nenhum projeto criado**; nenhum dado real | Ótimo: dá para reestruturar sem migrar dados |
| Hospedagem | `.openai/hosting.json` (Sites), publica `dist` estático | Estático não serve manifesto dinâmico por equipe |

**Conclusão:** como não existe dado real, a hora de trocar o modelo para "várias equipes" é agora, antes de qualquer outra funcionalidade.

---

## 1. Configurar o Supabase (passo a passo)

### 1.1 Local (antes de tudo)
1. Instalar/abrir Docker Desktop (modo Linux).
2. `npx supabase start` → anotar URL local, anon key, Studio (`http://127.0.0.1:54323`) e Inbucket/Mailpit (e-mails de teste).
3. `npx supabase db reset` (aplica as migrations).
4. `npm run test:supabase` — **primeira vez que os 3 testes HTTP vão rodar**. Corrigir o que falhar antes da v2.
5. Em `supabase/config.toml` adicionar buckets de storage (seção `[storage.buckets.*]`) e, na Fase 7, `[edge_runtime]`.

### 1.2 Projeto remoto
1. supabase.com → New project → região **South America (São Paulo)**. Guardar senha do banco.
2. Criar dois projetos: `tatame-staging` e `tatame-prod` (staging é onde você testa com celular real).
3. `npx supabase login` → `npx supabase link --project-ref <ref>` → `npx supabase db push`.
4. Plano: o gratuito pausa por inatividade e não tem backup diário. Para alunos reais, avaliar o pago (confira preço atual no site).

### 1.3 Auth
1. Authentication → Providers → Email: ligado, confirmação ligada, senha mínima 8.
2. URL Configuration: Site URL = domínio HTTPS final; Redirect URLs = domínio final + `http://localhost:5173` + `http://127.0.0.1:5173`.
3. SMTP próprio (Resend, Brevo, SES…) com domínio verificado (SPF/DKIM). Sem isso os e-mails ficam limitados/caem em spam.
4. Traduzir templates (confirmação, recuperação) para português.
5. Rate limits: revisar em Authentication → Rate Limits.

### 1.4 Chaves
- `.env.local`: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (pública).
- Chave secreta/service_role **somente** em `supabase secrets set` (Edge Functions). Nunca em `VITE_*`.

### 1.5 Storage (Fase 1+)
| Bucket | Público? | Caminho | Quem escreve | Quem lê |
|---|---|---|---|---|
| `team-branding` | sim | `{team_id}/logo.png` | professor/dono da equipe | todos |
| `attendance-photos` | não | `{team_id}/{student_id}/{attendance_id}.jpg` | o próprio aluno (só insert) | aluno dono + professores da equipe |
| `session-photos` | não | `{team_id}/{session_id}/{uuid}.jpg` | professores | membros da equipe |
Limites no bucket: `image/jpeg,image/webp`, até ~2 MB (o app comprime antes). Leitura privada por URL assinada curta.

### 1.6 Extensões e agendamentos
Database → Extensions: `pg_cron`, `pg_net`. Jobs: gerar aulas das próximas semanas, lembrete de check-in, apagar fotos de presença vencidas.

### 1.7 Bootstrap
Substituir `bootstrap.sql.example`: cria a equipe (nome, slug) e define o dono/professor por e-mail. Professor nunca nasce pelo cadastro público.

### 1.8 Checklist de publicação
`db push` no staging → testes → build com env de staging → celular real → repetir em prod.

---

## 2. Fase 1 — Várias equipes (multi-tenant) + white label

### Banco (migration `..._teams.sql`)
- `teams(id, slug unique, name, logo_path, primary_color, accent_color, goal, timezone default 'America/Sao_Paulo', created_at)` — substitui `class_settings`.
- `team_members(team_id, user_id, role in ('aluno','professor','dono'), revision, joined_at, pk(team_id,user_id))` — `role`/`revision` saem de `profiles` (que fica só com nome).
- `team_id` em `attendances`, `graduations`. Presença passa a ser única por `(session_id, student_id)` — ver D1 (por aula).
- Remover índice `one_teacher`; vários professores por equipe (D2).
- Helpers: `is_member(team)`, `is_teacher(team)`, `require_teacher(team)`. Todas as RPCs recebem `p_team`.
- RLS: toda leitura exige `is_member(team_id)`; dados de aluno só dele ou professor da mesma equipe.
- RPC `update_branding(p_team, name, colors)`; upload da logo pelo Storage com policy de professor.

### Front
- Antes: **dividir `App.tsx`** em `features/auth`, `features/student`, `features/teacher`, `features/settings`, e adicionar roteador (ex.: `react-router`) — sem isso as novas telas ficam inviáveis.
- `TeamProvider`: carrega a equipe ativa; se o usuário for de mais de uma, seletor.
- Tema: cores viram variáveis CSS (`--brand`, `--accent`) aplicadas no `:root`; Tailwind v4 lê via `@theme`. Logo no cabeçalho.
- Tela "Personalizar equipe" (nome, logo, cores com prévia e checagem de contraste).

### White label no app instalado (limite real)
Nome e ícone da tela inicial vêm do manifesto, que hoje é estático. Opções:
1. **Só tema interno** (logo/cores dentro do app; ícone "Tatame") — simples, recomendado para v2.
2. Manifesto por equipe via Edge Function (`/manifest?team=slug`) + `index.html` por rota `/t/slug` — exige hospedagem que reescreva rotas; não sei se o "Sites" atual suporta.
3. Subdomínio por equipe (`equipe.tatame.app`) — o mais correto, mais infraestrutura (DNS curinga).

### Testes
Unit (tema/contraste), PGlite: usuário da equipe A não lê nada da B em nenhuma tabela/RPC; professor de A não gradua aluno de B. Atualizar os 14 testes existentes para passarem `team`.

---

## 3. Fase 2 — Código de acesso por equipe

> Decidido (D3): código geral por equipe. O desenho de convites individuais abaixo fica guardado para uma versão futura; na v2 só mover o código para `teams` e adicionar compartilhamento.

- `invites(id, team_id, code_hash, salt, label/nome_previsto, created_by, expires_at, max_uses default 1, uses, revoked_at)`.
- RPC `create_invite(p_team, p_label, p_days)` → retorna a chave **uma única vez** (formato curto legível, ex. `ABCD-2345-XY`, sem 0/O/1/I).
- Cadastro: trigger atual passa a validar `invite_code` no lugar de `class_code`; transação trava o convite (`for update`), incrementa uso, cria `team_members` como aluno.
- Usuário já cadastrado entra em outra equipe com `redeem_invite(code)` (sem novo cadastro).
- Tela do professor: lista de convites (pendente/usado/expirado/revogado), revogar, compartilhar (link `/entrar?chave=`, QR, botão WhatsApp).
- D3: manter ou remover o código geral da turma.
- Testes: válida, inválida, expirada, revogada, esgotada, de outra equipe, duas pessoas simultâneas (HTTP), aluno tentando criar convite.

---

## 4. Fase 3 — Aulas padrão (recorrentes) e agenda

- `class_schedules(id, team_id, title, weekdays int[] (0-6), start_time, duration_min, valid_from, valid_until null, created_by)`.
- `class_sessions(id, team_id, schedule_id null, starts_at timestamptz, duration_min, title, status in ('prevista','cancelada','realizada'), description, cancel_reason, unique(schedule_id, starts_at))`.
- Geração: função `generate_sessions(p_team, p_until)` idempotente (upsert pela unique) + pg_cron diário gerando 4 semanas à frente.
- **Editar padrão**: fecha o antigo (`valid_until = ontem/data escolhida`) e cria novo; ocorrências futuras sem check-in são regeneradas; com check-in, o professor escolhe manter ou mover (e os alunos são avisados).
- Exceções: cancelar/remarcar uma ocorrência; criar aula avulsa.
- Horário local em São Paulo (sem horário de verão hoje, mas guardar `timestamptz` + fuso da equipe evita problema se voltar).
- Telas: professor — "Horários" (CRUD de padrões) e "Agenda" (semana/mês); aluno — "Próximas aulas".
- Testes: geração sem duplicar, edição não altera passado, cancelamento, aula avulsa, aluno não edita.

---

## 5. Fase 4 — Check-in (confirmar que vai)

- `session_rsvps(session_id, student_id, status in ('vou','nao_vou'), updated_at, pk(session_id, student_id))`.
- RPC `rsvp(p_session, p_status)`: só membro aluno, só aula `prevista`, até o prazo (D4, ex.: horário de início).
- Professor vê na aula: confirmados, desistências, quem não respondeu; contador na agenda.
- Check-in **não conta aula** — é intenção. Presença é a Fase 5.
- Testes: duplicado (idempotente), fora do prazo, aula cancelada, outra equipe, concorrência.

---

## 6. Fase 5 — Presença com foto confirmada pelo professor

- `attendances` ganha: `id uuid`, `session_id null`, `photo_path`, `status in ('pendente','confirmada','rejeitada')`, `reviewed_by`, `reviewed_at`, `reject_reason`.
- Fluxo do aluno: abrir aula de hoje → câmera (`<input type=file accept=image/* capture=user>`) → comprimir no navegador (canvas → webp/jpeg ~1280px) → upload → RPC `submit_attendance(p_session, p_photo_path)`. Servidor valida: aula de hoje (SP), janela de horário (D5), path pertence ao aluno.
- Professor: fila "Presenças para confirmar" com foto grande, aprovar/rejeitar individual ou em lote; correções manuais atuais continuam (sem foto, status confirmada).
- **Regra muda:** contagens, ciclo e meta passam a considerar **só confirmadas**. Atualizar `rules.ts`, testes unitários, `student_detail` e demo.
- Reenvio após rejeição: permitido enquanto a janela estiver aberta.
- Limite honesto: foto não prova presença (pode ser reaproveitada). É apoio para o professor conferir; não recomendo reconhecimento facial.
- LGPD: consentimento explícito no cadastro, texto de privacidade, retenção (ex.: apagar arquivo 30 dias após revisão via pg_cron, mantendo o registro). Validar com jurídico — não sou advogado.
- Testes: aluno não confirma a própria, não sobe foto em pasta de outro, pendente não conta, rejeitada não conta, professor de outra equipe não vê a foto.

---

## 7. Fase 6 — Diário de treinos (calendário)

- Usa `class_sessions.description` + `session_photos(id, session_id, team_id, path, caption, created_by)`.
- Professor pode criar sessão passada com status `realizada` (registrar treinos que já aconteceram), texto e várias fotos.
- Tela calendário mensal (componente próprio simples ou lib leve); dia → aulas → detalhe com fotos/descrição.
- D6: alunos veem o diário?
- Testes: aluno não edita, fotos só para membros, limite de fotos por aula.

---

## 8. Fase 7 — Notificações

- Web Push: gerar chaves VAPID; `push_subscriptions(user_id, team_id, endpoint, keys, created_at)`; opt-in explícito no app; handler `push`/`notificationclick` em `src/sw.ts`.
- Edge Function `notify` (Deno, `web-push`), chamada por Database Webhook/pg_net.
- Eventos para o professor: resumo de check-ins X min antes da aula (evita spam), fila de presenças pendentes. Para alunos (opcional): aula cancelada/remarcada.
- Limite iPhone: só com o PWA instalado na tela inicial (iOS 16.4+) e permissão concedida. Plano B: e-mail de resumo pelo SMTP.
- Testes: inscrição, remoção de endpoint expirado (410), usuário de outra equipe não recebe.

---

## 9. Ordem e critérios

| # | Entrega | Pronto quando |
|---|---|---|
| 0 | Supabase local rodando + `test:supabase` verde; `App.tsx` dividido + roteador | Todos os testes v1 verdes |
| 1 | Multi-equipe + tema | Isolamento entre equipes testado |
| 1b | Manifesto/ícone por equipe (se hospedagem permitir) | App instalado mostra nome e logo da equipe |
| 2 | Código por equipe + compartilhar | Cadastro só com código válido da equipe |
| 3 | Horários + agenda | Geração idempotente |
| 4 | Check-in | Professor vê lista por aula |
| 5 | Presença com foto | Só confirmada conta; LGPD resolvida |
| 6 | Diário | Fotos privadas por equipe |
| 7 | Push | Testado em Android e iPhone físicos |
| 8 | Staging → prod | Percurso E2E completo com e-mail real |

Cada fase: teste falhando → migration/RPC → PGlite → HTTP local → UI + RTL → Playwright → demo atualizada → README/VALIDATION atualizados.
Atualizar a lista "Fora desta versão" do README (agenda e notificações deixam de estar fora).

## 10. Decisões tomadas (25/09/2026)

**D1 — Presença por aula.**
- Tabela `attendances`: chave única `(session_id, student_id)`; `training_date` passa a ser derivada de `class_sessions.starts_at` (data em SP).
- Duas aulas no mesmo dia = 2 aulas contadas.
- Correção do professor: adicionar presença exige escolher uma aula; se não houver aula naquela data, o professor cria uma avulsa (`realizada`) na hora.
- Regra do ciclo mantida: presenças de aulas no **dia** da graduação pertencem ao ciclo encerrado.
- Testes de `rules.ts` que assumem "uma por dia" precisam ser reescritos (repetição na mesma aula não soma; outra aula no mesmo dia soma).

**D2 — Vários professores por equipe.**
- Remover índice `one_teacher`. Papéis: `dono` (1+ por equipe; gerencia professores, visual e código) e `professor` (alunos, aulas, presenças, graduações), `aluno`.
- Histórico de graduação e presença já registra `actor_id` — mostra qual professor fez.
- Concorrência entre dois professores no mesmo aluno: a trava por aluno + `revision` que já existe resolve.

**D3 — Código geral por turma (sem chave individual na v2).**
- Cada equipe tem seu próprio código (hash+salt, como hoje), trocável pelo dono/professor.
- A Fase 2 vira: mover o código de `class_settings` para `teams` + botão compartilhar (link `/entrar?codigo=`, QR, WhatsApp).
- Atenção: o requisito original pedia "chave para cada aluno". Com código geral, qualquer pessoa com o código entra. Mitigação sugerida: novo cadastro entra como `pendente` e o professor aprova (`team_members.status`). Confirmar se quer essa aprovação.

**D4 — Alunos veem diário e fotos da aula.**
- Leitura de `session-photos` e descrições liberada para qualquer membro ativo da equipe; escrita só professor.
- Avisar no cadastro que fotos de treino ficam visíveis para a equipe (consentimento de imagem).

**D5 — Ícone/nome por equipe: sim, se viável.**
- É viável, mas depende da hospedagem. Caminho recomendado: subdomínio por equipe (`slug.dominio.com.br`) + manifesto servido dinamicamente (Edge/Function da hospedagem ou Supabase Edge Function) com nome, cores e ícones da equipe (ícones gerados a partir da logo: 192, 512, maskable).
- Exige: domínio próprio, DNS curinga, hospedagem com funções/rewrites (ex.: Cloudflare Pages, Vercel, Netlify). Não sei se a hospedagem "Sites" atual suporta — verificar antes.
- Entra como **Fase 1b**, depois do tema interno funcionando. Se a hospedagem não permitir, fica só o tema interno.
- Limite: no iPhone o ícone é capturado na instalação; se a equipe trocar a logo depois, o aluno precisa reinstalar.

**D6 — Retenção das fotos de presença: em aberto.**
Sobre "banco relacional": sim, o Supabase **é** PostgreSQL, relacional. Mas a foto em si não fica numa tabela — fica no **Storage** (arquivos), e o banco guarda só o caminho, status, quem aprovou e quando. Isso permite apagar o arquivo e manter o registro da presença (a contagem não muda).
Proposta para decidir:
- `teams.attendance_photo_retention_days` (padrão sugerido 90; o dono pode ajustar).
- Job pg_cron diário apaga do Storage fotos de presenças já revisadas há mais de N dias e marca `photo_deleted_at`.
- Presença pendente nunca é apagada automaticamente.
- Fotos do diário (treinos) **não** entram nessa regra; ficam até o professor apagar.

**D7 — Aprovação de novos alunos: sim.** Cadastro com código entra como `pendente`; professor ou dono aprova.

**D8 — Check-in e presença (fluxo final).**
- Aluno faz check-in até **1 hora antes** do treino; pode desistir até esse prazo.
- O check-in já cria a presença **pendente**; depois do início da aula o professor só aprova ou rejeita.
- Aluno que foi sem check-in: professor lança a presença, já confirmada.
- Foto é **opcional**: o aluno com check-in pode anexar no dia da aula, enquanto pendente; serve de apoio para o professor.
- Só presença confirmada conta.
- Implementado nas regras: `src/domain/teams.ts`, `schedule.ts`, `attendance.ts` (testes unitários verdes, 25/09/2026).

## 11. Ainda pendentes
- Retenção final (D6).
- Hospedagem para o ícone por equipe (D5).
- Demo em memória: manter atualizada a cada fase?
