import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
await mkdir('.artifacts', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto('http://localhost:5173/')
await page.screenshot({ path: '.artifacts/login-desktop.png', fullPage: true })
await page.getByRole('button', { name: 'Conhecer a demonstração' }).click()
await page.getByRole('heading', { name: 'Olá, Lucas.' }).waitFor()
await page.screenshot({ path: '.artifacts/aluno-desktop.png', fullPage: true })
await page.setViewportSize({ width: 360, height: 800 })
await page.screenshot({ path: '.artifacts/aluno-mobile.png', fullPage: true })
await page.getByRole('button', { name: 'Ver como professor' }).click()
await page.getByRole('button', { name: /Lucas Almeida/ }).waitFor()
await page.screenshot({ path: '.artifacts/professor-mobile.png', fullPage: true })
console.log(
  JSON.stringify({
    pageErrors: errors,
    horizontalOverflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  }),
)
await browser.close()
if (errors.length) process.exitCode = 1
