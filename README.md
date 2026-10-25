# 영수증 장부

영수증 사진을 올리면 AI가 매장명·날짜·품목·금액을 읽어서 일별/월별/매장별로 정리해주는 웹앱입니다.
매장별 PIN 로그인(자기 매장만 조회)과 관리자 로그인(전체 조회 + 매장 관리)을 지원합니다.

## 1. 로컬에서 실행해보기

```bash
npm install
cp .env.example .env.local   # 아래 2번에서 만든 Firebase 값 채우기
npm run dev
```

Netlify Function(영수증 분석)은 로컬에서 바로 안 돌아갑니다. `netlify dev`로 실행해야 합니다:

```bash
npm install -g netlify-cli
netlify dev
```

## 2. Firebase 프로젝트 준비

1. https://console.firebase.google.com 에서 새 프로젝트 생성 (기존에 쓰시던 프로젝트를 재사용해도 됩니다)
2. 왼쪽 메뉴 **빌드 > Firestore Database** → 데이터베이스 만들기 (테스트 모드로 시작해도 되고, 아래 3번 규칙을 바로 적용해도 됩니다)
3. **프로젝트 설정(톱니바퀴) > 일반 > 내 앱** 에서 웹 앱 추가 → `firebaseConfig` 값들을 복사
4. 이 값들을 `.env.local` (로컬용) 그리고 **Netlify 환경변수** (배포용, 아래 4번)에 입력

## 3. Firestore 보안 규칙

PIN 확인은 앱 안에서만 이루어지므로, 아래는 기본적인 열린 규칙입니다. 외부에서 데이터베이스 주소를 알아도 함부로 손대지 못하게 최소한의 형태 검증만 넣었습니다. 더 강한 보안이 필요하면 나중에 Firebase Auth를 추가하는 걸 권장드립니다.

Firestore 콘솔 > 규칙 탭에서 아래로 교체하세요:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /config/{doc} {
      allow read: if true;
      allow write: if true;
    }
    match /receipts/{doc} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

## 4. Netlify 배포

1. 이 폴더를 GitHub 저장소로 올리거나, Netlify CLI로 직접 배포합니다.
   - GitHub 연동: Netlify 대시보드 > **Add new site > Import an existing project** > 저장소 선택
   - 빌드 명령/퍼블리시 폴더는 `netlify.toml`에 이미 설정되어 있습니다 (`npm run build`, `dist`)
2. Netlify 대시보드 > **Site configuration > Environment variables** 에서 아래 값들을 등록:

   | 이름 | 값 |
   |---|---|
   | `ANTHROPIC_API_KEY` | Anthropic 콘솔(console.anthropic.com)에서 발급받은 API 키 |
   | `VITE_FIREBASE_API_KEY` | Firebase 설정값 |
   | `VITE_FIREBASE_AUTH_DOMAIN` | Firebase 설정값 |
   | `VITE_FIREBASE_PROJECT_ID` | Firebase 설정값 |
   | `VITE_FIREBASE_STORAGE_BUCKET` | Firebase 설정값 |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase 설정값 |
   | `VITE_FIREBASE_APP_ID` | Firebase 설정값 |

3. **Deploy site** 클릭. 이후 배포마다 자동으로 `netlify/functions/analyze-receipt.js`가 서버리스 함수로 함께 배포됩니다.

`ANTHROPIC_API_KEY`는 서버(Netlify Function) 안에서만 쓰이고 브라우저로는 절대 내려가지 않습니다.

## 5. 첫 로그인

- 처음 접속하면 등록된 매장이 없습니다. **관리자 로그인**을 누르고 기본 PIN `0000`으로 들어가세요.
- **매장 관리** 탭에서 매장명 + PIN을 등록하고, 필요하면 관리자 PIN도 바로 바꾸세요.
- 이후 각 매장 직원은 **매장 로그인**으로 자기 매장 PIN을 입력해 들어오면, 그 매장 영수증만 보이고 새로 올리는 영수증도 자동으로 그 매장 이름이 붙습니다.

## 폴더 구조

```
receipt-ledger/
├── src/
│   ├── App.jsx          # 메인 화면 (로그인, 탭, 카드, 관리자 패널)
│   ├── firebase.js       # Firebase 초기화
│   └── main.jsx
├── netlify/functions/
│   └── analyze-receipt.js  # 영수증 이미지를 Claude API로 분석하는 서버 함수
├── netlify.toml
├── package.json
└── .env.example
```
