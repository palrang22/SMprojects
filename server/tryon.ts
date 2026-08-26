import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'

/**
 * Virtual Try-On — 인물 사진에 의상을 입힌 이미지를 만든다.
 *
 * SDK 에 `virtualTryOn` 이라는 이름은 없다. Virtual Try-On 은
 * `models.recontextImage()` 의 한 갈래로 들어간다
 * (node_modules/@google/genai/dist/genai.d.ts 의 recontextImage 주석 참고).
 *
 * 01번(Omni Flash)과 달리 LRO 가 아니라 동기 호출이라서 잡 스토어를 쓰지 않는다.
 */
export const TRYON_MODEL_ID = 'virtual-try-on-001'

/**
 * 이 모델은 `global` 에 없다. 2026-08-26 퍼블리셔 모델 메타데이터로 확인:
 *   us-central1 → 200 (launchStage GA) / global → 404 / asia-northeast3 → 404
 * 01번 Omni Flash 가 반대로 global 만 되므로, 둘은 리전이 서로 다르다.
 */
export const TRYON_LOCATION = 'us-central1'

export type TryOnImage = { data: string; mimeType: string }

export type TryOnOptions = {
  person: TryOnImage
  products: TryOnImage[]
  numberOfImages?: number
}

export type TryOnResult = {
  images: TryOnImage[]
}

/** base64 + mimeType 을 SDK 의 Image 형태로 바꾼다 */
function toImage(img: TryOnImage) {
  return { imageBytes: img.data, mimeType: img.mimeType }
}

export async function generateTryOn(
  config: OmniConfig,
  opts: TryOnOptions,
): Promise<TryOnResult> {
  const ai = createClient(config, TRYON_LOCATION)

  const response = await ai.models.recontextImage({
    model: TRYON_MODEL_ID,
    source: {
      // prompt 는 Virtual Try-On 에서 지원하지 않는다 (SDK 타입 주석에 명시)
      personImage: toImage(opts.person),
      productImages: opts.products.map((p) => ({ productImage: toImage(p) })),
    },
    config: {
      numberOfImages: opts.numberOfImages ?? 1,
    },
  })

  const generated = response.generatedImages ?? []

  // 안전 필터에 걸리면 image 없이 raiFilteredReason 만 온다
  const filtered = generated.find((g) => g.raiFilteredReason)
  const images = generated.flatMap((g) => {
    const bytes = g.image?.imageBytes
    if (!bytes) return []
    return [{ data: bytes, mimeType: g.image?.mimeType ?? 'image/png' }]
  })

  if (!images.length) {
    throw new Error(
      filtered?.raiFilteredReason
        ? `안전 필터에 걸렸습니다: ${filtered.raiFilteredReason}`
        : '모델이 이미지를 반환하지 않았습니다',
    )
  }

  return { images }
}
