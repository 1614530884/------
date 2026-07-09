// 用户类型
export interface User {
  id: number;
  username: string;
  email: string;
  phone?: string;
  balance?: number;
}

// 订单类型
export interface Order {
  id: number;
  order_id: string;
  user_id: number;
  product_id: number;
  product_name: string;
  config: Record<string, unknown>;
  amount: number;
  status: number;
  create_time: string;
  pay_time?: string;
  active_time?: string;
}

// 产品类型
export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  config: Record<string, unknown>;
}

// 购物车项
export interface CartItem {
  productId: number;
  quantity: number;
  config: Record<string, unknown>;
}

// 订单流程状态
export interface OrderFlowStatus {
  step: number;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  description?: string;
  timestamp?: number;
}

// 订单状态枚举
export enum OrderStatus {
  Pending = 0,
  Paid = 1,
  Processing = 2,
  Completed = 3,
  Cancelled = 4,
  Failed = 5,
}

// 套餐匹配结果
export interface PackageMatchResult {
  matched: boolean;
  packageId?: number;
  confidence?: number;
  message?: string;
}
