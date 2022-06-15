export interface oracleSubscriptionInputDto {
  readonly code: string;
  readonly subscriptionID: string;
}
export interface oracleSubscriptionOutputDto {
  timestamp: number;
  subsPlanID: string;
  subsAge: number;
  signature: Uint8Array;
}

export interface oracleOutputErrorDto {
  error: string;
  error_description: string;
}

export interface subscriptionDataType {
  status: string;
  status_update_time: Date;
  id: string;
  plan_id: string;
  start_time: Date;
  quantity: string;
  shipping_amoutn: {
    currency_code: string;
    value: string;
  };
  subscriber: {
    email_address: string;
    payer_id: string;
    name: {
      given_name: string;
      surname: string;
    };
    shipping_address: {
      address: {
        address_line_1: string;
        admin_area_2: string;
        admin_area_1: string;
        postal_code: string;
        country_code: string;
      };
    };
  };
  billing_info: {
    outstanding_balance: {
      currency_code: string;
      value: string;
    };
    cycle_executions: any[];
    last_payment: {
      amount: {
        currency_code: string;
        value: string;
      };
      time: Date;
    };
    next_billing_time: Date;
    failed_payments_count: string;
  };
  create_time: Date;
  update_time: Date;
  plan_overridden: boolean;
  plan: {
    product_id: string;
    name: string;
    description: string;
    billing_cycles: any[];
    payment_preferences: {
      service_type: string;
      auto_bill_outstanding: boolean;
      setup_fee: {
        currency_code: string;
        value: string;
      };
      setup_fee_failure_action: string;
      payment_failure_threshold: number;
    };
    quantity_supported: boolean;
  };
  links: any[];
}

interface emailsPayPalType {
  value: string;
  primary: boolean;
  confirmed: boolean;
}
export interface userInfoType {
  user_id: string;
  sub: string;
  name: string;
  payer_id: string;
  address: {
    street_address: string;
    locality: string;
    region: string;
    postal_code: string;
    country: string;
  };
  emails: emailsPayPalType[];
  verified_account: string;
}

export interface PayPalRequestHeader {
  Authorization: string;
}
