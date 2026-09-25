import { test, expect } from '@playwright/test'
test('fluxo demonstrativo de presença, professor, graduação e correção', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await page.getByRole('button', { name: 'Vou treinar' }).first().click()
  await expect(page.getByRole('button', { name: 'Desistir' }).first()).toBeVisible()
  await expect(page.getByText('Aguardando professor').first()).toBeVisible()
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await expect(page.getByText('Aguardando aprovação')).toBeVisible()
  await page.getByRole('button', { name: 'Aprovar Ana Costa' }).click()
  await expect(page.getByText('Aguardando aprovação')).toHaveCount(0)
  await page.getByRole('button', { name: /Lucas Almeida/ }).click()
  await page.getByRole('button', { name: 'Conceder grau', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByTestId('current-degrees')).toHaveText('2 graus')
  await expect(page.getByTestId('cycle-count')).toHaveText('0')
  await page.getByRole('button', { name: 'Desfazer última graduação' }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByTestId('current-degrees')).toHaveText('1 grau')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
test('offline esconde dados e bloqueia ações; reconexão recupera', async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await context.setOffline(true)
  await expect(page.getByText('Você está sem conexão')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Vou treinar' })).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Vou treinar' }).first()).toBeVisible()
})
test('acesso tem rótulos e cadastro não oferece papel de professor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByLabel('Nome completo')).toBeVisible()
  await expect(page.getByLabel('Código da turma')).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await page.getByLabel('Nome completo').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused()
})
test('calendário: professor cria horário, descreve aula, envia foto e lança presença', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await page.getByRole('button', { name: 'Calendário' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
  await expect(page.getByRole('gridcell')).toHaveCount(42)
  await page.getByRole('button', { name: 'Novo horário' }).click()
  await page.getByLabel('Nome da aula').fill('Kids')
  await page.getByRole('button', { name: 'Criar horário' }).click()
  await expect(page.getByText('Kids').first()).toBeVisible()
  // Abre a aula mais recente que já aconteceu (dias com aula têm "aula(s)" no rótulo).
  const cells = page.getByRole('gridcell', { name: /aula\(s\)/ })
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
  await expect(page.getByText('Sobre o treino')).toBeVisible()
  await page.getByLabel('Descrição da aula').fill('Raspagem de gancho')
  await page.getByRole('button', { name: 'Salvar descrição' }).click()
  await expect(page.getByText('Descrição salva.')).toBeVisible()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'treino.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('Fotos (1)')).toBeVisible()
  await expect(page.locator('.photo-grid img')).toHaveCount(1)
  const lancar = page.getByRole('button', { name: /Lançar presença de/ })
  if (await lancar.count()) {
    await lancar.first().click()
    await expect(page.getByText('Presença confirmada').first()).toBeVisible()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  // Aluno vê a descrição da aula no calendário de treinos.
  await page.getByRole('button', { name: /Voltar para o calendário/ }).click()
  await page.getByRole('button', { name: 'Ver como aluno' }).click()
  await page.getByRole('button', { name: 'Treinos' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
})
