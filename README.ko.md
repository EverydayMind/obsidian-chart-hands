# Chart Hands

노트에 짧은 `plotly` 코드 블록을 적으면 [Plotly](https://plotly.com/javascript/) 차트로 그려 주는 옵시디언 플러그인입니다. JavaScript는 몰라도 됩니다. 차트에 마우스를 올리면 값이 보이고, 끌어서 확대할 수 있습니다. 차트는 노트 폭에 맞춰지고, PDF로 내보낼 때는 페이지 폭에 맞춰집니다.

LLM 에이전트가 차트 블록을 노트에 쓰기 전에 만들고 검사할 수 있는 도구("손")도 제공합니다. 에이전트 없이도 플러그인은 똑같이 동작합니다.

Dmitriy Shulha의 [obsidian-plotly](https://github.com/Dmitriy-Shulha/obsidian-plotly)(MIT)를 바탕으로 Plotly.js 4, D3 7로 올리고, 폭 맞춤·PDF 내보내기 지원·에이전트 도구를 더했습니다. 데스크톱과 모바일에서 모두 동작합니다.

**목차:** [빠르게 시작하기](#빠르게-시작하기) · [plotly 블록 쓰는 법](#plotly-블록-쓰는-법) · [plotly.com 예제 가져오기](#plotlycom-예제-가져오기) · [노트 데이터로 그리기 (DataviewJS)](#노트-데이터로-그리기-dataviewjs) · [차트가 안 보일 때](#차트가-안-보일-때) · [설정](#설정) · [예제](#예제) · [LLM 에이전트용 도구](#llm-에이전트용-도구) · [설치](#설치)

## 빠르게 시작하기

1. Chart Hands를 설치하고 켭니다([설치](#설치) 참고).
2. 노트를 열고 `Ctrl+P`(macOS는 `Cmd+P`)로 명령 팔레트를 열어 **Chart Hands: New Plotly chart**를 실행합니다. 아래 블록을 직접 붙여 넣어도 됩니다.

   ````
   ```plotly
   data:
     - x: [0, 1, 2]
       y: [0, 1, 0]
   ```
   ````

3. 실시간 미리보기에서는 커서를 블록 밖으로 옮기고, 아니면 읽기 보기로 바꾸면 선 그래프가 나타납니다. Plotly는 첫 차트를 그릴 때 불러오기 때문에 처음에는 조금 걸립니다. 그동안 "loading Plotly and D3…" 알림이 보입니다.

다음으로 제목과 축 이름이 있는 막대 그래프를 그려 봅니다.

````
```plotly
data:
  - type: bar
    x: ["월", "화", "수", "목", "금"]
    y: [3, 5, 2, 6, 4]
layout:
  title: {text: "집중한 시간"}
  xaxis: {title: {text: "요일"}}
  yaxis: {title: {text: "시간"}}
```
````

`type: bar`를 `type: scatter`로 바꾸면 선 그래프가 됩니다. 여기까지 되면 [예제](#예제)에서 원하는 차트를 복사해 숫자만 내 데이터로 바꿔 쓰면 됩니다.

## `plotly` 블록 쓰는 법

블록 내용은 YAML 또는 JSON(어느 쪽이든 같게 읽습니다)이며, 최상위 키는 다음 네 개만 쓸 수 있습니다.

| 키 | 내용 |
| --- | --- |
| `data` | 트레이스 목록. 트레이스 하나가 계열 하나이며, `type`(`bar`, `scatter`, `pie`, `heatmap` 등)과 값(`x`, `y`, `labels`, `values` 등)을 적습니다. `type`을 생략하면 `scatter`로 그립니다. |
| `layout` | 선택. 제목, 축, 범례, 크기, 여백, 기준선(`shapes`), 주석(`annotations`). |
| `config` | 선택. `displaylogo: false`, `displayModeBar: false`, `scrollZoom: true` 같은 조작 옵션. |
| `fit` | 선택. `off`, `shrink`, `fill` 중 하나. 이 차트에만 **Fit chart width** 설정을 따로 지정합니다. |

이 키들은 Plotly.js의 `Plotly.newPlot(div, data, layout, config)`에 넘기는 객체와 같습니다. 모든 옵션은 [Plotly.js 레퍼런스](https://plotly.com/javascript/reference/)에 있습니다.

문제는 대개 다음 YAML 규칙에서 생깁니다.

- **색은 따옴표로 감쌉니다**: `color: "#2563EB"`. 따옴표가 없으면 `#`부터 YAML 주석이 되어 색이 사라집니다.
- **날짜도 따옴표로 감쌉니다**: `x: ["2026-01-05", "2026-01-12"]`. 그래야 값이 문자열로 남고 Plotly가 날짜로 읽습니다.
- **제목은 객체로 씁니다**: `title: {text: "매출"}`. Plotly.js 4는 문자열로만 쓴 제목을 보여 주지 않습니다.
- **들여쓰기는 공백으로** 하고 탭은 쓰지 않습니다. 트레이스마다 `- `로 시작합니다.
- **JavaScript는 쓸 수 없습니다**: `plotly` 블록에는 값만 적을 수 있어 함수, 변수, `new Date()`는 동작하지 않습니다. 계산한 데이터는 [DataviewJS](#노트-데이터로-그리기-dataviewjs)로 그립니다.

## plotly.com 예제 가져오기

[Plotly.js 예제](https://plotly.com/javascript/)는 JavaScript로 쓰여 있습니다. 값만으로 객체를 만드는 예제라면, 그 객체를 `plotly` 블록에 옮겨 적으면 됩니다. 이 예제는

```js
var trace1 = {x: [1, 2, 3, 4], y: [10, 15, 13, 17], type: 'scatter'};
var trace2 = {x: [1, 2, 3, 4], y: [16, 5, 11, 9], type: 'scatter'};
var layout = {title: {text: 'Two lines'}};
Plotly.newPlot('myDiv', [trace1, trace2], layout);
```

다음과 같이 바뀝니다.

````
```plotly
data:
  - {x: [1, 2, 3, 4], y: [10, 15, 13, 17], type: scatter}
  - {x: [1, 2, 3, 4], y: [16, 5, 11, 9], type: scatter}
layout:
  title: {text: "Two lines"}
```
````

반복문, `Math.random()`, `d3.csv(...)`처럼 값을 계산하는 예제는 DataviewJS 블록에서 실행합니다.

## 노트 데이터로 그리기 (DataviewJS)

노트 내용으로 계산한 차트나 코드를 실행하는 plotly.com 예제는 `dataviewjs` 블록으로 그립니다. [Dataview](https://github.com/blacksmithgu/obsidian-dataview) 플러그인을 설치하고, Dataview 설정에서 **Enable JavaScript Queries**를 켜야 합니다.

명령 팔레트의 **Chart Hands: New Plotly chart (Dataviewjs)**로 시작 블록을 넣을 수 있습니다. plotly.com 예제를 붙여 넣을 때는 `Plotly.newPlot`을 `window.renderPlotly`로 바꾸고 `this.container`에 그립니다.

```js
// plotly.com
Plotly.newPlot('myDiv', data, layout, config);
// 옵시디언의 DataviewJS
window.renderPlotly(this.container, data, layout, config);
```

다음 블록은 달마다 만든 노트 수를 셉니다.

````
```dataviewjs
const counts = {};
for (const page of dv.pages()) {
  const month = page.file.ctime.toFormat('yyyy-MM');
  counts[month] = (counts[month] || 0) + 1;
}
const months = Object.keys(counts).sort();
window.renderPlotly(this.container,
  [{type: 'bar', x: months, y: months.map(m => counts[m]), marker: {color: '#2563EB'}}],
  {title: {text: '월별 새 노트 수'}});
```
````

`window.renderPlotly`는 Plotly를 불러올 때까지 알아서 기다립니다. 다섯째 인자(`'off'`, `'shrink'`, `'fill'`)로 그 차트의 폭 맞춤을 정할 수 있습니다. Plotly.js와 D3가 플러그인에 들어 있으므로, obsidian-plotly와 달리 D3를 볼트에 따로 내려받을 필요가 없습니다. `Plotly`나 `d3`를 직접 쓰는 코드는 먼저 불러와야 합니다.

```js
const { Plotly, d3 } = await window.loadPlotlyLibraries();
```

## 차트가 안 보일 때

| 증상 | 확인할 것 |
| --- | --- |
| 블록이 코드로만 보임 | 플러그인이 켜져 있는지, 코드 블록 언어가 소문자 `plotly`인지 확인합니다. 실시간 미리보기에서는 커서를 블록 밖으로 옮깁니다. |
| `Couldn't render plot:` 뒤에 YAML 오류 | 들여쓰기(탭 대신 공백), 트레이스 앞의 `- `, 닫히지 않은 따옴표나 괄호를 확인합니다. 메시지에 줄 번호가 나옵니다. |
| `The only valid keys are data, layout, config and fit.` | `title`이나 `type` 같은 키가 최상위에 있습니다. `layout` 아래나 트레이스 안으로 옮깁니다. |
| `There should be a valid JSON in this block.` | 블록이 비어 있거나 주석만 있습니다. |
| 차트는 나오는데 색이나 제목이 빠짐 | `#` 색을 따옴표로 감싸고, 제목을 `title: {text: "..."}`로 씁니다. |
| "could not load Plotly" 알림 | 노트를 다시 엽니다. 다음에 차트를 그릴 때 Plotly를 다시 불러옵니다. |
| DataviewJS 블록에 아무것도 안 나옴 | Dataview가 설치되어 있고 JavaScript 쿼리가 켜져 있는지, 코드가 `Plotly.newPlot`이 아니라 `window.renderPlotly(this.container, ...)`를 부르는지 확인합니다. |

## 설정

*설정 → Chart Hands*에서 바꿉니다.

- **Fit chart width**(차트 폭 맞춤): *Shrink only when wider*(기본값)는 노트보다 넓은 차트만 줄입니다. *Always fill the width*는 모든 차트를 노트 폭에 맞춰 늘립니다. *Off*는 원래 크기(`layout.width`, 없으면 Plotly 기본값 700px)를 그대로 둡니다. 한 차트만 바꾸려면 블록에 `fit: off`, `fit: shrink`, `fit: fill`을 적습니다.
- **Keep aspect ratio when shrinking**(줄일 때 가로세로 비율 유지, 기본 켬): 폭과 함께 높이도 줄입니다.
- **Fit the page width when exporting to PDF**(PDF 내보내기 시 페이지 폭에 맞춤, 기본 켬): PDF로 내보내거나 인쇄할 때 페이지보다 넓은 차트를 줄여 잘리지 않게 합니다.

## 예제

아래 블록을 노트에 그대로 붙여 넣으면 차트가 그려집니다. 마지막 예제만 JSON이고 나머지는 YAML입니다. 색은 Chart Hands 팔레트를 썼으니 숫자와 라벨만 내 데이터로 바꿔 쓰면 됩니다.

| 보여 주려는 것 | 예제 |
| --- | --- |
| 시간에 따른 추세 | [목표선이 있는 선 그래프](#목표선이-있는-선-그래프), [범위 슬라이더가 있는 시계열](#범위-슬라이더와-기간-표시가-있는-시계열) |
| 항목 간 비교 | [묶음 막대](#값-라벨이-붙은-묶음-막대), [누적 막대](#누적-막대), [막대와 보조 축의 선](#막대와-보조-축의-선) |
| 전체 중 비중 | [도넛 차트](#도넛-차트), [선버스트](#선버스트) |
| 값의 분포 | [박스 플롯](#박스-플롯) |
| 두 값의 관계 | [버블 차트](#버블-차트) |
| 격자 형태의 값 | [히트맵 습관 기록](#히트맵-습관-기록) |
| 흐름과 누계 | [생키 다이어그램](#생키-다이어그램), [폭포 차트](#폭포-차트) |
| 핵심 지표 | [게이지가 있는 KPI 줄](#게이지가-있는-kpi-줄) |
| 여러 기준의 평가 | [레이더 차트](#레이더-차트) |
| 보기 전환 | [보기를 바꾸는 버튼](#보기를-바꾸는-버튼) |
| JSON 형식 | [JSON과 fit 키](#json과-fit-키) |

### 목표선이 있는 선 그래프

두 계열을 그리고, 작년 계열은 점선으로, 목표값은 `shapes`로 가로선을 긋습니다.

````
```plotly
data:
  - type: scatter
    mode: lines+markers
    name: "2025년"
    x: ["1월", "2월", "3월", "4월", "5월", "6월"]
    y: [32, 35, 31, 40, 43, 47]
    line: {color: "#64748B", dash: dash}
  - type: scatter
    mode: lines+markers
    name: "2026년"
    x: ["1월", "2월", "3월", "4월", "5월", "6월"]
    y: [38, 41, 44, 46, 52, 55]
    line: {color: "#2563EB", width: 3}
layout:
  title: {text: "월간 활성 사용자"}
  hovermode: "x unified"
  yaxis: {title: {text: "사용자 (천 명)"}, rangemode: tozero}
  shapes:
    - {type: line, xref: paper, x0: 0, x1: 1, y0: 50, y1: 50, line: {color: "#C2410C", dash: dot}}
  annotations:
    - {xref: paper, x: 0, y: 50, text: "목표", showarrow: false, xanchor: left, yanchor: bottom}
config:
  responsive: true
  displaylogo: false
```
````

### 값 라벨이 붙은 묶음 막대

````
```plotly
data:
  - {type: bar, name: "계획", x: ["1분기", "2분기", "3분기", "4분기"], y: [120, 140, 160, 180], marker: {color: "#64748B"}}
  - type: bar
    name: "실적"
    x: ["1분기", "2분기", "3분기", "4분기"]
    y: [115, 152, 171, 168]
    marker: {color: "#2563EB"}
    texttemplate: "%{y}"
    textposition: outside
    cliponaxis: false
layout:
  title: {text: "계획 대비 실적"}
  barmode: group
  yaxis: {title: {text: "금액 (백만 원)"}}
```
````

### 누적 막대

`barmode: stack`이면 달마다 항목이 위로 쌓입니다.

````
```plotly
data:
  - {type: bar, name: "주거", x: ["7월", "8월", "9월", "10월"], y: [900, 900, 900, 900], marker: {color: "#2563EB"}}
  - {type: bar, name: "식비", x: ["7월", "8월", "9월", "10월"], y: [420, 465, 390, 440], marker: {color: "#0F766E"}}
  - {type: bar, name: "교통", x: ["7월", "8월", "9월", "10월"], y: [150, 180, 140, 160], marker: {color: "#7C3AED"}}
  - {type: bar, name: "기타", x: ["7월", "8월", "9월", "10월"], y: [230, 310, 205, 260], marker: {color: "#64748B"}}
layout:
  title: {text: "월별 항목별 지출"}
  barmode: stack
  yaxis: {title: {text: "금액 (천 원)"}}
```
````

### 막대와 보조 축의 선

보조 y축은 두 계열의 단위가 다를 때만 씁니다.

````
```plotly
data:
  - {type: bar, name: "주문 수", x: ["1월", "2월", "3월", "4월", "5월", "6월"], y: [320, 340, 390, 410, 460, 480], marker: {color: "#2563EB"}}
  - type: scatter
    mode: lines+markers
    name: "반품률"
    x: ["1월", "2월", "3월", "4월", "5월", "6월"]
    y: [4.2, 3.9, 4.5, 3.6, 3.1, 2.8]
    yaxis: y2
    line: {color: "#C2410C"}
layout:
  title: {text: "주문 수와 반품률"}
  yaxis: {title: {text: "주문 수 (건)"}}
  yaxis2: {title: {text: "반품률 (%)"}, overlaying: "y", side: right, showgrid: false, tickmode: auto, rangemode: tozero}
  legend: {orientation: "h", x: 0, y: -0.15}
```
````

### 도넛 차트

````
```plotly
data:
  - type: pie
    hole: 0.55
    labels: ["집중 작업", "회의", "메일", "행정", "학습"]
    values: [18, 9, 6, 4, 3]
    sort: false
    textinfo: "label+percent"
    marker:
      colors: ["#2563EB", "#C2410C", "#64748B", "#7C3AED", "#0F766E"]
      line: {color: "#FFFFFF", width: 2}
layout:
  title: {text: "이번 주 시간 사용"}
  showlegend: false
  annotations:
    - {text: "40시간", showarrow: false, font: {size: 22}, xref: paper, yref: paper, x: 0.5, y: 0.5}
```
````

### 버블 차트

점 크기로 세 번째 값을 나타내고, `hovertemplate`로 세 값을 함께 보여 줍니다.

````
```plotly
data:
  - type: scatter
    mode: markers+text
    x: [12, 25, 8, 30, 18]
    y: [4.1, 3.6, 4.6, 3.2, 4.3]
    text: ["알파", "베타", "감마", "델타", "엡실론"]
    customdata: [120, 340, 80, 510, 220]
    textposition: "top center"
    marker: {size: [16, 30, 12, 40, 22], color: "#2563EB", opacity: 0.6, line: {color: "#FFFFFF", width: 1}}
    hovertemplate: "%{text}<br>가격 %{x}달러<br>평점 %{y}<br>판매 %{customdata}개<extra></extra>"
layout:
  title: {text: "가격, 평점, 판매량"}
  xaxis: {title: {text: "가격 (달러)"}}
  yaxis: {title: {text: "평점"}}
```
````

### 박스 플롯

분포를 비교합니다. `boxpoints: all`이면 모든 값을 점으로도 보여 줍니다.

````
```plotly
data:
  - {type: box, name: "평일", y: [6.1, 6.5, 6.8, 7.0, 6.2, 5.9, 6.6, 7.1, 6.4, 6.0], boxmean: true, boxpoints: all, jitter: 0.3, marker: {color: "#2563EB"}}
  - {type: box, name: "주말", y: [7.5, 8.2, 7.8, 8.6, 9.0, 7.2], boxmean: true, boxpoints: all, jitter: 0.3, marker: {color: "#0F766E"}}
layout:
  title: {text: "수면 시간"}
  yaxis: {title: {text: "시간"}}
  showlegend: false
```
````

### 히트맵 습관 기록

`z`는 `y` 값마다 한 줄씩인 행 목록입니다. `autorange: reversed`로 첫째 주를 맨 위에 둡니다.

````
```plotly
data:
  - type: heatmap
    x: ["월", "화", "수", "목", "금", "토", "일"]
    y: ["1주", "2주", "3주", "4주"]
    z:
      - [30, 45, 0, 60, 20, 90, 0]
      - [40, 30, 50, 0, 35, 120, 60]
      - [0, 55, 45, 50, 40, 0, 75]
      - [60, 50, 40, 70, 0, 100, 90]
    colorscale: Blues
    texttemplate: "%{z}"
    xgap: 3
    ygap: 3
    colorbar: {title: {text: "분"}}
layout:
  title: {text: "하루 독서 시간"}
  yaxis: {autorange: reversed}
```
````

### 선버스트

`parents`로 각 라벨의 부모를 지정합니다(최상위는 `""`). `branchvalues: total`이면 부모 값은 자식 값의 합이어야 합니다. `type`을 `treemap`이나 `icicle`로 바꾸면 같은 데이터를 다른 모양으로 그립니다.

````
```plotly
data:
  - type: sunburst
    labels: ["프로젝트", "업무", "개인", "보고서", "웹사이트", "텃밭", "외국어"]
    parents: ["", "프로젝트", "프로젝트", "업무", "업무", "개인", "개인"]
    values: [60, 40, 20, 24, 16, 8, 12]
    branchvalues: total
    textinfo: "label+value"
layout:
  title: {text: "이번 달 프로젝트별 시간"}
  margin: {l: 10, r: 10, t: 60, b: 10}
```
````

### 생키 다이어그램

`link.source`와 `link.target`은 `node.label`의 0부터 시작하는 번호입니다.

````
```plotly
data:
  - type: sankey
    node:
      label: ["월급", "부수입", "예산", "주거", "생활비", "저축", "투자"]
      color: ["#2563EB", "#7C3AED", "#64748B", "#C2410C", "#C2410C", "#0F766E", "#0F766E"]
      pad: 18
      thickness: 16
    link:
      source: [0, 1, 2, 2, 2, 2]
      target: [2, 2, 3, 4, 5, 6]
      value: [3000, 500, 1000, 1200, 800, 500]
      color: "rgba(100, 116, 139, 0.25)"
layout:
  title: {text: "돈의 흐름 (천 원)"}
```
````

### 폭포 차트

`measure`로 각 단계를 `absolute`(시작 수준), `relative`(증감), `total`(누계, `y` 값은 무시)로 지정합니다.

````
```plotly
data:
  - type: waterfall
    x: ["월초 잔액", "월급", "월세", "생활비", "저축", "월말 잔액"]
    measure: [absolute, relative, relative, relative, relative, total]
    y: [1200, 3000, -1000, -1200, -800, 0]
    texttemplate: "%{delta:,.0f}"
    textposition: outside
    increasing: {marker: {color: "#0F766E"}}
    decreasing: {marker: {color: "#C2410C"}}
    totals: {marker: {color: "#2563EB"}}
    connector: {line: {color: "#64748B", dash: dot}}
layout:
  title: {text: "이번 달 현금 흐름 (천 원)"}
  showlegend: false
```
````

### 범위 슬라이더와 기간 표시가 있는 시계열

날짜는 따옴표로 감싸 문자열로 둡니다. 회색 띠는 특정 기간을 표시하고, 위쪽 버튼은 최근 1개월·3개월로 확대합니다.

````
```plotly
data:
  - type: scatter
    mode: lines+markers
    name: "거리"
    x: ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23", "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"]
    y: [18, 22, 25, 21, 27, 8, 5, 12, 20, 26, 30, 28]
    line: {color: "#2563EB", width: 2}
layout:
  title: {text: "주간 달리기 거리"}
  xaxis:
    rangeslider: {visible: true}
    rangeselector:
      buttons:
        - {count: 1, label: "1개월", step: month, stepmode: backward}
        - {count: 3, label: "3개월", step: month, stepmode: backward}
        - {step: all, label: "전체"}
  yaxis: {title: {text: "km"}}
  shapes:
    - {type: rect, xref: x, yref: paper, x0: "2026-02-06", x1: "2026-02-20", y0: 0, y1: 1, fillcolor: "rgba(100, 116, 139, 0.15)", line: {width: 0}, layer: below}
  annotations:
    - {xref: x, yref: paper, x: "2026-02-13", y: 1, text: "무릎 부상", showarrow: false, yanchor: bottom}
```
````

### 게이지가 있는 KPI 줄

지표(indicator)는 `grid`와 `domain`으로 배치합니다.

````
```plotly
data:
  - type: indicator
    mode: number+delta
    value: 1284
    title: {text: "방문자"}
    delta: {reference: 1130}
    domain: {row: 0, column: 0}
  - type: indicator
    mode: number+delta
    value: 0.042
    number: {valueformat: ".1%"}
    title: {text: "전환율"}
    delta: {reference: 0.038, valueformat: ".1%"}
    domain: {row: 0, column: 1}
  - type: indicator
    mode: gauge+number
    value: 87
    title: {text: "만족도"}
    gauge:
      axis: {range: [0, 100]}
      bar: {color: "#2563EB"}
      threshold: {value: 90, line: {color: "#C2410C", width: 3}, thickness: 0.8}
    domain: {row: 0, column: 2}
layout:
  grid: {rows: 1, columns: 3, pattern: independent}
  height: 260
  margin: {l: 30, r: 30, t: 50, b: 20}
```
````

### 레이더 차트

윤곽을 닫으려면 첫 점을 끝에 한 번 더 적습니다.

````
```plotly
data:
  - type: scatterpolar
    name: "노트북 A"
    r: [4, 3, 5, 4, 2, 4]
    theta: ["속도", "배터리", "화면", "키보드", "무게", "속도"]
    fill: toself
    line: {color: "#2563EB"}
  - type: scatterpolar
    name: "노트북 B"
    r: [3, 5, 3, 4, 4, 3]
    theta: ["속도", "배터리", "화면", "키보드", "무게", "속도"]
    fill: toself
    line: {color: "#C2410C", dash: dash}
layout:
  title: {text: "노트북 비교 (1~5점)"}
  polar: {radialaxis: {range: [0, 5]}}
```
````

### 보기를 바꾸는 버튼

`updatemenus`로 코드 없이 차트를 바꿉니다. `method: restyle`은 트레이스를 보이거나 숨기고, `method: relayout`은 레이아웃을 바꿉니다.

````
```plotly
data:
  - {type: bar, name: "2025년", x: ["북부", "남부", "동부", "서부"], y: [380, 290, 340, 300], marker: {color: "#64748B"}}
  - {type: bar, name: "2026년", x: ["북부", "남부", "동부", "서부"], y: [420, 310, 380, 290], marker: {color: "#2563EB"}}
layout:
  title: {text: "지역별 매출 (백만 원)", x: 0, xanchor: left}
  margin: {t: 100}
  updatemenus:
    - type: buttons
      direction: right
      x: 0
      y: 1.12
      xanchor: left
      yanchor: bottom
      buttons:
        - {label: "모두", method: restyle, args: [{visible: [true, true]}]}
        - {label: "2025년", method: restyle, args: [{visible: [true, false]}]}
        - {label: "2026년", method: restyle, args: [{visible: [false, true]}]}
    - type: buttons
      direction: right
      x: 1
      y: 1.12
      xanchor: right
      yanchor: bottom
      buttons:
        - {label: "묶음", method: relayout, args: [{barmode: group}]}
        - {label: "누적", method: relayout, args: [{barmode: stack}]}
```
````

### JSON과 `fit` 키

블록은 JSON으로 써도 됩니다. `fit: fill`이면 플러그인 설정과 상관없이 이 차트만 노트 폭에 맞춰 늘립니다.

````
```plotly
{
  "data": [{"type": "bar", "x": ["A", "B", "C"], "y": [3, 5, 2], "marker": {"color": "#2563EB"}}],
  "layout": {"title": {"text": "JSON으로 작성"}},
  "fit": "fill"
}
```
````

## LLM 에이전트용 도구

옵시디언에서 AI 에이전트를 쓰지 않는다면 이 부분은 건너뛰어도 됩니다.

플러그인 인스턴스에 agentinterop v1 provider가 있어, 호환되는 에이전트 호스트가 도구 정의를 읽고 호출할 수 있습니다(호스트에서 사용자가 승인해야 모델에 보입니다).

- `get_chart_guide`: 작성 안내를 주제별로 돌려줍니다. 필요한 부분만 읽습니다. `basics`는 차트가 답할 질문(추세, 비교, 비중, 분포, 관계, 행렬, 계층, 흐름, 단계, 프로필, KPI)에 맞는 차트 종류를 알려 주고, `statistical`, `hierarchy`, `timeseries`, `scientific`, `maps`, `layout`은 Plotly 고급 차트의 검증된 예제를 담고 있습니다(박스·바이올린, 상관 히트맵, splom, 트리맵·선버스트, 생키, 폭포, 기간 버튼이 있는 캔들스틱, 게이지, 등고선·3D, 극좌표, 삼각 좌표, 평행 좌표, 지도, 서브플롯, 버튼·슬라이더). `style`, `examples`, `dataviewjs`, `errors`는 꾸미기, 기본 예제, DataviewJS, 문제 해결을 다룹니다.
- `build_chart`: 라벨과 계열 데이터로 `plotly` 블록을 만들어 줍니다(Chart Hands 팔레트 적용, 검사 포함). 종류: 선, 영역, 막대, 가로 막대, 콤보(막대+선, 보조 축 선택), 산점도, 버블, 파이, 도넛, 트리맵, 선버스트, 폭포, 깔때기, 히스토그램, 박스, 바이올린, 히트맵, 레이더, 지표(indicator). 선·영역·막대·산점도 계열에는 범위 슬라이더를 붙일 수 있습니다.
- `check_chart`: `plotly` 블록 내용을 검사합니다(YAML/JSON, 최상위 키, `fit` 값, 따옴표 없는 `#` 색상·날짜·문자열 제목·JavaScript 값·배열 길이 불일치 같은 흔한 실수, 고급 트레이스의 데이터 형태(트리맵 parents, 생키 링크, 캔들스틱 가격, 폭포 measure, 격자 `z`, 없어진 mapbox 종류), Plotly 속성 검사).
- `read_charts`: 노트의 `plotly` 블록 위치·트레이스·제목·문제를 20개씩 알려 줍니다.

어떤 도구도 노트를 바꾸거나 차트를 그리지 않습니다. 에이전트는 돌려받은 블록을 호스트의 노트 편집 도구로 삽입합니다. 안내 문구는 영어입니다.

### agentinterop v1 provider란

agentinterop v1 provider는 AI 에이전트 기능을 수행하는 다른 옵시디언 플러그인에서 MCP-like API를 제공하는 개발자 자체 규약으로, 공인된 표준은 아닙니다. 특정 에이전트 호스트를 몰라도, 에이전트를 실행하는 플러그인이 다른 플러그인의 도구를 찾아 쓸 수 있게 하려는 것입니다.

Chart Hands의 구현 방식:

- 플러그인 인스턴스의 `Symbol.for('dev.agentinterop.capability-provider')` 키에 provider를 둡니다. provider는 `protocol: 'agentinterop'`, `protocolVersion: 1`, `describe()`(provider 정보·지침·JSON Schema 입력을 가진 도구 정의 반환), `callTool(name, args)`(`content`와 `structuredContent` 또는 코드가 있는 오류 반환)를 가집니다.
- 도구 정의의 `_meta`에 `dev.agentinterop/` 접두사로 `effect`(`pure`/`read`), `group`, `keywords`, `resourceTypes`, `maxResultChars` 힌트를 둡니다. 호스트는 요청에 "plotly", "차트", "그래프" 같은 키워드가 있을 때만 모델에게 이 도구를 보여 줍니다.
- 로드·언로드 때 워크스페이스 이벤트 `agentinterop:providers-changed`를 발생시켜 호스트가 도구 목록을 갱신하게 합니다.
- 모든 도구는 읽기 전용이며 노트를 바꾸거나 차트를 그리지 않습니다.

## 설치

**커뮤니티 플러그인 목록에서**(Chart Hands가 등록된 뒤): *설정 → 커뮤니티 플러그인*에서 제한 모드가 켜져 있으면 끄고, **탐색**에서 **Chart Hands**를 찾아 **설치**한 뒤 **활성화**합니다.

**직접 설치**:

1. [최신 릴리스](https://github.com/EverydayMind/obsidian-chart-hands/releases/latest)에서 `main.js`, `manifest.json`, `styles.css`를 내려받습니다.
2. `<볼트>/.obsidian/plugins/chart-hands/` 폴더를 만들고 세 파일을 넣습니다. `.obsidian` 폴더는 운영체제에 따라 숨김 폴더로 보이지 않을 수 있습니다.
3. 옵시디언을 다시 시작하거나 커뮤니티 플러그인 목록을 새로 고친 뒤, *설정 → 커뮤니티 플러그인*에서 **Chart Hands**를 켭니다.

## 라이선스

MIT. Copyright (c) 2021 Dmitriy Shulha, (c) 2026 everydaymind. Plotly.js와 D3는 각각의 MIT, ISC 라이선스로 포함되어 있습니다.
