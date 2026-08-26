# SMprojects — Gemini Omni Flash 테스트 페이지

`gemini-omni-flash-preview` 로 영상을 생성하고 대화형으로 편집해보는 로컬 테스트 앱입니다.
React 19 + Vite + TypeScript.

## 실행

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

인증은 두 가지 중 하나를 고릅니다. 현재 어떤 방식으로 붙었는지는 dev 서버 시작
로그와 `GET /api/health` 로 확인합니다. (부스 화면에는 노출하지 않습니다.)

**A) Gemini API 키** — 간단, 프로토타입용

```bash
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey
```

**B) Vertex AI** — 키 문자열 없음, GCP 프로젝트 기반

```bash
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=gcp-a-presales-ge-20260521
GOOGLE_CLOUD_LOCATION=us-central1
```

B 는 키 대신 ADC 가 인증합니다. 로컬에서는 한 번만:

```bash
gcloud auth application-default login
```

GCP 위에 배포하면 attach 된 서비스 계정을 자동으로 집으므로 설정이 더 필요 없습니다.
전환은 `GOOGLE_GENAI_USE_VERTEXAI` 한 줄로 끝나고 호출 코드는 바뀌지 않습니다
(`server/config.ts`).

> **비용 주의:** 출력 영상 1초당 약 $0.10 입니다. 5초 영상 한 편이 약 $0.50.
> 화면 우측 하단에 예상 비용이 표시됩니다.

## 기능

- 텍스트 → 영상
- 이미지(최대 3장) + 텍스트 → 영상 (레퍼런스/첫 프레임)
- 비율 16:9 / 9:16, 해상도 720p / 1080p, 길이 3~10초

생성된 mp4 는 `output/` 에 저장됩니다 (git 에서 제외됨).

## 구조

```
server/omni.ts    Gemini SDK 래퍼. Files API 폴링(지수 백오프+jitter)까지 처리
server/api.ts     개발용 API 라우트 + 인메모리 잡 스토어
vite.config.ts    위 미들웨어를 dev 서버에 마운트 (apply: 'serve')
src/App.tsx       UI
```

### 왜 잡(job) 구조인가

영상 생성은 수 분이 걸리는 LRO 라서, HTTP 요청 하나를 붙잡고 기다리면 타임아웃에 걸립니다.
그래서 `POST /api/generate` 는 즉시 `jobId` 만 돌려주고, 프론트가 `GET /api/jobs/:id` 를
2초마다 폴링합니다. `docs/GCP-INFRA-GUIDE.md` §1.2 의 패턴과 동일합니다.

### API 키 취급

키는 **서버 쪽에서만** 읽습니다. `VITE_` 접두사를 붙이면 클라이언트 번들에 그대로
박혀서 브라우저에 노출되므로 절대 쓰지 마세요.

## 배포할 때

`server/api.ts` 는 Vite dev 서버 전용(`apply: 'serve'`)이라 `pnpm build` 결과물에는
포함되지 않습니다. 배포하려면 같은 핸들러를 호스팅 환경의 서버리스 함수로 옮겨야 하고,
인메모리 잡 스토어도 외부 저장소나 큐로 바꿔야 합니다.
선택지 비교는 `docs/GCP-INFRA-GUIDE.md` §2(인증), §5(배포 대상) 참고.
