import { test, expect } from '@playwright/test'

// O professor cadastra alunos direto no aplicativo (nome, foto, e-mail e quantas
// aulas ele já fez). O aluno entra na equipe na hora — o professor lança
// presença, gradua — mas continua sem conta: o e-mail informado é o que deixa
// ele entrar no app depois, se quiser.
test('professor cadastra vários alunos de uma vez e informa o e-mail depois', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await page.getByRole('button', { name: 'Alunos' }).first().click()

  // Aluno de exemplo da demonstração: já na equipe, ainda sem conta no app.
  const carlos = page.locator('.student-row', { hasText: 'Carlos Lima' })
  await expect(carlos).toContainText('sem conta')
  await expect(carlos).toContainText('12')

  // Cadastra dois alunos de uma vez.
  await page.getByRole('button', { name: 'Adicionar aluno' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await folha.getByLabel('Nome completo').fill('Pedro Novato')
  await folha.getByLabel('E-mail (opcional)').fill('pedro@example.com')
  await folha.getByLabel('Quantas aulas ele já fez').fill('5')
  await folha.getByRole('button', { name: 'Adicionar outro aluno' }).click()
  await folha.getByLabel('Nome completo').fill('Ana Paula')
  await folha.getByLabel('Quantas aulas ele já fez').fill('0')
  await folha.getByRole('button', { name: 'Criar 2 alunos' }).click()

  const pedro = page.locator('.student-row', { hasText: 'Pedro Novato' })
  await expect(pedro).toContainText('sem conta')
  // As aulas anteriores já entram no total.
  await expect(pedro).toContainText('5')
  await expect(page.locator('.student-row', { hasText: 'Ana Paula' })).toContainText('sem conta')

  // O perfil do aluno mostra que ele ainda não tem conta.
  await pedro.click()
  await expect(page.getByText('Sem conta no aplicativo')).toBeVisible()
  const total = page.locator('.stat-card', { hasText: 'Total de aulas' })
  await expect(total.locator('strong')).toHaveText('5')

  // O professor informa o e-mail no perfil: é o que deixa o aluno entrar depois.
  await page.getByRole('button', { name: 'Editar perfil' }).click()
  const editar = page.locator('.sheet-backdrop dialog')
  await editar.getByLabel('E-mail (para ele entrar no app)').fill('pedro@example.com')
  await editar.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.getByText('Sem conta no aplicativo · pedro@example.com')).toBeVisible()

  // Remove o aluno que ele criou e que nunca entrou no app.
  await page.getByRole('button', { name: 'Mais ações' }).click()
  await page.getByRole('button', { name: 'Remover aluno' }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.locator('.student-row', { hasText: 'Pedro Novato' })).toHaveCount(0)
})

// O aluno criado pelo professor é aluno da equipe: o professor marca presença
// dele na aula do dia como faz com qualquer outro.
test('professor lança presença do aluno que criou, sem conta no app', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  // Cria o aluno.
  await page.getByRole('button', { name: 'Alunos' }).first().click()
  await page.getByRole('button', { name: 'Adicionar aluno' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await folha.getByLabel('Nome completo').fill('Pedro Novato')
  await folha.getByLabel('Quantas aulas ele já fez').fill('5')
  await folha.getByRole('button', { name: 'Criar aluno' }).click()
  await expect(page.locator('.student-row', { hasText: 'Pedro Novato' })).toBeVisible()

  // Agenda: abre a aula mais recente que já aconteceu.
  await page.getByRole('button', { name: 'Agenda' }).first().click()
  const cells = page.getByRole('gridcell', { name: /:\s\d+ aulas?$/ })
  await cells.first().waitFor()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const labels = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))
  const past = labels
    .map((l) => l.slice(0, 10).split('/').reverse().join('-'))
    .filter((d) => d < today)
    .sort()
    .at(-1)!
  await page
    .getByRole('gridcell', { name: new RegExp('^' + past.split('-').reverse().join('/')) })
    .click()
  await page
    .getByRole('button', { name: /Jiu-jítsu adulto/ })
    .first()
    .click()

  // O aluno sem conta aparece na chamada: o professor marca a presença dele.
  const linha = page.locator('.roster label', { hasText: 'Pedro Novato' })
  await expect(linha).toContainText('sem check-in')
  await linha.locator('input').check()
  await page.getByRole('button', { name: 'Salvar fotos e presenças' }).click()
  await expect(page.locator('.roster label', { hasText: 'Pedro Novato' })).toContainText(
    'já confirmado',
  )
})
