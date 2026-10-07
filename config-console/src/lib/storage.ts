import type {
  PartnerServiceMapping,
  ServiceConfiguration,
  ServiceSfdcFieldMapping,
} from "@/types/models";

const STORAGE_KEY = "config-console/v1";

export type ConfigBundle = {
  serviceConfigurations: ServiceConfiguration[];
  partnerMappings: PartnerServiceMapping[];
  sfdcMappings: ServiceSfdcFieldMapping[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function seedBundle(): ConfigBundle {
  const t = nowIso();
  return {
    serviceConfigurations: [
      {
        id: 1,
        service_name: "CreditCheck",
        api_url: "https://api.example.com/v1/credit",
        headers: { "Content-Type": "application/json" },
        request_body: { customerId: "((customerId))" },
        request_method: "POST",
        response_body: {},
        send_response: false,
        timeout: 30,
        additional_config: {},
        created_date: t,
        created_by: "seed",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
      {
        id: 2,
        service_name: "NTCModel",
        api_url: "https://api.example.com/v1/ntc",
        headers: {},
        request_body: {},
        request_method: "POST",
        response_body: {},
        send_response: false,
        timeout: 45,
        additional_config: {},
        created_date: t,
        created_by: "seed",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
    partnerMappings: [
      {
        id: 1,
        name: "Samsung — KYC",
        partner_name: "Samsung",
        program_type: "Repeat",
        business_type: "",
        sourcing_program: "",
        loan_category: "",
        customer_type: "",
        product_line: "",
        stage: "Kyc",
        service_sequence_string: "{1;2}",
        created_date: t,
        created_by: "seed",
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
            },
          },
        ],
        created_date: t,
        created_by: "seed",
        modified_date: null,
        modified_by: null,
        is_deleted: false,
      },
    ],
  };
}

export function loadBundle(): ConfigBundle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = seedBundle();
      saveBundle(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as ConfigBundle;
    if (
      !parsed.serviceConfigurations ||
      !parsed.partnerMappings ||
      !parsed.sfdcMappings
    ) {
      const seed = seedBundle();
      saveBundle(seed);
      return seed;
    }
    return parsed;
  } catch {
    const seed = seedBundle();
    saveBundle(seed);
    return seed;
  }
}

export function saveBundle(bundle: ConfigBundle): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

export function resetToSeed(): ConfigBundle {
  const seed = seedBundle();
  saveBundle(seed);
  return seed;
}

export { nowIso };
