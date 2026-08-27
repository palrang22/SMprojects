import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Modality, type LiveServerMessage, type Session } from '@google/genai'
import { WebSocketServer, type WebSocket } from 'ws'
import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'
import { getIapIdentity } from './iap.ts'

/**
 * 03 Voice Studio — Gemini Live 프록시.
 *
 * 브라우저가 Live API 에 직접 붙을 수 없다. Vertex 는 ADC 로 인증하는데
 * 그 자격증명을 브라우저에 내려보낼 수 없기 때문이다. 그래서 서버가 가운데 선다:
 *
 *   브라우저 ⇄ (우리 WS) ⇄ 서버 ⇄ (ai.live.connect) ⇄ Gemini Live
 *
 * 오디오 포맷은 Live API 규격 그대로다.
 *   입력  16kHz  16-bit PCM mono
 *   출력  24kHz  16-bit PCM mono
 */

/**
 * SDK 예제(genai.d.ts)에는 'gemini-2.0-flash-live-preview-04-09' 로 적혀 있지만
 * 그 모델은 이 프로젝트에 존재하지 않는다 (global·us-central1 모두 404).
 * 퍼블리셔 모델 메타데이터로 실재를 확인한 값은 아래다 — 2026-08-26 기준 GA,
 * global 과 us-central1 양쪽에 있다.
 */
export const LIVE_MODEL_VERTEX = 'gemini-live-2.5-flash'
export const LIVE_MODEL_APIKEY = 'gemini-live-2.5-flash'

export const LIVE_PATH = '/api/live'

/** 부스 비용 방어 — 한 세션이 무한정 열려 있지 않게 한다 */
const SESSION_MAX_MS = 3 * 60 * 1000

export function liveModelFor(config: OmniConfig): string {
  return config.mode === 'vertex' ? LIVE_MODEL_VERTEX : LIVE_MODEL_APIKEY
}

const SYSTEM_INSTRUCTION =
  '당신은 SM Entertainment AI Day 부스의 안내 도우미입니다. ' +
  '방문자와 한국어로 짧고 친근하게 대화하세요. 답변은 2~3문장을 넘기지 마세요.'

type ClientMessage =
  | { type: 'audio'; data: string }
  | { type: 'audioStreamEnd' }

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

/** 모델이 보낸 메시지를 브라우저가 쓰기 좋은 형태로 추려서 넘긴다 */
function forwardServerMessage(browser: WebSocket, message: LiveServerMessage): void {
  const content = message.serverContent
  if (!content) return

  // 사용자가 끼어들면 브라우저가 재생 큐를 비워야 한다
  if (content.interrupted) send(browser, { type: 'interrupted' })

  for (const part of content.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data
    if (data) send(browser, { type: 'audio', data })
  }

  const transcript = content.outputTranscription?.text
  if (transcript) send(browser, { type: 'transcript', role: 'model', text: transcript })

  const heard = content.inputTranscription?.text
  if (heard) send(browser, { type: 'transcript', role: 'user', text: heard })

  if (content.turnComplete) send(browser, { type: 'turnComplete' })
}

async function handleConnection(config: OmniConfig, browser: WebSocket): Promise<void> {
  let session: Session | null = null
  let closed = false

  const shutdown = (reason?: string) => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    if (reason) send(browser, { type: 'error', message: reason })
    try {
      session?.close()
    } catch {
      // 이미 닫혔으면 무시
    }
    browser.close()
  }

  const timer = setTimeout(
    () => shutdown('세션 시간이 끝났습니다 (3분). 다시 시작해 주세요.'),
    SESSION_MAX_MS,
  )

  try {
    const ai = createClient(config)
    session = await ai.live.connect({
      model: liveModelFor(config),
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => send(browser, { type: 'ready' }),
        onmessage: (message: LiveServerMessage) => forwardServerMessage(browser, message),
        // ErrorEvent 는 Node 전역 타입이 아니라서 SDK 콜백 시그니처에서 추론시킨다
        onerror: (e) => shutdown(e.message || 'Live API 오류'),
        onclose: () => shutdown(),
      },
    })
  } catch (err) {
    shutdown(err instanceof Error ? err.message : String(err))
    return
  }

  browser.on('message', (raw) => {
    if (closed || !session) return
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw)) as ClientMessage
    } catch {
      return
    }

    if (msg.type === 'audio') {
      session.sendRealtimeInput({
        audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
      })
    } else if (msg.type === 'audioStreamEnd') {
      session.sendRealtimeInput({ audioStreamEnd: true })
    }
  })

  browser.on('close', () => shutdown())
  browser.on('error', () => shutdown())
}

/**
 * HTTP 서버의 upgrade 이벤트에 붙인다.
 *
 * Vite dev 서버는 HMR 용 WebSocket 을 이미 쓰고 있으므로 `noServer: true` 로 두고
 * 우리 경로(/api/live)로 온 것만 가로챈다. 나머지는 건드리지 않고 흘려보낸다.
 */
export function attachLiveServer(
  httpServer: { on(event: 'upgrade', cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void },
  config: OmniConfig,
): void {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname !== LIVE_PATH) return

    if (config.mode === 'unconfigured') {
      socket.destroy()
      return
    }

    // 로깅용 — 차단 안 함. IAP 가 WS 업그레이드 요청에 JWT 헤더를 안 붙이는 알려진 버그가
    // 있어서(Google Issue Tracker #238496778) 여기서 막으면 정상 사용자도 끊길 수 있다.
    void getIapIdentity(req.headers).then((identity) => {
      console.log(`[iap] WS ${LIVE_PATH} ← ${identity?.email ?? '(미검증)'}`)
    })

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(config, ws)
    })
  })
}
