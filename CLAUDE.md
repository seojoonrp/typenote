# typenote — 개인용 PDF 타이핑·하이라이트 앱 (Windows)

Acrobat에서 한글 FreeText가 깨지는 문제를 피하기 위한, 텍스트 상자 + 하이라이트 두 기능만 있는 1인용 데스크톱 앱.
전체 명세는 [docs/SPEC.md](docs/SPEC.md). 현재 단계의 상세는 `docs/PHASE*.md`. 이 파일과 SPEC이 충돌하면 SPEC이 우선이고, 충돌을 발견하면 사용자에게 알린다.

## 진행 방식
- Phase 단위로 진행한다. 한 Phase가 끝나면 보고하고 멈춘다. 다음 Phase는 사용자가 지시할 때만 시작.
- Phase를 시작하기 전에 짧은 실행 계획을 보여주고 확인을 받는다.
- mupdf.js, harfbuzzjs 등 라이브러리 API는 기억에 의존하지 말고 설치된 버전의 `.d.ts`와 실제 export로 확인한다.
- 렌더 결과는 PNG로 뽑아서 직접 눈으로 확인한다 (한글이 정상인지).

## 핵심 결정
- **FreeText는 직접 만든다**: annot dict, AP Form XObject, Type0/CIDFontType2 폰트 객체를 low-level PDF 객체 API로 직접 생성.
  Pretendard subset을 `/FontFile2`로 반드시 embed. `/Encoding /Identity-H`, `/CIDToGIDMap /Identity`, `/ToUnicode` 필수.
- `/Contents`(UTF-16BE + BOM)가 재편집·복구의 source of truth. 앱 소유 FreeText는 `/NM` 고정 접두사로 식별.
- 글자 → GID는 cmap lookup만 (shaping 없음, kerning 없음, advance = hmtx). **폰트 파일마다 GID 매핑을 따로** 한다.
- subset은 hb-subset + **RETAIN_GIDS** (CID = 원본 GID). 저장마다 문서 전체 사용 글자 합집합으로 weight별 subset을 다시 만들어 **같은 객체 번호에 덮어쓴다** → 기존 AP 수정 불필요.
- Highlight도 raw 객체로 직접 쓴다: 평평한 직사각형 AP, `/BM /Multiply`, 불투명도(`/CA`, 기본 40%). quad는 `StructuredText.highlight()` 결과 그대로. 기본 색은 청록, 스와치의 노랑 = Acrobat의 /C 값.
- 좌표: 앱 내부는 MuPDF page space (좌상단 원점, y-down, /Rotate·CropBox 반영). raw 객체에 쓰는 /Rect 등은 `page.getTransform()`으로 PDF user space로 변환. 회전 페이지 AP는 /Matrix에 회전 포함.
- 렌더: base bitmap(MuPDF, 앱 주석은 `setHiddenForEditing(true)`) + HTML annot overlay + 편집용 `<textarea>`의 3레이어.
- overlay는 같은 TTF를 FontFace로 weight 400/600 등록, `font-kerning: none`, AP와 같은 line-height.
- 저장: `saveToBuffer("incremental")` → 같은 폴더 temp 파일 → rename. `wasRepaired()`면 full save로 fallback. 메뉴에 full save(garbage collect) 제공.
- 스택: Tauri 2 + React + TypeScript strict, MuPDF.js(WASM)는 Web Worker에서. Tauri 백엔드는 파일 I/O·대화상자·설정·파일 연결만. PDF 바이트는 binary IPC로 Uint8Array 그대로.
- 폰트: `fonts/Pretendard-Regular.ttf`, `fonts/Pretendard-SemiBold.ttf` (OFL). variable이면 wght 400/600 static 인스턴스 생성 후 사용.

## 금지
- pdf.js FreeText editor / `saveDocument`로 FreeText 저장
- MuPDF `createAnnotation("FreeText")` + `update()`로 FreeText 생성 (CJK 누락)
- pdf-lib
- Electron
- synthetic bold, 시스템 폰트에 의존하는 렌더링
- 범위 밖 기능 추가: 손글씨, 도형, 팝업 메모, 페이지 편집, OCR, 동기화, 상자 내부 부분 서식, 자동 줄바꿈 박스

## Phase 0에서 확인된 구현 규칙 (mupdf 1.28.1, harfbuzzjs 1.6.4 기준, 근거는 spike/REPORT.md)
- **앱 FreeText에는 PDFAnnotation setter(`setRect`, `setContents`, `setColor` 등) 사용 금지.** 호출 후 `update()`하면 MuPDF가 AP를 Helv/Batang으로 재생성한다. 이동, 수정, 삭제는 raw `PDFObject.put`/`writeStream`으로만 한다. raw 수정은 `page.update()`/`annot.update()`를 거쳐도 AP가 유지된다.
- 저장 옵션은 `"incremental,compress"`. `wasRepaired()`이거나 `!canBeSavedIncrementally()`이면 `"garbage,compress"` full save로 한다.
- raw로 `/Annots`를 바꾼 뒤에는 해당 `PDFPage`를 `destroy()`하고 다시 로드한다(주석 목록 캐시).
- `Pixmap.getPixels()`는 WASM 메모리 뷰라서 즉시 `.slice()`로 복사한다.
- `page.toStructuredText()`는 주석을 포함하지 않는다(하이라이트 선택용으로 적합). 주석 텍스트는 `annot.toDisplayList().toStructuredText()`로 얻는다.
- `/Contents`는 `newByteString()`으로 UTF-16BE+BOM을 강제한다. 줄바꿈은 `\r`로 쓰고, 읽을 때는 `\r\n|\r|\n`을 모두 허용한다.
- hb-subset: harfbuzzjs v1 타입 API에는 subset이 없다. `harfbuzz-subset.wasm`을 직접 인스턴스화해서 C API를 호출한다(`src/pdf/engine/subset.ts`). `RETAIN_GIDS = 0x2`.

## 편집과 저장 구조 (Phase 2)
- PDF 쓰기는 모두 `src/pdf/engine/`(`PdfEditor`)를 거친다. 이 엔진은 worker(`src/pdf/session.ts`)와 Node 테스트(`engine.test.ts`)가 함께 쓴다. 폰트와 hb-subset wasm은 주입받는다(`FontKit`).
- 상자 id는 `/NM`(`typenote-` + uuid)이다. 위치 x, y는 MuPDF page space에서 상자의 왼쪽 위다. 같은 id로 다시 `putTextBox`하면 annot과 AP 객체 번호를 유지한 채 고쳐 쓴다.
- 폰트 subset은 편집할 때마다 문서 전체에서 쓰인 글자의 합집합으로 같은 객체에 다시 쓴다. 글리프 집합이 같으면(subset 태그가 같으면) 건드리지 않는다.
- worker는 저장한 직후 그 바이트로 문서를 다시 연다. 그래야 다음 incremental 저장이 그 위에 이어 붙는다. 디스크에는 항상 파일 전체를 temp 파일에 쓰고 rename한다(`write_pdf`).
- UI 쪽 문서 상태, 변경 여부, 자동 저장(3초), 잠김 재시도(10초), 충돌 처리는 `src/doc/DocStore.ts`가 맡는다. 연 뒤에 디스크 파일이 바뀌면(크기나 수정 시각) 충돌로 보고 자동 저장을 멈춘다.
- dev 빌드에만 `window.__typenote`(`store`, `addTestBox()`)가 있다. `tools/`의 시나리오 스크립트가 쓴다.

## 텍스트 상자 UI 구조 (Phase 3)
- 앱 FreeText는 base 비트맵에서 숨기고 HTML overlay(`src/annot/TextLayer.tsx`)로 그린다. overlay의 상자 크기와 줄 위치는 **반드시 엔진의 `layoutText`(`src/pdf/engine/layout.ts`)와 `textCss`(`src/annot/style.ts`)로 계산**한다. DOM으로 측정하지 않는다. 그래야 AP와 일치한다(실측 차이 ≤2 device px, `tools/overlay-test.mjs`).
- 메인 스레드 코드는 mupdf를 import하지 않는다. 메인에서 쓰는 엔진 모듈(`layout.ts`, `faces.ts`, `ttf.ts`, `model.ts`)은 mupdf에 의존하지 않게 유지한다.
- 편집은 `DocStore`에서 즉시 반영된다(optimistic). undo/redo도 `DocStore`가 맡는다(`record`, `merge` 옵션). UI는 `putTextBox`/`deleteTextBox`만 부른다.
- 키 처리 순서: 텍스트 도구(`useTextTool`, window **capture**)가 먼저 보고, 처리한 키는 `preventDefault`한다. 뷰어의 쪽 이동(window bubble)은 `defaultPrevented`이면 무시한다. 도구 단축키는 `e.code`(KeyT, KeyV)로 판별한다(한글 자판에서도 동작하도록).
- 툴바는 **항상 한 줄, 높이 고정**이다. 높이가 바뀌면 페이지 영역이 줄어 쪽 맞춤이 다시 계산되고, 그 사이 들어온 키가 잘못 처리된다.
- 실제 앱 UI 시나리오는 `tools/text-test.mjs`, overlay와 AP 비교는 `tools/overlay-test.mjs`로 돌린다.
- `tauri.conf.json`의 `zoomHotkeysEnabled`는 **true로 유지**한다. false로 두면 wry가 WebView2 `IsPinchZoomEnabled`까지 꺼서 터치패드 핀치가 페이지에 전달되지 않는다. 대신 Ctrl+휠과 Ctrl+=/-/0/1/2는 앱이 전역에서 preventDefault한다(`src/viewer/input.ts`, `App.tsx`). 터치패드 핀치는 "물리 Ctrl 없이 ctrlKey가 켜진 wheel"로 들어오고, 배율은 `exp(-deltaY/100)`이다.
- 실제 WebView2 동작은 `tools/run-app.ps1`(DevTools 프로토콜 포트 9222)로 검증한다. 키 입력, 휠, `Input.synthesizePinchGesture`, 스크린샷을 OS 입력 없이 재현할 수 있다. 디버그 빌드는 dev 서버(1420)를 띄우므로 `npm run dev`를 먼저 켠다. 저장 시나리오는 `tools/save-test.mjs`로 만든다. 단계 파일 안의 경로는 슬래시(`/`)로 쓴다(Git Bash의 `node -e`가 `\\`를 먹는다).
- worker에서 mupdf는 **동적 import**한다. mupdf가 top-level await를 쓰기 때문에, 정적 import를 쓰면 로드되는 동안 들어온 메시지가 리스너 등록 전에 버려진다(`src/pdf/worker.ts`).

## 하이라이트 구조 (Phase 4)
- 엔진은 `src/pdf/engine/highlight.ts`. **Highlight에도 PDFAnnotation setter + `update()`를 쓰지 않는다**(MuPDF가 AP를 자기 모양으로 다시 만든다). AP는 바깥 Form(`/GS gs /Fm Do`, ExtGState `BM Multiply`, `CA`/`ca`)이 안쪽 transparency group Form(quad 채우기)을 그리는 구조다. 고칠 때는 annot 객체 번호를 유지하고 옛 /N을 지운다. 지울 때는 /Popup도 함께 지운다.
- 출처와 상관없이 모든 하이라이트를 import한다. id는 `/NM`, 없으면 `obj:<번호>`. base 비트맵은 하이라이트를 모두 숨기고(`HIDDEN.highlights`), `src/annot/HighlightLayer.tsx`가 하이라이트마다 SVG 하나를 `mix-blend-mode: multiply` + `opacity`로 그린다. AP와 같은 합성 방식이어서 실측 차이는 경계 ≤1 device px, 색 ≤3/255다.
- 글자 선택은 worker의 `selectText`다. 드래그는 `StructuredText.highlight(from, to)`, 더블클릭은 `snap(p, p, "words")`를 쓴다(`highlight(p, p)`는 빈 배열). 시작점이 글자 줄 bbox 밖이면 빈 결과를 돌려준다(빈 곳과 스캔본에서는 동작하지 않음. `snap`은 빈 곳에서도 엉뚱한 quad를 돌려준다). 쪽별 StructuredText는 캐시한다.
- mupdf `PDFObject`: 없는 키에 `.get("A").get("B")`처럼 이어 부르면 예외가 난다. **경로 형식 `obj.get("A", "B")`를 쓴다.** PDF real은 float32로 돌아오므로 모델로 읽을 때 반올림한다.
- `DocStore`는 텍스트 상자와 하이라이트를 **한 undo 스택**에서 다룬다(명령에 `kind`). 선택은 둘 중 하나만 된다(`App.tsx`).
- 실제 앱 시나리오는 `tools/highlight-test.mjs`, overlay와 AP 비교는 `tools/highlight-compare.mjs`로 돌린다.

## 텍스트 입력 주의
- 한글 IME: keydown에서 `e.isComposing || e.keyCode === 229`이면 단축키·Enter·Esc 처리 금지.
- 확정은 Esc 또는 바깥 클릭. 빈 상자는 확정 시 자동 삭제.

## 폴더
- `docs/` 명세와 Phase 문서
- `fonts/` Pretendard TTF (원본, 수정 금지)
- `samples/` 테스트용 PDF (원본, 수정 금지. 결과물은 다른 폴더에 쓴다)
- `spike/` Phase 0 Node 스크립트와 결과(`spike/out/`), `spike/REPORT.md`
- `src/` 프런트엔드: `pdf/`(worker 셸, 세션, 클라이언트), `pdf/engine/`(FreeText, 폰트, subset, 저장 엔진), `doc/`(DocStore: 상태, undo, 저장), `annot/`(텍스트 상자와 하이라이트 overlay, 편집, 속성 바, 도구 상태), `viewer/`(한 쪽 레이아웃, 쪽 이동, 줌, 렌더 캐시), `platform/`(Tauri와 브라우저 대체 구현)
- `tools/` 실제 WebView2 검증 도구(CDP 클라이언트, 실행 스크립트, 단계 파일과 생성기)
- `src-tauri/` Rust 백엔드: `files.rs`(읽기, 원자적 쓰기, 잠김·충돌 판별, 실행 인자), `settings.rs`(settings.json, 최근 파일)

## 실행
- 앱: `npm run tauri dev`. Rust가 PATH에 없으면 `~/.cargo/bin`을 추가한다.
- 웹 레이어만 브라우저에서: `npm run dev` 후 `http://localhost:1420/?file=/samples/<파일>.pdf` (dev 전용 경로)
- 검사: `npm run typecheck`, `npm test`, `cd src-tauri && cargo test && cargo clippy --all-targets`
