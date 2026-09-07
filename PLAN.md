# PLAN.md — SM AI Day 부스 · 앞으로 할 일

> 최종 갱신: **2026-09-07** — 배포 완료 후 전면 재작성. 이전 계획(2026-08-27, 배포 전)은 폐기.
> 배경·GCP 설정·디자인 토큰·비용·함정은 `CLAUDE.md`. 이 문서는 **부스(2026-09-14) 전까지 할 일**만 담는다.

## 현재 상태

- 스튜디오 3종: UI·실호출 검증 완료 (2026-08-26).
- `server/index.ts` + `Dockerfile` 로 **Cloud Run 배포 완료**, IAP 콘솔 설정 완료.
- 아래 6개가 남은 작업. 순서는 **이름 변경 → 1·2 → 4 → 5·6 → 공통** 을 권장 (뒤 작업이 새 이름·공통 컴포넌트를 쓴다).

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

### 동의 팝업 (`/video`·`/image` 진입 시)

- [ ] `ConsentGate` — `/video`, `/image` 진입 시 모달. 동의해야 통과, 취소 시 홈.
- [ ] **매 진입마다 표시 (D5)** — `sessionStorage` 로 기억하지 않는다. 방문객이 계속 바뀌므로.
- 문구 **초안** (검토 필요):
  > 이 체험에서 촬영·생성한 사진과 영상은 부스 갤러리 화면에 전시되며, **행사 종료 후 모두 삭제**됩니다.
  > 갤러리에서 언제든 본인 결과를 바로 삭제할 수 있습니다. 동의하시면 시작하세요.
- ⚠️ 자동 삭제 규칙은 두지 않음 (D6). "행사 종료 후 삭제" 는 **스태프 수동 작업** — §부스 체크리스트.
  `CLAUDE.md` 의 "버킷 30일 자동 삭제 정책" 항목은 "수동 삭제" 로 정정.

### 호출 상한 · 킬 스위치 (아직 없음 — 부스 필수)

- [ ] 일일/세션 **생성 횟수 상한** (`server/api.ts`). 초과 시 친절한 거부.
- [ ] `/settings` 관리자 화면에 **기능 on/off 킬 스위치** — 서버 상태 플래그, `GET /api/health` 나 별도 엔드포인트로 반영.
- [ ] `server/iap.ts` `getIapIdentity()` 로 **신원별 카운트**(스푸핑 불가한 JWT 기준). 지금은 로깅만.
- [ ] `server/api.ts` 잡 스토어(`Map`) TTL — 부스 하루면 무한 증가.
- 참고: `docs/GCP-INFRA-GUIDE.md` §2.7, §10.2, §10.3.

### 배포 후 검증 (실행 시 과금 — 사용자와 함께)

- [ ] `/api/live` WebSocket 이 프로덕션 서버에서 실제로 붙는지 (03).
- [ ] GCS 서명 URL 이 배포 서비스 계정으로 생성되는지 (QR 다운로드·갤러리 전제).
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

- [x] 세 스튜디오 새 이름, "이름 바꾸지 말 것" 규칙 해제.
- [x] 테마 기본값(다크 고정), 허브 2열 레이아웃 900px — 디자인 시스템 섹션에 추가.
- [x] "버킷 30일 자동 삭제 정책" → "수동 삭제" 로 정정.
- [ ] `/gallery` 라우트, 동의 팝업 — 구현 완료 시 아키텍처 섹션에 추가.

---

## 미해결 합의

없음. 최근 합의: `docs/consensus/2026-09-07-plan-open-decisions.md` (7/7 해결).
새 결정거리가 생기면 `docs/consensus/<날짜>-<주제>.md` 로 만든다 (`CLAUDE.md` §결정·합의).
