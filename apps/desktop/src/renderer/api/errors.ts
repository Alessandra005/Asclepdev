import type { ErrorCode } from './types'

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly requestId: string | null
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}
