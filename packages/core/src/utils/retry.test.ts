/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HttpError } from './retry.js';
import {
  getErrorStatus,
  isTPMThrottlingError,
  retryWithBackoff,
} from './retry.js';
import { setSimulate429 } from './testUtils.js';
import { AuthType } from '../core/contentGenerator.js';

// Helper to create a mock function that fails a certain number of times
const createFailingFunction = (
  failures: number,
  successValue: string = 'success',
) => {
  let attempts = 0;
  return vi.fn(async () => {
    attempts++;
    if (attempts <= failures) {
      // Simulate a retryable error
      const error: HttpError = new Error(`Simulated error attempt ${attempts}`);
      error.status = 500; // Simulate a server error
      throw error;
    }
    return successValue;
  });
};

// Custom error for testing non-retryable conditions
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Disable 429 simulation for tests
    setSimulate429(false);
    // Suppress unhandled promise rejection warnings for tests that expect errors
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should return the result on the first attempt if successful', async () => {
    const mockFn = createFailingFunction(0);
    const result = await retryWithBackoff(mockFn);
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed if failures are within maxAttempts', async () => {
    const mockFn = createFailingFunction(2);
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    await vi.runAllTimersAsync(); // Ensure all delays and retries complete

    const result = await promise;
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw an error if all attempts fail', async () => {
    const mockFn = createFailingFunction(3);

    // 1. Start the retryable operation, which returns a promise.
    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    // 2. IMPORTANT: Attach the rejection expectation to the promise *immediately*.
    //    This ensures a 'catch' handler is present before the promise can reject.
    //    The result is a new promise that resolves when the assertion is met.
    // eslint-disable-next-line vitest/valid-expect
    const assertionPromise = expect(promise).rejects.toThrow(
      'Simulated error attempt 3',
    );

    // 3. Now, advance the timers. This will trigger the retries and the
    //    eventual rejection. The handler attached in step 2 will catch it.
    await vi.runAllTimersAsync();

    // 4. Await the assertion promise itself to ensure the test was successful.
    await assertionPromise;

    // 5. Finally, assert the number of calls.
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should default to 7 maxAttempts if no options are provided', async () => {
    // This function will fail more than 7 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn);

    // Expect it to fail with the error from the 7th attempt.
    // eslint-disable-next-line vitest/valid-expect
    const assertionPromise = expect(promise).rejects.toThrow(
      'Simulated error attempt 7',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(7);
  });

  it('should default to 7 maxAttempts if options.maxAttempts is undefined', async () => {
    // This function will fail more than 7 times to ensure all retries are used.
    const mockFn = createFailingFunction(10);

    const promise = retryWithBackoff(mockFn, { maxAttempts: undefined });

    // Expect it to fail with the error from the 7th attempt.
    // eslint-disable-next-line vitest/valid-expect
    const assertionPromise = expect(promise).rejects.toThrow(
      'Simulated error attempt 7',
    );
    await vi.runAllTimersAsync();
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(7);
  });

  it('should not retry if shouldRetry returns false', async () => {
    const mockFn = vi.fn(async () => {
      throw new NonRetryableError('Non-retryable error');
    });
    const shouldRetryOnError = (error: Error) =>
      !(error instanceof NonRetryableError);

    const promise = retryWithBackoff(mockFn, {
      shouldRetryOnError,
      initialDelayMs: 10,
    });

    await expect(promise).rejects.toThrow('Non-retryable error');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if maxAttempts is not a positive number', async () => {
    const mockFn = createFailingFunction(1);

    // Test with 0
    await expect(retryWithBackoff(mockFn, { maxAttempts: 0 })).rejects.toThrow(
      'maxAttempts must be a positive number.',
    );

    // The function should not be called at all if validation fails
    expect(mockFn).not.toHaveBeenCalled();
  });

  it('should use default shouldRetry if not provided, retrying on 429', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Too Many Requests') as any;
      error.status = 429;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    // Attach the rejection expectation *before* running timers
    const assertionPromise =
      expect(promise).rejects.toThrow('Too Many Requests'); // eslint-disable-line vitest/valid-expect

    // Run timers to trigger retries and eventual rejection
    await vi.runAllTimersAsync();

    // Await the assertion
    await assertionPromise;

    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should use default shouldRetry if not provided, not retrying on 400', async () => {
    const mockFn = vi.fn(async () => {
      const error = new Error('Bad Request') as any;
      error.status = 400;
      throw error;
    });

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 2,
      initialDelayMs: 10,
    });
    await expect(promise).rejects.toThrow('Bad Request');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxDelayMs', async () => {
    const mockFn = createFailingFunction(3);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(mockFn, {
      maxAttempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 250, // Max delay is less than 100 * 2 * 2 = 400
    });

    await vi.advanceTimersByTimeAsync(1000); // Advance well past all delays
    await promise;

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);

    // Delays should be around initial, initial*2, maxDelay (due to cap)
    // Jitter makes exact assertion hard, so we check ranges / caps
    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(100 * 0.7);
    expect(delays[0]).toBeLessThanOrEqual(100 * 1.3);
    expect(delays[1]).toBeGreaterThanOrEqual(200 * 0.7);
    expect(delays[1]).toBeLessThanOrEqual(200 * 1.3);
    // The third delay should be capped by maxDelayMs (250ms), accounting for jitter
    expect(delays[2]).toBeGreaterThanOrEqual(250 * 0.7);
    expect(delays[2]).toBeLessThanOrEqual(250 * 1.3);
  });

  it('should handle jitter correctly, ensuring varied delays', async () => {
    let mockFn = createFailingFunction(5);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // Run retryWithBackoff multiple times to observe jitter
    const runRetry = () =>
      retryWithBackoff(mockFn, {
        maxAttempts: 2, // Only one retry, so one delay
        initialDelayMs: 100,
        maxDelayMs: 1000,
      });

    // We expect rejections as mockFn fails 5 times
    const promise1 = runRetry();
    // Attach the rejection expectation *before* running timers
    // eslint-disable-next-line vitest/valid-expect
    const assertionPromise1 = expect(promise1).rejects.toThrow();
    await vi.runAllTimersAsync(); // Advance for the delay in the first runRetry
    await assertionPromise1;

    const firstDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );
    setTimeoutSpy.mockClear(); // Clear calls for the next run

    // Reset mockFn to reset its internal attempt counter for the next run
    mockFn = createFailingFunction(5); // Re-initialize with 5 failures

    const promise2 = runRetry();
    // Attach the rejection expectation *before* running timers
    // eslint-disable-next-line vitest/valid-expect
    const assertionPromise2 = expect(promise2).rejects.toThrow();
    await vi.runAllTimersAsync(); // Advance for the delay in the second runRetry
    await assertionPromise2;

    const secondDelaySet = setTimeoutSpy.mock.calls.map(
      (call) => call[1] as number,
    );

    // Check that the delays are not exactly the same due to jitter
    // This is a probabilistic test, but with +/-30% jitter, it's highly likely they differ.
    if (firstDelaySet.length > 0 && secondDelaySet.length > 0) {
      // Check the first delay of each set
      expect(firstDelaySet[0]).not.toBe(secondDelaySet[0]);
    } else {
      // If somehow no delays were captured (e.g. test setup issue), fail explicitly
      throw new Error('Delays were not captured for jitter test');
    }

    // Ensure delays are within the expected jitter range [70, 130] for initialDelayMs = 100
    [...firstDelaySet, ...secondDelaySet].forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(100 * 0.7);
      expect(d).toBeLessThanOrEqual(100 * 1.3);
    });
  });

  describe('Qwen OAuth 429 error handling', () => {
    it('should retry for Qwen OAuth 429 errors that are throttling-related', async () => {
      const errorWith429: HttpError = new Error('Rate limit exceeded');
      errorWith429.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(errorWith429)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called twice (1 failure + 1 success)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately for Qwen OAuth with insufficient_quota message', async () => {
      const errorWithInsufficientQuota = new Error('insufficient_quota');

      const fn = vi.fn().mockRejectedValue(errorWithInsufficientQuota);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(/Qwen API quota exceeded/);

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately for Qwen OAuth with free allocated quota exceeded message', async () => {
      const errorWithQuotaExceeded = new Error(
        'Free allocated quota exceeded.',
      );

      const fn = vi.fn().mockRejectedValue(errorWithQuotaExceeded);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(/Qwen API quota exceeded/);

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry for Qwen OAuth with throttling message', async () => {
      const throttlingError: HttpError = new Error(
        'requests throttling triggered',
      );
      throttlingError.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttlingError)
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 3 times (2 failures + 1 success)
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry for Qwen OAuth with throttling error', async () => {
      const throttlingError: HttpError = new Error('throttling');
      throttlingError.status = 429;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 2 times (1 failure + 1 success)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately for Qwen OAuth with quota message', async () => {
      const errorWithQuota = new Error('quota exceeded');

      const fn = vi.fn().mockRejectedValue(errorWithQuota);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        authType: AuthType.QWEN_OAUTH,
      });

      await expect(promise).rejects.toThrow(/Qwen API quota exceeded/);

      // Should be called only once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry normal errors for Qwen OAuth (not quota-related)', async () => {
      const normalError: HttpError = new Error('Network error');
      normalError.status = 500;

      const fn = createFailingFunction(2, 'success');
      // Replace the default 500 error with our normal error
      fn.mockRejectedValueOnce(normalError)
        .mockRejectedValueOnce(normalError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        authType: AuthType.QWEN_OAUTH,
      });

      // Fast-forward time for delays
      await vi.runAllTimersAsync();

      await expect(promise).resolves.toBe('success');

      // Should be called 3 times (2 failures + 1 success)
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});

describe('getErrorStatus', () => {
  it('should extract status from error.status (OpenAI/Anthropic/Gemini style)', () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
    expect(getErrorStatus({ status: 500 })).toBe(500);
    expect(getErrorStatus({ status: 503 })).toBe(503);
    expect(getErrorStatus({ status: 400 })).toBe(400);
  });

  it('should extract status from error.statusCode', () => {
    expect(getErrorStatus({ statusCode: 429 })).toBe(429);
    expect(getErrorStatus({ statusCode: 502 })).toBe(502);
  });

  it('should extract status from error.response.status (axios style)', () => {
    expect(getErrorStatus({ response: { status: 429 } })).toBe(429);
    expect(getErrorStatus({ response: { status: 503 } })).toBe(503);
  });

  it('should extract status from error.error.code (nested error style)', () => {
    expect(getErrorStatus({ error: { code: 429 } })).toBe(429);
    expect(getErrorStatus({ error: { code: 500 } })).toBe(500);
  });

  it('should prefer status over statusCode over response.status over error.code', () => {
    expect(
      getErrorStatus({
        status: 429,
        statusCode: 500,
        response: { status: 502 },
        error: { code: 503 },
      }),
    ).toBe(429);

    expect(
      getErrorStatus({
        statusCode: 500,
        response: { status: 502 },
        error: { code: 503 },
      }),
    ).toBe(500);

    expect(
      getErrorStatus({ response: { status: 502 }, error: { code: 503 } }),
    ).toBe(502);
  });

  it('should return undefined for out-of-range status codes', () => {
    expect(getErrorStatus({ status: 0 })).toBeUndefined();
    expect(getErrorStatus({ status: 99 })).toBeUndefined();
    expect(getErrorStatus({ status: 600 })).toBeUndefined();
    expect(getErrorStatus({ status: -1 })).toBeUndefined();
  });

  it('should return undefined for non-numeric status values', () => {
    expect(getErrorStatus({ status: 'not_a_number' })).toBeUndefined();
    expect(
      getErrorStatus({ error: { code: 'invalid_api_key' } }),
    ).toBeUndefined();
  });

  it('should return undefined for null, undefined, and non-object values', () => {
    expect(getErrorStatus(null)).toBeUndefined();
    expect(getErrorStatus(undefined)).toBeUndefined();
    expect(getErrorStatus(true)).toBeUndefined();
    expect(getErrorStatus(429)).toBeUndefined();
    expect(getErrorStatus('500')).toBeUndefined();
  });

  it('should handle Error instances with a status property', () => {
    const error: HttpError = new Error('Too Many Requests');
    error.status = 429;
    expect(getErrorStatus(error)).toBe(429);
  });

  it('should return undefined for Error instances without a status', () => {
    expect(getErrorStatus(new Error('generic error'))).toBeUndefined();
  });

  it('should return undefined for empty objects', () => {
    expect(getErrorStatus({})).toBeUndefined();
    expect(getErrorStatus({ response: {} })).toBeUndefined();
    expect(getErrorStatus({ error: {} })).toBeUndefined();
  });
});

describe('isTPMThrottlingError', () => {
  it('should detect TPM throttling error from string', () => {
    const errorMessage =
      '{"error":{"message":"Throttling: TPM(10680324/10000000)","type":"Throttling","code":"429"}}';
    expect(isTPMThrottlingError(errorMessage)).toBe(true);
  });

  it('should detect TPM throttling error from Error object', () => {
    const error = new Error('Throttling: TPM(10680324/10000000)');
    expect(isTPMThrottlingError(error)).toBe(true);
  });

  it('should detect TPM throttling error from nested error object', () => {
    const error = {
      error: {
        message: 'Throttling: TPM(10680324/10000000)',
        type: 'Throttling',
        code: '429',
      },
    };
    expect(isTPMThrottlingError(error)).toBe(true);
  });

  it('should return false for non-TPM errors', () => {
    expect(isTPMThrottlingError('Regular error message')).toBe(false);
    expect(isTPMThrottlingError(new Error('Regular error'))).toBe(false);
    expect(
      isTPMThrottlingError({
        error: { message: 'Rate limit exceeded', code: '429' },
      }),
    ).toBe(false);
  });

  it('should return false for non-string non-object values', () => {
    expect(isTPMThrottlingError(null)).toBe(false);
    expect(isTPMThrottlingError(undefined)).toBe(false);
    expect(isTPMThrottlingError(429)).toBe(false);
    expect(isTPMThrottlingError(true)).toBe(false);
  });
});

describe('TPM throttling retry handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSimulate429(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should wait 1 minute for TPM throttling errors before retrying', async () => {
    const tpmError: HttpError = new Error('Throttling: TPM(10680324/10000000)');
    tpmError.status = 429;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(tpmError)
      .mockResolvedValue('success');

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
    });

    // Fast-forward 1 minute for TPM delay
    await vi.advanceTimersByTimeAsync(60000);

    await expect(promise).resolves.toBe('success');

    // Should be called twice (1 failure + 1 success)
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should reset exponential backoff delay after TPM throttling error', async () => {
    const tpmError: HttpError = new Error('Throttling: TPM(10680324/10000000)');
    tpmError.status = 429;
    const normalError: HttpError = new Error('Server error');
    normalError.status = 500;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(tpmError) // First: TPM error (1 minute delay)
      .mockRejectedValueOnce(normalError) // Second: normal error (should use initialDelay)
      .mockResolvedValue('success');

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(fn, {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 1000,
    });

    // Fast-forward 1 minute for TPM delay
    await vi.advanceTimersByTimeAsync(60000);

    // Now handle the second error with exponential backoff
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('success');

    // Should be called 3 times
    expect(fn).toHaveBeenCalledTimes(3);

    // Check that the second delay (after TPM) uses initialDelayMs, not a doubled value
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
    // First delay should be 60000ms (1 minute for TPM)
    // Second delay should be around initialDelayMs (100ms) with jitter
    expect(delays[0]).toBe(60000);
    expect(delays[1]).toBeGreaterThanOrEqual(100 * 0.7);
    expect(delays[1]).toBeLessThanOrEqual(100 * 1.3);
  });

  it('should respect Retry-After header even for TPM throttling errors', async () => {
    // Create an error that is both a TPM throttling error AND has a Retry-After header
    const tpmErrorWithRetryAfter: HttpError & {
      response?: { headers?: { 'retry-after'?: string } };
    } = new Error('Throttling: TPM(10680324/10000000)');
    tpmErrorWithRetryAfter.status = 429;
    tpmErrorWithRetryAfter.response = {
      headers: {
        'retry-after': '30', // Server says wait 30 seconds
      },
    };

    const fn = vi
      .fn()
      .mockRejectedValueOnce(tpmErrorWithRetryAfter)
      .mockResolvedValue('success');

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 1000,
    });

    // Wait for all timers to complete
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('success');

    // Check that the delay used was from Retry-After (30 seconds), not TPM (60 seconds)
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);

    // The Retry-After header should take precedence over TPM-specific delay
    expect(delays[0]).toBe(30000); // Should use Retry-After header value (30 seconds)
  });
});
