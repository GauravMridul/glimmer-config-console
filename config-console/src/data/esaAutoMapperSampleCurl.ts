/** Sample curl for ESA Auto Mapper (matches the JSON example shape in spirit). */
export const ESA_AUTO_MAPPER_SAMPLE_CURL = `curl 'https://api.example.com/v1/decision' \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  -d '{"partner":"Personal Loan","net_monthly_income":23058,"Last12MSalesTransaction":[{"amount":1200,"txnDate":"2025-01-15","merchantName":"Retail A","category":"shopping"}],"fk_data":{}}'`;
