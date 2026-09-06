# Validação da entrega — 05/09/2026

- 22 testes unitários de regras passaram. Cobertura das regras: 100% de branches, funções, linhas e statements; mínimo configurado: 90%.
- 4 testes de componente passaram: envio único, confirmação, cancelamento, erro com nova tentativa e botão desabilitado.
- 14 testes PostgreSQL/PGlite passaram: migration real, isolamento por aluno, professor, visitante, código de entrada, metadados, escrita proibida, correções, graduação, revisão, reenvio e limites.
- 6 testes Playwright passaram: três percursos em Chromium com 360 px e em WebKit. Demonstração com presença, professor, grau e desfazer; offline/reconexão; rótulos, teclado e cadastro sem papel de professor.
- Build de produção e verificação de formatação passaram. Manifesto standalone e service worker gerados.
- PWA compilado testado no Chromium: nenhum erro de instalabilidade; 8 arquivos únicos em cache, nenhum endpoint de API; recarregamento offline mostra o aviso. A checagem de conexão usa `online.txt`, deliberadamente fora do cache.
- Capturas locais de aluno, professor e acesso conferidas; sem erro JavaScript nem rolagem horizontal a 360 px. Capturas em `.artifacts/` não entram na publicação.

## Limites da validação

- O usuário ainda não possui Supabase e pediu para deixar a conexão preparada. Cadastro, confirmação e recuperação por e-mail precisam ser validados após conectar um projeto e configurar SMTP.
- O Supabase local não iniciou porque o Docker Desktop/daemon Linux está desligado. `npm run test:supabase` detectou a ausência e terminou com erro explícito; seus três testes HTTP não foram executados.
- PGlite usa PostgreSQL real, mas em uma conexão. A verificação de duplicação local não comprova concorrência entre sessões do servidor. A suíte HTTP preparada verifica chamadas paralelas contra Supabase local quando o Docker estiver disponível.
- Emulação WebKit não equivale a instalação em iPhone físico. A instalação em Android e iPhone físicos e o ciclo real completo com e-mails permanecem para a ativação da turma.
- A publicação inicial serve para revisão privada; acesso dos alunos e persistência real exigem concluir a configuração descrita no README.
