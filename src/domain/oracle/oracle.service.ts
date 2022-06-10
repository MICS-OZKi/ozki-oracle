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
        return {
          subsPlanID: subscriptionData.plan_id,
          timestamp: getUTCTimestampInSeconds(),
          subsAge: diffMinutes(
            new Date(subscriptionData.start_time),
            new Date(),
          ),
          signature: 'This is a dummy signature',
        };
      }
    } catch (error) {
      return error;
    }
  }
}
