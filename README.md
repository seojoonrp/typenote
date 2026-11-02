# typenote

PDF에 한글 텍스트 상자와 하이라이트를 넣는 1인용 Windows 앱. Acrobat에서 한글 주석이 깨지는 문제를 피하려고 만들었다. 텍스트 상자는 Pretendard를 PDF 안에 embed해서, Acrobat, 브라우저, 다른 뷰어에서도 같은 모양으로 보인다.

## 설치

1. `npm run tauri build`로 만든 `src-tauri/target/release/bundle/nsis/typenote_<버전>_x64-setup.exe`를 실행한다. 사용자 단위 설치라 관리자 권한이 필요 없다.
2. 코드 서명이 없어서 "Windows의 PC 보호" 창이 뜨면 "추가 정보" → "실행"을 누른다.
3. PDF를 typenote로 바로 열려면: PDF 오른쪽 클릭 → "연결 프로그램" → "다른 앱 선택" → typenote → "항상".

지울 때는 Windows 설정 → 앱 → 설치된 앱 → typenote → 제거.

## 사용법

UI는 영어다.

| 기능 | 방법 |
|---|---|
| 열기 | Open(Ctrl+O), Recent, 창에 끌어 놓기, PDF 더블클릭. 모두 한 창의 새 탭에서 열리고, 이미 열린 파일이면 그 탭으로 이동 |
| 탭 | ×, 가운데 클릭, Ctrl+W로 닫기. Ctrl+Tab / Ctrl+Shift+Tab으로 이동 |
| 텍스트 상자 | Text(T) 도구에서 클릭하고 입력. Enter로 줄바꿈, Esc나 바깥 클릭으로 확정. 상자를 클릭하면 그 위치에서 편집, 윤곽선을 끌면 이동. 크기는 10/12/14/16/20/24 중에서 고르거나 직접 입력. 한글은 자간을 1.5% 줄여서 씀 |
| 상자 스타일 | 속성 바: 크기, 굵게(Ctrl+B), 색. Ctrl+Shift+. / , 로 크기 한 단계 |
| 하이라이트 | Highlight(H) 도구에서 글자 위를 드래그, 단어는 더블클릭. 높이는 글자에 딱 맞음. 하이라이트를 클릭하면 색, 불투명도, 삭제 |
| 선택 | Select(V) 도구. 상자나 하이라이트를 클릭해 고르고, Delete로 삭제, 화살표로 1pt 이동(Shift는 10pt). PDF의 글자를 끌거나 더블클릭해 고르면 Ctrl+C나 Copy 버튼으로 복사. 쪽 바깥을 클릭하면 선택 해제 |
| 되돌리기 | Ctrl+Z, Ctrl+Y |
| 저장 | 편집하고 3초 뒤 원본에 자동 저장. Ctrl+S, Save As(Ctrl+Shift+S), Save 메뉴의 "Save Compacted"(파일 크기 줄이기) |
| 보기 | 한 쪽씩. PageUp/PageDown, 화살표, 휠로 쪽 이동(휠 한 칸에 한 쪽, 계속 굴리면 계속 넘어감). 툴바의 쪽 번호를 클릭하면 번호를 입력해 이동. 오른쪽 스크롤바는 문서 전체에서의 위치이고 끌면 쪽 이동. Ctrl+휠, 터치패드 핀치, Ctrl+0(쪽 맞춤), Ctrl+2(폭 맞춤) |

## 개발

- 명세: [docs/SPEC.md](docs/SPEC.md), 개발 규칙: [CLAUDE.md](CLAUDE.md), 단계별 기록: `docs/PHASE*.md`
- 실행: `npm run tauri dev`
- 검사: `npm run typecheck`, `npm test`, `cd src-tauri && cargo test && cargo clippy --all-targets`
- 배포 빌드: `npm run tauri build`
