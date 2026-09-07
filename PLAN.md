# PLAN.md — SM AI Day 부스 · 앞으로 할 일

> 최종 갱신: **2026-09-07** — 배포 완료 후 전면 재작성. 이전 계획(2026-08-27, 배포 전)은 폐기.
> 배경·GCP 설정·디자인 토큰·비용·함정은 `CLAUDE.md`. 이 문서는 **부스(2026-09-14) 전까지 할 일**만 담는다.

## 현재 상태

- 스튜디오 3종: UI·실호출 검증 완료 (2026-08-26).
- `server/index.ts` + `Dockerfile` 로 **Cloud Run 배포 완료**, IAP 콘솔 설정 완료.
- 남은 작업: 아래 §QR(최우선, 권한 대기) → §1·2 → §4 → §5·6 → §공통.

---

## QR 공유 (서명 URL) — 최우선

`DownloadQr` 가 `url` 없으면 "QR 다운로드는 준비 중이에요" 만 띄운다. 이걸 푼다. 갤러리(§4)도 서명 URL 사용.

### 배경 (권한 문제 아님)

- `server/gcs.ts` `createSignedUrl` → `getSignedUrl({ version: 'v4', action: 'read' })`.
  V4 read 서명은 **GCS API 를 안 부른다** — 순수 서명 + (키 없을 때) IAM `signBlob`.
  → **버킷 권한(`storage.*`)과 무관.** 업로드가 되는 것과 별개.
- 로컬 `Cannot sign data without 'client_email'` = `pnpm dev` 가 사용자 개인 ADC 로 도는데
  개인 계정엔 서명 주체가 없어 `signBlob` 경로를 못 탄다.

### 권한

- 배포 런타임 SA `smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com` 에
  `roles/iam.serviceAccountTokenCreator` (self-bind) — **이거 하나.** → ✅ 완료 (2026-09-07)
- `iamcredentials.googleapis.com` API 가 켜져 있어야 `signBlob` 이 먹는다 (보통 켜져 있음 — 확인만).

### 코드 (2026-09-07) ✅

- **impersonation** — `server/gcs.ts` `GCS_SIGNER_SA` 환경변수가 있으면 그 SA 를 impersonate 해서 서명
  (`google-auth-library` `Impersonated`). 없으면 기본 ADC. 배포에선 비워두면 런타임 SA 로 직접 서명.
  `.env.local` 에 설정함. `.env.example` 문서화. `pnpm add google-auth-library@9.15.1`.
- **오류 노출** — `createSignedUrl` 이 `{ url, error }` 를 돌려준다. 서명 실패 시 원본 에러가
  `downloadError` 로 잡(job)·tryon 응답까지 흐르고, `DownloadQr` 팝오버가 "준비 중이에요" 대신
  **[🔎 오류 보기]** 버튼을 띄운다 → `src/lib/errorReport.ts` 로 새 탭에 원문 표시
  (`ErrorBanner` 의 "에러코드 확인하기" 와 같은 유틸, 공유로 분리).

### 남은 것

- 지금은 로컬에서 QR 자리에 **[🔎 오류 보기]** 가 뜨고, 누르면
  `SigningError: Permission 'iam.serviceAccounts.signBlob' denied` 가 새 탭에 보인다 (정상 — 아래 권한 대기).
- [ ] **로컬** — 2026-09-07 테스트: impersonation 코드는 실행되지만
      `Permission 'iam.serviceAccounts.signBlob' denied` → `kseungh@mz.co.kr` 계정이 SA 에
      `roles/iam.serviceAccountTokenCreator` 가 **없다.** 관리자(선배)가 부여해야 함 (우리는 Editor):
      ```bash
      gcloud iam service-accounts add-iam-policy-binding \
        smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com \
        --member="user:kseungh@mz.co.kr" \
        --role="roles/iam.serviceAccountTokenCreator" --project=kktae-demo --condition=None
      ```
      부여되면 `pnpm dev` 재시작 → Look Studio 1회 → 로그 `impersonate 합니다` + QR 버튼 확인.
- [ ] **배포본** — self-bind(SA→SA)가 실제로 붙었으면 `GCS_SIGNER_SA` 없이 이미 동작할 것.
      배포 후 Look Studio 1회 → QR 버튼 / 로그 `서명 URL 생성 실패` 없는지.
  - `PERMISSION_DENIED ... signBlob` → self-bind 도 실제로 안 붙음.
  - `Cannot sign data without 'client_email'` → Cloud Run SA attach 안 됨.

---

## 배포 IAM — 정리 (2026-09-07)

앱이 쓰는 GCP: **Vertex(`@google/genai`) + GCS(`@google-cloud/storage`) 둘뿐.**

런타임 SA `smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com` 현재 보유:
`Editor` + `Cloud Run Admin` + `IAP Policy Admin` + `iam.serviceAccountTokenCreator`(self-bind).

| 필요 | 커버 | 상태 |
|---|---|---|
| Vertex 3종 호출 | `Editor` 에 `aiplatform.*` 포함 | ✅ 동작 확인 |
| 버킷 업로드/다운로드/목록/삭제 | `Editor` 에 `storage.objects.*` 포함 | ✅ 동작 확인 |
| 서명 URL (`signBlob`) — QR·갤러리 | `serviceAccountTokenCreator` (Editor 엔 없음) | ✅ self-bind 완료 |

→ **런타임 SA 는 더 요청할 것 없음.** `aiplatform.user`·`storage.objectUser` 는 Editor 가 이미 포함하므로 불필요.

### 남은 것 하나 — 로컬 QR 테스트 (선택)

`kseungh@mz.co.kr` 계정이 SA 에 `roles/iam.serviceAccountTokenCreator` 가 없어서
로컬 `pnpm dev` + `GCS_SIGNER_SA` impersonate 가 `signBlob denied` (2026-09-07 확인).
→ 급하지 않으면 **배포본에서 QR 확인**하면 된다 (self-bind 로 이미 될 것). 로컬도 되게 하려면:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  smprojects-ai-runner@kktae-demo.iam.gserviceaccount.com \
  --member="user:kseungh@mz.co.kr" \
  --role="roles/iam.serviceAccountTokenCreator" --project=kktae-demo --condition=None
```

### 역할 아닌 것 — 확인만

- [ ] `iamcredentials.googleapis.com` API 켜짐 (signBlob) — `gcloud services list --enabled --filter=iamcredentials --project=kktae-demo`
- [ ] Cloud Run 이 이 SA 로 도는지 — `gcloud run services describe smprojects-sh --region=asia-northeast3 --format="value(spec.template.spec.serviceAccountName)"`
- [ ] `IAP_AUDIENCE` 환경변수가 Cloud Run 에 세팅됐는지 (`server/iap.ts`).

---

## 0. 이름 변경 — 취소 (2026-09-07)

한 번 Short-Form Studio / AI Closet / Face-Reading AI 로 바꿨다가 **사용자가 원복**.
**기존 이름 유지**: Motion Studio (`/video`) / Look Studio (`/image`) / Voice Studio (`/audio`).
(참고: `docs/consensus/2026-09-07-plan-open-decisions.md` D1·D2 는 취소 처리.)

---

## 1. Motion Studio (`/video`) — 숏폼

**목표:** 프롬프트를 직접 짜지 않아도, **[인물 선택] + [컨셉 선택]** 두 단계로
검증·정제된 프롬프트와 참조 이미지가 자동 입력되어 쇼츠가 나온다.

### 흐름

1. **인물 선택** — 별도 위젯. 샘플 6명(`woman_1~3`, `man_1~3`, `public/samples/`) + **웹캠 촬영** + (파일 업로드).
   → `src/routes/LookStudio.tsx` 의 `PersonPicker` / `SampleModal` 을 `src/components/PersonPicker.tsx` 로 **추출해 공유**.
2. **컨셉 선택** — 별도 위젯(신규). 컨셉 하나 = `{ id, label, prompt(정제됨), refImage }`.
   - 시작 컨셉: **놀이공원** (기존) / **시상식** / **레드카펫**. 이후 항목 추가만으로 확장.
   - **버튼을 누르면 정제 프롬프트가 자유 입력창에 자동으로 채워진다 (D3).** 사용자가 이어서 손볼 수 있다.
     동시에 그 컨셉의 참조 이미지가 인물 사진과 함께 첨부된다.
3. **생성** — `POST /api/generate` 에 `images: [인물사진, 컨셉참조이미지]`, `prompt: (자동채움된)프롬프트`.
   서버(`server/api.ts` `parseOptions`)는 이미 다중 이미지·프롬프트를 받으므로 **API 변경 불필요**.

### 컨트롤 (D4)

- 기본값 **720p · 10초**. 하단 선택창은 지금 구조 유지: 해상도 `360p/720p/1080p`, 길이 슬라이더.
- 길이 슬라이더 하한은 **3초** (`MIN_DURATION` — Omni 하한), 상한 10초. 비율은 쇼츠라 `9:16` 기본.
- 비용 표시(`priceFor`) 유지. 720p·10초 ≈ **$1.00/생성** — §공통 호출 상한이 특히 중요.

### 작업

- [ ] `PersonPicker` 공유 컴포넌트 추출 (Motion·Look 둘 다 사용)
- [ ] `ConceptPicker` 컴포넌트 + 컨셉 정의 파일 (`src/lib/concepts.ts`)
- [ ] `MotionStudio.tsx` — 기존 `EXAMPLE_PROMPTS` 자리를 `ConceptPicker` 로 교체.
      자유 입력 textarea·해상도·길이 컨트롤은 유지, 기본값만 720p/10초로.
- [ ] 컨셉 선택 시 프롬프트 자동 채움 + 참조 이미지 첨부 로직 (`attachmentFromUrl`, `src/lib/image.ts` 재사용)

### 리스크

- ⚠️ **인물 사진 + 컨셉 배경 이미지 2장을 함께 넣었을 때** "그 인물이 그 무대/레드카펫에 선" 영상이
  나오는지는 **실호출로 검증 안 됨.** 컨셉별 1회씩 360p 로 테스트 필요 (비용 발생 — 사용자 확인 후).
- 정제된 컨셉 프롬프트 문구는 내가 초안 작성 후 사용자 검토, 또는 사용자 제공 *(→ 필요한 에셋)*.

---

## 2. Look Studio (`/image`) — 옷 입히기

**목표:** 옷을 업로드하는 대신 **여러 샘플 의상에서 고른다.** 상·하의 조합을 위해 **최대 2벌** 선택.

### 작업

- [ ] **샘플 의상 그리드** — 스크롤되는 리스트에서 선택. 각 항목 = `{ id, label, category: 'top'|'bottom'|'dress', image }`.
      의상 이미지는 `public/samples/garments/` *(→ 필요한 에셋)*.
- [ ] **최대 2벌 선택** — 서버 `parseTryOnOptions`(`server/api.ts`)가 이미 `products.slice(0, 2)` 로 2장까지 받는다.
      프론트만 1장 → 2장 전송으로 확장. `dress` 는 1벌만.
- [ ] **인물 선택에 웹캠 촬영 추가** — §1 에서 추출한 공유 `PersonPicker` 사용 (이미 LookStudio 에 카메라 코드 있음, 공유로 정리).
- [ ] 기존 업로드 슬롯(`Slot`)·"이 사진으로 계속하기" 체이닝은 유지.
- UI 골격은 §1(Motion Studio)과 동일하게 맞춘다 (사용자 확인).

### 참고

- `virtual-try-on-001` 은 상의/하의/원피스만. 가방·모자·소품 불가 (`CLAUDE.md`).
- Vertex 전용, `us-central1` 리전 (`server/tryon.ts` 가 `locationOverride` 로 처리 중).

---

## 3. 스튜디오 이름 — 변경 안 함 (§0)

Motion / Look / Voice Studio 그대로.

---

## 4. Media Gallery (신규)

**목표:** 지금까지 사람들이 만든 **01·02 의 사진·영상**이 슬라이드쇼로 넘어가는 화면. (03 Voice Studio 는 제외 — D7)
좌하단 레일 메뉴에서 갤러리 아이콘 → **관리자 비밀번호** 통과 후 진입.

### 접근

- 새 라우트 `/gallery`, `src/routes/Gallery.tsx`.
- `src/components/Rail.tsx` 좌하단(관리자 아이콘 옆)에 `GalleryIcon` 추가 (`src/components/Icons.tsx` 에 아이콘 신규).
- **관리자 게이트 재사용** — `Settings.tsx` 의 `sessionStorage["sm-admin"]` 판정을 작은 훅/컴포넌트로 빼서 `/gallery` 도 감싼다. 비번은 동일(`aprk12!`, `CLAUDE.md` §접근 제어 — 클라이언트 처리 유지).

### 서버 (GCS 버킷 목록 조회 — 재시작·재배포와 무관하게 부스 하루 종일 누적)

- [ ] `GET /api/gallery` — `gs://smproject-sh/output` 나열. 경로로 타입 분류:
      `/looks/...` = 이미지(02), 그 외 = 영상(01). 각 항목에 **서명 URL**(`createSignedUrl`) + 생성시각, 최신순.
- [ ] `DELETE /api/gallery?object=<경로>` — 버킷에서 해당 오브젝트 삭제.
- [ ] `server/gcs.ts` 에 `listObjects(project, prefix)`, `deleteObject(project, gsUri)` 추가.
- 두 라우트 모두 배포 환경에서만 의미 있음(로컬 dev 는 서명 URL 이 개인 ADC 라 안 될 수 있음 — `gcs.ts` 주석).

### 프론트 (슬라이드쇼)

- [ ] 사진 **5초**, 영상은 **영상 길이만큼** 재생 후 다음으로.
- [ ] 좌 → 우로 **슬라이드되는 전환 애니메이션**. `prefers-reduced-motion` 이면 페이드/즉시.
- [ ] **마우스 움직이면 하단에서 올라오는 바** — 평소 숨김, `mousemove` 시 슬라이드업. 그 안에 **[삭제]** 버튼 → `DELETE /api/gallery` 호출 후 목록에서 제거.
- [ ] 목록 주기적 갱신(폴링) 또는 진입 시 1회 로드 — 부스 운영 중 새 결과가 쌓이므로 폴링 권장(30~60초).

### 개인정보

- 갤러리는 관리자만 **여는** 화면이지만, 열려 있으면 부스 방문객에게 **얼굴이 계속 노출**된다.
  → §공통 의 **동의 팝업(매 진입)** 이 전제. 삭제 버튼은 즉시 회수 수단.
- 자동 삭제 규칙 없음 (D6) — **행사 종료 후 스태프가 버킷을 직접 비운다.** 체크리스트에 넣을 것.

---

## 5. 기본 다크 모드 — ✅ 완료 (2026-09-07)

- [x] `src/lib/theme.ts` `readInitialTheme()` — `prefers-color-scheme` 분기 삭제. 저장값 없으면 `"dark"`.
- [x] `index.html` 인라인 스크립트 — `matchMedia` 분기 삭제. 저장값 없으면 `"dark"`.
- [x] 두 곳 주석 정리. `useLogo`·토글 로직은 그대로.

---

## 6. 13" 노트북 레이아웃 — ✅ 코드 완료 (2026-09-07) · 실기 확인 대기

- [x] 2열 붕괴 브레이크포인트 `1080px` → **`900px`** (`.main-split` + 히어로 테두리 스왑 미디어쿼리 둘 다).
- [x] `.main-split` → `grid-template-columns: minmax(0,1.05fr) minmax(340px,1fr)`.
- [x] `.hero` / `.panel` / `.mod` 의 좌우 패딩·gap 을 `clamp()` 로 (폭 좁아지면 자연스레 축소).
- [ ] **실기 확인** — 사용자 13" 노트북에서 2열 유지되는지. (빌드는 통과, 브라우저 리사이즈 확인은 사용자/스크린샷)
- (별건) `public/samples/man_1~3.png` 각 7MB → 리사이즈/webp 로 최적화하면 로딩이 빨라진다.

---

## 공통 / 부스 준비

### 동의 게이트 — ✅ 완료 (2026-09-07)

- [x] `src/components/ConsentGate.tsx` — 라우트 element 를 감싼다 (`src/App.tsx`).
      동의 체크 → "동의하고 시작", "취소" → 홈. 동의 전엔 스튜디오를 렌더 안 함(웹캠 조기 작동 방지).
- [x] **매 진입마다 표시 (D5)** — 라우트 마운트마다 `consented` 가 false 로 시작. `sessionStorage` 안 씀.
      각 라우트의 `<ConsentGate>` 에 `key`(video/image/audio) 를 줘서 스튜디오 → 스튜디오 이동 시에도
      강제 remount (안 그러면 셋이 트리 같은 위치·타입이라 React 가 상태를 유지해 게이트가 건너뛰어짐).
      브라우저에서 video→image→audio 연속 이동 확인 완료.
- [x] `variant="capture"` (`/video`·`/image`) — "사진·영상이 갤러리에 전시, 행사(2026-09-14) 후 폐기, 직접 삭제 가능".
- [x] `variant="live"` (`/audio`) — "얼굴 촬영·음성 인식, 저장 안 됨, 세션 끝나면 데이터 안 남음".
- [x] 스타일 `src/styles/hub.css` — 스튜디오 강조색 반영(`.consent-scrim.video/image/audio`), reduced-motion 대응.
- ⚠️ `capture` 문구의 "행사 후 폐기" 는 **스태프 수동 삭제** (D6). §부스 체크리스트.

### 호출 상한 · 킬 스위치 (아직 없음 — 부스 필수)

- [ ] 일일/세션 **생성 횟수 상한** (`server/api.ts`). 초과 시 친절한 거부.
- [ ] `/settings` 관리자 화면에 **기능 on/off 킬 스위치** — 서버 상태 플래그, `GET /api/health` 나 별도 엔드포인트로 반영.
- [ ] `server/iap.ts` `getIapIdentity()` 로 **신원별 카운트**(스푸핑 불가한 JWT 기준). 지금은 로깅만.
- [ ] `server/api.ts` 잡 스토어(`Map`) TTL — 부스 하루면 무한 증가.
- 참고: `docs/GCP-INFRA-GUIDE.md` §2.7, §10.2, §10.3.

### 배포 후 검증 (실행 시 과금 — 사용자와 함께)

- [ ] `/api/live` WebSocket 이 프로덕션 서버에서 실제로 붙는지 (03).
- [ ] GCS 서명 URL — **§QR 참고 (권한 대기 중).**
- [ ] `IAP_AUDIENCE` 환경변수가 Cloud Run 서비스에 설정됐는지 (없으면 `iap.ts` 가 신원 미검증).

### 필요한 에셋 (사용자 제공)

- **Look Studio 샘플 의상** — 상의/하의/원피스 제품컷 여러 벌 → `public/samples/garments/`. (현재 없음)
- **Motion Studio 컨셉 참조 이미지** — 놀이공원 / 시상식 / 레드카펫 배경·무대 → `public/samples/concepts/`.
- **정제된 컨셉 프롬프트** — 내가 초안 작성 후 검토, 또는 사용자 제공.
- (선택) 최적화된 샘플 인물 이미지 (현 7MB PNG 대체).

### 부스 당일/종료 체크리스트

- [ ] 행사 종료 후 `gs://smproject-sh` 의 체험 결과물 **수동 삭제** (동의 문구가 약속한 내용 — D6).
- [ ] 킬 스위치 동작 확인, 호출 상한 리셋.

### CLAUDE.md 갱신

- [x] 테마 기본값(다크 고정), 허브 2열 레이아웃 900px — 디자인 시스템 섹션에 추가.
- [x] "버킷 30일 자동 삭제 정책" → "수동 삭제" 로 정정.
- [x] 동의 게이트(`ConsentGate`) — 아키텍처 섹션에 추가.
- [ ] `/gallery` 라우트 — 구현 완료 시 아키텍처 섹션에 추가.
- [ ] §QR 권한 부여되면 "GCP 설정" 섹션의 대기 항목 갱신.

---

## 미해결 합의

없음. 최근 합의: `docs/consensus/2026-09-07-plan-open-decisions.md` (7/7 해결).
새 결정거리가 생기면 `docs/consensus/<날짜>-<주제>.md` 로 만든다 (`CLAUDE.md` §결정·합의).
