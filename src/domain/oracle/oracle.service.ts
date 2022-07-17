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
  oracleGoogleOutputDto,
  oracleGoogleInputDto,
} from './dto/oracle.dto';
import { buildEddsa } from 'circomlibjs';
import { assert } from 'chai';
import { ZkUtils, OracleData} from 'ozki-toolkit';
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';

dotenv.config();
// use the google auth lib class
const client = new OAuth2Client(process.env.GoogleClientID);

interface PayPalInput {subsPlanID: string, subsAge: number};
class PayPalOracleData extends OracleData<PayPalInput> {
  protected formatCustomInput(timeStamp: number, input: PayPalInput): number[] {
    console.log("**** PayPalOracleData.formatCustomInput");
    const zkutils = new ZkUtils();
    return zkutils.normalizeInputForHash(input.subsPlanID, input.subsAge, timeStamp);
  }
}

interface LoginInfo {domain: string};
class GoogleAuthOracleData extends OracleData<LoginInfo> {
  protected formatCustomInput(timeStamp: number, input: LoginInfo): number[] {
    console.log("**** GoogleAuthOracleData.formatCustomInput");
    const zkutils = new ZkUtils();
    return zkutils.normalizeAuthInputForHash(input.domain, timeStamp);
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
      process.env.OraclePrivateKey,
      timestamp,
      {subsPlanID, subsAge}
    );
  };

  private generateAuthSignature = async (
    emailDomain: string,
    timestamp: number,
  ): Promise<Array<any>> => {
    const oracleData = new GoogleAuthOracleData();
    return await oracleData.sign(
      process.env.OraclePrivateKey,
      timestamp,
      {domain: emailDomain}
    );
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
    console.log(">> GetSubscriptionInfo");
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
        console.log("<< GetSubscriptionInfo: completed in %d ms", t2-t1);

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

  private getDomain = async (email: string): Promise<string> => {
    return email.split('@')[1];
  };

  private async verifyGoogleCodeToken(googleCodeToken: string) {
    // call google to verify the code token
    console.log("#### calling google's verifyIdToken");
    const ticket = await client.verifyIdToken({
      idToken: googleCodeToken,
      audience: process.env.GoogleClientID,
    });

    // get the payload
    console.log("#### calling google's getPayload");
    const payload = ticket.getPayload();

    // we are interested in email only
    const email = payload['email'];
    console.log("#### email=%s", email);
    const domain = await this.getDomain(email);
    return domain;
  }

  async verifyGoogleCredential(
    oracleGoogleInputData: oracleGoogleInputDto,
  ): Promise<oracleGoogleOutputDto | oracleOutputErrorDto> {
    console.log(">> verifyGoogleCredential");
    const t1 = new Date().getTime();
    try {
      const emailDomain = await this.verifyGoogleCodeToken(
        oracleGoogleInputData.googleCodeToken,
      );
      if (emailDomain) {
        const timestamp = getUTCTimestampInSeconds();

        const signature = await this.generateAuthSignature(
          emailDomain,
          timestamp,
        );

        const t2 = new Date().getTime();
        console.log("<< verifyGoogleCredential: completed in %d ms", t2-t1);
        return {
          timestamp: timestamp,
          emailDomain: emailDomain,
          signature: signature,
        };
      }
    } catch (error) {
      console.log(error);
      throw this.handleError(
        'Oracle Error',
        'Data is invalid or does not fit the requirements',
      );
    }
  }
}
