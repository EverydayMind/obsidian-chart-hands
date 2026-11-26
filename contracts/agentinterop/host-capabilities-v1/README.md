# Host capabilities v1 — 플러그인 Skill·텍스트 추출·비공개 판정·문서 소유권

정형 원본: Verbex. 이 멤버를 구현하는 자매 플러그인(HWP Hands, KorDoc Transform, HWPX Exporter, PPTX Hands, Chart Hands, Web Hands, Bridge 플러그인)은 같은 경로에 바이트 동일 사본을 두고 `manifest.json` 해시로 대조한다.

근거: [설계 v0.5](../../../docs/plans/plugin-owned-skills-and-bridges-2026-11-25.md) §3·§6.3, [통제 계약 v1.20](../../../docs/plans/prompt-injection-native-provider-boundary-v1.20.md).

## 범위

agentinterop v1·v2 provider 객체(`Symbol.for('dev.agentinterop.capability-provider')`)의 **새 선택 멤버** 다섯 개다. `describe()`가 돌려주는 descriptor는 바꾸지 않는다. 구버전 Verbex는 provider 객체의 정해진 멤버만 읽으므로(`discovery.ts`의 `readProviderHandle`) 이 멤버들을 무시하고, 기존 도구는 그대로 동작한다. descriptor에 새 키를 넣으면 구버전 Verbex가 닫힌 키 목록(`descriptorSchema.ts`)으로 그 provider 전체를 거부하므로 넣지 않는다.

| 멤버 | 용도 | 호출 조건 |
| --- | --- | --- |
| `describeAssets()` | 플러그인이 내놓는 Skill의 frontmatter와 본문 해시 | 탐색 때. 승인 대상에 포함 |
| `readAsset(request)` | Skill 본문 | 주입: 승인·활성 provider만. 표시: 승인 화면에서 승인 대기·재승인 대기 provider도(§2) |
| `extractText` | 문서 파일의 색인용 텍스트 추출 | 승인·활성 provider만 |
| `privacy` | AI 비공개 판정 | **승인과 무관하게** 켜진 모든 플러그인(§4) |
| `ownership.openDocumentPaths()` | 동반 창에 열린 문서 경로 | 승인·활성 provider만. 선언했는데 쓸 수 없으면 쓰기 거절(§5) |

모든 멤버는 host 전용이다. 모델 도구가 아니고, 모델에 정의를 보이지 않으며, 모델이 부를 수 없다.

## 공통 규칙

- host는 멤버를 getter를 실행하지 않는 방식(`readDataMember`)으로 읽는다. 이 함수는 getter를 만나면 예외를 던진다. 멤버별 처리는 각 절에 적는다(`describeAssets`는 거부, `privacy`는 판정 없음과 경고). Proxy는 같은 프로세스에서 탐지하지 못한다(DECISIONS §21.1과 같은 한계).
- 결과는 손실 없는 JSON 사본(`copyJson`)으로 만든 뒤 검증한다. 클래스 인스턴스·함수·순환·Symbol 키가 있거나, **값이 `undefined`인 속성이 있으면** 결과 전체를 거부한다. 선택 필드는 키를 빼서 표현한다.
- 문자열 길이 한도는 JavaScript `String.length`(UTF-16 코드 단위) 기준이다. JSON Schema의 `maxLength`(코드 포인트)는 그보다 느슨한 근사다. host 검사가 정본이다.
- 문자열에 CR(`\r`), NUL, 짝 없는 surrogate가 있으면 거부한다. 본문 맨 앞 BOM도 거부한다.
- 메서드는 값 또는 Promise를 돌려줄 수 있다(`privacy.isBlocked` 제외). 각 절의 시간 제한 안에 끝나지 않으면 실패다.

## 1. `describeAssets()`

```ts
describeAssets(): AssetsDescriptor | Promise<AssetsDescriptor>
```

- `describe()`와 **동시에** 부른다(provider당 하나의 탐색 슬롯 안에서 병렬). 시간 제한 1,000ms. 사본 한도는 깊이 16, 노드 10,000, 256 KiB이며 descriptor와 따로 센다.
- 스키마 통과가 사본 한도 통과를 보장하지 않는다(스키마상 최대치는 256 KiB를 넘을 수 있다).
- 최상위 키는 `version`과 `skills`다. `version`은 필수이며 v1은 `1`이다. 정수인데 host가 모르는 값(예: `2`)이면 결함이 아니라 **멤버 없음**으로 본다: 승인 스냅샷에 넣지 않고, 도구는 그대로 두며, "Verbex를 업데이트하면 이 플러그인의 Skill을 쓸 수 있습니다"를 안내한다(사유 코드 `unsupported_version`). 없거나 정수가 아니면 `schema`. `workflows`·`prompts`는 예약이며 있으면 `reserved_key`로 거부한다. 그 밖의 키는 `schema`.
- `skills` 0~16개. `(id, locale)` 쌍이 겹치면 거부. 언어당 8개 이하, 언어당 `bodyTokens` 합 20,000 이하.
- `id`: `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`. host 정본 ID는 `<pluginId>:<id>`다.
- `locale`: `ko` 또는 `en`. Verbex는 모델 언어(`getModelLocale()`)와 같은 판만 쓰고, 없는 언어판은 대신하지 않는다.
- `frontmatter` 키는 닫혀 있다(`assets.schema.json`). 알 수 없는 키는 `schema`로 거부한다.
  - 번역 필드(언어판마다 달라도 됨): `name`(1~80자, 줄바꿈 없음), `description`(1~300자, 줄바꿈 허용), `trigger_keywords`(32개 이하, 각 1~40자)
  - 스위치 필드(같은 `id`의 언어판끼리 같아야 함): `applies_to`, `tools`, `allowed-tools`, `preferred-tools`, `required-plugins`, `requires-host-tools`, `workflow`, `standalone`, `cross_document`, `disable-model-invocation`
  - 같음의 정의: 목록 필드는 없음과 `[]`를 같게 보고, 순서까지 같은 문자열 배열이어야 한다. 불리언은 없음과 `false`를 같게 본다. 문자열은 그대로 비교한다.
  - 도구 이름 `^[A-Za-z0-9_-]{1,128}$`, 목록당 32개 이하. `required-plugins`는 provider id 규칙(`^[A-Za-z0-9][A-Za-z0-9_-]{0,48}$`) 8개 이하이며, host가 제공 플러그인 자신을 더한다.
  - **`tools`(노출 요구)에는 제공 플러그인 자신의 도구와 Verbex 내장 도구만 쓸 수 있다.** 판정: `plg__`로 시작하는 항목은 `plg__<자기 pluginId>__`로 시작해야 한다. 아니면 `foreign_required_tool`로 거부한다. 다른 플러그인 도구는 `preferred-tools`·`allowed-tools`에만 쓴다(없어도 되는 보조). host는 자기가 모르는 내장 도구 이름을 무시한다. 승인 화면은 내장 쓰기 도구를 강조한다.
- `bodySha256`: 본문(§2의 `body`)의 UTF-8 바이트 SHA-256, 소문자 16진 64자.
- `bodyTokens`: js-tiktoken `cl100k_base`의 `encode(body, [], []).length`. 특수 토큰 문자열(`<|endoftext|>` 등)도 일반 텍스트로 센다. 1~5,000 정수. (기본 `encode(body)`는 특수 토큰 문자열에서 예외를 던지므로 쓰지 않는다.)
- 거부 사유 코드: `unsupported_version`(거부가 아니라 무시), `schema`, `reserved_key`, `duplicate_skill`, `locale_switch_mismatch`, `locale_limit`, `foreign_required_tool`, `invalid_text`, `copy_limit`, `getter_member`, `timeout`, `error`.
- 결함이 하나라도 있으면(getter로 만든 `describeAssets` 포함) 그 provider의 **승인 대상 전체**를 거부한다. 이유를 진단·설정 화면에 남긴다.
- Skill이 없는 provider는 멤버를 두지 않는다. 빈 배열도 유효하지만 승인 대상을 바꾼다.

### 승인 대상과 digest

- 승인 스냅샷 = `{ descriptor, assets?, extractText? }`. `assets`는 `describeAssets()` 결과, `extractText`는 §3의 `{ version, extensions }`이다. 없는 키는 빼고 만든다.
- digest = `canonicalDigest(스냅샷)`. 단 `assets`·`extractText`가 모두 없으면 지금처럼 `canonicalDigest(descriptor)`다. 그래서 새 멤버를 내지 않는 기존 provider는 재승인이 생기지 않는다. 멤버를 더하거나 빼면 digest가 바뀌어 재승인이다.
- 승인 기록에 스냅샷 JSON 전체를 저장한다. 재승인 diff의 사본 한도는 스냅샷 기준 512 KiB다. Skill 본문은 저장하지 않으므로 본문 변경은 "본문 바뀜(해시)"으로 표시하고 현재 본문을 `readAsset`으로 보인다. 이전 본문과의 줄 단위 비교는 v1 범위가 아니다.

## 2. `readAsset(request)`

```ts
readAsset(request: { kind: 'skill'; id: string; locale: 'ko' | 'en' }):
  { body: string } | Promise<{ body: string }>
```

- 언제 부르나:
  - **주입:** 승인·활성 provider의 선택된 Skill만, 제출마다 주입 직전에. 같은 provider 인스턴스·generation·`(id, locale, bodySha256)`의 검증된 본문은 메모리에 캐시해 다시 쓸 수 있다. 영구 저장하지 않는다.
  - **표시:** 설정의 승인 화면에서 사람이 펼칠 때. 승인 대기·재승인 대기 provider도 허용한다. 조건: 현재 인스턴스·generation 확인, 인자는 `id`·`locale`뿐, 결과는 그 화면에만 표시, 모델 요청·원장·반출에 싣지 않는다.
- 시간 제한 1,000ms, abort 가능. 사본 한도 깊이 4, 노드 16, 256 KiB.
- provider busy 잠금을 잡지 않는다. Vault 변경 관측과도 무관하다. 사용자 데이터를 provider에 넘기지 않는다.
- `body`는 frontmatter를 포함하지 않는 SKILL.md 본문이다. 60,000자 이하.
- 검사 순서와 상태 코드: 형식(문자열 아님·길이·CR·NUL·surrogate·BOM) `invalid_body` → 해시 `hash_mismatch` → 토큰 `token_mismatch`. 그 밖에 `timeout`, `read_error`, `not_current`, 토크나이저를 쓸 수 없으면 `token_unavailable`. 어느 것이든 **그 Skill만** 쓸 수 없고, provider의 도구·다른 Skill은 영향받지 않는다.
- 주입할 때 출처 한 줄(`출처: <플러그인 표시명> 제공 Skill`)을 붙이고 파일 경로를 보이지 않는다.

## 3. `extractText`

```ts
extractText: {
  version: 1
  extensions: string[]          // v1: '.hwp' | '.hwpx' | '.pdf' 중 1~3개, 소문자, 중복 없음
  extractorVersion: { id: string; engineVersion: string; chunkerVersion: string }
  extract(input: {
    path: string                // Vault 상대 경로
    signal: AbortSignal
    ocr: 'off' | 'candidates'
    maxChars: number            // host가 정함(현재 2,000,000)
  }): Promise<ExtractTextResult>
}
```

- v1은 host가 이미 문서로 다루는 형식(`isDocumentPath`: hwp·hwpx·pdf)만 받는다. 그 밖의 확장자, 대문자, 점 없는 값, 중복, 빈 배열, `version` ≠ 1이면 `extractText` 전체를 쓰지 않고 진단에 남긴다. 경로 확장자 비교는 대소문자를 무시한다.
- `extractorVersion`은 데이터 멤버이고 `extract` 전에 읽는다. 기존 투영이 낡았는지를 이 값으로 판단한다(DECISIONS §26 "extractor/chunker version으로 무효화"). 결과의 `extractor`와 다르면 그 결과는 `corrupted`다.
- `{version, extensions}`는 승인 digest에 들어간다(§1). 승인 뒤 확장자를 더하면 재승인이다.
- 결과 형식은 KorDoc Transform의 기존 `api.indexText` v1과 같고 한도도 같다(`protocol.ts`의 `ExtractTextResult` 주석). 다른 점은 `extractor.id`가 provider가 정하는 문자열(`^[a-z0-9-]{1,64}$`)이라는 것뿐이다. 청크 텍스트 합은 `maxChars` 이하, 모든 청크에서 `blockRange[1] >= blockRange[0]`. 알 수 없는 추가 키는 무시한다(지금 zod 동작과 같음).
- 투영 신원은 `(pluginId, extractor.id, engineVersion, chunkerVersion)`이다. 다른 플러그인이 같은 `extractor.id`를 내도 남의 투영을 잇거나 덮지 않는다. P0c는 기존 KorDoc 투영을 `kordoc-transform`의 것으로 한 번 옮긴다(같은 버전이면 재추출 없음).
- 같은 확장자를 둘 이상의 provider가 선언하면 그 확장자는 색인하지 않고 상태 화면에 충돌을 보인다.
- 승인·활성 provider만 부른다(지금의 승인 없는 직접 호출에서 바뀜). 원천이 없거나 승인 전이면 지금의 `extractor_unavailable`과 같이 처리한다: 이전 `ok` 투영은 유지하고, 상태 화면에 "색인 원천 승인 필요"를 보인다.
- 경로는 AI 비공개 판정(`shouldIndexSource`)을 통과한 뒤에만 넘긴다.
- 시간 제한은 지금 색인 요청과 같은 30초 deadline이다. 도중에 provider 인스턴스가 바뀌면 그 결과를 버리고 `not_current`로 다시 시도 대상에 둔다.
- provider busy 잠금을 잡지 않는다. 사용자 도구 호출과 동시에 불릴 수 있으므로 provider는 재진입을 견뎌야 한다.
- 사본 한도: 깊이 8, 노드 1,500,000, 40 MiB. 근거: 텍스트 2,000,000자 × 3바이트(`copyJson` 계수) ≈ 6 MB, 청크 구조 오버헤드 약 280바이트 × 최대 100,000 청크 ≈ 28 MB, 청크당 노드 약 13개 × 100,000 ≈ 1.3M.
- 결과는 비신뢰 자료다. 지시문으로 쓰지 않는다. 모델에 보낼 때는 기존 문서 투영·disclosure 경계를 그대로 거친다.

## 4. `privacy`

```ts
privacy: {
  isBlocked(path: string): boolean   // 동기
  extensions: string[]               // 필수. 소문자, 점 포함, 1~32개
}
```

- **승인과 무관하게** 켜진 모든 플러그인의 provider 객체에서 읽는다. descriptor가 거부됐거나, 재승인 대기이거나, runtime fault여도 읽는다. 이를 위해 `readProviderHandle`(규약 위반 시 throw)과 **분리된** 전용 읽기를 쓴다. 판정은 모델 문맥에 들어갈 내용을 줄이기만 한다.
- host가 묻는 방법:
  1. 경로를 Vault 경로로 정규화한다.
  2. 색인 노트(`<문서>.<ext>.index.md`)면 원본 문서 경로를 구한다.
  3. 원본(색인 노트가 아니면 그 경로)의 확장자가 `extensions`에 없으면(대소문자 무시) 이 provider에는 묻지 않는다.
  4. 경로와 원본이 모두 Vault에 없으면 묻지 않는다(보호할 내용이 없고, 만들려는 경로를 거절하면 거짓 사실이 된다).
  5. `isBlocked(경로)`를 부르고, 색인 노트면 `isBlocked(원본)`도 부른다.
- `false`만 "이 provider는 허용"이다. `true`·그 밖의 값(Promise 포함)·예외는 **차단**이다(fail closed). Promise가 오면 host가 `.catch`를 붙여 처리되지 않은 rejection을 막는다. 여러 provider 중 하나라도 차단하면 차단이다. 지금 HWP Hands 경로는 `=== true`일 때만 차단하므로 이것은 강화다.
- `privacy` 멤버가 없거나, getter이거나, `isBlocked`가 함수가 아니거나, `extensions`가 규칙에 맞지 않으면 그 provider는 판정을 내지 않은 것으로 보고, 설정의 provider 상태에 경고를 보인다. (판정을 약속한 provider의 결함을 차단으로 볼 수도 있으나, 확장자를 모르는 상태에서 모든 읽기를 막게 되므로 경고로 둔다.)
- host는 결과를 캐시하지 않는다. 판정 지점은 DECISIONS의 AI 비공개 절과 같다.
- 거절 결과와 문구는 판정한 플러그인의 표시명을 적는다. 지금 문구("HWP Hands의 AI 비공개 설정")를 일반화한다.
- 알아 둘 사실: `isBlocked`를 낸 플러그인은 자기 `extensions`에 맞는 경로 중 Verbex가 읽으려는 경로를 받는다. 같은 프로세스라 새 권한은 아니다. 동기 무한 루프는 막지 못한다.
- 전환기: HWP Hands의 옛 `api.privacy.isBlocked` 직접 읽기를 HWP Hands 새 판 공개 뒤 두 번째 Verbex 릴리스까지 함께 쓴다(설계 D12). 두 결과는 논리합(어느 쪽이든 차단이면 차단)이다.

## 5. `ownership.openDocumentPaths()`

```ts
ownership: { openDocumentPaths(): Promise<string[]> }
```

- 동반 창(편집기 세션이 아닌 보기·변환 창)에 열린 문서의 Vault 경로 목록이다. 모델 도구·grant·저장 승인이 아니다. 세션 ID가 있는 편집기는 기존 `editor.openDocuments`를 쓴다.
- 한도는 지금 protocol-1 동반 창 조회(`companionOwnership.ts`)와 같다: 시간 제한 2,000ms, 100개 이하, 경로마다 4,096자 이하와 Vault 경로 검증, 같은 provider에 대한 동시 조회는 하나로 합친다. 비교 키는 기존 `ownershipKey`(NFC·대소문자)다.
- 조회 실패·timeout·잘못된 경로·인스턴스 교체는 빈 목록이 아니다. 소유권 확인 불가로 쓰기를 거절한다.
- **이 멤버를 선언한 provider가 승인 대기·재승인 대기·꺼짐·fault이면** 부르지 않고 소유권 확인 불가로 본다(DECISIONS §21.1 "발견됐지만 현재 상태가 아닌 편집기"와 같은 규칙).
- 멤버가 없는 provider는 동반 창이 없는 것으로 본다(지금 protocol-1에서 메서드가 없을 때 `[]`인 것과 같은 보호 한계).

## 6. host 광고 (Verbex가 내고 provider가 읽음)

```ts
// host 플러그인 인스턴스의 Symbol.for('dev.agentinterop.host')
{ protocol: 'agentinterop', contracts: string[], hostVersion: string }
```

- 이 계약을 아는 host는 `contracts`에 `'host-capabilities-v1'`을 넣는다. 데이터 멤버로 두고 getter를 쓰지 않는다.
- provider는 이 광고로 새 host를 알아본다(host 플러그인 ID나 버전 문자열에 기대지 않는다). 광고가 없으면 옛 host로 보고 옛 경로를 유지한다: 예를 들어 KorDoc Transform은 protocol-1 등록과 `api.indexText` v1을, HWP Hands는 `api.privacy`를 유지한다.
- Bridge 플러그인은 광고가 없으면 도구를 내지 않는다(옛 host의 내장 기능과 겹치지 않게). 자기 설정 화면에 host 업데이트가 필요하다고 보인다.
- 버전이 섞일 때의 전체 규칙은 설계 §10이 정본이다.

## 파일

- `protocol.ts`: 위 멤버의 TypeScript 타입과 한도 주석.
- `assets.schema.json`: `describeAssets()` 결과의 JSON Schema(draft 2020-12). 저장소의 도구 `inputSchema` 부분집합 검사(`schemaSubset.ts`) 대상이 아니다.
- `fixtures.json`: 합성 정상·거절 사례. `scope`가 `contract`면 provider 구현도 쓸 수 있는 자료 사례, `host`면 host 하네스 상태가 필요한 행동 사례다. `expected`는 시험할 기대값이며 통과 기록이 아니다.
- `manifest.json`: 자신을 제외한 파일의 SHA-256(UTF-8, CRLF→LF 정규화). 각 저장소 시험은 자기 로컬 사본만 읽는다.
