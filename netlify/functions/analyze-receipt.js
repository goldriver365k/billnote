const SYSTEM_PROMPT = `너는 영수증 이미지를 분석해서 구조화된 JSON으로 변환하는 도구다.
반드시 아래 JSON 형식으로만 응답하고, 다른 설명이나 코드블록(백틱)은 절대 포함하지 마라.

{
  "vendor": "영수증에 찍힌 구매처(마트, 도매상 등 상호명). 알아볼 수 없으면 \\"알 수 없음\\"",
  "date": "YYYY-MM-DD 형식 (영수증에 날짜가 없으면 \\"\\")",
  "items": [
    { "name": "품목명", "qty": 수량(숫자), "price": 해당품목총가격(숫자) }
  ],
  "total": 합계금액(숫자)
}

입력 이미지는 종이 영수증뿐 아니라 쿠팡·네이버·마켓컬리 등 인터넷 주문의 핸드폰 화면 캡처(주문내역, 주문상세, 결제완료 화면)일 수도 있다. 이 경우 vendor는 쇼핑몰 이름(예: 쿠팡)으로 하고, date는 주문일 또는 결제일, items는 주문한 상품(배송비는 별도 품목으로), total은 할인·쿠폰 적용 후 실제 결제금액으로 한다. 한 화면에 여러 주문이 보여도 이미지 맨 위(또는 가장 크게 보이는) 주문 하나만 분석한다.

숫자에는 콤마나 원화기호를 넣지 말고 순수 숫자만 넣어라. 항목을 읽을 수 없으면 items를 빈 배열로 둬라.`;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. Netlify 환경변수를 확인하세요." }),
    };
  }

  try {
    const { base64, mediaType } = JSON.parse(event.body || "{}");
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ error: "이미지 데이터가 없습니다" }) };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 },
              },
              { type: "text", text: "이 영수증을 분석해서 JSON으로 반환해줘." },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: "Anthropic API 오류", detail }) };
    }

    const data = await response.json();
    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed.date) parsed.date = new Date().toISOString().slice(0, 10);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
