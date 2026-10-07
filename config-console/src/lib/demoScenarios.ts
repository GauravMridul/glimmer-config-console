import type { ConfigBundle } from "@/lib/storage";

const t = () => new Date().toISOString();

/** Rich aligned dataset for walkthroughs and screenshots. */
export function bundleFullDemo(): ConfigBundle {
  const ts = t();
  return {
    serviceConfigurations: [
      {
        id: 1,
        service_name: "CreditCheck",
        api_url: "https://api.example.com/v1/credit/score",
        headers: { "Content-Type": "application/json", "X-Partner": "((partnerName))" },
        request_body: {
          applicationId: "((applicationId))",
          customerId: "((customerId))",
        },
        request_method: "POST",
        response_body: {},
        send_response: false,
        timeout: 30,
        additional_config: {},
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
      {
        id: 2,
        service_name: "NTCModel",
        api_url: "https://api.example.com/v1/ntc/evaluate",
        headers: { "Content-Type": "application/json" },
        request_body: { leadId: "((leadId))" },
        request_method: "POST",
        response_body: {},
        send_response: false,
        timeout: 45,
        additional_config: {},
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
      {
        id: 3,
        service_name: "FraudScreen",
        api_url: "https://api.example.com/v1/fraud/check",
        headers: {},
        request_body: {},
        request_method: "GET",
        response_body: {},
        send_response: false,
        timeout: 20,
        additional_config: {},
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
    partnerMappings: [
      {
        id: 1,
        name: "Samsung — KYC (credit + NTC)",
        partner_name: "Samsung",
        program_type: "Repeat",
        business_type: "Personal Loan",
        sourcing_program: "",
        loan_category: "",
        customer_type: "",
        product_line: "",
        stage: "Kyc",
        service_sequence_string: "{1;2}",
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
      {
        id: 2,
        name: "Acme — Fraud gate",
        partner_name: "Acme",
        program_type: "New",
        business_type: "",
        sourcing_program: "",
        loan_category: "",
        customer_type: "",
        product_line: "",
        stage: "Underwriting",
        service_sequence_string: "{3}",
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
    sfdcMappings: [
      {
        id: 1,
        service_name: "NTCModel",
        request_body: [
          {
            url: "/services/data/v64.0/sobjects/Audit_Log__c",
            method: "POST",
            referenceId: "NTCModel_Audit_Log__c_Post",
            merge: "false",
            body: {
              Type__c: "((NTCModel.serviceName))",
              Response__c: "{{serializeJson(((NTCModel.response)))}}",
            },
          },
          {
            url: "/services/data/v64.0/sobjects/NTC_Summary__c",
            method: "POST",
            referenceId: "NTCModel_NTC_Summary__c_Post",
            merge: "false",
            body: {
              Run_Id__c: "((NTCModel.response.body.body[0].RunId__c))",
              Score__c: "((NTCModel.response.body.body[0].ModelScore__c))",
            },
          },
        ],
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
      {
        id: 2,
        service_name: "CreditCheck",
        request_body: [
          {
            url: "/services/data/v64.0/sobjects/Credit_Snapshot__c",
            method: "POST",
            referenceId: "CreditCheck_Snapshot_Post",
            merge: "false",
            body: {
              Score__c: "((CreditCheck.score))",
              Lead__c: "((leadId))",
            },
          },
        ],
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
  };
}

/** ESA calls CreditCheck + NTCModel but only NTCModel has SFDC stamping — CreditCheck row missing on purpose. */
export function bundleMissingSfdcForCredit(): ConfigBundle {
  const b = bundleFullDemo();
  b.sfdcMappings = b.sfdcMappings.filter((x) => x.service_name !== "CreditCheck");
  return b;
}

/** SFDC template exists for a name that does not exist in ESA — shows orphan on Overview. */
export function bundleOrphanSfdc(): ConfigBundle {
  const b = bundleFullDemo();
  b.sfdcMappings = [
    ...b.sfdcMappings,
    {
      id: 99,
      service_name: "LegacyOnlyService",
      request_body: [
        {
          url: "/services/data/v64.0/sobjects/Old_Object__c",
          method: "POST",
          referenceId: "orphan",
          merge: "false",
          body: { Name: "demo" },
        },
      ],
      created_date: t(),
      created_by: "demo",
      modified_date: null,
      modified_by: null,
      is_deleted: false,
    },
  ];
  return b;
}

/** Minimal single-path demo — fastest to explain in a meeting. */
export function bundleMinimal(): ConfigBundle {
  const ts = t();
  return {
    serviceConfigurations: [
      {
        id: 1,
        service_name: "HelloService",
        api_url: "https://httpbin.org/post",
        headers: {},
        request_body: { ping: true },
        request_method: "POST",
        response_body: {},
        send_response: false,
        timeout: 15,
        additional_config: {},
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
    partnerMappings: [
      {
        id: 1,
        name: "Demo partner — one step",
        partner_name: "DemoPartner",
        program_type: "",
        business_type: "",
        sourcing_program: "",
        loan_category: "",
        customer_type: "",
        product_line: "",
        stage: "Start",
        service_sequence_string: "{1}",
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
    sfdcMappings: [
      {
        id: 1,
        service_name: "HelloService",
        request_body: [
          {
            url: "/services/data/v64.0/sobjects/Demo_Log__c",
            method: "POST",
            referenceId: "HelloService_log",
            merge: "false",
            body: { Notes__c: "((HelloService.status))" },
          },
        ],
        created_date: ts,
        created_by: "demo",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
  };
}

export type DemoScenarioId =
  | "full"
  | "minimal"
  | "missing-sfdc"
  | "orphan-sfdc";

export function getDemoScenario(id: DemoScenarioId): ConfigBundle {
  switch (id) {
    case "minimal":
      return bundleMinimal();
    case "missing-sfdc":
      return bundleMissingSfdcForCredit();
    case "orphan-sfdc":
      return bundleOrphanSfdc();
    default:
      return bundleFullDemo();
  }
}
