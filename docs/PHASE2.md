# Phase 2 결과: AP 생성기, 폰트 subset/embed, 저장

2026-11-02 · mupdf 1.28.1 · harfbuzzjs 1.6.4 · Tauri 2.12

## 구현한 것

| 영역 | 내용 |
|---|---|
| 엔진 `src/pdf/engine/` | spike의 lib를 옮김: TTF 파서, ToUnicode, AP 생성, 공용 Type0 폰트, hb-subset. 환경 의존이 없어서(폰트 바이트와 wasm을 `FontKit`으로 주입) worker와 Node 테스트가 같은 코드를 씀 |
| `PdfEditor` | `textBoxes()`는 앱 FreeText를 모델로 읽음. `putTextBox()`는 생성과 수정을 함께 처리하고, 수정할 때 annot과 AP 객체 번호를 유지함. 다른 쪽으로 옮기면 같은 id로 다시 만듦. `deleteTextBox()`가 있음. `save(full?)`은 incremental 저장이고, repair된 파일이나 정리 요청이면 full(garbage) 저장. 폰트에 없는 글자는 `missing`으로 알려 줌 |
| 폰트 | 편집할 때마다 문서 전체 사용 글자의 합집합으로 같은 객체에 다시 subset함. 글리프 집합이 그대로면 건드리지 않음. Pretendard TTF 2개와 `harfbuzz-subset.wasm`은 Vite asset이고, worker가 첫 편집 전에 미리 받아 둠 |
| worker | 셸(`worker.ts`, 리스너와 순서 보장)과 세션(`session.ts`, 동적 import)으로 나눔. 상자를 편집하면 그 쪽의 page 캐시를 버림. 저장 후에는 저장한 바이트로 문서를 다시 열어서 다음 저장이 그 위에 이어 붙음 |
| Rust `write_pdf` | 바이너리 IPC 본문과 헤더(`x-path`는 percent-encoded, `x-stamp`)를 받아 같은 폴더 temp 파일에 쓰고 sync한 뒤 rename. 실패를 4가지로 구분함: `conflict`(연 뒤에 크기나 수정 시각이 바뀜), `locked`(os error 5/32/33), `readonly`, `io`. temp 파일은 실패해도 남기지 않음. `file_stamp` 명령도 추가 |
| `DocStore` (`src/doc/`) | 상자 목록, 변경 여부, 저장 상태를 관리. 편집 후 **3초 동안 입력이 없으면 원본에 자동 저장**. 저장 중에 들어온 편집은 다음 저장으로 넘김. `locked`면 10초마다 재시도. `conflict`와 `readonly`면 자동 저장을 멈추고 사용자에게 맡김. 새 파일(다른 이름으로 저장)은 stamp 비교를 하지 않음 |
| UI | 저장 메뉴(저장 Ctrl+S, 다른 이름으로 저장 Ctrl+Shift+S, 정리하여 저장). 제목 옆 상태(수정됨 / 저장 중… / 저장됨 HH:MM). 창 제목에 `•` 표시. 저장 문제 배너(다시 시도, 덮어쓰기, 다른 이름으로 저장). 닫기와 다른 파일 열기 전에는 먼저 저장하고, 실패하면 확인을 받음. 편집한 쪽은 새 렌더가 올 때까지 이전 비트맵을 보여 주다가 바꿈 |
| dev 훅 | dev 빌드에만 `window.__typenote = { store, addTestBox(patch) }`. Phase 3 UI가 생기기 전 검증용 |

## 검증

- **엔진 테스트 14개** (`src/pdf/engine/engine.test.ts`, Node):
  - Type0/CIDFontType2/FontFile2/Identity-H 구조, ToUnicode 역매핑 == /Contents, 모든 글리프 outline 존재, MuPDF 텍스트 추출 일치
  - 모델을 쓰고 다시 읽기, 회전 90·270 + CropBox에서 정방향
  - 고쳐 쓸 때 객체 번호 유지, 다른 상자 AP 바이트 불변, 폰트를 같은 객체에 다시 subset
  - 이동은 /Rect만 바뀜, 다른 쪽으로 이동, weight 전환
  - 삭제 후 subset에서 글자가 빠짐, 연속 incremental 저장(앞 파일이 접두부로 유지)
  - MuPDF 렌더, `page.update()`, 하이라이트 편집 뒤에도 AP 불변
  - repair된 파일은 full 저장, 없는 글자 보고, 정리 저장으로 크기 감소
  - RETAIN_GIDS를 끄면 2개가 실패하는 것도 확인함(테스트가 실제로 잡아냄)
- **DocStore 테스트 8개**: 자동 저장 지연, 편집하면 타이머 재시작, 저장 중 편집, 잠김 재시도, 충돌 시 자동 저장 중단과 덮어쓰기, 다른 이름으로 저장, 경로 없는 문서, 쪽 다시 그리기 알림
- **Rust 테스트 4개**: 경로 디코딩, 쓰기와 충돌 판별, **다른 프로세스가 독점으로 연 파일 → locked**, 읽기 전용 파일
- **실제 앱(WebView2, `tools/save-test.mjs` + `run-app.ps1`)**:
  - 상자 추가 → 3초 뒤 자동 저장 → 회전 페이지 상자 + Ctrl+S
  - 다른 PowerShell 프로세스가 파일을 독점: "locked" 배너가 뜨고 수정 상태 유지 → 잠금이 풀린 뒤 자동 재시도로 저장됨
  - 외부에서 파일 수정: "conflict" 배너가 뜨고, 추가 편집도 자동 저장 안 함 → 덮어쓰기로 저장됨
  - 수정된 상태에서 창 닫기 → 저장한 뒤 닫힘
  - 디스크 파일을 Phase 0 `spike/verify.ts`로 검사: FontFile2, `pdffonts` emb/sub/uni yes, ToUnicode, 글리프, AP 불변, 회전 정방향 모두 통과. poppler 렌더에서도 정상

## 직접 확인할 것

UI가 Phase 3에 생기므로, 지금은 dev 빌드의 콘솔에서만 상자를 만들 수 있어요. 아래는 Phase 3 이후에 함께 확인해도 돼요.

```bash
npm run tauri dev
```

- ☐ 앱이 저장한 PDF(복사본으로 시험)가 Acrobat, Edge, Chrome에서 한글로 정상 표시되는지 (Phase 0 체크리스트와 같음)
- ☐ Acrobat으로 같은 파일을 연 채 앱에서 편집하면 "다른 프로그램이 열고 있음" 배너가 뜨고, Acrobat을 닫으면 저장되는지

## 알려진 한계와 다음으로 넘긴 것

- incremental 저장마다 바뀐 폰트 subset이 파일 뒤에 쌓여요(글자 집합이 바뀔 때만). "정리하여 저장"으로 줄일 수 있어요. 자동 정리 정책(예: 크기가 2배가 되면)은 필요해지면 추가할게요.
- 디스크 쓰기는 항상 파일 전체를 temp 파일에 쓰고 rename해요. 그래서 원본의 생성 시각, ACL, 대체 데이터 스트림(Zone.Identifier 등)은 유지되지 않아요.
- 하이라이트 편집(Phase 4)과 undo/redo(Phase 3)는 아직이에요. 하이라이트는 저장 경로에서 건드리지 않아요.
- 앱 FreeText는 아직 base 비트맵에 MuPDF가 그대로 그려요. Phase 3에서 overlay를 붙이면 `HIDE_APP_ANNOTS`를 켜요.
