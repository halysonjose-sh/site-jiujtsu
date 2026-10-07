import { test, expect } from '@playwright/test'

// Professor cria aluno sem conta (nome + aulas anteriores), informa o e-mail
// depois e exclui o convite. O vínculo real por e-mail no cadastro é coberto
// pelos testes de banco (supabase/tests/database.test.ts).
test('professor cria aluno, informa e-mail e exclui convite', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  await page.getByRole('button', { name: 'Alunos' }).first().click()
  await expect(page.getByRole('heading', { name: 'Alunos', exact: true })).toBeVisible()

  // Convite de exemplo do modo demonstração já está aguardando acesso.
  const carlos = page.locator('.student-row.invited', { hasText: 'Carlos Lima' })
  await expect(carlos).toContainText('12 aulas anteriores')
  await expect(carlos).toContainText('aguardando e-mail')

  // Cria um aluno novo com aulas anteriores.
  await page.getByRole('button', { name: 'Adicionar aluno' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await folha.getByLabel('Nome completo').fill('Pedro Novato')
  await folha.getByLabel('Quantas aulas ele já fez').fill('5')
  await folha.getByRole('button', { name: 'Criar aluno' }).click()
  const pedro = page.locator('.student-row.invited', { hasText: 'Pedro Novato' })
  await expect(pedro).toContainText('5 aulas anteriores')

  // Informa o e-mail que o aluno vai usar no cadastro.
  await pedro.getByRole('button', { name: 'Informar e-mail' }).click()
  await folha.getByLabel('E-mail do aluno').fill('pedro@example.com')
  await folha.getByRole('button', { name: 'Salvar e-mail' }).click()
  await expect(pedro).toContainText('pedro@example.com')

  // Exclui o convite do Pedro.
  await pedro.getByRole('button', { name: 'Excluir convite de Pedro Novato' }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.locator('.student-row.invited', { hasText: 'Pedro Novato' })).toHaveCount(0)
})
