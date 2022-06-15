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

  private stringToBytes(s: string): number[] {
    const MAX_STRING_LENGTH = 48;
    const enc = new TextEncoder();

    if (s.length > MAX_STRING_LENGTH)
      throw new Error('Exceeding max string length');

    s = s.padEnd(MAX_STRING_LENGTH, ' ');
    return Array.from(enc.encode(s));
  }

  private numberToBytes(i: number, b: number): number[] {
    const a: number[] = [];
    for (let j = 0; j < b; j++) {
      const q = Math.floor(i / 256);
      const r = i - q * 256;
      a.push(r);
      i = q;
    }
    return a;
  }

  private normalizeInputForHash = (
    s: string,
    age: number,
    ts: number,
  ): number[] => {
    // s is a fixed array of 20 numbers
    // a is a number
    // the serialized data is s appended with a, resulting in array of 21 numbers
    const data = this.stringToBytes(s);

    let bytes = this.numberToBytes(age, 4);
    for (let i = 0; i < 4; i++) {
      data.push(bytes[i]);
    }

    bytes = this.numberToBytes(ts, 4);
    for (let i = 0; i < 4; i++) {
      data.push(bytes[i]);
    }

    return data;
  };

  private generateSignature = async (
    subsPlanID: string,
    subsAge: number,
    timestamp: number,
  ): Promise<Uint8Array> => {
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

    // calculate the sig of the PII
    const msg = this.normalizeInputForHash(subsPlanID, subsAge, timestamp);

    const signature = eddsa.signPedersen(prvKey, msg);
    const pSignature = eddsa.packSignature(signature); // this is the signature for the PII

    return pSignature;
  };

  private getAccessToken = async (codeToken: string): Promise<string> => {
    const oauthData = {
      grant_type: 'authorization_code',
      code: codeToken,
    };
    const bodyString = generateURLEncodedData(oauthData);

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
        'Error when retrieving subscription Data.',
      );
    }

    return response.data;
  };

  private validateSubscriptionData = async (
    subscriptionData: subscriptionDataType,
    userInfo: userInfoType,
  ): Promise<boolean> => {
    if (
      checkStatusActive(subscriptionData.status) &&
      checkPayerID(subscriptionData.subscriber.payer_id, userInfo.payer_id)
    ) {
      return true;
    }
    throw this.handleError(
      'Oracle Error',
      'Data is invalid or does not fit the requirements',
    );
  };

  async getSubscriptionInfo(
    oracleSubscriptionInputData: oracleSubscriptionInputDto,
  ): Promise<oracleSubscriptionOutputDto | oracleOutputErrorDto> {
    try {
      const access_token = await this.getAccessToken(
        oracleSubscriptionInputData.code,
      );

      const header = {
        Authorization: `Bearer ${access_token}`,
      };

      const userInfo = await this.getUserInfo(header);
      const subscriptionData = await this.getSubscriptionData(
        oracleSubscriptionInputData.subscriptionID,
      );

      if (await this.validateSubscriptionData(subscriptionData, userInfo)) {
        const planId = subscriptionData.plan_id;
        const subsAge = diffMinutes(
          new Date(subscriptionData.start_time),
          new Date(),
        );
        const timestamp = getUTCTimestampInSeconds();
        const signature = await this.generateSignature(
          planId,
          subsAge,
          timestamp,
        );
        return {
          subsPlanID: subscriptionData.plan_id,
          timestamp: getUTCTimestampInSeconds(),
          subsAge: subsAge,
          signature: signature,
        };
      }
    } catch (error) {
      return error;
    }
  }
}
