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

- `check_chart`: `plotly` 블록 내용을 검사합니다(YAML/JSON, 최상위 키, `fit` 값, Plotly 속성 검사).
- `read_charts`: 노트의 `plotly` 블록 위치·트레이스·제목·문제를 20개씩 알려 줍니다.

두 도구 모두 노트를 바꾸거나 차트를 그리지 않습니다.

## 라이선스

MIT. Copyright (c) 2021 Dmitriy Shulha, (c) 2026 everydaymind.
