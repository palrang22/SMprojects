import type { GoogleGenAI } from '@google/genai'
import { Storage } from '@google-cloud/storage'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'

export const MODEL_ID = 'gemini-omni-flash-preview'

export type ImageInput = { data: string; mimeType: string }

export type GenerateOptions = {
  prompt: string
  images?: ImageInput[]
  aspectRatio?: string
  resolution?: string
  durationSeconds?: number
  previousInteractionId?: string
}

export type GenerateResult = {
  interactionId: string
  fileName: string
}

/** 진행 단계를 호출자(잡 스토어)에게 알려주는 콜백 */
export type StageReporter = (stage: string) => void

// LRO 폴링 파라미터 — docs/GCP-INFRA-GUIDE.md §9.1 의 권장값
const POLL_INITIAL_MS = 3_000
const POLL_MAX_MS = 30_000
const POLL_FACTOR = 1.5
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** File.state 는 SDK 버전에 따라 문자열이거나 { name } 객체다. 둘 다 받아준다. */
function readState(state: unknown): string {
  if (typeof state === 'string') return state
  if (state && typeof state === 'object' && 'name' in state) {
    return String((state as { name: unknown }).name)
  }
  return 'UNKNOWN'
}

/** Files API 가 ACTIVE 가 될 때까지 지수 백오프 + jitter 로 폴링한다. */
async function waitForActive(
  ai: GoogleGenAI,
  name: string,
  onStage?: StageReporter,
): Promise<void> {
  const startedAt = Date.now()
  let delay = POLL_INITIAL_MS

  while (true) {
    const info = await ai.files.get({ name })
    const state = readState(info.state)

    if (state === 'ACTIVE') return
    if (state === 'FAILED') throw new Error('영상 생성에 실패했습니다 (state: FAILED)')

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('15분 안에 영상이 준비되지 않아 중단했습니다')
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    onStage?.(`파일 처리 대기 중 (${elapsed}초, state: ${state})`)

    // jitter: 여러 인스턴스가 같은 주기로 때리는 것을 방지
    await sleep(delay + Math.random() * 1000)
    delay = Math.min(delay * POLL_FACTOR, POLL_MAX_MS)
  }
}

/** gs://bucket/path 를 로컬 파일로 내려받는다 (인증은 ADC 가 처리). */
async function downloadFromGcs(gsUri: string, project: string, filePath: string): Promise<void> {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri)
  if (!match) throw new Error(`GCS URI 를 해석하지 못했습니다: ${gsUri}`)

  const [, bucket, object] = match
  await new Storage({ projectId: project }).bucket(bucket).file(object).download({
    destination: filePath,
  })
}

export async function generateVideo(
  config: OmniConfig,
  opts: GenerateOptions,
  outDir: string,
  onStage?: StageReporter,
): Promise<GenerateResult> {
  const ai = createClient(config)

  // 이미지가 있으면 [이미지..., 텍스트] 배열, 없으면 그냥 문자열.
  // video_config.task 는 생략한다 — 모델이 입력 구성으로 알아서 판단한다.
  const input = opts.images?.length
    ? [
        ...opts.images.map((img) => ({
          type: 'image' as const,
          data: img.data,
          mime_type: img.mimeType,
        })),
        { type: 'text' as const, text: opts.prompt },
      ]
    : opts.prompt

  onStage?.('모델 호출 중')

  // 720p 10초면 4MB 를 넘기 쉬우므로 가능하면 uri 전송을 쓴다.
  //   - Gemini API 키: Files API 가 받아준다 (gcs_uri 불필요)
  //   - Vertex AI    : 내 GCS 버킷이 있어야 uri 를 쓸 수 있다
  const gcsUri = config.mode === 'vertex' ? config.outputGcsUri : undefined
  const canUseUriDelivery = config.mode !== 'vertex' || Boolean(gcsUri)

  const interaction = await ai.interactions.create({
    model: MODEL_ID,
    input,
    response_format: {
      type: 'video',
      delivery: canUseUriDelivery ? 'uri' : 'inline',
      ...(gcsUri ? { gcs_uri: gcsUri } : {}),
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.durationSeconds ? `${opts.durationSeconds}s` : undefined,
    },
    ...(opts.previousInteractionId
      ? { previous_interaction_id: opts.previousInteractionId }
      : {}),
  })

  const video = interaction.output_video
  if (!video) {
    throw new Error('모델이 영상을 반환하지 않았습니다 (안전 필터에 걸렸을 수 있습니다)')
  }

  await mkdir(outDir, { recursive: true })
  const fileName = `${Date.now()}-${interaction.id}.mp4`
  const filePath = path.join(outDir, fileName)

  if (video.data) {
    // inline 응답 — base64 를 그대로 파일로 떨군다
    onStage?.('영상 저장 중')
    await writeFile(filePath, Buffer.from(video.data, 'base64'))
  } else if (video.uri?.startsWith('gs://')) {
    // Vertex — 결과가 내 GCS 버킷에 쓰여 있다
    onStage?.('GCS 에서 내려받는 중')
    await downloadFromGcs(video.uri, config.mode === 'vertex' ? config.project : '', filePath)
  } else if (video.uri) {
    // Gemini API — Files API 가 ACTIVE 가 될 때까지 기다린 뒤 내려받는다
    const match = /files\/([a-zA-Z0-9_-]+)/.exec(video.uri)
    if (!match) throw new Error(`파일 URI 를 해석하지 못했습니다: ${video.uri}`)
    const name = `files/${match[1]}`

    onStage?.('파일 처리 대기 중')
    await waitForActive(ai, name, onStage)

    onStage?.('영상 내려받는 중')
    await ai.files.download({ file: name, downloadPath: filePath })
  } else {
    throw new Error('응답에 영상 데이터도 URI 도 없습니다')
  }

  return { interactionId: interaction.id, fileName }
}
