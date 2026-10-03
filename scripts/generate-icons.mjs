import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
// Marca Tatame: faixa amarrada (nó central, duas pontas, ponteira preta com graus).
await mkdir('public', { recursive: true })
const mark = (belt, line) => `
  <rect x="3" y="20" width="58" height="11" rx="3" fill="${belt}"/>
  <path d="M27 31 L35 32 L25.5 58 L17.5 55 Z" fill="${belt}"/>
  <path d="M30 32 L38 31 L47.5 55 L39.5 58 Z" fill="${belt}"/>
  <path d="M43.2 44.2 L47.5 55 L39.5 58 L35.4 47.3 Z" fill="#161616"/>
  <path d="M37.1 50.4 L44.1 47.6 M38.1 53.1 L45.1 50.3" stroke="#fff" stroke-width="1.5"/>
  <rect x="23" y="15" width="18" height="21" rx="5" fill="${belt}" stroke="${line}" stroke-width="2"/>
  <path d="M27 18.5 L37 32.5" stroke="${line}" stroke-width="1.8" stroke-linecap="round" opacity=".45"/>`
const icon = (radius, scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="#1d3557"/>
  <g transform="translate(256 262) scale(${scale}) translate(-32 -36)">${mark('#f7f6f2', '#1d3557')}</g></svg>`
for (const size of [192, 512])
  await sharp(Buffer.from(icon(100, 6.4))).resize(size, size).png().toFile(`public/icon-${size}.png`)
// Maskable: o sistema recorta as bordas, então a marca fica dentro da área segura (80%).
await sharp(Buffer.from(icon(0, 5))).png().toFile('public/icon-maskable.png')
