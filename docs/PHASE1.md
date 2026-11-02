# Phase 1 결과: 뷰어

2026-11-02 · Tauri 2.12 · React 19.3 · Vite 8.3 · mupdf 1.28.1 · Rust 1.99.1

## 구현한 것

| 영역 | 내용 |
|---|---|
| Tauri 셸 | 창 1개(1100×850). CSP 적용(`wasm-unsafe-eval` 허용). 권한은 `core:default`, `core:window:allow-set-title`, `dialog:allow-open`만 |
| 열기 | 대화상자(Ctrl+O), 드래그 앤 드롭(Tauri `onDragDropEvent`), 최근 파일 10개(`%APPDATA%\dev.typenote.desktop\settings.json`), 실행 인자로 받은 경로(`launch_path`) |
| 파일 I/O | `read_pdf`가 `tauri::ipc::Response`로 바이트를 그대로 넘긴다(JS에서는 ArrayBuffer). worker로 transfer해서 복사가 없다 |
| 연결 프로그램 | `bundle.fileAssociations`에 `.pdf`를 선언만 해 둠. 실제 등록은 설치 프로그램이 하므로 Phase 5 패키징 때 확인 |
| worker | mupdf를 동적 import. 문서 1개, 페이지 객체 LRU 8개. 렌더는 Pixmap(RGBA, 흰 배경) → ImageBitmap으로 transfer. 우선순위 큐와 취소를 지원하고, 큐는 MessageChannel로 돌려 타이머 제한을 받지 않음. `hideAppAnnots` 옵션은 있지만 overlay가 생기기 전까지는 꺼 둠 |
| 한 쪽씩 보기 | Phase 1 피드백으로 연속 스크롤에서 바꿈. 현재 쪽 하나만 가운데 배치. 쪽이 화면에 들어오면 ↑↓←→, PageUp/Down, 휠로 쪽 단위로 바로 이동(애니메이션 없음). 쪽이 화면보다 길면 ↓↑는 48px, PageUp/Down은 한 화면씩 그 쪽 안에서 움직이다가, 끝에서 다음/이전 쪽(이전 쪽은 아래 끝)으로 감. Home/End는 첫/끝 쪽. 휠은 "버스트"(150ms 안에 이어지는 이벤트)당 최대 한 쪽만 넘기므로, 터치패드 관성으로 여러 쪽이 넘어가지 않음. 쪽 안에서 스크롤하다 관성으로 끝에 닿은 버스트는 넘기지 않음 |
| 렌더 | 현재 쪽 먼저, 그다음 +1, +2, −1 쪽을 미리 렌더해서 넘길 때 바로 보임 |
| 캐시 | (page, render scale) 키의 LRU. 총 7,200만 px(약 288MB) 예산이고, 지금 원하는 키는 내쫓지 않음. 해당 해상도가 없으면 가장 가까운 해상도를 늘려서 보여 줌 |
| 줌 | 100% = 실제 크기(1pt = 96/72 CSS px). 쪽 맞춤 / 폭 맞춤 / 사용자 지정(줌 모드와 %는 다음 문서와 다음 실행까지 기억). 단축키는 Acrobat과 같음: Ctrl+0 쪽 맞춤, Ctrl+1 100%, Ctrl+2 폭 맞춤, Ctrl+= / Ctrl+- 프리셋 단계. % 숫자를 클릭하면 직접 입력(Enter·바깥 클릭이면 적용, Esc는 취소). Ctrl+휠과 터치패드 핀치는 CSS `scale`로 미리 보여 주고 180ms 후 확정하며, 커서 아래 지점이 고정됨. 범위는 10%~800% |
| 터치패드 핀치 | `zoomHotkeysEnabled: false`이면 wry가 WebView2 `IsPinchZoomEnabled`도 꺼서 핀치가 페이지에 오지 않았음(실측: wheel 이벤트 0개). true로 바꾸고, 대신 앱이 Ctrl+휠과 줌 단축키를 전역에서 막아 UI 자체는 확대되지 않게 함. 핀치는 물리 Ctrl 없이 `ctrlKey`가 켜진 wheel로 오고, 배율은 `exp(-deltaY/100)` |
| 해상도 | render scale = 줌 × 96/72 × devicePixelRatio를 2^(k/4) 단위로 올림(버킷). 한 페이지는 최대 1,200만 px |

## 검증

- **실제 WebView2 (피드백 반영 후)**: `tools/run-app.ps1`로 DevTools 프로토콜에 붙어 OS 입력 없이 확인했다.
  - 터치패드 핀치 ×2(`Input.synthesizePinchGesture`): 100% → 200%. 이벤트 28개, deltaY 합 −69.3 = −100·ln2. ×0.5 핀치로 100%로 돌아옴.
  - Ctrl+휠 한 칸: 116%. Ctrl+=: 125%. Ctrl+1: 100%.
  - 위 모든 경우에 UI는 확대되지 않음(visualViewport 1, devicePixelRatio 그대로).
  - 쪽 맞춤 상태: PageDown ×2, ↓, ↑, End, Home, 휠 한 칸 ×2가 모두 쪽 단위로 이동. 30개 이벤트 스와이프는 정확히 한 쪽.
  - 300% 상태: ↓는 48px, PageDown은 한 화면씩 쪽 안에서 움직이고 끝에서 다음 쪽 맨 위로 감. PageUp은 위로 한 화면.
  - 배율 입력: "300" + Enter로 적용되고 포커스가 페이지로 돌아옴. Esc는 바뀌지 않음.
- **단위 테스트** 15개(`src/viewer/viewer.test.ts`): 한 쪽 레이아웃, 쪽/폭 맞춤, 키 이동, 휠 버스트, % 파싱, 줌 단계, 버킷, 픽셀 상한, LRU.
- 아래는 피드백 이전 연속 스크롤 시점의 확인이다(열기, 렌더, 회전, 빌드 관련 부분은 지금도 유효).
- **브라우저 창**(dev 서버, 그리고 `vite build` 결과물을 preview로):
  - `sample-normal.pdf`(18쪽): 스크롤, 쪽 번호 표시, 가상화를 확인했다.
  - 키보드 줌(102→110→125%): 다시 렌더되고 중앙 지점이 유지된다.
  - Ctrl+휠: 제스처 중 커서 아래 지점이 고정되고, 확정 후 265%로 다시 렌더된다.
  - `step2.pdf`: `/Rotate 90`, `/Rotate 270` + CropBox 페이지가 똑바로 보인다.
  - PDF가 아닌 파일은 오류로 표시된다. 최근 파일에서 클릭해 열기도 된다.
- **360쪽 문서**: 열기 75ms, 201쪽 렌더 36ms. DOM 페이지 자리는 5개.
- **실제 Tauri 창**(`tauri build --debug`): PDF를 인자로 실행하면 1.5초 안에 창 제목이 바뀌고, 페이지가 렌더되고, settings.json에 최근 파일이 저장된다.

## 직접 확인할 것 (네이티브 창)

```bash
npm run tauri dev
```

- ☐ 열기 버튼과 Ctrl+O로 대화상자가 뜨고, PDF를 고르면 열린다
- ☐ 탐색기에서 PDF를 창에 끌어다 놓으면 열린다
- ☐ 최근 파일 목록이 앱을 다시 켜도 유지된다
- ☐ 쪽 맞춤(Ctrl+0)에서 ↑↓, PageUp/Down, 휠, 터치패드 스와이프로 쪽이 하나씩 바로 넘어간다(스와이프 한 번에 두 쪽 이상 넘어가지 않는다)
- ☐ 확대해서 쪽이 화면보다 길면 쪽 안에서 스크롤되고, 끝에서 한 번 더 내리면 다음 쪽으로 간다
- ☐ 터치패드 핀치와 Ctrl+휠 줌이 커서 위치를 기준으로 자연스럽다
- ☐ % 숫자를 클릭해 배율을 입력할 수 있다
- ☐ 창 크기를 바꾸면 폭 맞춤 상태에서 페이지 폭이 따라간다
- ☐ 모니터를 옮기거나 배율이 바뀌면 글자가 다시 선명해진다

## 알려진 한계와 다음으로 넘긴 것

- 휠 버스트 간격(150ms)과 넘김 임계값(40px)은 실제 터치패드와 마우스로 써 보고 조정이 필요할 수 있다(`src/viewer/navigation.ts`).
- 쪽 안에서 휠로 스크롤할 때는 Chromium 기본 부드러운 스크롤이 적용된다. 키보드 이동은 애니메이션이 없다.
- 터치스크린 핀치는 UI가 확대되지 않게 막기만 했고, 문서 줌으로 연결하지는 않았다.
- 아주 크게 확대하면(쪽당 1,200만 px 초과) 타일 렌더가 없어서 조금 흐려진다. A4 기준 약 550% × 175% 배율 이상이다.
- 이미 앱이 켜져 있을 때 다른 PDF를 더블클릭하면 새 창(새 프로세스)이 뜬다. single-instance 플러그인은 연결 프로그램 등록과 함께 Phase 5에서 처리한다.
- 암호 걸린 PDF는 "지원하지 않음" 오류로 처리한다.
- 앱 FreeText와 Highlight는 아직 base 비트맵에 그대로 그린다(`HIDE_APP_ANNOTS = false`). Phase 3/4에서 overlay가 생기면 켠다.
- 닫기 전 확인, 저장, undo는 편집 기능이 생기는 Phase 2 이후에 한다.
