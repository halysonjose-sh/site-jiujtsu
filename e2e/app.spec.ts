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
    .getByLabel('Escolher fotos do treino')
    .setInputFiles({ name: 'treino.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('img', { name: 'Foto escolhida 1' })).toBeVisible()
  // Marca um aluno que não fez check-in como presente.
  const semCheckin = page.locator('.roster label', { hasText: 'sem check-in' }).first()
  const nome = (await semCheckin.locator('span').textContent())!
  await semCheckin.locator('input').check()
  await page.getByRole('button', { name: 'Salvar fotos e presenças' }).click()
  await expect(
    page.getByText(/1 foto\(s\) enviada\(s\) e \d+ presença\(s\) confirmada/),
  ).toBeVisible()
  await expect(page.locator('.photo-large img')).toHaveCount(1)
  await expect(page.locator('.photo-large img')).toHaveCount(1)
  await expect(page.locator('.roster label', { hasText: nome })).toContainText('já confirmado')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  // Aluno vê a descrição da aula no calendário de treinos.
  await page.getByRole('button', { name: /Voltar para o calendário/ }).click()
  await page.getByRole('button', { name: 'Ver como aluno' }).click()
  await page.getByRole('button', { name: 'Treinos' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
})
test('cadastro de aula: pelo botão (futura) e por um dia passado (com foto e presentes)', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await page.getByRole('button', { name: 'Calendário' }).first().click()
  await expect(page.getByText('Aula avulsa')).toHaveCount(0)

  // Validação: nome vazio e duração inválida mostram erros e não criam nada.
  await page.getByRole('button', { name: 'Nova aula', exact: true }).click()
  await page.getByLabel('Nome da aula').fill(' ')
  await page.getByLabel('Duração (min)').fill('5')
  await page.getByRole('button', { name: 'Criar aula' }).click()
  await expect(page.getByText('Informe o nome da aula.')).toBeVisible()
  await expect(page.getByText('A duração deve ficar entre 15 e 300 minutos.')).toBeVisible()

  // Aula futura: sem fotos/presença; abre a aula criada.
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  })
  await page.getByLabel('Nome da aula').fill('Treino de competição')
  await page.getByLabel('Duração (min)').fill('90')
  await page.getByLabel('Data').fill(tomorrow)
  await page.getByLabel('Horário').fill('06:30')
  await expect(page.getByText(/Aula futura/)).toBeVisible()
  await expect(page.locator('.roster')).toHaveCount(0)
  const flyer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  // Escolhe duas, remove uma pela prévia e envia a outra junto com a aula futura.
  await page.getByLabel('Escolher fotos do treino').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: flyer },
    { name: 'b.png', mimeType: 'image/png', buffer: flyer },
  ])
  await expect(page.locator('.photo-previews li')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remover foto 2' }).click()
  await expect(page.locator('.photo-previews li')).toHaveCount(1)
  await page.getByRole('button', { name: 'Criar aula e registrar' }).click()
  await expect(page.getByText('Aula criada, 1 foto(s) enviada(s).')).toBeVisible()
  // A foto aparece grande, sem precisar tocar nela.
  await expect(page.locator('.photo-large img')).toHaveCount(1)
  const box = await page.locator('.photo-large img').boundingBox()
  expect(box!.width).toBeGreaterThan(250)
  await expect(page.getByRole('heading', { name: /Treino de competição/ })).toBeVisible()
  await page.getByRole('button', { name: /Voltar para o calendário/ }).click()

  // Dia passado: toca no dia e cria com foto e presentes na mesma tela.
  const past = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  })
  const cell = page.getByRole('gridcell', {
    name: new RegExp('^' + past.split('-').reverse().join('/')),
  })
  if ((await cell.count()) === 0) await page.getByRole('button', { name: 'Mês anterior' }).click()
  await page
    .getByRole('gridcell', { name: new RegExp('^' + past.split('-').reverse().join('/')) })
    .click()
  await page.getByRole('button', { name: 'Nova aula neste dia' }).click()
  await expect(page.getByLabel('Data')).toHaveValue(past)
  await page.getByLabel('Nome da aula').fill('Open mat')
  await page.getByLabel('Horário').fill('10:00')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await page
    .getByLabel('Escolher fotos do treino')
    .setInputFiles({ name: 'open.png', mimeType: 'image/png', buffer: png })
  await page.locator('.roster label', { hasText: 'Pedro Oliveira' }).locator('input').check()
  await page.getByRole('button', { name: 'Criar aula e registrar' }).click()
  await expect(
    page.getByText('Aula criada, 1 foto(s) enviada(s), 1 presença(s) confirmada(s).'),
  ).toBeVisible()
  await expect(page.locator('.photo-large img')).toHaveCount(1)
  await expect(page.locator('.roster label', { hasText: 'Pedro Oliveira' })).toContainText(
    'já confirmado',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
test('professor vê, copia e troca o código de acesso; link abre cadastro preenchido', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await page.getByRole('button', { name: 'Configurações' }).first().click()
  await expect(page.getByLabel('Código da turma')).toHaveText('TIGR-2026')
  await page.getByRole('button', { name: 'Copiar código' }).click()
  await expect(page.getByRole('button', { name: 'Copiado!' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('TIGR-2026')
  await page.getByText('Trocar código').click()
  await page.getByRole('button', { name: 'Gerar novo código' }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByLabel('Código da turma')).not.toHaveText('TIGR-2026')
  await expect(page.getByLabel('Código da turma')).toHaveText(
    /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
  )
  await page.goto('/?codigo=ABCD-EFGH')
  await expect(page.getByLabel('Código da turma')).toHaveValue('ABCD-EFGH')
  await expect(page.getByLabel('Nome completo')).toBeVisible()
})
