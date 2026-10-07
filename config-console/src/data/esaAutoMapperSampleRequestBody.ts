/**
 * Bundled sample JSON for ESA Auto Mapper (arrays, bureau-style blobs). UI explains usage.
 */
export const ESA_AUTO_MAPPER_SAMPLE_REQUEST_BODY = `{
  "partner": "Personal Loan",
  "net_monthly_income": 23058,
  "Last12MSalesTransaction": [
    { "amount": 1200, "txnDate": "2025-01-15", "merchantName": "Retail A", "category": "shopping" },
    { "amount": 800, "txnDate": "2025-02-03", "merchantName": "Fuel B", "category": "fuel" }
  ],
  "GST_Details": [
    { "gstin": "29ABCDE1234F1Z5", "legalName": "Example Pvt Ltd", "status": "Active" }
  ],
  "Cibil_Data": {
    "consumerCreditData": [
      {
        "addresses": [
          { "line1": "Sample line 1", "pinCode": "400017", "stateCode": "27" }
        ],
        "scores": [{ "score": "00779", "scoreName": "CIBILTUSC3" }],
        "enquiries": [{ "enquiryDate": "13122025", "enquiryPurpose": "10" }]
      }
    ],
    "consumerSummaryData": {
      "accountSummary": { "totalAccounts": 19, "currentBalance": 406502 }
    },
    "controlData": { "success": true }
  },
  "fk_data": {},
  "transaction_detail__c": {}
}`;
