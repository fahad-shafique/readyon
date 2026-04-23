import { HcmErrorCategory } from '../../common/types';

export abstract class HcmError extends Error {
  abstract readonly category: HcmErrorCategory;
  abstract readonly hcmErrorCode: string;

  constructor(
    message: string,
    public readonly correlationId: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class HcmTransientError extends HcmError {
  readonly category = HcmErrorCategory.TRANSIENT;

  constructor(
    public readonly hcmErrorCode: string,
    message: string,
    correlationId: string,
  ) {
    super(message, correlationId);
  }
}

export class HcmPermanentError extends HcmError {
  readonly category = HcmErrorCategory.PERMANENT;

  constructor(
    public readonly hcmErrorCode: string,
    message: string,
    correlationId: string,
  ) {
    super(message, correlationId);
  }
}
