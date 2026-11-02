# SPEC

## 기능 범위

**텍스트 상자**
- 클릭한 위치에 키보드로 입력. Typewriter 방식: 폭은 자동, 줄바꿈은 Enter로만 (자동 줄바꿈 없음)
- 스타일은 상자 단위:
  - 크기: pt 직접 입력 + 프리셋 10/12/14/18/24
  - 굵기: Pretendard Regular / SemiBold
  - 색: 프리셋 + picker
- 더블클릭 재편집, 드래그 이동, Delete 삭제. 빈 상자는 확정 시 자동 삭제
- 선택한 상자 위에 floating 속성 바 (크기 stepper, B 토글, 색). 선택된 상자가 없을 때 바꾸면 도구 기본값이 됨

**하이라이트 — Acrobat과 동일하게**
- 글자 위에서 드래그 → 글자 단위로 선택. 드래그 중에는 하이라이트 색으로 미리보기, 놓으면 확정
- 여러 줄이면 주석 1개에 줄별 quad
- 더블클릭은 단어 선택
- 글자가 없는 곳이나 스캔본에서는 동작 안 함
- 기존 하이라이트 클릭 → 팝오버(색 스와치, 불투명도, 삭제). Delete 키로도 삭제
- 표시: 색 + Multiply blend (글자가 검정 그대로 보이도록). 불투명도는 슬라이더로 10~100%, 10% 단위, 기본 40%. 모양은 줄마다 평평한 직사각형. 기본 색은 청록 (Phase 4에서 결정)

**공통**
- 열기: 대화상자, drag&drop, 최근 파일, .pdf 연결 프로그램 등록
- 보기: 한 쪽씩 보기 (Acrobat 단일 페이지 보기처럼). 쪽 전체가 화면에 들어오는 배율이면 휠·화살표·PageUp/Down으로 쪽 단위로 애니메이션 없이 바로 이동하고, 쪽이 화면보다 길면 그 쪽 안에서 스크롤하다가 끝에서 다음 쪽으로 넘어감 (Phase 1 피드백으로 연속 스크롤에서 변경)
- 줌: 쪽 맞춤, 폭 맞춤, % 직접 입력, Ctrl+휠, 터치패드 핀치
- 편집·저장: undo/redo, Ctrl+S, autosave(편집 후 3초 동안 입력이 없으면 원본에 incremental 저장. Phase 2에서 결정), 닫기 전 확인
- 단축키:
  - 도구: T(텍스트), H(하이라이트), V(선택)
  - Ctrl+B: weight 토글
  - Ctrl+Shift+. / Ctrl+Shift+, : 크기 한 단계 키우기/줄이기

**범위 밖**
- 손글씨, 도형, 팝업 메모, 페이지 편집, OCR, 동기화
- 상자 내부 부분 서식, 자동 줄바꿈 박스

## 스택
- Tauri 2 + React + TypeScript (strict), Windows/WebView2 타깃
- MuPDF.js (npm `mupdf`, WASM)를 Web Worker에서 실행: 렌더링, 텍스트 quad, low-level PDF 객체 쓰기, incremental save
- harfbuzzjs의 hb-subset으로 폰트 subset (RETAIN_GIDS 필수)
- 폰트: `fonts/Pretendard-Regular.ttf`, `fonts/Pretendard-SemiBold.ttf` (OFL). variable 폰트라면 wght 400/600 static 인스턴스를 만들어서 사용
- Tauri 백엔드는 파일 I/O, 대화상자, 설정, 파일 연결만 담당. PDF 바이트는 binary IPC로 Uint8Array 그대로 전달

## 금지
- pdf.js의 FreeText editor나 saveDocument로 FreeText 저장
- MuPDF의 createAnnotation("FreeText") + update()로 FreeText 생성
- pdf-lib (full rewrite 방식, 유지보수 중단)
- Electron
- synthetic bold, 시스템 폰트에 의존하는 렌더링

## 아키텍처

페이지마다 3레이어:
1. **base bitmap**: worker에서 MuPDF로 렌더. 앱이 관리하는 FreeText/Highlight는 `setHiddenForEditing(true)`로 숨기고 렌더하고, 나머지 주석은 그대로 렌더
2. **annot overlay** (HTML): 텍스트 상자와 하이라이트
3. **편집 중인 `<textarea>`**

렌더링:
- 보이는 페이지와 앞뒤 1장만 렌더
- (page, zoom bucket)을 키로 LRU 캐시
- 줌 제스처 중에는 CSS scale로 버티고, debounce 후 재렌더

좌표:
- 앱 내부는 MuPDF page space로 통일 (좌상단 원점, y-down, /Rotate·CropBox 반영)
- raw 객체에 쓰는 /Rect 등은 PDF user space여야 함 → `page.getTransform()`으로 변환

문서를 열 때 주석 처리:
- 앱이 만든 FreeText (/NM 고정 접두사로 식별): 모델로 import해서 편집 가능
- 다른 프로그램이 만든 FreeText: 건드리지 않고 base에 렌더. 깨진 한글이 감지되면 복구를 제안 (아래 "저장" 참고)
- Highlight: 출처와 상관없이 import (색 변경, 삭제 가능)

## FreeText 객체 (직접 생성)

```
annot dict: /Type /Annot /Subtype /FreeText /Rect /F 4 /IT /FreeTextTypeWriter
  /Contents  UTF-16BE(BOM) 원문 — 재편집·복구의 source of truth
  /DA (/PS 14 Tf r g b rg)  /NM (고정접두사-uuid)  /M  /CreationDate
  /AP << /N Form XObject >>

AP Form XObject: /BBox [0 0 w h], 회전 페이지면 /Matrix에 회전 포함
  /Resources << /Font << /PR → Regular Type0, /PS → SemiBold Type0 >> >>
     (문서 공용 객체, 실제로 쓰인 weight만)
  stream: q BT /PS 14 Tf r g b rg  pad firstBaseline Td  lineHeight TL
          <GID hex> Tj T* <…> Tj ET Q

Type0: /BaseFont /XXXXXX+Pretendard-SemiBold /Encoding /Identity-H /ToUnicode CMap
  └ CIDFontType2: /CIDSystemInfo (Adobe, Identity, 0) /CIDToGIDMap /Identity /W (쓰인 CID만)
     └ FontDescriptor: FontName, Flags, FontBBox, ItalicAngle, Ascent, Descent,
                       CapHeight, StemV, /FontFile2 → subset TTF
```

글자 → GID:
- cmap lookup만 사용. 현대 한글 완성형과 Latin이라 shaping이 필요 없음
- 폰트에 없는 글자는 입력 시 경고
- 폰트마다 GID 매핑을 따로 함 (두 파일의 glyph 순서가 같다고 가정하지 말 것)

subset 전략:
- RETAIN_GIDS로 CID = 원본 GID 고정
- 저장할 때마다 문서 전체에서 쓰인 글자 합집합으로 weight별 subset을 다시 만들어 **같은 객체 번호에 덮어씀**
- 덕분에 기존 상자들의 AP는 수정할 필요가 없음

레이아웃 계산:
- advance는 hmtx 값 그대로, kerning 없음
- lineHeight = (ascender − descender + lineGap) / UPM × size
- 첫 baseline = h − pad − ascender × size / UPM
- /Rect: 가로 = 최장 줄 advance + 2·pad, 세로 = 줄 수 × lineHeight + 2·pad

overlay 일치:
- 같은 TTF를 FontFace API로 weight 400/600 두 개 등록
- `font-kerning: none`, AP와 같은 line-height 사용

## Highlight 객체
- annot dict와 AP를 raw 객체로 직접 씀 (Phase 4에서 결정. 평평한 직사각형 AP를 쓰기로 해서 MuPDF annot API의 AP 생성은 쓰지 않음)
- quad는 `StructuredText.highlight(p, q)` 결과를 그대로 사용 (UL, UR, LL, LR 순서). 더블클릭 단어는 `StructuredText.snap(p, p, "words")`
- AP: quad를 채운 transparency group을 ExtGState `/BM /Multiply`, `/CA`·`/ca` = 불투명도로 합성. 줄끼리 겹쳐도 한 번만 칠해짐. annot에도 `/C`, `/CA`를 씀
- 다른 프로그램이 만든 하이라이트도 import. 색이나 불투명도를 바꾸면 이 AP로 다시 씀
- 스와치의 노랑은 Acrobat이 만든 하이라이트의 /C 값과 같음. 기본 색은 청록 `[0.219604 0.898041 1]`

## 텍스트 입력 주의
- 한글 IME: keydown에서 `e.isComposing || e.keyCode === 229`이면 단축키, Enter, Esc 처리를 하지 말 것 (마지막 글자가 중복 입력되는 버그)
- 확정은 Esc 또는 바깥 클릭

## 저장
- `saveToBuffer("incremental")` → 같은 폴더의 temp 파일에 쓰기 → rename
- repair된 문서(`wasRepaired()`)는 incremental 불가 → full save로 fallback
- 메뉴에 full save(garbage collect) 제공. incremental이 쌓이면 죽은 폰트 subset이 누적되기 때문
- 다른 프로그램이 파일을 잡고 있어서 쓰기가 실패하는 경우 처리
- Acrobat FreeText 복구: AP 폰트에 FontFile이 없고 /Contents에 한글이 있으면, 앱 폰트로 AP를 재생성하자고 제안. 복구하면 앱 소유 주석으로 전환

## 데이터 모델

```ts
type RGB = [number, number, number]; // 0–1
type TextBox = {
  id: string; page: number; x: number; y: number; text: string;
  size: number; weight: 'regular' | 'semibold'; color: RGB; objNum?: number;
};
type Quad = [number, number, number, number, number, number, number, number]; // UL, UR, LL, LR
type Highlight = {
  id: string; page: number; quads: Quad[]; color: RGB; opacity: number; objNum?: number;
};
```

Undo/redo는 command 패턴. 각 커맨드가 주석의 직렬화본을 보관.

## 마일스톤

| Phase | 내용 |
|---|---|
| 0 | 진단 + 한글 FreeText/Highlight spike (Node 스크립트) |
| 1 | 뷰어: Tauri 셸, 열기, 가상 스크롤, 줌, worker 렌더 |
| 2 | AP 생성기, 폰트 subset/embed, incremental 저장을 앱 모듈로 이식 |
| 3 | 텍스트 상자 UI (입력, IME, 이동, 재편집, 속성 바) |
| 4 | 하이라이트 (선택, 미리보기, 더블클릭, 색 변경, 삭제) |
| 5 | 기존 주석 import/복구, 호환성 테스트, 패키징 |

## 핵심 리스크
- MuPDF가 직접 만든 FreeText AP를 렌더나 저장 중에 재생성하는지
- Acrobat에서 앱의 FreeText를 편집하면 Acrobat이 AP를 재생성해서 다시 깨질 수 있음 (다른 프로그램에서는 보기만 하는 것을 전제)
- /Rotate 페이지에서의 AP 회전
- overlay와 AP 사이의 미세한 렌더 차이
