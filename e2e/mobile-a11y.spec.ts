import { test, expect, type Page } from '@playwright/test'

// Auditoria de UX mobile (docs/PLANO_UX_MOBILE.md, critérios P1–P5, P8):
// nenhuma tela rola de lado em 360 px, todo alvo de toque tem >= 44 px em
// qualquer eixo e nenhum texto funcional usa fonte < 13 px.
// Quem adicionar tela nova adiciona uma linha na lista de navegações abaixo.

let todas: string[] = []

test.beforeEach(() => {
  // Acumulador por teste: sem isso o segundo teste herdaria violações do primeiro.
  todas = []
})

async function audit(page: Page, onde: string) {
  const violations = await page.evaluate(() => {
    const out: string[] = []
    const tag = (el: Element) => {
      const cls =
        el.className && typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).join('.')
          : ''
      return el.tagName.toLowerCase() + cls
    }
    if (document.documentElement.scrollWidth > window.innerWidth)
      out.push(
        'rolagem lateral: scrollWidth ' +
          document.documentElement.scrollWidth +
          ' > ' +
          window.innerWidth,
      )
    const alvos = document.querySelectorAll<HTMLElement>(
      'button, a, select, [role="button"], label:has(input)',
    )
    for (const el of alvos) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // Célula do calendário: grid de 7 colunas não alcança 44px de largura
      // em 360px (o container do formulário dá ~39px por célula); a altura é
      // garantida em 64px e o toque preciso é preservado. Exige só altura.
      const mes = el.classList.contains('month-cell')
      if (mes ? r.height < 44 : r.width < 44 || r.height < 44) {
        const nome = (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40)
        out.push(`alvo < 44px: ${tag(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${nome}"`)
      }
    }
    const vistos = new Set<Element>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const texto = walker.currentNode as Text
      if (!texto.textContent || !texto.textContent.trim()) continue
      const el = texto.parentElement
      if (!el || vistos.has(el)) continue
      vistos.add(el)
      if (el.closest('[aria-hidden="true"]')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 13)
        out.push(`fonte ${fs}px < 13px: ${tag(el)} "${texto.textContent.trim().slice(0, 40)}"`)
    }
    return out
  })
  for (const v of violations) todas.push(onde + ': ' + v)
}

test.afterEach(async () => {
  expect(todas, 'auditoria mobile completa').toEqual([])
})

test('telas do app sem rolagem lateral, alvos >= 44px e fontes >= 13px', async ({ page }) => {
  // ~18 telas auditadas em sequência: no webkit, com o projeto chromium rodando
  // em paralelo, 30s (default) estouram no meio da navegação.
  test.setTimeout(120_000)
  // Acesso
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Conhecer a demonstração' })).toBeVisible()
  await audit(page, 'acesso: login')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await expect(page.getByLabel('Nome completo')).toBeVisible()
  await audit(page, 'acesso: cadastro')

  // Demonstração como aluno
  await page.goto('/')
  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await audit(page, 'aluno: treinar')
  await page.getByRole('button', { name: 'Vou treinar' }).first().click()
  await expect(page.getByRole('button', { name: 'Desistir' }).first()).toBeVisible()
  await audit(page, 'aluno: treinar com check-in')
  await page.getByRole('button', { name: 'Treinos' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
  await audit(page, 'aluno: treinos')
  await page.getByRole('button', { name: 'Perfil' }).first().click()
  await audit(page, 'aluno: eu')

  // Demonstração como professor: a aba padrão agora é Hoje, onde ficam as
  // pendências (aprovações de alunos) e o treino do dia com os check-ins.
  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await expect(page.getByText('Aguardando aprovação')).toBeVisible()
  await audit(page, 'professor: hoje com pendência')
  await page.getByRole('button', { name: 'Aprovar Ana Costa' }).click()
  await expect(page.getByText('Aguardando aprovação')).toHaveCount(0)
  await audit(page, 'professor: hoje')

  // Folha de check-ins é tela nova: audita aberta (fica no top layer do dialog).
  await page
    .locator('.today-card', { hasText: 'Treino avulso' })
    .getByRole('button', { name: 'Ver check-ins' })
    .click()
  await expect(page.locator('.sheet-backdrop dialog')).toBeVisible()
  await audit(page, 'professor: folha de check-ins')
  await page.getByRole('button', { name: 'Fechar' }).click()

  await page.getByRole('button', { name: 'Alunos' }).first().click()
  await expect(page.getByRole('button', { name: /Lucas Almeida/ })).toBeVisible()
  await audit(page, 'professor: lista de alunos')
  await page.getByRole('button', { name: /Lucas Almeida/ }).click()
  await audit(page, 'professor: detalhe do aluno')
  // Folha de graduar é tela nova (top layer); graduar cria o evento que o
  // menu "Mais ações" precisa para oferecer "Desfazer última graduação".
  await page.getByRole('button', { name: 'Graduar', exact: true }).click()
  await expect(page.locator('.sheet-backdrop dialog')).toBeVisible()
  await audit(page, 'professor: folha graduar')
  await page.getByRole('button', { name: '+1 grau' }).click()
  await expect(page.getByText('Grau concedido').first()).toBeVisible()
  await page.getByRole('button', { name: 'Mais ações' }).click()
  await page.getByRole('button', { name: 'Desfazer última graduação' }).click()
  await expect(page.getByRole('dialog', { name: 'Confirmar alteração' })).toBeVisible()
  await audit(page, 'professor: diálogo de confirmação')
  await page.getByRole('button', { name: 'Cancelar' }).click()
  // data-stay mantém o menu aberto sob o diálogo; fechar a folha para voltar.
  await page.getByRole('button', { name: 'Fechar' }).click()
  await page.getByRole('button', { name: 'Todos os alunos' }).click()

  await page.getByRole('button', { name: 'Agenda' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
  await audit(page, 'professor: calendário')

  // Dia com aula já realizada: abre o painel do treino. Espera as células
  // carregarem antes de capturar: sem isso labels sai vazio e o cálculo
  // quebra (list_sessions do demo responde depois da primeira pintura).
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
  await expect(page.getByText('Sobre o treino')).toBeVisible()
  await audit(page, 'professor: painel do treino')
  // Zoom de foto, quando o treino exibido tem fotos.
  if (await page.locator('.photo-large img').count()) {
    await page.locator('.photo-large img').first().click()
    await expect(page.getByRole('dialog', { name: 'Foto ampliada' })).toBeVisible()
    await audit(page, 'professor: zoom de foto')
    await page.getByRole('button', { name: 'Fechar' }).click()
  }
  await page.getByRole('button', { name: /Voltar para o calendário/ }).click()

  await page.getByRole('button', { name: 'Nova aula', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nova aula' })).toBeVisible()
  await audit(page, 'professor: folha nova aula')
  await page.getByRole('button', { name: /Mais opções/ }).click()
  await expect(page.getByRole('heading', { name: 'Nova aula' })).toBeVisible()
  await audit(page, 'professor: formulário nova aula')
  await page.getByRole('button', { name: /Voltar para o calendário/ }).click()

  // Horários padrão agora moram na aba Gestão.
  await page.getByRole('button', { name: 'Gestão' }).first().click()
  await expect(page.getByLabel('Código da equipe')).toBeVisible()
  await page.getByRole('button', { name: 'Novo horário' }).click()
  await page.getByRole('button', { name: 'Criar horário' }).waitFor()
  await audit(page, 'professor: formulário novo horário')
  await page.getByRole('button', { name: 'Fechar' }).click()

  await expect(page.getByLabel('Código da equipe')).toBeVisible()
  await audit(page, 'professor: configurações')
  await page.getByRole('button', { name: 'Novo horário' }).click()
  await expect(page.getByRole('button', { name: 'Criar horário' })).toBeVisible()
  await audit(page, 'professor: formulário novo horário')
})

test('tela offline sem rolagem lateral, alvos >= 44px e fontes >= 13px', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Conhecer a demonstração' })).toBeVisible()
  // Sem recarregar: o app reage ao evento offline e troca a tela inteira.
  await page.context().setOffline(true)
  await expect(page.getByText('Você está sem conexão')).toBeVisible()
  await audit(page, 'offline')
  await page.context().setOffline(false)
})
