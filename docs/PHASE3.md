# Phase 3 결과: 텍스트 상자 UI

2026-11-02

## 구현한 것

| 영역 | 내용 |
|---|---|
| 표시 | base 비트맵에서 앱 FreeText를 숨기고(`HIDDEN.textBoxes`), HTML overlay(`src/annot/TextLayer.tsx`)로 그림. 하이라이트는 Phase 4 전까지 base에 남음 |
| 폰트와 레이아웃 | 메인 스레드도 같은 Pretendard TTF를 FontFace(`TypenotePretendard`, 400/600)로 등록하고 파싱함. 상자 크기와 줄 높이는 엔진의 `layoutText`(hmtx, 커닝 없음)를 그대로 씀. mupdf에 의존하지 않는 `engine/layout.ts`, `engine/faces.ts`로 분리함. CSS는 `font-kerning: none`, 합자와 대체 글리프를 끄고, AP와 같은 line-height와 padding을 씀 |
| 도구 | 선택(V)과 텍스트(T). 마지막 도구와 기본 스타일을 기억함 |
| 텍스트 도구 | 빈 곳을 클릭하면 첫 줄 가운데가 클릭 지점에 오도록 새 상자를 시작함. 상자를 클릭하면 편집하고, 끌면 옮김. 확정 후에도 텍스트 도구를 유지함 |
| 선택 도구 | 클릭하면 선택, 끌면 이동, 더블클릭이나 Enter로 재편집, Delete로 삭제, Esc로 해제. **화살표로 1pt, Shift+화살표로 10pt 미세 이동**(선택이 없으면 쪽 이동) |
| 입력 | 상자 위치에 겹친 textarea. 폭은 레이아웃에 1em 여유를 더한 값이고, 줄바꿈은 Enter로만 함. **IME 조합 중(`isComposing` / 229)에는 Esc, Enter, 단축키를 처리하지 않음**. 확정은 Esc 또는 바깥 클릭(pointerdown). 빈 상자는 만들지 않고, 비운 상자는 지움 |
| 없는 글자 | Pretendard에 없는 글자는 입력 중 경고함. 표시할 때는 PDF와 같게 .notdef 자리(폭 1em의 □)로 보여 줌 |
| 속성 바 | 크기(−, 직접 입력과 프리셋 10/12/14/18/24, +), B(Regular/SemiBold), 색(검정, 파랑, 빨강, 초록, 보라 + 색상 선택기), 삭제. 선택하거나 편집 중인 상자 위에 떠서 표시됨. 텍스트 도구에서는 툴바에도 붙어 있고, 선택한 상자가 있으면 그 상자, 없으면 도구 기본값을 바꿈 |
| 단축키 | Ctrl+B(굵게), Ctrl+Shift+. / Ctrl+Shift+,(크기 한 단계), Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. 편집 중인 textarea 안에서 Ctrl+Z는 브라우저 기본 동작(입력 취소)을 씀 |
| Undo/redo | `DocStore`의 command 스택. 각 명령은 상자의 이전/이후 상태를 보관함. 확정, 이동, 삭제, 속성 변경이 각각 한 단계. 1초 안의 연속 미세 이동과 크기 단계 변경은 한 단계로 합침. 생성을 되돌리면 삭제되고, 다시 실행하면 같은 id로 되살아남 |
| 즉시 반영 | 편집하면 화면 상태가 먼저 바뀌고, worker 결과로는 객체 번호만 받음(놓은 상자가 되돌아가 보이지 않게). worker가 거부하면 원래대로 되돌리고 그 undo 단계도 지움. 상자 id(`typenote-` + uuid)는 메인 스레드에서 만듦 |
| 툴바 | 항상 한 줄이고 높이가 고정됨(줄바꿈되면 페이지 영역이 줄어 쪽 맞춤이 다시 계산되고, 그 사이 들어온 PageDown이 쪽 안 스크롤로 처리되던 문제가 있었음). 줌 맞춤은 ▾ 메뉴로 옮김(쪽 맞춤, 폭 맞춤, 실제 크기) |

## 검증

- **단위 테스트 44개**: 엔진 14, DocStore 11(즉시 반영, undo/redo, 합치기, 롤백 포함), 뷰어 15, 스타일 4
- **실제 앱** (`tools/text-test.mjs` + `run-app.ps1`, DevTools 프로토콜로 실제 마우스·키 입력과 `Input.imeSetComposition`):
  - 클릭 → 두 줄 입력 → Esc로 확정, 상자가 선택된 상태로 남음
  - **IME**: 조합 중 Esc와 Enter는 무시되고 "한글"이 중복 없이 한 번만 들어감. 조합 중에 바깥을 클릭해도 "자"가 한 번만 남고 빈 상자는 생기지 않음
  - 선택 → 끌어 이동 → 화살표 ×3과 Shift+↓ → Ctrl+Z 한 번에 미세 이동 전체가 취소되고, 한 번 더 누르면 이동이 취소됨
  - Ctrl+B, Ctrl+Shift+., 파랑 스와치 → SemiBold 14pt 파랑
  - 더블클릭 재편집, Delete → Ctrl+Z → Ctrl+Y → Ctrl+Z
  - 빈 클릭 후 Esc로 상자가 생기지 않음, 이모지 경고, 회전(90) 페이지에 생성, 3초 뒤 자동 저장
- **저장된 파일** (`spike/verify.ts`): FontFile2, pdffonts emb/sub/uni yes, AP 불변, 회전 페이지 정방향 통과. 일부러 넣은 이모지 상자 하나는 .notdef(CID 0)로 저장돼 ToUnicode 역매핑이 "�"로 나옴(의도된 동작)
- **overlay와 AP 일치** (`tools/overlay-test.mjs`): 앱 화면 캡처와 저장된 PDF를 MuPDF로 같은 device 배율로 렌더한 결과의 글자 잉크를 비교함. 상자 4개(8, 10, 18 SemiBold 2줄, 24pt):

  | 배율 | 잉크 bbox 차이 | 최적 정렬 IoU |
  |---|---|---|
  | 100% (2.33 px/pt) | 좌우 0~1 px, 상하 0~2 px | 0.81~0.92 |
  | 150% (3.5 px/pt) | 좌우 0~1 px, 상하 0~2 px | 0.90~0.94 |

  가로는 사실상 일치함(글자 폭이 같음). 세로는 overlay가 0~2 device px(≤0.6pt) 위에 그려짐. Chromium이 폰트 ascent/descent를 정수로 반올림하기 때문으로 보임. SPEC 리스크 "overlay와 AP 사이의 미세한 렌더 차이"는 이 수준임

## 직접 확인할 것

```bash
npm run tauri dev
```

- ☐ 실제 한글 IME로 빠르게 입력하고 Esc나 바깥 클릭으로 확정했을 때 마지막 글자가 중복되거나 빠지지 않는지
- ☐ 상자 끌기, 화살표 미세 이동, Delete, Ctrl+Z/Y가 자연스러운지
- ☐ 속성 바(크기 입력, B, 색)가 편하게 쓰이는지, 위치가 상자를 가리지 않는지
- ☐ 저장된 PDF를 Acrobat이나 브라우저에서 열었을 때 앱에서 본 위치와 같은지

## 알려진 한계와 다음으로 넘긴 것

- 삭제를 되돌린 상자는 겹침 순서상 맨 위로 옴(원래 순서 복원은 안 함)
- 여러 상자 선택이나 복사·붙여넣기는 없음(SPEC 범위 밖)
- 터치스크린 입력은 고려하지 않음
- 하이라이트 도구(H)와 하이라이트 overlay는 Phase 4
