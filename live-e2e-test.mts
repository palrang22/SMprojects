/**
 * 03 Voice Studio 엔드투엔드 드라이브.
 * 브라우저 대신 WS 로 붙어서, 손님 역할을 채팅 턴으로 대신한다.
 * 웹캠 대신 샘플 사진을 프레임으로 밀어넣는다.
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const SP = '/private/tmp/claude-501/-Users-palrang22-Documents-Projects-SMprojects/372dccef-6e2b-4243-a7b1-e2f24a081db2/scratchpad'
const frame = readFileSync(`${SP}/w.jpg`).toString('base64')

/** 손님 대사. null = 일부러 침묵 (넛지가 도는지 본다) */
const GUEST: (string | null)[] = ['네, 보여드렸어요.', '네 보세요.', null, 'SM 대박나자!', '제 연애운은 어때요?']

const ws = new WebSocket('ws://localhost:5199/api/live')
const t0 = Date.now()
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

let turn = 0
let line = ''
let audioBytes = 0
let guestIndex = 0
let frameTimer: NodeJS.Timeout | null = null

const done = () => {
  if (frameTimer) clearInterval(frameTimer)
  ws.close()
  console.log(`\n총 ${at()} / 모델 턴 ${turn}회`)
  setTimeout(() => process.exit(0), 500)
}

ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw))

  if (msg.type === 'ready') {
    console.log(`[${at()}] ready — 프레임 전송 시작 (손님은 아직 말 안 함)`)
    const send = () => ws.send(JSON.stringify({ type: 'video', data: frame }))
    send()
    frameTimer = setInterval(send, 2000)
    return
  }
  if (msg.type === 'audio') { audioBytes += Buffer.from(msg.data, 'base64').length; return }
  if (msg.type === 'transcript' && msg.role === 'model') { line += msg.text; return }

  if (msg.type === 'turnComplete') {
    turn += 1
    console.log(`\n──[${at()}] 관상가 턴 ${turn} (음성 ${(audioBytes / 48000).toFixed(1)}초)`)
    console.log(line.trim())

    // 실제 클라이언트처럼 "재생이 끝난 뒤" playbackDone 을 보낸다 (24kHz 16bit = 48000 B/s)
    const playMs = (audioBytes / 48000) * 1000 + 250
    line = ''
    audioBytes = 0

    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'playbackDone' }))

      const say = GUEST[guestIndex++]
      if (say === undefined) { done(); return }
      if (say === null) { console.log(`   …손님 침묵 (넛지가 도는지 확인)`); return }
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        console.log(`   손님> ${say}`)
        ws.send(JSON.stringify({ type: 'text', text: say }))
      }, 1500)
    }, playMs)
    return
  }
  if (msg.type === 'error' || msg.type === 'ended') { console.log(`[${at()}] ${msg.type}: ${msg.message}`); done() }
})

ws.on('open', () => console.log(`[${at()}] WS 연결`))
ws.on('error', (e) => { console.log('WS 오류', e.message); process.exit(1) })
setTimeout(done, 200000)
