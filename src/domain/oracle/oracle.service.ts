import { Injectable } from '@nestjs/common';
import {
  PayPalOauth2APIURL,
  PayPalSubscriptionDetailAPIURL,
  PayPalUserInfoAPIURL,
} from '@/config/payPalConfig';
import {
  checkPayerID,
  checkStatusActive,
  diffMinutes,
  diffDays,
  encode,
  generateURLEncodedData,
  getUTCTimestampInSeconds,
  sendRequestExternalAPI,
} from '@/utils/util';
import {
  oracleSubscriptionInputDto,
  oracleOutputErrorDto,
  oracleSubscriptionOutputDto,
  subscriptionDataType,
  userInfoType,
  PayPalRequestHeader,
} from './dto/oracle.dto';
import { buildEddsa } from 'circomlibjs';
import { assert } from 'chai';
import { ZkUtils, OracleData} from 'ozki-lib';

interface PayPalInput {subsPlanID: string, subsAge: number};
class PayPalOracleData extends OracleData<PayPalInput> {
  protected formatCustomInput(timeStamp: number, input: PayPalInput): number[] {
    console.log("**** PayPalOracleData.formatCustomInput");
    const zkutils = new ZkUtils();
    return zkutils.normalizeInputForHash(input.subsPlanID, input.subsAge, timeStamp);
  }
}

@Injectable()
export class OracleService {
  private readonly authCodeBase64 = encode(
    `${process.env.PayPalClientID}:${process.env.PayPalSecret}`,
  );

  private handleError = (
    error: string,
    error_description: string,
  ): oracleOutputErrorDto => {
    return {
      error: error,
      error_description: error_description,
    };
  };

  private generateSignature = async (
    subsPlanID: string,
    subsAge: number,
    timestamp: number,
  ): Promise<Array<any>> => {

    const oracleData = new PayPalOracleData();
    return await oracleData.sign(
      '0001020304050607080900010203040506070809000102030405060708090001',
      timestamp,
      {subsPlanID, subsAge}
    );

    /*
    //
    // running on oracle side:
    //   get the PII and sign the data
    //
    const eddsa = await buildEddsa();

    // oracle's signature keys
    const prvKey = Buffer.from(
      '0001020304050607080900010203040506070809000102030405060708090001',
      'hex',
    );
    const pubKey = eddsa.prv2pub(prvKey);

    // calculate the sig of the PII
    const zkutils = new ZkUtils();
    const msg = zkutils.normalizeInputForHash(subsPlanID, subsAge, timestamp);

    const signature = eddsa.signPedersen(prvKey, msg);
    const pSignature = eddsa.packSignature(signature); // this is the signature for the PII

    // assert (optional)
    const uSignature = eddsa.unpackSignature(pSignature);
    assert(eddsa.verifyPedersen(msg, uSignature, pubKey));

    const pSignatureArray = Array.from(pSignature);

    return pSignatureArray;
    */
  };

  private getAccessToken = async (codeToken: string): Promise<string> => {
    const oauthData = {
      grant_type: 'authorization_code',
      code: codeToken,
    };
    const bodyString = generateURLEncodedData(oauthData);

    console.log("calling paypal's oauth2 api");
    const response = await sendRequestExternalAPI(
      PayPalOauth2APIURL,
      bodyString,
      'POST',
      {
        Authorization: `Basic ${this.authCodeBase64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    );

    if (
      [200, 201, 202, 204].indexOf(response.status) === -1 ||
      !response ||
      !response.data
    ) {
      throw this.handleError(
        'Oracle Error',
        'Error when retrieving access token',
      );
    }

    return response.data.access_token;
  };

  private getUserInfo = async (
    header: PayPalRequestHeader,
  ): Promise<userInfoType> => {
    const response = await sendRequestExternalAPI(
      PayPalUserInfoAPIURL,
      {},
      'GET',
      header,
    );

    if (
      [200, 201, 202, 204].indexOf(response.status) === -1 ||
      !response ||
      !response.data
    ) {
      throw this.handleError('Oracle Error', 'Error when retrieving user info');
    }

    return response.data;
  };

  private getSubscriptionData = async (
    subscriptionId: string,
  ): Promise<subscriptionDataType> => {
    const response = await sendRequestExternalAPI(
      PayPalSubscriptionDetailAPIURL(subscriptionId),
      {},
      'GET',
      {
        Authorization: `Basic ${this.authCodeBase64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    );
    if (
      [200, 201, 202, 204].indexOf(response.status) === -1 ||
      !response ||
      !response.data
    ) {
      throw this.handleError(
        'Oracle Error',
        'Error occured during subscription data retrieval. Check the billing-id.',
      );
    }

    return response.data;
  };

  private validateSubscriptionData = async (
    subscriptionData: subscriptionDataType,
    userInfo: userInfoType,
  ): Promise<boolean> => {
    if (!checkStatusActive(subscriptionData.status)) {
      throw this.handleError(
        'Oracle Error',
        'Subscription is no longer active',
      );
    }

    if (!checkPayerID(subscriptionData.subscriber.payer_id, userInfo.payer_id)) {
      throw this.handleError(
        'Oracle Error',
        'The billing-id is not owned by the logged-on user'
      );
    }
    return true;
  };

  async getSubscriptionInfo(
    oracleSubscriptionInputData: oracleSubscriptionInputDto,
  ): Promise<oracleSubscriptionOutputDto | oracleOutputErrorDto> {
    console.log("**** GetSubscriptionInfo started");
    const t1 = new Date().getTime();

    try {
      console.log("**** getting paypal's access token");
      const access_token = await this.getAccessToken(
        oracleSubscriptionInputData.code,
      );

      const header = {
        Authorization: `Bearer ${access_token}`,
      };

      console.log("**** getting paypal's user info");
      const userInfo = await this.getUserInfo(header);

      console.log("**** getting paypal's subscription detail");
      const subscriptionData = await this.getSubscriptionData(
        oracleSubscriptionInputData.subscriptionID,
      );

      console.log("**** validating subscription status & owner");
      if (await this.validateSubscriptionData(subscriptionData, userInfo)) {
        const planId = subscriptionData.plan_id;
        const subsAge = diffDays(
          new Date(subscriptionData.start_time),
          new Date(),
        );
        const timestamp = getUTCTimestampInSeconds();
        const signature = await this.generateSignature(
          planId,
          subsAge,
          timestamp,
        );

        const t2 = new Date().getTime();
        console.log("**** GetSubscriptionInfo completed in %d ms", t2-t1);

        return {
          subsPlanID: subscriptionData.plan_id,
          timestamp: timestamp,
          subsAge: subsAge,
          signature: signature,
        };
      }
    }
    catch (error) {
      console.log(error);
      return error;
    }
  }
}
