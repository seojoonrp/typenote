# Phase 0 상세

`spike/` 폴더에 Node + TypeScript 스크립트로 작성 (UI 없음). mupdf.js와 harfbuzzjs API는 기억에 의존하지 말고 설치된 버전의 `.d.ts`와 export로 확인할 것.

입력:
- `samples/`의 PDF. Acrobat으로 한글을 써서 깨진 파일, Acrobat 하이라이트가 있는 파일이 들어 있을 수 있음
- 텍스트가 있는 일반 페이지와 /Rotate 90 페이지를 포함한 테스트 PDF를 mupdf.js로 직접 생성해서 함께 사용

## 스크립트

1. **`inspect.ts <pdf>`**: 모든 FreeText/Highlight 주석을 덤프
   - FreeText: /Contents, /DA, /RC 유무, AP 폰트 리소스(BaseFont, Subtype, Encoding, FontFile 유무)
   - Highlight: /C, /CA, AP의 blend mode
2. **`write.ts <in> <out>`**:
   - FreeText 3개 생성
     - Regular 12pt 검정 1줄
     - SemiBold 18pt 파랑 여러 줄 (한글+영문+숫자+기호)
     - /Rotate 90 페이지에 1개
   - 첫 페이지 첫 텍스트 줄에 Highlight (stext.highlight로 quad 계산)
   - incremental save
3. **`append.ts <in> <out>`**: 이전 결과물에 없던 한글 글자로 FreeText를 추가하고, subset 재생성 후 같은 객체 번호로 교체해서 두 번째 incremental save
4. **`verify.ts <pdf>`**: 아래 자동 검증을 수행하고 결과 출력

## 자동 검증 (verify.ts)
- 다시 열어서 각 페이지를 주석 포함 PNG로 `spike/out/`에 렌더. 그 PNG를 네가 직접 열어서 한글이 정상인지 눈으로 확인할 것
- 앱 FreeText의 모든 폰트에 FontFile2가 있는지 확인 (poppler `pdffonts`가 있으면 emb yes도 확인)
- ToUnicode CMap을 파싱해서 AP의 GID 시퀀스를 역매핑한 결과가 /Contents와 일치하는지
- 열기 → 렌더 → incremental save를 거친 뒤에도 FreeText AP stream 바이트가 그대로인지 (MuPDF가 재생성하는지 확인)
- append 이후에도 처음 만든 상자들이 정상 렌더되는지 (RETAIN_GIDS 전략 검증)
- Highlight AP의 blend mode 기록
- /Rotate 90 페이지의 FreeText가 화면 기준으로 똑바로 보이는지

## REPORT.md
- 각 검증 항목의 결과 (통과/실패와 근거)
- samples/의 Acrobat 파일 진단 결과: 한글이 깨진 실제 원인
- mupdf.js·harfbuzzjs API가 SPEC의 가정과 다른 점, 그에 따른 설계 수정 제안
- 내가 직접 확인할 체크리스트: 결과 PDF를 Acrobat, Edge, Chrome, Firefox, SumatraPDF에서 열어서 볼 항목
  - 다섯 곳에서 모양이 같은지
  - Acrobat에서 Highlight 선택, 색 변경, 삭제가 되는지
  - 텍스트를 복사하면 한글이 제대로 나오는지
  - 인쇄 미리보기에 나오는지
