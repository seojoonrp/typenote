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
- Highlight는 MuPDF annot API 사용 가능 (createAnnotation("Highlight") → setQuadPoints → setColor → update()). quad는 `StructuredText.highlight()` 결과 그대로. AP blend mode가 Multiply가 아니면 AP 직접 생성. 기본 노랑 = Acrobat의 /C 값.
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

## 텍스트 입력 주의
- 한글 IME: keydown에서 `e.isComposing || e.keyCode === 229`이면 단축키·Enter·Esc 처리 금지.
- 확정은 Esc 또는 바깥 클릭. 빈 상자는 확정 시 자동 삭제.

## 폴더
- `docs/` 명세와 Phase 문서
- `fonts/` Pretendard TTF (원본, 수정 금지)
- `samples/` 테스트용 PDF (원본, 수정 금지. 결과물은 다른 폴더에 쓴다)
- `spike/` Phase 0 Node 스크립트와 결과(`spike/out/`), `spike/REPORT.md`
