# Pencil → HTML + CSS 디자인 스택 전환

## 배경 (2026-04-17)
초기에는 Designer 에이전트가 Pencil MCP 로 시안을 만들고, CTO 가 그 시안을 재해석해 코드로 옮기는 구조였다. 이 과정에서 다음 문제가 반복되었다.

1. **시각 산출물과 실제 구현의 drift**: Pencil 시안의 색상/간격/컴포넌트가 실제 코드와 달라짐 — 시안은 참고용, 코드는 별도 진실
2. **디바이스 목업 경험의 한계는 모바일 앱에 집중 — 웹 프로덕트에는 과도한 우회**: 본 프레임워크 사용자의 다수가 웹 앱을 만드는 상황에서 Pencil 은 오히려 핸드오프 비용을 늘림
3. **한 캔버스에 여러 시안 조망 / PNG 추출 / 줌** 같은 Figma 의 핵심 가치는 HTML + `panzoom` + `html-to-image` 200~300 LOC 로 재현 가능
4. **토큰 SSOT 부재**: Pencil 파일은 사람이 편집하는 시각 자산이라 토큰 변경이 코드로 자동 전파되지 않음

## 결정
**Designer 의 산출물을 HTML + CSS 로 전면 전환한다.** Pencil/Figma 사용 중단.

- 시각적 진실 = HTML 파일
- 토큰 SSOT = `docs/design/system/tokens.css`
- 컴포넌트 SSOT = `docs/design/system/components.css`
- 렌더/조망/PNG = 대시보드의 `/design` 페이지 (Design Canvas)
- CTO 컨텍스트에도 HTML 목업이 포함되어 실제 코드와 토큰·컴포넌트 이름이 1:1 일치

## 구조
```
docs/design/
├── system/
│   ├── tokens.css           ← 색·간격·반경·타이포·그림자 CSS 변수 (SSOT)
│   ├── components.css       ← .device-*, .ip-* 재사용 클래스
│   └── design-system.md     ← 명세 + CHANGELOG
└── mockups/
    ├── system/
    │   ├── preview.html     ← 시스템 시각 프리뷰 (부트스트랩 산출물)
    │   └── meta.json
    ├── {feature}/
    │   ├── {screen}.html    ← <link href="../../system/components.css">
    │   └── meta.json        ← name/feature/screen/device/flow/tokensUsed/componentsUsed
    └── ...
```

## Design Canvas (대시보드)
- `GET /api/design/mockups` — `docs/design/mockups/*/meta.json` 스캔 후 목업 목록 반환 ([mockup-scanner.ts](../../src/core/design/mockup-scanner.ts))
- `GET /design-assets/*` — `docs/design/` 정적 서빙
- `GET /design` — Design Canvas 클라이언트 ([canvas.html](../../src/dashboard/design/canvas.html))
- 기능: 다중 아트보드 병치, 휠/핀치 줌, 팬, 디바이스 필터, PNG 추출 (아트보드별/전체)
- 라이브러리: `panzoom` (마우스 + 터치), `html-to-image` (DOM → PNG)

## 에이전트 규칙 요약
- **Designer**: HTML 목업 생성. 리터럴 값 금지 — `var(--token)` 과 `.ip-*` 클래스만. 피처 폴더마다 `meta.json` 필수. `required_mcp_tools` 에서 `pencil` 제거.
- **CTO**: 디자인 시안 HTML + 디자인 시스템을 구현 레퍼런스로 삼고, 목업의 토큰·컴포넌트 이름을 실제 코드와 1:1 매핑.
- **Marketer**: 시각 자산은 Designer 에게 HTML 목업으로 요청.

## 구현 지점
| 파일 | 변경 |
|------|-----|
| `docs/design/system/tokens.css` | 신규 — 토큰 SSOT |
| `docs/design/system/components.css` | 신규 — 컴포넌트 SSOT |
| `docs/design/system/design-system.md` | 신규 — 명세 + CHANGELOG |
| `docs/design/mockups/system/preview.html` | 신규 — 시스템 부트스트랩 시안 |
| `docs/design/mockups/login/mobile.html` | 신규 — 예시 모바일 목업 |
| `docs/design/mockups/dashboard/desktop.html` | 신규 — 예시 데스크탑 목업 |
| `src/core/design/mockup-scanner.ts` | 신규 — meta.json 스캐너 |
| `src/dashboard/design/canvas.html` | 신규 — Design Canvas 클라이언트 |
| `src/dashboard/server.ts` | `/api/design/mockups`, `/design-assets/*`, `/design` 라우트 추가 |
| `src/core/agent/agent-defaults.ts` | Designer / CTO / Marketer 프롬프트·룰 갱신 (Pencil 제거) |
| `src/core/project/detectors/agent-recommender.ts` | 동적 Designer / CTO / Marketer 설정 동일 갱신 |
| `src/core/workflow/phases.ts` | design / development 페이즈 inputs + completionCriteria 갱신 |
| `src/core/context/context-manager.ts` | design/development/testing 페이즈 컨텍스트에 tokens/components/mockups 포함, feature 매칭 스캔 추가 |
| `package.json` | `build:assets` 가 `src/dashboard/design/` 도 dist 로 복사 |

## 관련 문서
- [디자이너 디자인 시스템 생명주기](./designer-design-system-lifecycle.md) — Pencil 전제 초기 버전 (v0)
- [에이전트 작업 언어 설정](./agent-language-setup.md) — 시스템 프롬프트 주입 패턴
- [에이전트 진실성 강제](./agent-truthfulness.md) — 프롬프트 최상단 룰 주입 패턴

## 테스트 관점
- 단위: Designer/CTO/Marketer 기본 설정에 "Pencil" 이 포함되지 않고, Designer 에 "HTML", "tokens.css", "components.css", "meta.json", "Design Canvas" 키워드가 포함되는지
- 단위: `context-manager` 가 development 페이즈에서 `docs/design/system/tokens.css` 와 매칭되는 feature 의 `*.html` 을 포함하는지 (해당 파일이 존재할 때)
- 수동: 대시보드 기동 후 `/design` 방문 → 목업 3개(system/login/dashboard) 자동 렌더, 줌/팬/디바이스 필터/PNG 추출 동작 확인
