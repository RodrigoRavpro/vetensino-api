import axios from 'axios';
import { env } from '../../../config/env';

export type FinpetOrder = {
  uuid: string;
  payUrl: string;
  reference: string;
  status: 'APPROVED' | 'PENDING' | 'CANCELED';
};

const cents = (value: string): string => String(Math.round(Number(value) * 100));

const getClient = () => {
  if (!env.payments.isConfigured || !env.payments.baseUrl) {
    throw new Error('FINPET não configurado');
  }
  const credential = env.payments.credential || env.payments.apiKey || '';
  const password = env.payments.password || env.payments.apiKey || '';
  return axios.create({
    baseURL: env.payments.baseUrl.replace(/\/+$/, ''),
    timeout: 15_000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${credential}:${password}`).toString('base64')}`,
    },
  });
};

export const createFinpetOrder = async (input: { reference: string; amount: string; customerName: string; customerDocument?: string; description: string; redirectUrl: string }): Promise<FinpetOrder> => {
  const response = await getClient().post<FinpetOrder>('/api/orders', {
    order: {
      reference: input.reference,
      redirectUrl: input.redirectUrl,
      amount: cents(input.amount),
      minInstallments: 1,
      maxInstallments: 12,
      merchantCode: env.payments.merchantId,
      customerName: input.customerName,
      customerDocument: input.customerDocument,
      description: input.description,
    },
  });
  return response.data;
};

export const getFinpetOrder = async (uuid: string): Promise<FinpetOrder> => (await getClient().get<FinpetOrder>(`/api/orders/${uuid}`)).data;
