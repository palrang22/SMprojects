import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  ActivityHandling,
  EndSensitivity,
  Modality,
  StartSensitivity,
  type LiveServerMessage,
  type Session,
} from '@google/genai'
import { WebSocketServer, type WebSocket } from 'ws'
import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'
import { errorDetail } from './errors.ts'
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
const SESSION_MAX_MS = 5 * 60 * 1000

export function liveModelFor(config: OmniConfig): string {
  return config.mode === 'vertex' ? LIVE_MODEL_VERTEX : LIVE_MODEL_APIKEY
}

/**
 * 03 Voice Studio 컨셉 — AI 관상가.
 * 방문자가 웹캠으로 얼굴을 보여주면 실시간으로 관상을 봐준다.
 */
const SYSTEM_INSTRUCTION = [
  '당신은 관상을 봐주는 AI입니다. SM Entertainment AI Day 부스에 있고,',
  '손님 얼굴이 실시간 영상으로, 목소리가 실시간 음성으로 들어옵니다.',
  '',
  '[말투]',
  '- 정중한 존댓말, 차분하고 또렷하게. 손님을 "손님"이라 부른다.',
  '- 한 번에 3~4문장. 화면에 보이는 특징(이마 넓이, 눈썹 숱, 코끝 모양, 입꼬리 방향 등)을',
  '  구체적으로 짚어 재미있게 말한다. "좋습니다"만 반복하는 뻔한 덕담과 피부·성형 조언은 금지.',
  '- 관상학 용어(관록궁·형제궁·전택궁·재백궁·식록·지각)를 뜻풀이와 함께 자연스럽게 쓴다.',
  '',
  '[진행]',
  '이마 → 눈썹·눈 → 코 → 입·턱, 네 부위를 순서대로 한 번씩 본다.',
  '한 부위를 볼 때: 그 부위가 뭘 뜻하는지 한 문장으로 말하고, 자세를 청하고',
  '(예: "머리를 넘겨 이마를 보여주세요"), 가벼운 질문을 하나 던진 뒤 손님 답을 기다린다.',
  '손님이 답하면 그 부위를 2~3문장으로 읽어주고, 곧바로 이어서 다음 부위로 안내한다.',
  '손님이 "다음"이라고 말하기를 기다리지 않는다.',
  '',
  '[반복 금지 — 매우 중요]',
  '이미 읽은 부위는 두 번 읽지 않는다. 방금 한 말을 다시 하지 않는다.',
  '손님 답이 짧거나 부실해도 다시 캐묻지 말고, 보이는 대로 읽고 다음 부위로 넘어간다.',
  '진행이 꼬이면 남은 부위는 건너뛰고 바로 총평으로 간다.',
  '',
  '[돈 이야기] 재물운·재정·돈 이야기는 오직 코(재백궁)를 볼 때만. 눈에서는 가정·집안·심성만 본다.',
  '',
  '[음성]',
  '전체 대화에서 한두 번, 손님 목소리 울림·톤을 관상 관점에서 짧게 평한다. 표현은 매번 바꾼다.',
  '입·턱을 보기 직전에 한 번 "SM 대박나자, 하고 크게 외쳐보세요" 하고 그 울림을 평한다.',
  '',
  '[마무리]',
  '네 부위를 다 보면 "총평을 원하시면 말씀해주세요." 하고 다음 발화에 "총평입니다" 하고 종합 3~4문장 + 올해 조심할 점 하나를 말한다.',
  '그 뒤에는 관상을 처음부터 다시 시작하지 않고, 손님이 더 물으면 그것만 답한다.',
  '',
  '[금지] 정치·종교·건강 진단·수명·불행 예언은 피한다. 재미로 보는 것이다.',
].join('\n')

/** 목소리 — 차분한 톤. 마음에 안 들면 바꿀 것 (voice 목록 30종) */
const VOICE_NAME = 'Gacrux'

type ClientMessage =
  | { type: 'audio'; data: string }
  | { type: 'audioStreamEnd' }
  | { type: 'video'; data: string }
  | { type: 'text'; text: string }

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

  // AI 발화 자막은 일부러 내보내지 않는다 — 화면에 뜨면 방문자가 미리 읽고
  // 다음 대사를 예측해 미리 답하게 되고, 그게 barge-in 반복 문제를 키운다.
  // 손님이 한 말(inputTranscription)만 자막으로 보여준다.
  const heard = content.inputTranscription?.text
  if (heard) send(browser, { type: 'transcript', role: 'user', text: heard })

  if (content.turnComplete) send(browser, { type: 'turnComplete' })
}

async function handleConnection(config: OmniConfig, browser: WebSocket): Promise<void> {
  let session: Session | null = null
  let closed = false

  const shutdown = (reason?: string, kind: 'error' | 'ended' = 'error', detail?: string) => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    if (reason) send(browser, { type: kind, message: reason, detail })
    try {
      session?.close()
    } catch {
      // 이미 닫혔으면 무시
    }
    browser.close()
  }

  // 시간 초과 시 정상 종료 (오류 아님) — 부스 비용·대기열 방어 (SESSION_MAX_MS)
  const timer = setTimeout(
    () => shutdown('세션이 종료되었습니다. 다시 보려면 버튼을 눌러 주세요.', 'ended'),
    SESSION_MAX_MS,
  )

  // 선제 발화 없음 — 손님이 "안녕하세요" 하고 먼저 말을 건다 (연결 텀 동안 자연스럽게 말이 나온다)

  try {
    const ai = createClient(config)
    session = await ai.live.connect({
      model: liveModelFor(config),
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        inputAudioTranscription: {},
        // 요청은 하되(안정성), 클라로 전달만 안 한다 — forwardServerMessage 참고
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          languageCode: 'ko-KR',
        },
        realtimeInputConfig: {
          // 손님 목소리(또는 스피커 에코·주변 소음)가 감지돼도 AI 발화를 자르지 않는다.
          // 부스·이어폰 없는 환경에서 에코로 AI가 계속 끊기는 문제를 막는다.
          activityHandling: ActivityHandling.NO_INTERRUPTION,
          // 음성 감지 민감도는 낮게 — 손님 턴 시작/종료 판정만 느슨하게
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 300,
            silenceDurationMs: 1200,
          },
        },
      },
      callbacks: {
        onopen: () => send(browser, { type: 'ready' }),
        onmessage: (message: LiveServerMessage) => forwardServerMessage(browser, message),
        // ErrorEvent 는 Node 전역 타입이 아니라서 SDK 콜백 시그니처에서 추론시킨다
        onerror: (e) => shutdown(e.message || 'Live API 오류', 'error', errorDetail(e)),
        onclose: () => shutdown(),
      },
    })
  } catch (err) {
    shutdown(err instanceof Error ? err.message : String(err), 'error', errorDetail(err))
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
    } else if (msg.type === 'video') {
      // 웹캠 프레임 (JPEG). 음성 대화와 병행 — 활동 감지에는 잡히지 않는다
      session.sendRealtimeInput({
        video: { data: msg.data, mimeType: 'image/jpeg' },
      })
    } else if (msg.type === 'text') {
      // 채팅 입력 — 하나의 완결된 턴으로 넣어 응답을 유도한다
      const text = msg.text.trim()
      if (text) session.sendClientContent({ turns: text, turnComplete: true })
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
