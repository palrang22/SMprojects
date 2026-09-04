# CLAUDE.md

## 이 프로젝트가 뭔가

**SM Entertainment AI Day 부스**에서 시연할 Google Cloud AI 체험 웹앱.
우리는 GCP MSP 의 **Google Cloud presales** 입장이다.

사용자는 presales 신입이고, **GCP 기능을 폭넓게 써보는 것 자체가 목적 중 하나다.**
"가장 빠른 길"보다 GCP 네이티브 방식(Vertex AI, GCS, IAP, Cloud Run)을 우선한다.

체험 3종을 한 웹페이지에 담는다:

| # | 스튜디오 | 라우트 | 모델/API | 강조색 | 상태 |
|---|---|---|---|---|---|
| 01 Video | **Motion Studio** | `/video` | `gemini-omni-1.1-flash-preview` | Google red | 🟡 개발 중 |
| 02 Image | **Look Studio** | `/image` | Virtual Try-On | Google blue | ⬜ 자리표시자 |
| 03 Audio | **Voice Studio** | `/audio` | Gemini Live | Google yellow | ⬜ 자리표시자 |

행사일은 **2026-09-14 (월)**. 스튜디오 이름은 시안에서 온 것이니 임의로 바꾸지 말 것.

**하나씩 순서대로** 개발한다. 상세 구현 방식은 대부분 미정 — `PLAN.md` 참고.

### 체험자 · 컨셉 방향

체험자는 **20~30대 SM 엔터 직원**이다. 세 스튜디오 모두 이 층이
**"이런 것도 된다고?"** 하고 놀랄 만한 데모여야 한다. "동작한다"가 아니라
"내 업무/관심사에 이게 꽂힌다"를 목표로 기능을 디벨롭한다.

- **02 Look Studio — 아이돌 무대의상 입어보기.** 인물(샘플 아이돌 사진 또는 웹캠 촬영)에
  무대의상을 합성한다. 샘플 인물 사진은 **저작권·초상권 문제가 없는 아이돌 사진만**
  쓴다 (확보 가능하다고 확인받음). 파일은 `public/samples/` (`README.md` 참고).
  `virtual-try-on-001` 은 상의/하의/원피스만 지원 — 가방·모자·소품은 안 됨.
- **03 Voice Studio — AI 관상가.** 웹캠으로 얼굴을 보여주면 관상가 아주머니 페르소나가
  영상을 보면서 실시간 음성으로 관상을 봐준다 (`PLAN.md` §03). Gemini Live 의 영상+음성
  동시 처리를 그대로 보여주는 컨셉.
- **01 Motion Studio** 도 같은 기준으로 시나리오를 잡을 것.

## 스택 · 명령어

Vite + React 19 + TypeScript, pnpm.

```bash
pnpm dev      # 개발 서버 (API 라우트 포함)
pnpm build    # tsc -b && vite build
pnpm lint     # eslint
```

변경 후에는 `pnpm build`와 `pnpm lint`를 돌려서 통과하는지 확인할 것.

## GCP 설정 (이미 되어 있음 — 다시 만들지 말 것)

```
프로젝트  kktae-demo                   (2026-08-27 프로젝트 변경 — 이전 gcp-a-presales-ge-20260521 아님)
계정      kseungh@mz.co.kr             (회사 계정. 개인 Gmail 아님)
인증      Vertex AI + ADC              (API 키 아님)
리전      global                       (Vertex 호출 리전. Cloud Run 배포 리전(asia-northeast3)과 다름)
버킷      gs://smproject-sh/output
```

- 인증은 `gcloud auth application-default login` + `gcloud auth application-default set-quota-project kktae-demo` 로 이미 잡혀 있다.
- 버킷은 이 프로젝트 안에 새로 만든 것. **30일 자동 삭제 정책을 걸어야 한다** (아직 미확인).
- ⚠️ **`kktae-demo`는 전용 프로젝트가 아니라 선배의 기존 프로젝트다.** 이전 프로젝트
  (`gcp-a-presales-ge-20260521`) 때와 같은 원칙 적용: **우리가 만든 리소스(서비스 계정
  `smprojects-*`, 버킷 `smproject-sh`)만 건드리고, 이미 있던 다른 리소스는 절대 만지지 말 것.**
  IAM 정책 조회(`add-iam-policy-binding` 실행 시 뜬 기존 조건부 바인딩 등)로 다른 용도
  (`cloudbuild-connection-setup`, `Create Studio Asset Metadata DB` 등)가 이미 돌고 있는 게
  확인됨. 예산·쿼터도 선배 프로젝트 계정으로 잡히니 비용 지출 전 확인 원칙은 그대로 유지.

## 접근 제어 — IAP

**`@mz.co.kr` 도메인 계정만 진입 가능.** 주소를 치면 바로 구글 로그인 화면이 떠야 한다.
로그인한 사람은 기능을 자유롭게 쓸 수 있다.

- **Cloud Run 에 IAP 를 직접** 건다 (2026 GA. 로드밸런서 불필요)
- 허용 대상: 주 구성원 `domain:mz.co.kr` + 역할 `roles/iap.httpsResourceAccessor`
- 앱 안에서 로그인 기능을 따로 만들지 말 것. IAP 가 이미 인증을 끝낸다.

IAP 통과 후 요청에 붙는 헤더:

```
X-Goog-Authenticated-User-Email : accounts.google.com:kseungh@mz.co.kr
X-Goog-Authenticated-User-Id    : accounts.google.com:<id>
X-Goog-IAP-JWT-Assertion        : <서명된 JWT>
```

앞의 두 개는 스푸핑 가능하다. **신뢰해야 할 것은 `X-Goog-IAP-JWT-Assertion` 서명 검증 결과다.**
사용자별 호출 상한·로깅에 이 신원을 쓴다.

> **GCP 콘솔 작업은 사용자가 직접 한다.** 코드/CLI 로 리소스를 만들지 말고,
> 콘솔에서 뭘 눌러야 하는지 절차를 알려줄 것.

## 아키텍처

```
server/config.ts        인증 방식 판별 (Vertex AI ↔ API 키, 환경변수 한 줄로 전환)
server/omni.ts          Gemini SDK 래퍼. GCS/Files API 다운로드까지
server/api.ts           개발용 API 라우트 + 인메모리 잡 스토어
vite.config.ts          위 미들웨어를 dev 서버에 마운트 (apply: 'serve')

src/App.tsx             라우터 + 셸. 허브에서만 .main-split (2열) 적용
src/components/Rail.tsx 좌측 64px 레일 (NavLink 활성 상태)
src/components/Icons.tsx 시안에서 가져온 라인 아이콘
src/routes/Hub.tsx      랜딩 — 히어로 + 스튜디오 3개 카드
src/routes/MotionStudio.tsx  체험 1 (Omni Flash)
src/routes/ComingSoon.tsx    체험 2·3 자리표시자
src/styles/hub.css      시안 CSS. 디자인 토큰(:root)이 여기 있다
src/styles/studio.css   스튜디오 UI. 위 토큰으로 재매핑해서 톤을 맞춘다

public/                 로고 SVG (SM CI, Google Cloud). 절대경로로 참조
docs/design/            원본 HTML 시안 (빌드 미포함)
docs/GCP-INFRA-GUIDE.md 선배 프로젝트 인프라 가이드
```

### 디자인 시스템

`src/styles/hub.css` 의 `:root` 가 단일 소스다. 색을 새로 만들지 말고 토큰을 쓸 것.

```
--ink / --ink-2 / --ink-3   배경 계열 (스튜디오 블랙)
--paper / --fog / --fog-2   텍스트 계열
--line / --line-2           경계선
--g-blue --g-red --g-yellow --g-green   Google 브랜드 색. 모듈당 하나씩만 쓴다
```

`.reveal.d1~d6` 는 순차 등장 애니메이션. JS 없이 CSS 만으로 동작하고
`prefers-reduced-motion` 대응도 들어 있다.

### 잡(job) 구조를 쓰는 이유

영상 생성은 수 분짜리 LRO다. HTTP 요청 하나로 기다리면 타임아웃에 걸린다.
`POST /api/generate` 는 즉시 `jobId` 만 반환하고 프론트가 `GET /api/jobs/:id` 를 폴링한다.
`docs/GCP-INFRA-GUIDE.md` §1.2 의 패턴. **체험 2·3번도 오래 걸리면 같은 구조로 갈 것.**

### ⚠️ 지금은 배포 불가 상태

`server/api.ts` 는 Vite dev 서버 전용(`apply: 'serve'`)이라 `pnpm build` 결과물에 안 들어간다.
Cloud Run 에 올리려면 **정적 파일과 API 를 함께 서빙하는 실제 서버**가 필요하다.
IAP 는 배포된 서비스에만 걸 수 있으므로 이게 선행 작업이다.

### 인증 모드 전환

`server/config.ts` 가 `GOOGLE_GENAI_USE_VERTEXAI` 를 보고 갈라진다.
호출 코드(`interactions.create(...)`)는 어느 쪽이든 동일하다.
나중에 다른 GCP 프로젝트로 옮겨도 환경변수만 바꾸면 된다.

## 함정 (실제로 겪은 것들)

1. **리전은 `global`.** `us-central1` 같은 단일 리전은 Omni Flash 가 거부한다
   (`global` / `us` / `eu` 만 지원). 메타데이터 조회는 단일 리전에서도 200이 떠서 헷갈린다.
2. **Vertex 에서 `delivery: 'uri'` 는 `gcs_uri` 가 필수다.** API 키 방식은 Files API 가
   대신 받아주지만 Vertex 는 본인 버킷을 요구한다.
3. **API 키를 클라이언트에 노출하지 말 것.** `VITE_` 접두사를 붙이면 번들에 박힌다.
   서버 쪽에서만 읽는다.
4. **Omni 1.1 은 모델 ID 가 인증 모드마다 다르다.** Vertex 는 `gemini-omni-1.1-flash-preview`,
   Gemini API 키는 `gemini-omni-1.1-flash` 다. 블로그·AI Studio 문서에는 후자만 적혀 있어서
   그대로 베끼면 Vertex 에서 404 가 난다. `server/omni.ts` 의 `omniModelFor()` 가 갈라준다.
5. **SDK 타입이 공식 문서보다 정확하다.** 문서는 `generationConfig.videoConfig` (camelCase)
   라고 써 있지만 실제 타입은 `generation_config.video_config` (snake_case) 다.
   파라미터를 추측하지 말고 `node_modules/@google/genai/dist/genai.d.ts` 를 grep 할 것.
6. **영상 확장에 `previous_interaction_id` 를 쓰지 말 것.** Vertex 는 이 값을 에러 없이
   무시해서, 앞 영상과 무관한 새 영상이 나오는데도 정상처럼 보인다 (문서의 멀티턴 확장
   예시는 Gemini API 키 기준이다). 앞 영상의 `gs://` 를 `document` 입력으로 직접 넣어야
   한다. 확인은 응답 `usage.input_tokens_by_modality` 에 `video` 가 잡히는지로 한다.

## 비용 — 중요

**회사 결제 계정으로 청구된다.** 사용자는 비용에 민감하고, 불필요한 지출을 하지 말라는
지시를 받은 상태다.

- Omni 1.1 Flash: 해상도별 출력 토큰이 다르다 (360p 1,931 / 720p 5,792 / 1080p 8,688 / 4k 17,376 토큰/초).
  720p 기준 **1초당 $0.10** (5초 = $0.50), 1080p 는 그 1.5배.
  UI 는 360p·720p·1080p 를 노출한다 — 4k 는 부스에서 비용이 튀므로 열지 않았다.
  360p 는 초안·테스트용으로 유용하다 (720p 의 약 1/3).
- 실제 생성 호출을 하기 전에 사용자에게 확인받을 것. 테스트로 임의 생성 금지.
- 설정 확인·메타데이터 조회·타입체크는 무료. 여기까지는 자유롭게 해도 된다.
- 부스는 방문자가 반복해서 누르는 환경이다. **호출 상한과 킬 스위치가 필수**
  (`docs/GCP-INFRA-GUIDE.md` §2.7, §10.2, §10.3).

## 작업 스타일

- 파라미터·API 형태를 **추측하지 말 것.** SDK 타입 정의나 공식 문서로 확인하고 쓴다.
- GCP 리소스를 임의로 만들지 말 것. 필요하면 먼저 물어본다.
- 주석과 UI 문구는 한국어. 코드 식별자는 영어.
- 검증하지 않은 것을 "됐다"고 말하지 말 것. 못 돌려본 경로는 그렇다고 명시한다.

## 참고

- `PLAN.md` — 로드맵, 미정 사항, 리스크
- `docs/GCP-INFRA-GUIDE.md` — 선배 프로젝트(`veo-dashboard`)를 분석한 인프라 가이드.
  §2 인증, §5 배포 대상, §9 장시간 작업, §12 안티패턴이 특히 유용하다.
  단 **"선배가 한 것"과 "이렇게 해라"가 섞여 있으니** 구분해서 읽을 것.