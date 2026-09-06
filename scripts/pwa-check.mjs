import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
const page = await context.newPage()
page.on('pageerror', (e) => console.error('Page error:', e.message))
page.on('requestfailed', (r) => console.error('Request failed:', r.url(), r.failure()?.errorText))
try {
  await page.goto('http://localhost:4173/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  const manifest = await page.evaluate(
    async () => await (await fetch('/manifest.webmanifest')).json(),
  )
  if (manifest.display !== 'standalone' || manifest.icons.length < 3)
    throw new Error('Manifesto incompleto')
  const cdp = await context.newCDPSession(page)
  const install = await cdp.send('Page.getInstallabilityErrors')
  if (install.installabilityErrors.length)
    throw new Error(JSON.stringify(install.installabilityErrors))
  const urls = await page.evaluate(async () => {
    const keys = await caches.keys()
    return (
      await Promise.all(
        keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)),
      )
    ).flat()
  })
  if (urls.some((u) => /supabase|\/rest\/|\/auth\//.test(u)))
    throw new Error('Dados de API encontrados no cache')
  await context.setOffline(true)
  await page.reload()
  await page.screenshot({ path: '.artifacts/pwa-offline.png' })
  await page.getByRole('heading', { name: 'Você está sem conexão' }).waitFor()
  console.log(
    JSON.stringify({
      manifest: 'standalone',
      installabilityErrors: install.installabilityErrors,
      offlineShell: true,
      cachedFiles: urls.length,
      apiCache: false,
    }),
  )
} finally {
  await browser.close()
}
