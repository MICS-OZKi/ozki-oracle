import * as dotenv from 'dotenv';

dotenv.config();

const PayPalScriptAPI = 'https://www.paypalobjects.com/js/external/api.js';
const PayPalOauth2APIURL = process.env.PayPalBasedAPIURL + '/v1/oauth2/token';
const PayPalUserInfoAPIURL =
  process.env.PayPalBasedAPIURL +
  '/v1/identity/oauth2/userinfo?schema=paypalv1.1';
const PayPalListTransactionAPIURL = (
  startDate: Date,
  endDate: Date,
  bodyString: string,
) => {
  return (
    process.env.PayPalBasedAPIURL +
    `/v1/reporting/transactions?fields=transaction_info,payer_info,shipping_info,cart_info&&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}&${bodyString}`
  );
};

const PayPalSubscriptionDetailAPIURL = (subscriptionId: string) => {
  return (
    process.env.PayPalBasedAPIURL +
    `/v1/billing/subscriptions/${subscriptionId}?fields=last_failed_payment,plan`
  );
};

export {
  PayPalScriptAPI,
  PayPalOauth2APIURL,
  PayPalUserInfoAPIURL,
  PayPalListTransactionAPIURL,
  PayPalSubscriptionDetailAPIURL,
};
