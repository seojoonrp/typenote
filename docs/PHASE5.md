# Phase 5 결과: 호환성, 창, 패키징

2026-11-02

## 결정 (Phase 시작 시 사용자 선택)

- **기존 주석 복구: 하지 않음.** Phase 0에서 확인한 실제 깨짐은 FreeText가 아니라 Acrobat Fill & Sign이 페이지 내용에 평탄화한 글자였다. 다른 프로그램의 FreeText와 Fill & Sign 글자는 그대로 보여 주기만 하고, 앞으로의 타이핑은 이 앱으로 한다. SPEC에 반영함
- **실행 중 다른 PDF 열기: 새 창.** 파일마다 창 하나

## 구현한 것

| 영역 | 내용 |
|---|---|
| 파일마다 창 하나 | `tauri-plugin-single-instance`로 두 번째 실행(.pdf 더블클릭, 명령줄)을 첫 프로세스가 받음. 그 파일을 연 창이 있으면 그 창을 앞으로 가져오고(경로 대소문자·표기 무관), 문서가 없는 창이 있으면 그 창에서, 아니면 새 창에서 엶. 창 안에서 최근 파일, 열기, 끌어 놓기로 다른 창에 이미 열린 파일을 열면 그 창을 앞으로 가져옴. 상대 경로는 실행한 폴더 기준으로 풀림. 새 창은 main 창 설정을 그대로 씀(핀치 줌 포함) |
| 호환성 corpus | `src/pdf/engine/corpus.ts`: 파일 구조 변형 7가지(classic xref, xref stream + object stream, AES-256·RC4-128 소유자 암호만, startxref가 깨진 파일, /Rotate·/MediaBox를 페이지 트리에서 상속, 다른 프로그램 주석 + 간접 /Annots)와 앱과 같은 편집 왕복(상자 2개 + 하이라이트 → 저장 → 다시 열어 수정·이동·삭제·색 변경·하이라이트 추가 → 저장) |
| 렌더 비교 | `tools/compat-render.ts`: corpus와 samples의 편집 결과를 MuPDF(이 앱), poppler, PDFium(Chrome·Edge의 엔진), pdf.js(Firefox의 엔진)로 2배 렌더해서 앱 주석의 위치와 색을 비교하고, 엔진별 잘라낸 그림을 나란히 붙인 contact sheet를 만듦. PDFium(`@hyzyla/pdfium`)과 pdf.js(`pdfjs-dist`)는 개발 의존성 |
| 설치 파일 | NSIS, 사용자 단위 설치(관리자 권한 없음), 설치 화면 한국어. `.pdf`를 "연결 프로그램" 목록에 등록 |

## 검증

- **단위 테스트**: 기존 55개 + 호환성 왕복 7개(파일 구조 변형마다)
  - 저장 방식: 깨진 파일은 첫 저장만 full(repair 후), 그 뒤는 incremental. 나머지는 모두 incremental이고 원본 바이트가 앞부분에 그대로 남음
  - 다시 열 때 repair가 필요 없음. 암호 걸린 파일은 저장 후에도 암호가 유지됨
  - 상자와 하이라이트가 쓴 그대로 읽힘. MuPDF가 상자 AP에서 뽑은 글자가 원문과 같음(암호 파일의 복호화 포함)
  - 다른 프로그램의 주석(FreeText, Highlight, 메모)은 개수와 종류가 그대로
- **Rust 테스트**: 기존 4개 + 창 2개(명령줄 PDF 인자 해석, 대소문자가 다른 같은 파일 판별)
- **창 동작** (`tools/window-test.mjs`, 실제 앱을 여러 번 실행): 8단계 모두 기대대로
  1. 파일 없이 실행 → 빈 창 하나
  2. a.pdf 실행 → 빈 창이 a.pdf를 엶(창 1개)
  3. b.pdf 실행 → 새 창(창 2개)
  4. `A.PDF`(대문자 경로) 실행 → 창이 늘지 않고 a 창이 앞으로
  5. b 창에서 a.pdf를 열면 b는 그대로이고 a 창이 앞으로
  6. b 창을 닫은 뒤 b.pdf 실행 → 다시 새 창
  7. 상대 경로 `c.pdf`로 실행 → 실행한 폴더의 c.pdf가 새 창에서 열림
  8. 두 번째 실행 프로세스는 매번 바로 종료됨(exit 0)
- **렌더 엔진 비교** (`tools/compat-render.ts`, 7개 변형 + samples 2개, 2배 렌더): 앱 주석의 경계 차이가 MuPDF 대비 poppler, PDFium, pdf.js 모두 **최대 1 px**. 하이라이트 평균 색 차이는 채널당 3 이하. contact sheet에서 한글 상자가 네 엔진에서 같은 모양으로 보임(회전 쪽, 실제 Acrobat 파일 포함)
- **release 빌드** (`npm run tauri build`, 처음 5분 47초. 대부분 의존 crate 최초 컴파일과 LTO 링크): `typenote.exe` 14.4 MB, 설치 파일 `src-tauri/target/release/bundle/nsis/typenote_0.1.0_x64-setup.exe` 7.97 MB
- **release 빌드 실제 동작** (`tools/release-test.mjs` + `run-app.ps1 -Release`, dev 서버 없이 DOM과 실제 입력만): 파일이 열리고 비트맵이 그려짐, dev hook 없음, 오류 배너 없음. 텍스트 도구로 "릴리스 빌드 확인 Release 123" 입력, 하이라이트 드래그, 자동 저장("저장됨"). 저장된 파일에 FreeText(Pretendard subset `FontFile2` embed)와 하이라이트(청록 40%)가 들어 있음. CSP, wasm, worker, 폰트 asset이 release에서도 정상

## 직접 확인할 것

설치:

- ☐ `src-tauri/target/release/bundle/nsis/typenote_0.1.0_x64-setup.exe` 실행. 코드 서명이 없어서 "Windows의 PC 보호" 창이 뜨면 "추가 정보" → "실행". 관리자 권한은 묻지 않음
- ☐ PDF 오른쪽 클릭 → "연결 프로그램"에 typenote가 보이는지. 기본 앱으로 쓰려면 "다른 앱 선택"에서 typenote를 고르고 "항상"을 누름(Windows 11은 앱이 기본 앱을 스스로 바꿀 수 없음)
- ☐ 앱이 켜져 있을 때 다른 PDF를 더블클릭하면 새 창이 뜨는지, 이미 연 PDF를 다시 더블클릭하면 그 창이 앞으로 오는지(Windows 포커스 규칙상 작업 표시줄만 깜빡일 수도 있음)

다른 뷰어 (`spike/out/compat/`에 앱으로 편집한 파일이 있음. `sample-*.pdf`는 samples 복사본에 편집한 것):

- ☐ Acrobat에서 한글 상자("수정된 상자 Edited / 둘째 줄 그대로")가 Pretendard로 보이고, 하이라이트(노랑 60%, 청록 40%)가 앱과 같은 색인지
- ☐ Acrobat에서 하이라이트를 선택하고 색을 바꾸거나 지울 수 있는지. 그렇게 저장한 파일을 앱에서 다시 열었을 때 상자가 그대로이고 편집할 수 있는지
- ☐ 암호 파일(`aes256-owner-only.pdf`, `rc4-128-owner-only.pdf`)이 Acrobat에서 암호 없이 열리고 상자가 보이는지
- ☐ Edge나 Chrome에서 같은 파일(엔진 비교는 PDFium으로 했지만 실제 브라우저에서도 한 번)

## 알려진 한계

- 코드 서명이 없어서 설치할 때 SmartScreen 경고가 뜸
- 자동 업데이트 없음. 새 버전은 설치 파일을 다시 실행하면 덮어씀
- 사용자 암호(열 때 암호를 묻는 PDF)는 여전히 지원하지 않음. 소유자 암호만 걸린 파일은 지원하지만, 그 파일의 권한 설정(주석 수정 금지 등)은 따르지 않음
- linearized PDF는 MuPDF가 더 이상 만들 수 없어 corpus에 없음. incremental 저장하면 linearize가 풀리는 것은 정상이고 읽기에는 영향이 없음
- 창마다 MuPDF worker가 따로 떠서, 창 하나당 메모리를 따로 씀
- 창 크기와 위치는 기억하지 않음. 새 창은 Windows 기본 위치에 뜸
- Acrobat 동작은 자동으로 확인하지 못함(위 체크리스트)
