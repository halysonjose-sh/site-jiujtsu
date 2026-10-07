import { test, expect } from '@playwright/test'

// Aba Hoje do professor: ver quem fez check-in e excluir o check-in de quem
// não apareceu. O relógio é fixado às 19:30 de São Paulo (= 22:30 UTC; o
// Brasil não observa horário de verão): a avulsa iniciada (30 min antes) já
// começou, a de 20:30 ainda não.
const hojeSp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const AGORA = new Date(`${hojeSp()}T22:30:00Z`)

test('professor vê os check-ins e exclui o de quem não apareceu', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.setFixedTime(AGORA)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  // Aba Hoje é a padrão do professor; o cartão da avulsa mostra a contagem.
  await expect(page.getByRole('heading', { name: 'Hoje.' })).toBeVisible()
  const cartao = page.locator('.today-card', { hasText: 'Treino avulso' })
  await expect(cartao).toContainText('2 alunos fizeram check-in')

  // Abre a folha de check-ins: Lucas confirmado, Marina pendente.
  await cartao.getByRole('button', { name: 'Ver check-ins' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await expect(folha.getByText('Lucas Almeida')).toBeVisible()
  await expect(folha.getByText('Marina Santos')).toBeVisible()
  await expect(folha.getByText('Pedro Oliveira')).toHaveCount(0)

  // Marina não apareceu no treino: professor exclui o check-in dela.
  await folha.getByRole('button', { name: 'Excluir check-in de Marina Santos' }).click()
  await folha.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText('Check-in excluído')).toBeVisible()
  await expect(cartao).toContainText('1 aluno fez check-in')
  await expect(folha.getByText('Marina Santos')).toHaveCount(0)
  await folha.getByRole('button', { name: 'Fechar' }).click()
})

test('aula sem check-ins mostra estado vazio na folha', async ({ page }) => {
  await page.clock.setFixedTime(AGORA)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  const cartao = page.locator('.today-card', { hasText: 'Treino de competição' })
  await expect(cartao).toContainText('Nenhum aluno fez check-in ainda')
  await cartao.getByRole('button', { name: 'Ver check-ins' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await expect(folha.getByText('Nenhum aluno fez check-in nesta aula ainda.')).toBeVisible()
})
