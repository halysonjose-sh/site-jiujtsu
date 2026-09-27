import { test, expect } from '@playwright/test'

// Aba Hoje do professor: chamada em 3 toques (Fazer chamada, linha, Salvar),
// contador "a revisar" zerando e Desfazer do toast.
// O relógio é fixado às 19:30 de São Paulo (= 22:30 UTC; o Brasil não observa
// horário de verão): a avulsa de 18:30 está iniciada, a de 20:30 ainda não.
const hojeSp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const AGORA = new Date(`${hojeSp()}T22:30:00Z`)

test('professor faz a chamada em 3 toques, zera o contador e desfaz', async ({ page }) => {
  // Dois percursos completos num teste só: no webkit, com o projeto chromium
  // rodando em paralelo, 30s (default) estouram no meio da última espera.
  test.setTimeout(120_000)
  await page.clock.setFixedTime(AGORA)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  // Aba Hoje é a padrão do professor; o cartão da avulsa mostra as contagens.
  await expect(page.getByRole('heading', { name: 'Hoje.' })).toBeVisible()
  const cartao = page.locator('.today-card', { hasText: 'Treino avulso' })
  await expect(cartao).toContainText('1 confirmado · 1 a revisar')
  // Marina fez check-in pendente: aparece como presença a revisar.
  await expect(page.getByText('1 presença a revisar')).toBeVisible()

  // Toque 1: abre a folha; pendente e confirmada já vem marcadas.
  await cartao.getByRole('button', { name: 'Fazer chamada' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await expect(folha.getByRole('checkbox', { name: 'Lucas Almeida' })).toBeChecked()
  await expect(folha.getByRole('checkbox', { name: 'Marina Santos' })).toBeChecked()
  await expect(folha.getByRole('checkbox', { name: 'Pedro Oliveira' })).not.toBeChecked()

  // Toque 2: desmarcar a pendente registra rejeição (o contador precisa zerar).
  await folha.getByRole('checkbox', { name: 'Marina Santos' }).uncheck()

  // Toque 3: salvar em lote.
  await folha.getByRole('button', { name: 'Salvar presenças' }).click()
  await expect(folha.getByText('Chamada salva')).toBeVisible()

  // O contador de pendências da aula zera na aba, atrás da folha.
  await expect(page.getByText('1 presença a revisar')).toHaveCount(0)

  // Recusa de check-in pendente não oferece Desfazer: produção não tem RPC
  // que volte a 'pendente'. O toast só existe depois de fechar a folha.
  await folha.getByRole('button', { name: 'Fechar' }).click()
  const toast = page.locator('.toast')
  await expect(toast).toContainText('Chamada salva')
  await expect(toast.getByRole('button', { name: 'Desfazer' })).toHaveCount(0)

  // Segundo fluxo, com Desfazer: confirma quem não tinha registro e volta atrás.
  await cartao.getByRole('button', { name: 'Fazer chamada' }).click()
  await folha.getByRole('checkbox', { name: 'Pedro Oliveira' }).check()
  await folha.getByRole('button', { name: 'Salvar presenças' }).click()
  await expect(folha.getByText('Chamada salva')).toBeVisible()
  await expect(cartao).toContainText('2 confirmados · 0 a revisar')
  await folha.getByRole('button', { name: 'Fechar' }).click()
  await toast.getByRole('button', { name: 'Desfazer' }).click()
  await expect(cartao).toContainText('1 confirmado · 0 a revisar')
})

test('bloqueia salvar presenças antes do início da aula', async ({ page }) => {
  await page.clock.setFixedTime(AGORA)
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()

  const cartao = page.locator('.today-card', { hasText: 'Treino de competição' })
  await expect(cartao).toBeVisible()
  await cartao.getByRole('button', { name: 'Fazer chamada' }).click()
  const folha = page.locator('.sheet-backdrop dialog')
  await expect(folha.getByRole('button', { name: 'Salvar presenças' })).toBeDisabled()
  await expect(folha.getByText('A chamada abre quando a aula começar.')).toBeVisible()
})
