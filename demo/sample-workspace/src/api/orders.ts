import { formatMoney } from '../lib/format';

export interface Order {
  id: number;
  totalCents: number;
}

export const describeOrder = (order: Order): string => `#${order.id} · ${formatMoney(order.totalCents)}`;
