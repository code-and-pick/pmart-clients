# 요청: 조정한 수행료의 `Earning.adjustmentRef` 채우기

보낸 앱: rider-backoffice (PC 5)
받는 백엔드 영역: delivery

- 작성: 2026-11-24
- 계약: delivery-execution `Earning.adjustmentRef: { type: string }` — 계약에는 있지만 지금은 서버가 채우지 않는다(코드 읽어 확인, 2026-11-24).

## 사용자 말(2026-11-24)
> 조정한 수행료와 일반정상 수행료 구분이 안돼. 조정한 수행료라고 작게 기입을 해주던가

## 지금 상태
- `POST /rider-earnings/{earningId}/adjustments` 로 조정하면 `EarningAdjustments.applyAdjustment` 가 수행료 줄을 이렇게 바꾼다:
  - 지급: `calculable = true`, `settlementState = CONFIRMED`
  - 미지급: `settlementState = ADJUSTED`
  - 메모(`note`)는 "지원센터 조정 — …" 으로 바뀐다.
- 그래서 **지급으로 조정한 수행료는 계약 값만으로 보통 수행료와 구분할 수 없다.**
- 앱은 메모 글자로 가르지 않는다. 표시 문구는 바뀔 수 있어서다.

## 요청
1. 조정할 때 그 수행료의 `adjustmentRef` 에 조정 기록 ID(`ADJ-…`, `rider_earning_adjustment` 의 adjustmentId)를 넣어 주세요.
   - 지급·미지급 둘 다 넣어 주세요.
   - 직원 조회(`GET /rider-earnings`)와 라이더 본인 조회(`GET /riders/me/earnings`) 둘 다 내려 주세요.
2. 이미 조정된 수행료도 채워 주세요(조정 기록 표에서 earningId 로 찾아 한 번 채우기). 어렵다면 새 조정부터만이라도 괜찮다.
   - 어느 쪽인지 알려 주면 앱 안내에 적겠다.

## 앱 쪽(이미 한 것)
- 라이더 백오피스: 라이더 상세 수행료 표와 지급 관리 "이 묶음의 배송" 에서 아래 둘 중 하나면 금액 옆에 작게 "조정" 이라고 보인다.
  - `adjustmentRef` 가 있음
  - `settlementState = ADJUSTED`
- 미지급(ADJUSTED)은 금액 대신 "미지급" 이라고 보인다.
- 그래서 지금은 미지급 조정만 표시된다. 이 요청이 반영되면 지급 조정도 따로 고치지 않아도 표시된다.
