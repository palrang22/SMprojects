import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { generateVideo, MODEL_ID, type GenerateOptions } from './omni.ts'
import { generateTryOn, TRYON_MODEL_ID, type TryOnImage, type TryOnOptions } from './tryon.ts'
import { describeConfig, type OmniConfig } from './config.ts'

export type JobStatus = 'queued' | 'running' | 'completed' | 'error'

export type Job = {
  id: string
  status: JobStatus
  stage: string
  createdAt: number
  completedAt?: number
  videoUrl?: string
  interactionId?: string
  error?: string
}

const MAX_BODY_BYTES = 25 * 1024 * 1024 // 이미지 몇 장까지는 받아준다
const ALLOWED_ASPECT = new Set(['16:9', '9:16'])
const ALLOWED_RESOLUTION = new Set(['720p', '1080p'])

/** 로컬 단일 프로세스 전용 인메모리 잡 스토어. 서버를 재시작하면 사라진다. */
const jobs = new Map<string, Job>()

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('요청 본문이 너무 큽니다 (25MB 초과)')
    chunks.push(chunk as Buffer)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** { data, mimeType } 형태만 통과시킨다 */
function parseImages(raw: unknown[]): TryOnImage[] {
  return raw.flatMap((item) => {
    const img = item as Record<string, unknown>
    if (typeof img?.data !== 'string' || typeof img?.mimeType !== 'string') return []
    return [{ data: img.data, mimeType: img.mimeType }]
  })
}

function parseOptions(raw: unknown): GenerateOptions {
  const body = (raw ?? {}) as Record<string, unknown>

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) throw new Error('프롬프트를 입력하세요')

  const images = Array.isArray(body.images) ? parseImages(body.images) : undefined

  const aspectRatio =
    typeof body.aspectRatio === 'string' && ALLOWED_ASPECT.has(body.aspectRatio)
      ? body.aspectRatio
      : '16:9'

  const resolution =
    typeof body.resolution === 'string' && ALLOWED_RESOLUTION.has(body.resolution)
      ? body.resolution
      : '720p'

  const rawDuration = Number(body.durationSeconds)
  const durationSeconds = Number.isFinite(rawDuration)
    ? Math.min(10, Math.max(3, Math.round(rawDuration)))
    : 5

  const previousInteractionId =
    typeof body.previousInteractionId === 'string' && body.previousInteractionId
      ? body.previousInteractionId
      : undefined

  return { prompt, images, aspectRatio, resolution, durationSeconds, previousInteractionId }
}

function parseTryOnOptions(raw: unknown): TryOnOptions {
  const body = (raw ?? {}) as Record<string, unknown>

  const [person] = parseImages(Array.isArray(body.person) ? body.person : [body.person])
  if (!person) throw new Error('인물 사진을 넣어주세요')

  const products = parseImages(Array.isArray(body.products) ? body.products : [])
  if (!products.length) throw new Error('의상 사진을 넣어주세요')

  return { person, products: products.slice(0, 2) }
}

/**
 * SDK 에러는 "400 API error occurred: {...}" 처럼 불친절하다.
 * 흔한 원인을 인증 모드에 맞는 힌트로 덧붙인다.
 */
function describeError(err: unknown, config: OmniConfig): string {
  const message = err instanceof Error ? err.message : String(err)
  const hint = (text: string) => `${message}\n\n힌트: ${text}`

  // 리전 문제는 두 모드 공통이고 메시지에 지원 목록이 같이 온다
  if (/unsupported location/i.test(message)) {
    return hint(
      '.env.local 의 GOOGLE_CLOUD_LOCATION 을 위 메시지가 알려주는 값으로 바꾸고 dev 서버를 재시작하세요.',
    )
  }

  if (/\b429\b/.test(message)) {
    return hint('쿼터를 초과했습니다. 잠시 후 다시 시도하거나 콘솔에서 한도를 확인하세요.')
  }

  if (/\b(400|401|403)\b/.test(message)) {
    return config.mode === 'vertex'
      ? hint(
          `gcloud auth application-default login 이 되어 있는지, ${config.project} 에서 ${MODEL_ID} 를 쓸 권한이 있는지 확인하세요.`,
        )
      : hint(`GEMINI_API_KEY 가 유효한지, 해당 키로 ${MODEL_ID} 에 접근 권한이 있는지 확인하세요.`)
  }

  return message
}

/**
 * 잡을 백그라운드로 돌린다.
 *
 * 영상 생성은 수 분이 걸리는 LRO 라서, HTTP 요청 하나를 붙잡고 기다리면
 * 게이트웨이/프록시 타임아웃에 걸린다. docs/GCP-INFRA-GUIDE.md §1.2 의
 * "즉시 응답 + 상태 폴링" 구조를 그대로 따랐다.
 */
function startJob(config: OmniConfig, opts: GenerateOptions, outDir: string): Job {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    stage: '대기 중',
    createdAt: Date.now(),
  }
  jobs.set(job.id, job)

  void (async () => {
    job.status = 'running'
    try {
      const result = await generateVideo(config, opts, outDir, (stage) => {
        job.stage = stage
      })
      job.status = 'completed'
      job.stage = '완료'
      job.videoUrl = `/output/${result.fileName}`
      job.interactionId = result.interactionId
    } catch (err) {
      job.status = 'error'
      job.stage = '실패'
      job.error = describeError(err, config)
    } finally {
      job.completedAt = Date.now()
    }
  })()

  return job
}

/** 생성된 mp4 를 Range 지원으로 서빙한다 (Safari 는 Range 없이는 재생하지 않는다). */
async function serveVideo(
  res: ServerResponse,
  outDir: string,
  fileName: string,
  rangeHeader: string | undefined,
): Promise<void> {
  // 경로 탈출 방지: 파일명만 취한다
  const safeName = path.basename(fileName)
  const filePath = path.join(outDir, safeName)

  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    json(res, 404, { error: '파일을 찾을 수 없습니다' })
    return
  }

  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null
  if (match) {
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : size - 1
    if (start >= size || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(filePath, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(filePath).pipe(res)
}

export function createApiMiddleware(config: OmniConfig, outDir: string) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    if (!pathname.startsWith('/api/') && !pathname.startsWith('/output/')) {
      next()
      return
    }

    try {
      if (pathname === '/api/health') {
        json(res, 200, {
          ok: true,
          ready: config.mode !== 'unconfigured',
          mode: config.mode,
          detail: describeConfig(config),
          model: MODEL_ID,
          tryonModel: TRYON_MODEL_ID,
        })
        return
      }

      if (pathname === '/api/generate' && req.method === 'POST') {
        if (config.mode === 'unconfigured') {
          json(res, 500, { error: config.reason })
          return
        }
        const opts = parseOptions(await readBody(req))
        const job = startJob(config, opts, outDir)
        json(res, 202, { jobId: job.id })
        return
      }

      // 02 Look Studio — LRO 가 아니라 동기 호출이라 잡 구조를 쓰지 않는다
      if (pathname === '/api/tryon' && req.method === 'POST') {
        if (config.mode === 'unconfigured') {
          json(res, 500, { error: config.reason })
          return
        }
        const opts = parseTryOnOptions(await readBody(req))
        json(res, 200, await generateTryOn(config, opts))
        return
      }

      if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
        const job = jobs.get(pathname.slice('/api/jobs/'.length))
        if (!job) {
          json(res, 404, { error: '해당 작업을 찾을 수 없습니다' })
          return
        }
        json(res, 200, job)
        return
      }

      if (pathname.startsWith('/output/') && req.method === 'GET') {
        await serveVideo(res, outDir, pathname.slice('/output/'.length), req.headers.range)
        return
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      json(res, 400, { error: describeError(err, config) })
    }
  }
}
