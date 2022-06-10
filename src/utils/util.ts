import axios from 'axios';
import axiosRetry from 'axios-retry';
import * as dotenv from 'dotenv';

dotenv.config();

axiosRetry(axios, {
  retries: process.env.RetriesNumber ? parseInt(process.env.RetriesNumber) : 1,
  shouldResetTimeout: true,
  retryCondition: (error) => {
    return error.response.status === 500 || error.response.status === 503;
  },
});

const encode = (str: string): string =>
  Buffer.from(str, 'binary').toString('base64');

const getUTCTimestampInSeconds = () => {
  return Math.floor(new Date().getTime() / 1000);
};

const diffMinutes = (startDate: Date, endDate: Date) => {
  return Math.floor((endDate.getTime() - startDate.getTime()) / 60000);
};

const generateURLEncodedData = (data: any): string => {
  const formBody = [];
  for (const property in data) {
    const encodedKey = encodeURIComponent(property);
    const encodedValue = encodeURIComponent(data[property]);
    formBody.push(encodedKey + '=' + encodedValue);
  }
  const body = formBody.join('&');
  return body;
};

const checkStatusActive = (status: string) => {
  return status === 'ACTIVE';
};

const checkPayerID = (payerID: string, userID: string) => {
  return payerID === userID;
};

const sendRequestLocal = async (
  url: string,
  data: any,
  method: string,
  headers?: any,
) => {
  return await sendRequest(
    `http://localhost:3001/${url}`,
    data,
    method,
    headers,
  );
};

const sendRequestExternalAPI = async (
  url: string,
  data: any,
  method: string,
  headers?: any,
) => {
  return await sendRequest(url, data, method, headers);
};

const sendRequest = async (
  url: string,
  data: any,
  method: string,
  headers?: any,
) => {
  try {
    let response;
    if (method === 'POST') {
      response = await axios
        .post(url, data, { headers: headers })
        .catch((error) => {
          return error;
        });
    } else if (method === 'GET') {
      response = await axios.get(url, { headers: headers }).catch((error) => {
        return error;
      });
    }
    return response;
  } catch (error) {
    console.log('Error send Request', error); // eslint-disable-line no-console
    throw error;
  }
};

export {
  encode,
  getUTCTimestampInSeconds,
  diffMinutes,
  checkPayerID,
  checkStatusActive,
  generateURLEncodedData,
  sendRequestLocal,
  sendRequestExternalAPI,
};
