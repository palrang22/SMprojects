# PLAN.md — SM AI Day 부스

> 최종 갱신: 2026-08-26 밤
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
| 01 | `gemini-omni-flash-preview` | **global** | 실호출 성공 |
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

## S4 — 콘솔 + 배포 (내일 오전, 사용자)

**나는 GCP 리소스를 만들지 않는다. 아래는 사용자가 직접.**

1. **API 활성화** — Cloud Run Admin, Artifact Registry, Cloud Build, **Identity-Aware Proxy**
2. **서비스 계정** 생성 → Cloud Run 에 attach. 키 파일 만들지 말 것 (ADC)
   - `roles/aiplatform.user`
   - 버킷 `smprojects-omni-output-805888175648` 에 `roles/storage.objectAdmin`
3. **OAuth 동의 화면** — 내부(Internal). IAP 켜기의 선행 조건
4. 리전: Cloud Run 은 `asia-northeast3` (서울).
   ※ Vertex 호출 리전(`global`)과 무관하다. 헷갈리지 말 것
5. **배포**: `gcloud run deploy --source . --min-instances=1 --max-instances=1`
   (인스턴스 1개 고정 — 인메모리 잡 스토어를 그대로 쓰기 위한 조건)
6. **IAP 켜기 + `domain:mz.co.kr` 허용**
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

- 01 Omni Flash: 출력 1초당 $0.10 (5초 = $0.50)
- 02 Virtual Try-On: 단가 미확인
- 03 Live: 세션 시간 과금 → 3분 자동 종료를 걸어뒀다
- **실제 생성 호출 전에 매번 확인받는다.** 설정 확인·타입체크는 무료

---

## 9/14 부스 행사까지 (내일 오전 마감 이후)

- [ ] 사용자별 레이트 리밋 (IAP 신원 기준) — 부스는 방문자가 반복해서 누른다
- [ ] 결과물 회수 — 서명 URL + QR 코드 유력
- [ ] 실패·타임아웃 시 방문자용 화면 (지금은 SDK 에러 문자열이 그대로 노출된다)
- [ ] 부스 환경 대응 — 화면 크기, 터치 입력, 유휴 상태 자동 복귀
- [ ] 부스 소음 환경의 음성 입력 (03) — 헤드셋? 지향성 마이크? **하드웨어 조달 리드타임**
- [ ] 네트워크 폴백 — 사전 생성 샘플
- [ ] preview 모델 가용성 행사 직전 재확인
- [ ] SM 아티스트 자산 사용 허가 (02 정식 데이터셋)
- [ ] 담당자 확인: 부스 기기 대수, 대기열 필요 여부, 현장 네트워크

## 확정 사항

| 항목 | 결정 |
|---|---|
| 배포 | Cloud Run + IAP 직접 연결 (`domain:mz.co.kr`) |
| 인증 | Vertex AI + ADC. 앱 자체 로그인은 만들지 않는다 |
| 프로젝트 | `gcp-a-presales-ge-20260521` (공용 — 남의 리소스 건드리지 말 것) |
| 저장소 | `gs://smprojects-omni-output-805888175648/output` (30일 자동 삭제) |
| Vertex 리전 | `global` (`us-central1` 등 단일 리전은 Omni Flash 가 거부) |

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
