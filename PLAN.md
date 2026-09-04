# PLAN.md — SM AI Day 부스

> 최종 갱신: 2026-08-27 (프로젝트 `kktae-demo` 이전 + IAM 권한 대기)
> **마감: 2026-08-27 (목) 오전 — 3개 스튜디오 + Cloud Run 배포 + IAP**
> (부스 행사는 2026-09-14 (월). 내일 오전은 그 전 중간 마감이다.)

## 전제

사용자가 "3개 전부"로 결정했고, **콘솔 작업은 내일 오전에 하기로** 다시 정했다.
그래서 오늘 밤은 콘솔이 필요 없는 코드만 진행한다 (02 → 03 → 배포 코드).
배포 자체는 내일 아침 콘솔 설정 직후 `gcloud run deploy` 한 번으로 끝나게 준비해둔다.

~~**컷라인:** 03 이 실호출에서 무너지면 자리표시자로 되돌린다~~
→ **3개 모두 실호출 성공. 컷라인 해제.** (`ComingSoon.tsx` 는 미사용이지만 남겨둠)

## UI 정리 (2026-08-26)

- **다크/라이트 테마 토글** — 레일 하단 태양/달 아이콘.
  `data-theme` + `localStorage`, `index.html` 인라인 스크립트로 첫 페인트 번쩍임 방지.
  라이트 팔레트는 `hub.css` 의 `:root[data-theme="light"]` 한 곳에만 있다.
  Google 강조색은 밝은 배경용 진한 변형으로 교체 (#1A73E8 / #D93025 / #E37400 / #1E8E3E)
- **관리자 메뉴 분리** — 레일에 슬라이더 아이콘 추가 → `/settings`.
  원래 이 자리의 태양 아이콘이 테마 토글로 오해받아서 실제 토글로 바꾸고 관리자는 새 메뉴로
- **관리자 비밀번호 게이트** (`aprk12!`) — ⚠️ 아래 "알려진 한계" 참고
- 허브 날짜에서 `PM` 제거 → `2026.09.14 / Mon`
- **스튜디오 3종에서 인증 상태 표시줄 제거.** 개발용 표시였는데
  `Vertex AI · <프로젝트 ID> · global · gs://<버킷>` 이 부스 방문자에게 그대로 보였다.
  인증 상태는 dev 로그와 `GET /api/health` 로만 확인한다

## 체험 3종

| # | 체험 | 진입점 | 구조 | 상태 |
|---|---|---|---|---|
| 01 | **Motion Studio** (`/video`) | `ai.interactions.create()` | LRO + 잡 폴링 | 🟢 실호출 성공 |
| 02 | **Look Studio** (`/image`) | `ai.models.recontextImage()` | 동기 호출 | 🟢 실호출 성공 (2026-08-26) |
| 03 | **Voice Studio** (`/audio`) | `ai.live.connect()` | WebSocket 프록시 | 🟢 실호출 성공 (2026-08-26) |

### 모델 ID · 리전 — 실측 검증 완료 (2026-08-26)

SDK 타입만 믿지 않고 **퍼블리셔 모델 메타데이터를 직접 조회**해서 실재를 확인했다.
(ADC + `x-goog-user-project` 헤더로 GET. 무료)

| 체험 | 모델 ID | 리전 | 상태 |
|---|---|---|---|
| 01 | `gemini-omni-1.1-flash-preview` | **global** | 모델 ID 확인 완료, 실호출 미검증 |
| 02 | `virtual-try-on-001` | **us-central1 전용** | GA · 메타데이터 200 |
| 03 | `gemini-live-2.5-flash` | global · us-central1 | GA · 메타데이터 200 |

**검증에서 두 가지가 뒤집혔다:**

1. **02 는 `global` 에 없다.** global·asia-northeast3 모두 404, us-central1 만 200.
   01 은 반대로 global 을 요구하므로 **두 모델의 리전이 서로 다르다.**
   → `createClient(config, locationOverride)` 로 Try-On 만 us-central1 을 쓰게 고쳤다.
2. **03 의 SDK 예제 모델 ID 는 존재하지 않는다.**
   `gemini-2.0-flash-live-preview-04-09` 는 global·us-central1 모두 404.
   실재하는 것은 `gemini-live-2.5-flash` (GA). → 교정 완료.

02 의 페이로드 형태도 SDK 런타임(`index.mjs`)에서 확인했다:
`{model}:predict` 에 `instances[0].personImage.image` + `instances[0].productImages`.
**단 `recontextImage` 는 Vertex 전용이다** — API 키 모드에서는 예외를 던진다.

---

# 진행 상황

## S1 — 02 Look Studio ✅ UI 완료

- [x] `server/tryon.ts` — `recontextImage` 래퍼. 동기 호출이라 잡 스토어를 쓰지 않는다
- [x] `POST /api/tryon` — 인물 + 의상 이미지 → 합성 이미지 (base64 인라인 응답)
- [x] `src/routes/LookStudio.tsx` — 업로드 슬롯 2개, 결과 + 다운로드. 강조색 Google blue
- [x] 스튜디오 공통 셸 리팩터 — `.omni` → `.studio` + `.video/.image/.audio` 강조색 분기
- [x] `src/lib/image.ts` — 이미지 읽기 유틸을 01·02 가 공유
- [x] **실제 호출 검증 성공** (2026-08-26, 사용자 확인)
- [x] Try-On 전용 리전 분리 — `us-central1` (global 에 모델이 없다)
- [ ] 의상 프리셋 (사용자가 이미지 제공하면)

## S2 — 03 Voice Studio ✅ UI 완료

- [x] `server/live.ts` — 브라우저 ⇄ 우리 WS ⇄ `ai.live.connect()` 프록시.
      브라우저에 ADC 를 줄 수 없어서 서버가 가운데 서야 한다
- [x] `src/lib/audio.ts` — 16kHz PCM 캡처(AudioWorklet) / 24kHz 재생 큐
- [x] `src/routes/VoiceStudio.tsx` — 마이크 버튼 + 실시간 자막. 강조색 Google yellow
- [x] 세션 3분 자동 종료 (비용 방어)
- [x] `ws` 의존성 추가 — SDK 의 의존성이지만 pnpm 엄격 레이아웃이라 빌려 쓸 수 없다
- [x] 모델 ID 교정 — `gemini-live-2.5-flash`
- [x] **실제 음성 세션 검증 성공** (2026-08-26, 사용자 확인)

## S3 — 배포 코드 ✅ (콘솔 불필요분 완료)

- [x] `server/index.ts` — 정적 `dist/` + API + WS 를 한 프로세스로. `PORT` 존중, `0.0.0.0` 바인딩
- [x] `tsconfig.server.json` — dev 용은 `noEmit` 이라 배포용 emit 설정을 따로 뒀다.
      `rewriteRelativeImportExtensions` 가 `./api.ts` → `./api.js` 로 바꿔준다
- [x] `/health` (GET + HEAD)
- [x] SPA 폴백 — `/video` `/image` `/audio` 가 `index.html` 로 떨어진다
- [x] 정적 자산 캐시 헤더 (`/assets/*` 는 immutable, index.html 은 no-cache)
- [x] 경로 탈출 방어
- [x] `Dockerfile` (멀티스테이지) + `.dockerignore`
- [x] `pnpm start` / `pnpm build:server` 스크립트
- [x] **Vite 없이 컴파일된 서버로 전 라우트 검증** (포트 8099, 실제 응답 확인)
- [x] `server/iap.ts` — IAP JWT(`X-Goog-IAP-JWT-Assertion`) 서명 검증 유틸 (`jose`).
      `IAP_AUDIENCE` 없으면 no-op(로컬). 지금은 라우트 차단 없이 로깅만 — 실제 인가 판단은
      킬스위치/레이트리밋 붙일 때(S5). audience 값은 배포 후 Cloud Run 서비스명·프로젝트
      번호가 확정돼야 나온다 (`docs/GCP-INFRA-GUIDE.md` §2.7.1)
- [ ] ⚠️ **컨테이너 빌드는 미검증** — 로컬에 Docker 가 없다.
      Dockerfile 자체는 내일 Cloud Build 에서 처음 돌아간다
- [ ] `/api/live` WS 를 프로덕션 서버에서 미검증 (연결하면 과금되는 세션이 열린다).
      dev 에서 동작한 것과 같은 `attachLiveServer` 이지만 마운트 지점이 다르다

## S4 — 콘솔 + 배포 (사용자)

**나는 GCP 리소스를 만들지 않는다. 아래는 사용자가 직접.**

> ⚠️ **2026-08-27 프로젝트 변경**: `gcp-a-presales-ge-20260521` → **`kktae-demo`**로 이전.
> `kktae-demo`는 전용 프로젝트가 아니라 **선배의 기존 프로젝트** (다른 용도 IAM 바인딩
> `cloudbuild-connection-setup`, `Create Studio Asset Metadata DB` 등이 이미 존재 확인됨).
> 우리가 만든 리소스만 건드릴 것 (`CLAUDE.md` 참고).
>
> **현재 막힌 지점**: 사용자 계정(`kseungh@mz.co.kr`)이 `kktae-demo`에서 **Editor 권한뿐**이라
> `setIamPolicy`가 거부됨 (`add-iam-policy-binding` 실패). 선배가 바빠서 **관리자 권한을
> 나중에 부여하기로 함** — 그때까지 아래 2번(IAM 바인딩)은 대기. 서비스 계정 생성 자체는
> 완료됨 (`smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com`).
> 대기 중에도 로컬 `pnpm dev`는 가능 — 로컬은 서비스 계정이 아니라 사용자 ADC로 호출하고
> Editor 권한이면 Vertex AI 호출 자체는 막히지 않는다.

1. **API 활성화** — Cloud Run Admin, Artifact Registry, Cloud Build, **Identity-Aware Proxy** ✅ 완료
2. **서비스 계정** 생성 → Cloud Run 에 attach. 키 파일 만들지 말 것 (ADC)
   - [x] 생성 완료: `smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com`
   - [ ] `roles/aiplatform.user` ← **관리자 권한 받으면 재시도** (`--condition=None` 붙일 것,
         프로젝트에 조건부 바인딩이 있어서 안 붙이면 대화형 프롬프트 뜸)
   - [ ] 버킷 `smproject-sh` 에 `roles/storage.objectAdmin` ← 마찬가지로 대기
   - [ ] `roles/iam.serviceAccountTokenCreator` (자기 자신 대상, self-bind) ← **QR 다운로드
         (서명 URL) 기능에 필요해서 추가됨.** 이게 없으면 `server/gcs.ts`의
         `createSignedUrl`이 계속 null 을 돌려주고, 결과 카드의 "QR로 저장" 버튼이 아예
         안 뜬다 (에러는 안 남, 그냥 기능만 조용히 빠짐). 명령어:
         ```
         gcloud iam service-accounts add-iam-policy-binding \
           smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com \
           --member="serviceAccount:smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com" \
           --role="roles/iam.serviceAccountTokenCreator" --project=kktae-demo
         ```
3. **OAuth 동의 화면** — 내부(Internal). IAP 켜기의 선행 조건. ← 다음 순서
4. 리전: Cloud Run 은 `asia-northeast3` (서울).
   ※ Vertex 호출 리전(`global`)과 무관하다. 헷갈리지 말 것
5. **배포** ✅ 완료 (2026-08-27)
   - 서비스명 `smprojects-sh` (⚠️ "omni"로 지을 뻔했다가 두 번째로 지적받음 — 이 앱은
     세 스튜디오 전부를 다루니 특정 모델 코드네임을 쓰지 말 것. `smprojects-ai-runner`
     서비스 계정 때도 같은 지적 받았었다)
   - URL: `https://smprojects-sh-264172533638.asia-northeast3.run.app`
     (`--no-allow-unauthenticated`라 IAP 켜기 전까진 브라우저로 못 들어간다 — 정상)
   - ⚠️ **PowerShell 함정**: `--set-env-vars`에 따옴표 없이 콤마로 구분된 값을 넘기면
     PowerShell이 콤마를 배열 연산자로 해석해서 값이 깨진다(공백으로 이어붙여짐).
     **반드시 전체를 따옴표로 감쌀 것**: `--set-env-vars "K1=v1,K2=v2,..."`
   - 프로젝트 번호 `264172533638` — IAM 정책의 서비스 에이전트 계정명에서 확인 가능,
     `gcloud projects describe` 안 돌려도 됨
6. **IAP 켜기 + `domain:mz.co.kr` 허용** ← 그다음 순서
7. ~~JWT(`X-Goog-IAP-JWT-Assertion`) 서명 검증 ← 코드, 배포 후~~
   → **코드는 준비됨** (`server/iap.ts`). 배포 후 `IAP_AUDIENCE` 값만 채워 넣으면 된다.
   앞의 두 헤더는 스푸핑 가능하다

### 배포 시 같이 처리 — 영상 전달 경로

Cloud Run 파일시스템은 tmpfs(메모리)다. 지금처럼 GCS → 로컬 다운로드 → `/output/` 서빙이면
영상 1편당 ~1.4MB 가 RAM 에 쌓여서 재시작 전까지 안 빠진다.
→ **GCS 서명 URL 로 전환.** 다운로드 단계를 없앤다. 나중 QR 회수와도 이어진다.

## S5 — 마감 점검

- [ ] 최소 안전장치 — 일일 총 호출 상한 + `/settings` 킬 스위치
- [ ] 잡 스토어 TTL — `server/api.ts` 의 `Map` 무한 증가
- [ ] 3개 라우트 전부 실제 URL 에서 한 번씩
- [ ] GCP 콘솔 **예산 알림** ← 사용자

---

## 알려진 한계

**관리자 비밀번호는 보안이 아니다.** `aprk12!` 는 클라이언트 번들에 평문으로 들어간다
(빌드 산출물에서 grep 으로 확인됨). "실수로 들어가는 것"을 막는 덮개일 뿐이다.
진짜 접근 제어는 IAP 도메인 제한이 맡는다.
**킬 스위치를 붙일 때는 반드시 서버에서 IAP 신원을 다시 검사할 것.**

## 막히는 지점 — 사용자 확인 필요

1. **02번 의상 이미지.** Virtual Try-On 은 `productImages` 가 필수다.
   지금은 업로드 슬롯으로만 받는다. 부스에서는 프리셋이 있어야 하니
   `public/` 에 의상 사진을 넣어주면 붙인다.
   SM 아티스트 자산은 허가 리드타임이 있으므로 내일 오전용은 일반 의상 사진으로.
2. **02·03 실호출 검증이 안 됐다.** 둘 다 첫 호출에 비용이 발생한다.
   UI·타입·빌드까지만 확인한 상태다. 진행 전에 확인받겠다.
3. **IAP + WebSocket (03번).** IAP 를 통과하는 WebSocket 은 추가 설정이 필요할 수 있다.
   배포 후에야 드러난다.

## 비용

- 01 Omni 1.1 Flash: 720p 출력 1초당 $0.10 (5초 = $0.50). 1080p 는 약 1.5배, 4k 는 약 3배
- 02 Virtual Try-On: 단가 미확인
- 03 Live: 세션 시간 과금 → 3분 자동 종료를 걸어뒀다
- **실제 생성 호출 전에 매번 확인받는다.** 설정 확인·타입체크는 무료

---

## 9/14 부스 행사까지 (내일 오전 마감 이후)

- [ ] 사용자별 레이트 리밋 (IAP 신원 기준) — 부스는 방문자가 반복해서 누른다
- [x] 결과물 회수 — 서명 URL + QR 코드. **코드는 완료** (`server/gcs.ts`,
      `src/components/DownloadQr.tsx`, 01·02 결과 카드의 "QR로 저장" 버튼).
      로컬에서 팝오버·QR 렌더링은 mock 으로 확인함. **실제 서명 URL 동작은 미검증** —
      `roles/iam.serviceAccountTokenCreator` 권한 확보 + 배포 후 확인 필요 (S4 참고)
- [ ] 실패·타임아웃 시 방문자용 화면 (지금은 SDK 에러 문자열이 그대로 노출된다)
- [ ] 부스 환경 대응 — 화면 크기, 터치 입력, 유휴 상태 자동 복귀
- [ ] 부스 소음 환경의 음성 입력 (03) — 헤드셋? 지향성 마이크? **하드웨어 조달 리드타임**
- [ ] 네트워크 폴백 — 사전 생성 샘플
- [ ] preview 모델 가용성 행사 직전 재확인
- [ ] 02 아이돌 샘플 인물 사진 확보 (저작권·초상권 무관한 것) + 무대의상 이미지 소스
- [ ] 03 Voice Studio 컨셉 확정 → `systemInstruction` 작성 (「체험 컨셉」 참고)
- [ ] 담당자 확인: 부스 기기 대수, 대기열 필요 여부, 현장 네트워크

## 확정 사항

| 항목 | 결정 |
|---|---|
| 배포 | Cloud Run + IAP 직접 연결 (`domain:mz.co.kr`) |
| 인증 | Vertex AI + ADC. 앱 자체 로그인은 만들지 않는다 |
| 프로젝트 | `kktae-demo` (2026-08-27 변경 — 이전 `gcp-a-presales-ge-20260521`에서 이전) |
| 저장소 | `gs://smproject-sh/output` (30일 자동 삭제 — 새 버킷, lifecycle 설정 재확인 필요) |
| Vertex 리전 | `global` (`us-central1` 등 단일 리전은 Omni Flash 가 거부) |

## 체험 컨셉 (9/14 데모)

체험자 = **20~30대 SM 엔터 직원**. 목표는 "동작한다"가 아니라 이 층이
**"이런 것도 된다고?"** 하게 만드는 것. `CLAUDE.md` 「체험자 · 컨셉 방향」 참고.

### 02 Look Studio — 아이돌 무대의상 입어보기 (결정, 2026-08-28)

- 인물: 샘플 아이돌 사진(3×2 팝업) 또는 웹캠 촬영. 의상: 무대의상 업로드.
- 샘플 인물은 **저작권·초상권 문제 없는 아이돌 사진만.** 확보 가능 확인받음.
  `public/samples/{woman,man}_{1..3}.png` (`public/samples/README.md`).
- `virtual-try-on-001` 은 상의/하의/원피스만. 가방·모자·소품 불가
  (Google Shopping/Merchant 도움말에 accessories 명시적 제외 — Vertex API 문서엔 목록 없음).
- 결과 → "이 사진으로 계속하기" 로 체이닝 (상의 → 하의 순차 착장).
- 무대의상 이미지 확보 방법 미정 (SM 자산 허가? 자체 촬영? 무료 소스?).

### 03 Voice Studio — AI 관상가 (결정, 2026-08-28)

웹캠으로 얼굴을 보여주면 관상가 아주머니 페르소나가 **영상을 보면서 실시간 음성 대화**로
관상을 봐준다. Gemini Live 만의 강점(실시간 영상+음성 동시, 자연스러운 끼어들기)을
그대로 시연하는 컨셉. `gemini-live-2.5-flash` 는 파인튜닝 불가 — 전부 세션 설정으로.

구현됨 (`server/live.ts`, `src/routes/VoiceStudio.tsx`, `src/lib/audio.ts`):
- `systemInstruction` — **관상 봐주는 AI** (아줌마 흉내 X — "아이고" 추임새를 남발해서 뺐다).
  정중한 존댓말 + 관상학 한자 용어(관록궁·명궁·형제궁·전택궁·재백궁·식록·지각)를 뜻 풀이와 함께 사용.
  **4단계 스캔**: ① 이마 ② 눈썹·눈 ③ 코 ④ 입·턱. 각 단계 = 부위 뜻 한마디 → 화면 행동 지시 →
  짧은 질문(여기서 멈춤) → 손님 답/동작 → 2~3문장 리딩 → **끊지 말고 바로 다음 단계로 이어감**
  (손님이 "다음" 안 해도. 구버전은 리딩만 하고 턴을 끝내서 매번 "다음은요?" 해야 했음).
  이미 본 부위 재언급 금지. **재물·돈 얘기는 코(재백궁)에서만** (눈 전택궁을 "재산"으로 풀어서
  코랑 중복됐던 것 수정). 리딩은 화면에 보이는 특징 구체적으로, 뻔한 덕담 금지. 음성 평 1~2회.
- ⚠️ **프롬프트 과설계 → 무한 루프 겪음** (2026-08-28): `(a)(b)(c)` 단계 형식 + "리딩만 하고
  끝내지 말고 항상 다음 지시까지" 규칙이 모델 턴을 길게(4~5문장 복합) 만들었고, 손님이
  중간에 답하며 인터럽트하면 그 복합 턴을 처음(이마)부터 재생성 → 같은 말 3번 반복.
  → 프롬프트를 짧고 자연스럽게 재작성. "이미 읽은 부위 두 번 금지 / 방금 한 말 반복 금지 /
  답이 부실해도 캐묻지 말고 넘어감 / 자세 안 보여도 진행 / 꼬이면 총평으로" 명시. 턴 짧게.
- ⚠️ **barge-in 반복의 근본 원인** (2026-08-28): 클라 `PcmPlayer` 가 들어온 오디오 스트림을
  전부 즉시 타임라인에 예약(앞질러 버퍼링) → "손님이 들은 양" ≫ "Gemini가 재생됐다고 추정한 양".
  손님이 끼어들면 Gemini는 자기 턴을 추정치만큼만 남기고 **뒤쪽(다음 부위 안내+질문)을 컨텍스트에서
  삭제** → 손님 답이 "없는 질문"에 대한 답이 되고 → 모델이 그 부분을 재생성 → 반복.
  **AI 발화 자막을 화면에서 뺐다** (`outputAudioTranscription` 요청 안 함, 서버가 model transcript
  미전송): 자막이 보이면 방문자가 미리 읽고 예측 답을 해서 barge-in을 더 유발. 손님 발화 자막만 남김.
  공식 Live 데모 사이트도 AI 자막을 안 보여주는 이유로 추정. 근본 완화는 NO_INTERRUPTION 또는
  푸시투토크 (§ "고칠 수 있는 방향" — 아직 미적용).
- 손님 발화 자막은 `turnComplete` 를 경계로 발화별로 줄을 나눈다 (`newLineRef`).
- ⚠️ **친구 테스트 시 "AI가 말하다 끊김"** (2026-08-28): 본인(조용한 방/이어폰)은 멀쩡한데
  친구는 AI가 자꾸 끊김. 원인 = **스피커→마이크 에코 + 주변 소음**을 Gemini VAD 가 손님 발화로
  잡아 barge-in(기본 `START_OF_ACTIVITY_INTERRUPTS`) → AI 발화 중단. `GAIN=1.8` 이 에코를 키움.
  → `realtimeInputConfig.activityHandling = NO_INTERRUPTION` 로 변경. AI 발화는 어떤 소리에도
  안 끊긴다 (관상가가 리드하는 구성이라 barge-in 불필요).
- **half-duplex** (`VoiceStudio.tsx`): `NO_INTERRUPTION` 은 "안 끊김"이지 "에코를 입력에서 뺌"이
  아니라서, AI 목소리가 스피커→마이크로 돌아가면 유령 입력이 된다. → AI가 **재생 중인 동안**
  마이크 전송을 끊는다(`micOpenRef`). 첫 `audio` 에서 닫고 `audioStreamEnd` 전송,
  `turnComplete` + 재생 꼬리(`player.remainingMs()`) + 250ms 뒤 재개. `turnComplete` 누락 대비
  5초 fallback. 결과: AI 말하는 중 손님이 한 말은 안 들어가고, AI 끝난 뒤 말한 것만 입력됨.
  3→4단계 사이 "SM 대박나자 외쳐보세요" 1회. 끝에 총평 + 올해 주의점, 이후 자유 대화, 재시작 금지.
- **선제 발화 없음**: 손님이 "안녕하세요" 하고 먼저 건다 (연결 텀 동안 자연스럽게 말이 나옴).
  기존 `sendClientContent` 킥오프 제거.
- **출력 볼륨**: Live `SpeechConfig` 에 `speakingRate`/`volumeGainDb` 없음(배치 TTS 전용).
  볼륨은 `PcmPlayer.GAIN = 1.8` 로 클라에서 키움. 속도는 프롬프트로만 조절 가능.
- 목소리를 `Gacrux` 로 바꾸면서 기본(Puck)보다 작아짐 — gain 으로 보정. 더 필요하면 GAIN 올리거나 voice 교체.
- **3분 종료 = 정상**: `ended` 메시지로 분리(빨간 "오류" 아님) → "관상 잘 봤습니다" 안내 배너.
  재시작 시 이전 대화 자동 초기화. 예전엔 종료 직후 버튼이 "시작"으로 돌아가 방문자가
  반사적으로 눌러 관상이 처음부터 다시 시작되는 일이 있었음 → 프롬프트에 "총평 후엔
  손님이 뭐라 하든 처음부터 다시 시작 금지" + "외쳐봐요"를 3단계 끝(중간)으로 이동.

### 03 실측 비용 (2026-08-28, 3분 세션 1회 ≈ **$0.13~0.16 / 약 200원**)

`gemini-live-2.5-flash` 요금 (audio in $3, audio out $12, video in $3, text $0.5 /1M).
오디오는 32토큰/초, 이미지는 프레임당 ~350토큰 가정 (정확치 아님).

| 항목 | 대략 | 비중 |
|---|---|---|
| 웹캠 프레임 (2초마다 ~90장) | ~$0.095 | **~60%** |
| 관상가 음성 출력 (~90초 발화) | ~$0.035 | ~25% |
| 마이크 입력 (180초 스트림) | ~$0.017 | ~12% |
| 텍스트(프롬프트 등) | ~$0.001 | 무시 |

- **최대 레버는 웹캠 프레임.** `FRAME_INTERVAL_MS` 를 2000→4000 하면 영상비 절반 → 세션당 ~$0.10.
  더 줄이려면 "보여줘 봐요" 직후 몇 초만 전송하는 게이팅. (지금은 세션 내내 전송)
- 부스 2일 300세션 가정 시 03만 ~6만원. 01(클립당 $0.5)·02 합산 + 킬스위치·레이트리밋 필수.
- `speechConfig` — `voiceName: 'Gacrux'` (성숙한 톤) + `languageCode: 'ko-KR'`. 마음에 안 들면 교체
- `realtimeInputConfig` — VAD **민감도 낮음** (`START/END_SENSITIVITY_LOW`, `silenceDurationMs: 1200`).
  기본값(HIGH)이 너무 성급하게 끼어든다는 피드백
- **웹캠**: 페이지 진입 시 미리보기 자동 ON, 프레임 전송은 시작 버튼 이후.
  2초마다 512px JPEG (`FRAME_INTERVAL_MS`). `sendRealtimeInput({video})`. **프레임마다 과금**
- **입력 2-way**: 마이크(오디오 스트림) + 채팅창(`sendClientContent({turns, turnComplete:true})`)
- 시작 버튼 생김새·3분 세션 캡은 그대로

미검증:
- [ ] `kktae-demo` 에서 영상 프레임 실제 반응 (첫 호출 때 확인)
- [ ] `speechConfig`/`realtimeInputConfig` 가 half-cascade 에서 먹는지 (타입은 통과, 런타임 미확인)
- [ ] `Gacrux` 목소리 실제 톤 — 들어보고 조정
- [ ] `/api/live` WS 프로덕션(IAP 뒤) 동작

세션 설정으로 더 조절 가능한 것 (`LiveConnectConfig`, `genai.d.ts`):
`temperature`/`maxOutputTokens`, `enableAffectiveDialog`·`proactivity`(native-audio 계열만),
`tools`(Google Search 그라운딩).

## 함정 기록 (같은 곳에 두 번 빠지지 않기)

1. `us-central1` → 거부. Omni Flash 는 `global`/`us`/`eu` 만 지원
2. Vertex + `delivery:'uri'` → `gcs_uri` 필수. 버킷 생성으로 해결
3. Virtual Try-On 은 SDK 에 `virtualTryOn` 이 없다 → `recontextImage`
4. `ws` 는 SDK 의존성이지만 pnpm 엄격 레이아웃이라 우리가 직접 못 쓴다 → 별도 설치
5. `ErrorEvent` 는 Node 전역 타입이 아니다 → SDK 콜백에서 추론시킬 것
6. **모델마다 지원 리전이 다르다.** 01=global, 02=us-central1.
   클라이언트 하나를 전부가 공유하면 안 된다
7. **SDK 예제의 모델 ID 도 낡을 수 있다.** 타입 정의는 정확해도 예제 문자열은 별개다.
   퍼블리셔 모델 메타데이터 GET 으로 실재부터 확인할 것 (무료)
8. 메타데이터 조회에는 `x-goog-user-project` 헤더가 필요하다 (없으면 403 quota project)
9. **Vite 스타터의 `src/index.css` 가 디자인 시스템과 싸우고 있었다.**
   거기 `h1,h2 { color: var(--text-h) }` 가 있고 `--text-h` 가
   `@media (prefers-color-scheme: dark)` 에서 `#f3f4f6` 으로 바뀐다.
   OS 가 다크면 우리 `data-theme` 과 무관하게 헤드라인이 흰색으로 고정돼
   라이트 모드에서 히어로 문구가 사라졌다. 다크에서는 우연히 맞아떨어져서 안 보였던 버그다.
   → `index.css` 를 실제로 쓰이는 것(`--mono`, `--shadow`, 루트 폰트 크기)만 남기고 정리

## 완료 기록

**Phase 0 — 허브 페이지** ✅ 시안 → React, 라우팅, 레일

**Phase 1 — Omni Flash** ✅ Vertex ADC 인증, LRO 잡 구조, 인증 전환 스위치, 생성 UI,
**첫 생성 성공 (2026-08-26)**, 이어서 편집 UI 제거 (2026-08-26)
