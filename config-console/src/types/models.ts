/** ESA `service_configuration` row (aligned with esa_models.ServiceConfiguration). */
export type ServiceConfiguration = {
  id: number;
  service_name: string;
  api_url: string;
  headers: Record<string, unknown>;
  request_body: Record<string, unknown>;
  request_method: string;
  response_body: Record<string, unknown>;
  send_response: boolean;
  timeout: number;
  additional_config: Record<string, unknown>;
  created_date: string;
  created_by: string;
  modified_date: string | null;
  modified_by: string | null;
  is_deleted: boolean;
};

/** Decision Manager `partner_service_mapping`. */
export type PartnerServiceMapping = {
  id: number;
  name: string;
  partner_name: string;
  program_type: string;
  business_type: string;
  sourcing_program: string;
  loan_category: string;
  customer_type: string;
  product_line: string;
  stage: string;
  service_sequence_string: string;
  created_date: string;
  created_by: string;
  modified_date: string | null;
  modified_by: string | null;
  is_deleted: boolean;
};

/** Decision Manager `service_sfdc_field_mapping` — request_body is Composite template array. */
export type ServiceSfdcFieldMapping = {
  id: number;
  service_name: string;
  /** JSON array of composite sub-requests */
  request_body: unknown;
  created_date: string;
  created_by: string;
  modified_date: string | null;
  modified_by: string | null;
  is_deleted: boolean;
};
