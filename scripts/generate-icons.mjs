import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
await mkdir('public', { recursive: true })
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#203c32"/><g fill="#d9e8b7" transform="translate(256 256)"><rect x="-38" y="-140" width="65" height="280" rx="8" transform="rotate(36)"/><rect x="-35" y="-120" width="65" height="260" rx="8" transform="rotate(-36)"/></g></svg>`
for (const size of [192, 512])
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icon-${size}.png`)
await sharp(Buffer.from(svg.replace('rx="100"', 'rx="0"')))
  .png()
  .toFile('public/icon-maskable.png')
