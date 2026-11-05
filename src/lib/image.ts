const MAX_BYTES = 5 * 1024 * 1024
const MAX_SIDE = 1600

/** Shrink a photo before upload (long side 1600px by default, JPEG). PDFs pass through unchanged. */
export async function prepareReceipt(file: File, maxSide = MAX_SIDE): Promise<{ blob: Blob; ext: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 5 MB`)
    return { blob: file, ext: 'pdf' }
  }
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo or PDF`)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`Could not read ${file.name}. Try a JPEG or PNG photo.`)
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
  if (!blob || blob.size < 1500) throw new Error('Could not process the photo. Try taking it again in good light.')
  if (blob.size > MAX_BYTES) throw new Error(`${file.name} is still larger than 5 MB after shrinking`)
  return { blob, ext: 'jpg' }
}
