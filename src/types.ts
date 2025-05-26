export type PackageOptions = {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly debug?: boolean;
};

export type PackageResult = {
  readonly success: boolean;
  readonly message: string;
  readonly data?: unknown;
};

export type ConfigOptions = {
  readonly timeout?: number;
  readonly retries?: number;
  readonly verbose?: boolean;
};
