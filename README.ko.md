# Chart Hands

노트의 `plotly` 코드 블록을 [Plotly](https://plotly.com/javascript/) 차트로 그려 주고, LLM 에이전트가 차트를 쓰기 전에 정의를 검사할 수 있는 도구("손")를 제공하는 옵시디언 플러그인입니다.

Dmitriy Shulha의 [obsidian-plotly](https://github.com/Dmitriy-Shulha/obsidian-plotly)(MIT)를 바탕으로 Plotly.js 4, D3 7로 올리고, 폭 맞춤·PDF 내보내기 지원·에이전트 도구를 더했습니다.

## 사용법

`plotly` 코드 블록에 YAML 또는 JSON으로 `data`, `layout`, `config`, `fit` 키를 적습니다. 명령 팔레트의 **New Plotly chart**로 예시 블록을 넣을 수 있고, DataviewJS에서는 `window.renderPlotly(...)`로 그릴 수 있습니다.

Plotly.js와 D3는 플러그인에 포함되어 있으며 첫 차트를 그릴 때 한 번 불러오므로 볼트 시작 속도에 영향을 주지 않습니다.

## 설정

- **차트 폭 맞춤**: 넓을 때만 줄이기(기본) / 항상 폭에 맞추기 / 사용 안 함. 블록에 `fit: off|shrink|fill`을 적으면 그 차트만 따로 지정합니다.
- **줄일 때 가로세로 비율 유지**
- **PDF 내보내기 시 페이지 폭에 맞춤**

## LLM 에이전트용 도구

플러그인 인스턴스에 agentinterop v1 provider가 있어, 호환되는 에이전트 호스트가 도구 정의를 읽고 호출할 수 있습니다(호스트에서 사용자가 승인해야 모델에 보입니다).

- `get_chart_guide`: 작성 안내를 주제별(`basics`, `style`, `examples`, `dataviewjs`, `errors`)로 돌려줍니다. 필요한 부분만 읽습니다.
- `build_chart`: 라벨과 계열 데이터로 선·막대·가로 막대·파이·산점도의 `plotly` 블록을 만들어 줍니다(Chart Hands 팔레트 적용, 검사 포함).
- `check_chart`: `plotly` 블록 내용을 검사합니다(YAML/JSON, 최상위 키, `fit` 값, 따옴표 없는 `#` 색상·날짜·JavaScript 값·배열 길이 불일치 같은 흔한 실수, Plotly 속성 검사).
- `read_charts`: 노트의 `plotly` 블록 위치·트레이스·제목·문제를 20개씩 알려 줍니다.

어떤 도구도 노트를 바꾸거나 차트를 그리지 않습니다. 에이전트는 돌려받은 블록을 호스트의 노트 편집 도구로 삽입합니다. 안내 문구는 영어입니다.

### agentinterop v1 provider란

agentinterop v1 provider는 AI 에이전트 기능을 수행하는 다른 옵시디언 플러그인에서 MCP-like API를 제공하는 개발자 자체 규약으로, 공인된 표준은 아닙니다. 특정 에이전트 호스트를 몰라도, 에이전트를 실행하는 플러그인이 다른 플러그인의 도구를 찾아 쓸 수 있게 하려는 것입니다.

Chart Hands의 구현 방식:

- 플러그인 인스턴스의 `Symbol.for('dev.agentinterop.capability-provider')` 키에 provider를 둡니다. provider는 `protocol: 'agentinterop'`, `protocolVersion: 1`, `describe()`(provider 정보·지침·JSON Schema 입력을 가진 도구 정의 반환), `callTool(name, args)`(`content`와 `structuredContent` 또는 코드가 있는 오류 반환)를 가집니다.
- 도구 정의의 `_meta`에 `dev.agentinterop/` 접두사로 `effect`(`pure`/`read`), `group`, `keywords`, `resourceTypes`, `maxResultChars` 힌트를 둡니다. 호스트는 요청에 "plotly", "차트", "그래프" 같은 키워드가 있을 때만 모델에게 이 도구를 보여 줍니다.
- 로드·언로드 때 워크스페이스 이벤트 `agentinterop:providers-changed`를 발생시켜 호스트가 도구 목록을 갱신하게 합니다.
- 모든 도구는 읽기 전용이며 노트를 바꾸거나 차트를 그리지 않습니다.

## 라이선스

MIT. Copyright (c) 2021 Dmitriy Shulha, (c) 2026 everydaymind.
