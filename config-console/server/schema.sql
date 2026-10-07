-- Single database for local config-console: ESA + Decision Manager tables.
-- Run: psql "$DATABASE_URL" -f server/schema.sql

CREATE TABLE IF NOT EXISTS service_configuration (
    id BIGSERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    api_url VARCHAR(512) NOT NULL,
    headers JSONB DEFAULT '{}',
    request_body JSONB DEFAULT '{}',
    request_method VARCHAR(255) NOT NULL,
    response_body JSONB DEFAULT '{}',
    send_response BOOLEAN DEFAULT FALSE,
    timeout INT4 DEFAULT 0,
    additional_config JSONB DEFAULT '{}',
    created_date TIMESTAMP NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    modified_date TIMESTAMP,
    modified_by VARCHAR(255),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS partner_service_mapping (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    partner_name VARCHAR(255) NOT NULL,
    program_type VARCHAR(255) DEFAULT '',
    business_type VARCHAR(255) DEFAULT '',
    sourcing_program VARCHAR(255) DEFAULT '',
    loan_category VARCHAR(255) DEFAULT '',
    customer_type VARCHAR(255) DEFAULT '',
    product_line VARCHAR(255) DEFAULT '',
    stage VARCHAR(255) NOT NULL,
    service_sequence_string VARCHAR(255) NOT NULL,
    created_date TIMESTAMP NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    modified_date TIMESTAMP,
    modified_by VARCHAR(255),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS service_sfdc_field_mapping (
    id BIGSERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    request_body JSONB DEFAULT '[]'::jsonb,
    created_date TIMESTAMP NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    modified_date TIMESTAMP,
    modified_by VARCHAR(255),
    is_deleted BOOLEAN DEFAULT FALSE
);
