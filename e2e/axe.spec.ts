import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Auditoria de acessibilidade automática (axe) nas telas principais
// (plano de UI/UX, fase 7). Só violações serious/critical bloqueiam.
async function axe(page: Page, onde: string) {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const graves = resultado.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  )
  const resumo = graves
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)
    .join(' | ')
  expect(resumo, `axe em ${onde}`).toBe('')
}

test('axe nas telas principais', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Conhecer a demonstração' })).toBeVisible()
  await axe(page, 'acesso')

  await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
  await expect(page.getByText('Modo demonstração')).toBeVisible()
  await axe(page, 'aluno: treinar')
  await page.getByRole('button', { name: 'Treinos' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
  await axe(page, 'aluno: treinos')
  await page.getByRole('button', { name: 'Perfil' }).first().click()
  await axe(page, 'aluno: eu')

  await page.getByRole('button', { name: 'Ver como professor' }).click()
  await expect(page.getByText('Aguardando aprovação')).toBeVisible()
  await axe(page, 'professor: hoje')
  await page.getByRole('button', { name: 'Agenda' }).first().click()
  await expect(page.getByRole('grid')).toBeVisible()
  await axe(page, 'professor: calendário')
  await page.getByRole('button', { name: 'Gestão' }).first().click()
  await expect(page.getByLabel('Código da equipe')).toBeVisible()
  await axe(page, 'professor: mais')
})
