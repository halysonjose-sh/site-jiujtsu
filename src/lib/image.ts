/** Reduz a foto no próprio celular antes do envio (lado maior até 1600 px, JPEG). */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Não foi possível ler esta imagem. Tente uma foto JPG ou PNG.')
  })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  if (!blob) throw new Error('Não foi possível preparar a foto.')
  if (blob.size > 3 * 1024 * 1024) throw new Error('A foto ficou grande demais. Tente outra.')
  return blob
}
