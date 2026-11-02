# Phase 0 Spike Report

작성일 2026-11-02 · mupdf 1.28.1 · harfbuzzjs 1.6.4 · Node 22.17 · poppler 25.05 (MSYS2)

## 요약

- **핵심 가설은 성립한다.** FreeText의 AP를 직접 만들고 Pretendard subset(RETAIN_GIDS)을 `/FontFile2`로 embed한 결과, MuPDF와 poppler 두 엔진에서 한글, 두 weight, 기호, 회전 페이지가 모두 정상으로 렌더됐다. 자동 검증은 step1 10개, step2 11개, 실제 Acrobat 파일 9개 항목이 전부 통과했다.
- **MuPDF는 우리 AP를 다시 만들지 않는다.** 렌더, `page.update()`, `annot.update()`, incremental 저장을 거쳐도 AP 객체 번호와 바이트가 그대로였다. 단, **MuPDF의 annotation setter(`setRect`, `setContents`, `setColor` 등)를 한 번이라도 부르면** AP가 Helv+Batang을 쓰는 MuPDF 자체 AP로 교체된다. → 앱 FreeText는 raw 객체로만 수정해야 한다.
- **samples의 한글 "깨짐"은 FreeText 문제가 아니었다.** Acrobat **Fill & Sign**이 페이지 콘텐츠에 평탄화해 넣은 텍스트이고, 한글만 AdobeMyungjoStd-Medium(명조)으로 대체되어 "궁서체처럼" 보인 것이다. SPEC의 "Acrobat FreeText 복구" 기능은 대상을 다시 정해야 한다(아래 §4).
- **Acrobat 하이라이트는 불투명이 아니다.** samples의 하이라이트 10개는 모두 `/C [.2196 .898 1]`(청록), `/CA 0.4`, Multiply다. 노란색 샘플이 없어서 기본 노랑의 `/C`는 아직 확정하지 못했다.

## 실행 방법

```bash
cd spike
npm install
npm run phase0                                    # make-test → write → append → verify ×2
npx tsx inspect.ts ../samples/sample-korean.pdf   # 주석 덤프
npx tsx write.ts ../samples/sample-korean.pdf out/sample-korean-step1.pdf
npx tsx verify.ts out/sample-korean-step1.pdf
```

| 파일 | 내용 |
|---|---|
| `make-test.ts` | 테스트 PDF 생성. 1쪽 일반 텍스트, 2쪽 `/Rotate 90`, 3쪽 `/Rotate 270` + CropBox 오프셋(추가 항목). 본문은 맑은 고딕으로 써서 Pretendard와 섞이지 않게 함 |
| `inspect.ts` | FreeText/Highlight 덤프 (/Contents, /DA, /RC, AP 폰트, /C, /CA, blend) |
| `write.ts` | FreeText 3개 + 3쪽 추가 1개, 1쪽 첫 줄 Highlight, incremental 저장 |
| `append.ts` | 새 한글 글자로 상자 2개(두 weight) 추가, subset을 같은 객체 번호에 덮어쓰고 두 번째 incremental 저장 |
| `verify.ts` | 아래 §1의 자동 검증 + PNG 렌더(MuPDF 2x, poppler 144dpi) |
| `lib/` | `ttf.ts`(cmap/hmtx/메트릭), `subset.ts`(hb-subset WASM), `fonts.ts`(Type0 객체 생성/덮어쓰기), `freetext.ts`(레이아웃, AP, annot dict), `tounicode.ts`, `content.ts`(content stream 역해석), `document.ts`(폰트 동기화, 저장) |

결과물은 `spike/out/`에 있다(git 제외). 체크리스트용 파일은 `step2.pdf`와 `sample-korean-step1.pdf`이다.

## 1. 자동 검증 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 주석 포함 PNG 렌더, 육안 확인 | **통과** | `step1/step2-p{1,2,3}.png`(MuPDF)와 `-poppler-{1,2,3}.png`를 직접 열어 봤다. 두 엔진의 결과가 같다. Regular 12pt 검정, SemiBold 18pt 파랑 4줄(기호 `“” ‘’ · … → ※ ㈜ ① ½ °C` 포함)이 빠진 글자 없이 나온다. 5배 확대 렌더(`step2-zoom-append.png`)에서도 뷁·똠·햏·웹툰·꿻·쀍이 정상이다 |
| 앱 FreeText 폰트에 FontFile2 | **통과** | MuPDF 객체 검사: Type0/CIDFontType2, Identity-H, CIDToGIDMap Identity, FontFile2, ToUnicode 모두 있음. `pdffonts`: `CID TrueType Identity-H emb yes sub yes uni yes` (두 weight) |
| ToUnicode로 AP GID 역매핑 == /Contents | **통과** | 6/6 상자 일치. MuPDF 자체 텍스트 추출(`annot.toDisplayList().toStructuredText()`)로도 6/6 일치 |
| AP glyph가 embed된 subset에 실제로 있음 | **통과** | step2 기준 263개 GID 모두 subset의 `glyf`에 outline이 있음(공백 제외) |
| 열기 → 렌더 → incremental 저장 후 AP 바이트 불변 | **통과** | 렌더, stext, `page.update()`를 거친 뒤 저장해도 변경이 없어 0바이트가 추가됐다. 하이라이트 색을 바꾼 뒤 저장했을 때는 하이라이트 객체 `[19 43]`만 다시 쓰였고 FreeText AP 6개는 객체 번호와 raw/decoded 바이트가 모두 같았다. 원본 바이트 prefix도 보존됐다 |
| (실험) FreeText에 `annot.update()` 직접 호출 | 정보 | `false`를 반환하고 AP는 그대로였다 |
| (실험) FreeText에 MuPDF setter 호출 후 `update()` | 정보: **위험** | `setRect`, `setContents`, `setColor` 모두 AP를 새 객체로 교체했다(폰트 `/Helv`, `/Batang`) |
| (실험) raw `/Rect`, `/M` 수정 후 `page.update()` + `annot.update()` | 정보 | AP를 건드리지 않았다. 이동은 raw 수정으로 하면 안전하다 |
| append 후에도 처음 상자가 정상 (RETAIN_GIDS) | **통과** | 폰트 객체 번호 25/30이 유지됐고 BaseFont 태그만 바뀌었다(`TPKFRP→BUXZUU`, `VJGWJB→MXLCXF`). step1 상자 4개의 AP 객체 번호와 바이트가 그대로였다. 새 subset에 옛 GID가 모두 있고, PNG에서도 정상이다 |
| Highlight AP blend mode | **통과 (기록)** | MuPDF가 만든 AP는 ExtGState `/H << /BM /Multiply >>`이고 불투명이다. SPEC 조건(Multiply)을 충족하므로 AP를 직접 만들 필요는 없다. 다만 모양 차이가 있다: 양 끝이 둥글고, `/Rect`가 quad보다 약 5pt 넓다 |
| /Rotate 90 페이지 FreeText가 화면 기준으로 똑바로 | **통과** | `/Matrix [0 1 -1 0 0 0]`, form→page 선형변환 `[1 0 0 -1]`. stext 줄 방향 `[1,0]`. 두 엔진의 PNG에서 모두 똑바로 보인다. 추가 항목인 `/Rotate 270` + CropBox 오프셋 페이지도 통과했다 |
| (추가) `setHiddenForEditing(true)`로 base 렌더 | **통과** | 앱 주석을 숨기고 렌더한 결과가 주석 없는 렌더와 픽셀 단위로 같다(3쪽 모두) |
| (추가) repair된 파일 | 확인 | xref를 망가뜨린 파일: `wasRepaired()=true`, `canBeSavedIncrementally()=false`, `saveToBuffer("incremental")`이 `Can't do incremental writes on a repaired file`을 던진다. 따라서 full save fallback이 필요하다 |
| (추가) 실제 Acrobat 파일에 쓰기 | **통과** | `sample-korean.pdf`(기존 incremental 1회, Acrobat 하이라이트 2개)에 write → 9/9 통과 |

크기 측정:

| 항목 | 값 |
|---|---|
| subset (RETAIN_GIDS, 비압축) | 87 KB (Regular 53자) / 96 KB (SemiBold 91자). 대부분 `hmtx` 55 KB + `loca` 28 KB이다. 쓰인 최대 GID(약 13.8k)까지 테이블이 유지되기 때문 |
| subset (Flate 압축 후) | 5.8 KB / 8.5 KB |
| step1 → step2 | 100.8 KB → 124.5 KB. full GC 저장 시 104.7 KB. append 1회에 죽은 subset이 약 20 KB 쌓인다(SPEC의 GC 메뉴가 필요한 이유가 확인됨) |

## 2. samples 진단: 한글이 깨진 실제 원인

### `sample-korean.pdf` (원본 ezPDF Builder, Acrobat에서 1회 incremental 저장)

- **FreeText 주석이 없다.** 주석은 Highlight 2개와 Popup 2개뿐이다.
- 타이핑한 텍스트는 **Acrobat Fill & Sign**의 결과물이다. 페이지 콘텐츠 끝에 `/ADBE_FillSign BMC … /Fm0 Do EMC`가 붙어 있고, Form XObject마다 `/ADBE_FillSign << /Type /FillSignData /Subtype /text … >>` 메타데이터가 들어 있다. 즉 주석이 아니라 **페이지 콘텐츠로 평탄화**되어 있다.
  - 영문 줄("english text is fine …"): `/TT0` = `UNEHEF+Arial`, TrueType, WinAnsi, embed됨
  - 한글 줄("한글 텍스트는 깨져서 궁서체로 나옴"): `/C0_0` = `GACVHC+AdobeMyungjoStd-Medium`, CIDFontType0C, Identity-H, embed됨(FontFile3), ToUnicode 있음
- **결론**: glyph가 빠지거나 embed가 안 된 문제가 아니다. **Fill & Sign의 고정 글꼴(Arial)에 한글이 없어서 Acrobat이 내장 한국어 폰트인 Adobe 명조로 대체**한 것이다. 획이 있는 명조라서 "궁서체"처럼 보인다. 텍스트 추출은 정상이다(`pdftotext`로 한글이 그대로 나온다). Fill & Sign에서는 글꼴을 고를 수 없어서 피할 방법이 없다. 그러니 "Pretendard를 직접 embed한다"는 이 프로젝트의 해법은 실제 문제에도 맞는다.
- 하이라이트 2개: `/C [.219604 .898041 1]`, `/CA .399994`, `/T (최 서준)`, `/Subj (Highlight)`, `/NM` uuid, `/Popup`. AP 구조는 `/R0 gs`(ca/CA 0.4) + `/R1 gs`(BM Multiply) + `MWFOForm`(Transparency group) 안의 직사각형 fill이다.

### `sample-normal.pdf` (PowerPoint 2021 내보내기, 18쪽)

- FreeText 없음. Highlight 8개는 위와 같은 청록 + `/CA 0.4` + Multiply이다.

### SPEC 가정과 다른 점

- SPEC은 "FreeText AP 폰트에 한글 glyph가 없거나 embed가 안 됨"을 원인으로 추정했지만, 샘플에서 확인된 원인은 Fill & Sign 폰트 대체다. Acrobat **주석** FreeText(Comment → Add Text Comment)로 만든 한글 샘플이 없어서 그 경로는 검증하지 못했다.

## 3. mupdf.js / harfbuzzjs API: SPEC 가정과 다른 점

### mupdf.js 1.28.1

| 가정 | 실제 | 영향 |
|---|---|---|
| `page.getTransform()` | 있음. user→page 행렬(예: Rotate 90 → `[0 1 1 0 0 0]`) | 그대로 사용 |
| `setHiddenForEditing` | 있음. 동작 확인 | 그대로 사용 |
| `StructuredText.highlight(p, q)` | `highlight(p, q, max_hits = 100)` | 100줄을 넘는 선택은 잘린다. 글자는 **점이 글자 중심을 넘어야** 포함된다(Acrobat과 비슷). 프로그램으로 범위를 줄 때는 글자 가장자리 좌표를 써야 한다 |
| `saveToBuffer("incremental")` | 옵션 문자열. `"incremental"`만 주면 새 스트림이 **비압축**으로 저장됨 | **`"incremental,compress"`**를 써야 한다(폰트 87 KB → 5.8 KB) |
| `wasRepaired()` | 있음. `canBeSavedIncrementally()`도 있음 | 두 가지를 같이 확인한다 |
| `page.toStructuredText()` | **주석이 빠진다**. 주석까지 보려면 `page.toDisplayList(true).toStructuredText()` 또는 `annot.toDisplayList()` | 하이라이트 선택에는 오히려 유리하다(앱 FreeText 글자가 선택되지 않음) |
| FreeText 수정 | MuPDF setter + `update()`는 AP를 재생성한다(Helv/Batang) | **앱 FreeText에는 PDFAnnotation setter 금지.** raw `PDFObject.put`/`writeStream`만 사용 |
| raw `/Annots` 수정 | 이미 로드된 `PDFPage`의 주석 목록(JS `_annots` 캐시)에 반영되지 않음 | raw로 주석을 추가하거나 삭제한 뒤에는 worker에서 그 페이지를 `destroy()`하고 다시 로드한다 |
| `Pixmap.getPixels()` | WASM 메모리 뷰. 메모리가 늘면 detach됨 | 즉시 `.slice()`로 복사한 뒤 `postMessage` |
| `newString()` | PDFDocEncoding이 가능하면 그쪽으로 저장함 | `/Contents`를 UTF-16BE+BOM으로 강제하려면 `newByteString()` |
| JS 값 → PDF | `"(…)"`이면 문자열, 그 외 문자열은 name, 정수는 int | 객체 리터럴로 dict를 바로 만들 수 있다 |
| `addPage(…, "")` | 빈 contents면 `/Contents`를 생략함 | 테스트 생성 시에만 해당 |
| Highlight API | `/NM`, `/M`, `/CreationDate`, `/T`를 넣지 않음. 색을 바꿔도 `/M`을 갱신하지 않음. `/CA`는 재생성 AP에도 유지됨 | 앱이 `/NM`, `/M`, `/CreationDate`를 직접 넣는다 |

### harfbuzzjs 1.6.4

- v1의 타입 API(`Blob`/`Face`/`Font`/`Buffer`/`shape`)에는 **subset이 없다**. 대신 패키지에 `dist/harfbuzz-subset.wasm`이 따로 들어 있다(import 없음, `_initialize()` 필요). 이 파일을 직접 인스턴스화해서 `hb_subset_input_*` / `hb_subset_or_fail` C API를 호출했다(`lib/subset.ts`).
- 플래그 상수는 패키지에 없다. `hb-subset.h` 값 `RETAIN_GIDS = 0x2`를 썼고, subset의 cmap GID가 원본과 같은지로 실험적으로 검증했다.
- GSUB/GPOS/GDEF/DSIG는 drop했다(PDF 안에서는 쓰이지 않음).
- 앱(worker)에서도 같은 코드로 동작한다(`fetch` → `WebAssembly.instantiate`).

### 폰트

- 두 파일 모두 static TTF(`fvar` 없음)라서 instancing이 필요 없다. UPM 2048이라 `/W` 값이 정수가 아니다(소수 3자리로 저장).
- 메트릭: hhea asc 1950 / desc −494 / gap 0, OS/2 typo 1949 / −494 / 0, `USE_TYPO_METRICS` 켜짐. lineHeight = 1.1934 em. 브라우저가 typo 메트릭을 써도 차이가 0.0005 em(18pt에서 0.01pt 미만)이라 overlay와 AP는 사실상 일치할 것으로 본다(Phase 3에서 실측 필요).
- 테스트한 글자는 두 weight의 GID가 같았지만, 코드에서는 SPEC대로 폰트마다 따로 매핑한다.

## 4. 설계 수정 제안

결정이 필요한 것부터 적었다.

1. **[결정 필요] Phase 5 "Acrobat FreeText 복구"의 대상.** 실제 문제는 Fill & Sign 텍스트(페이지 콘텐츠)다. 선택지:
   - (a) 복구 기능을 빼고, 앞으로 이 앱으로만 타이핑한다.
   - (b) Fill & Sign 블록(`/ADBE_FillSign` marked content + `FillSignData /Subtype /text` Form)을 감지하고, 텍스트를 ToUnicode로 추출해 앱 FreeText로 바꾼 뒤 그 블록을 콘텐츠 스트림에서 제거한다. 페이지 콘텐츠를 고치는 작업이라 주석 편집보다 위험하다.
   - (c) Acrobat 주석 FreeText 샘플을 받아 원래 SPEC대로 진행한다.
   - 제 추천은 (a)로 시작하고, 필요해지면 (b)를 별도 Phase로 하는 것이다.
2. **[결정 필요] Highlight 데이터 모델에 `opacity` 추가.** 기존 Acrobat 하이라이트가 `/CA 0.4`라서, overlay가 불투명으로 그리면 import한 하이라이트가 훨씬 진하게 보인다. 새 하이라이트를 SPEC대로 불투명으로 할지, Acrobat처럼 0.4로 할지도 정해야 한다.
3. **[샘플 필요] 기본 노랑 `/C`.** Acrobat에서 기본색으로 하이라이트 1개를 만든 PDF가 있으면 그 값을 쓴다. 지금은 임시로 `[1 .819611 0]`을 쓰고 있다.
4. **[선택] 하이라이트 AP 모양.** MuPDF는 양 끝을 둥글게 그리고 `/Rect`를 약 5pt 넓힌다. Acrobat은 평평한 직사각형이다. Multiply는 충족하므로 그대로 둬도 된다. Acrobat과 똑같은 모양을 원하면 AP를 직접 만든다(간단함).
5. **규칙(CLAUDE.md에 반영함)**: 앱 FreeText는 raw 객체로만 다룬다. 저장 옵션은 `"incremental,compress"`, `canBeSavedIncrementally()`가 false면 `"garbage,compress"` full save를 쓴다. raw 주석 변경 뒤에는 페이지를 다시 로드한다. `getPixels()`는 바로 복사한다.
6. **SPEC 객체 구조에 추가한 것**(동작에 문제 없음, 확인용):
   - AP stream에 `0 Tc 100 Tz 0 Tr`: 상속되는 텍스트 상태를 초기화한다.
   - annot에 `/BS << /W 0 >>`, `/P`: 다른 뷰어가 AP를 재생성하더라도 테두리가 생기지 않게 한다.
   - 회전 페이지에서는 annot에 `/Rotate <페이지 회전>`: Acrobat의 관례다.
   - `/Contents`의 줄바꿈은 `\r`(Acrobat 관례). 읽을 때는 `\r\n|\r|\n`을 모두 허용한다.
   - pad = 2pt(SPEC에 값이 없어서 임시로 정함).
7. **subset 태그를 글리프 집합의 해시로 만든다.** 쓰인 글자 집합이 그대로면 태그가 같으므로 저장할 때 폰트 객체를 건드리지 않는다. 그래서 불필요한 incremental 증가가 없다.
8. **Phase 1 사전 준비**: 이 PC에 Rust(cargo/rustc)가 없다. Tauri 2를 쓰려면 rustup과 MSVC Build Tools를 설치해야 한다(WebView2는 Windows 11에 기본 포함).

### SPEC 핵심 리스크 현황

| 리스크 | 현황 |
|---|---|
| MuPDF가 우리 AP를 재생성 | MuPDF에서는 **해소**. 단, setter를 쓰면 재생성되므로 규칙으로 막는다 |
| Acrobat에서 편집하면 AP가 재생성되어 깨짐 | 미검증. 아래 체크리스트로 확인 |
| /Rotate 페이지 AP 회전 | MuPDF와 poppler에서 **해소**(90, 270 + CropBox). 다른 뷰어는 체크리스트로 확인 |
| overlay와 AP의 차이 | 메트릭상 거의 없음. Phase 3에서 실측 |

## 5. 직접 확인할 체크리스트

열 파일:
- `spike/out/step2.pdf` (주 테스트 파일, 3쪽)
- `spike/out/sample-korean-step1.pdf` (실제 Acrobat 파일 + 앱 상자 2개 + 노란 하이라이트. 하이라이트는 stext 읽기 순서상 첫 줄인 쪽 번호 "12"에 붙어 있음)

정답 그림은 `spike/out/step2-p1.png`, `step2-p2.png`, `step2-p3.png`이다.

| 확인 항목 | Acrobat | Edge | Chrome | Firefox | SumatraPDF |
|---|---|---|---|---|---|
| 1쪽: 상자 3개(검정 1줄, 파랑 SemiBold 4줄, 보라 1줄)가 정답 그림과 같은 위치·모양·굵기 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 1쪽: 기호 줄 `“따옴표” ‘작은’ · … → ※ ㈜ ① ½ °C`에 빈 네모나 다른 글꼴이 없음 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 1쪽: 첫 줄의 노란 하이라이트 아래 글자가 검정 그대로 보임 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2쪽(가로): 빨간 2줄 상자와 청록 굵은 상자가 똑바로 읽힘 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3쪽(가로): 초록 굵은 상자가 똑바로 읽히고 위치가 본문 아래 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 텍스트 복사: 상자 글자를 선택해 메모장에 붙이면 한글이 그대로 나옴. 선택이 안 되는 뷰어는 Acrobat 주석 목록이나 속성에서 내용이 한글인지 확인 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 인쇄 미리보기에 상자와 하이라이트가 나옴 | ☐ | ☐ | ☐ | ☐ | ☐ |

Acrobat에서만 볼 것:
- ☐ 노란 하이라이트를 클릭해 선택할 수 있다
- ☐ 하이라이트 색을 바꿀 수 있다
- ☐ 하이라이트를 삭제할 수 있다
- ☐ 주석 목록에 FreeText 6개가 한글 내용으로 보인다
- ☐ **하이라이트 색을 바꾸고 저장한 뒤 다시 열었을 때, 상자 6개가 그대로다**(Acrobat이 저장할 때 다른 주석의 AP를 재생성하는지 확인)
- ☐ (선택, 사본으로) 상자 하나를 더블클릭해 편집하면 모양이 어떻게 바뀌는지. 깨지면 SPEC의 "다른 프로그램에서는 보기만" 전제를 확인한 셈이다

`sample-korean-step1.pdf`에서 볼 것:
- ☐ 기존 청록 하이라이트 2개와 Fill & Sign 텍스트가 그대로이고, 앱 상자 2개가 Pretendard로 보인다

## 6. 다음 단계 전에 필요한 것

1. §4의 1, 2, 4번 결정
2. Acrobat 기본 노랑 하이라이트 샘플(가능하면 Acrobat "Add Text Comment"로 한글을 쓴 FreeText 샘플도)
3. 위 체크리스트 결과
4. Phase 1용 Rust 설치
