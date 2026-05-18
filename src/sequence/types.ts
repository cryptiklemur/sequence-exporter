export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: Pagination;
}

export type AccountType =
  | "BANK"
  | "BROKERAGE"
  | "CRYPTO_EXCHANGE"
  | "CASH"
  | "LOAN"
  | "CREDIT_CARD"
  | "PROPERTY"
  | "VEHICLE"
  | "OTHER_ASSET"
  | "OTHER_LIABILITY"
  | "EXTERNAL_ACCOUNT"
  | "POD"
  // open fallback so unknown server values still type-check, while known values autocomplete
  | (string & {});

export interface AccountSummary {
  id: string;
  name: string;
  type: AccountType;
  description?: string | null;
  externalAccountType?: string | null;
  beneficiaryName?: string | null;
  institutionName?: string | null;
  canBeSource?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Balance {
  balanceInCents: number | null;
  availableBalanceInCents?: number | null;
  lastStatementBalanceInCents?: number | null;
  nextPaymentMinimumInCents?: number | null;
  nextPaymentDueDate?: string | null;
  balanceLastUpdatedAt?: string | null;
  error?: string | null;
}

export interface Account extends AccountSummary {
  routingNumber?: string | null;
  bankAccountNumber?: string | null;
  balance: Balance | null;
}

export interface TransferAccountRef {
  id: string;
  name: string;
  type: AccountType;
  isDeleted: boolean;
}

export type TransferStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETE"
  | "FAILED"
  | "CANCELED"
  | "RETURNED"
  | (string & {});

export type TransferDirection = "MONEY_IN" | "MONEY_OUT" | (string & {});

export type TransferOrigin = "RULE" | "MANUAL" | "AUTO" | "INSTANT" | "API" | (string & {});

export interface Transfer {
  id: string;
  amountInCents: number;
  direction: TransferDirection;
  origin: TransferOrigin;
  source: TransferAccountRef;
  destination: TransferAccountRef;
  status: TransferStatus;
  ruleId?: string | null;
  ruleExecutionId?: string | null;
  errorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
}
