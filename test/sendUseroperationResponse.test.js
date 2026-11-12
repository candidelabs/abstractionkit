// Tests for SendUseroperationResponse.included(), which had no unit test.
// - The timeout counted only the sleeps between polls, not the time each poll
//   took, so a slow bundler stretched the wait to several times the timeout.
// - NaN slipped past the argument checks.
// - One failed poll (a 502, a dropped connection) ended the whole wait.
// - Once failed polls were retried, a request the bundler refuses as such
//   (invalid params, method not found) was retried until the timeout.
// - The last poll could land up to one interval before the deadline.
// - A receipt request that hung kept the caller waiting past the deadline.
// Offline, with short real timers.

const ak = require('../dist/index.cjs');

const HASH = '0x' + 'ab'.repeat(32);
const RECEIPT = { success: true, userOpHash: HASH };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `answers` is consumed one per poll; the last one repeats.
function responseWith(answers, latencyMs = 0) {
    let polls = 0;
    const bundler = {
        getUserOperationReceipt: async (hash) => {
            expect(hash).toBe(HASH);
            const answer = answers[Math.min(polls, answers.length - 1)];
            polls++;
            if (latencyMs > 0) await sleep(latencyMs);
            if (answer instanceof Error) throw answer;
            return answer;
        },
    };
    return { response: new ak.SendUseroperationResponse(HASH, bundler, ak.ENTRYPOINT_V7), polls: () => polls };
}
const caught = (promise) =>
    promise.then(
        () => {
            throw new Error('expected a rejection');
        },
        (error) => error,
    );

describe('SendUseroperationResponse.included', () => {
    test('polls until the receipt appears', async () => {
        const { response, polls } = responseWith([null, null, RECEIPT]);
        expect(await response.included(2, 0.02)).toBe(RECEIPT);
        expect(polls()).toBe(3);
    });

    test('times out with the user operation hash as context', async () => {
        const { response, polls } = responseWith([null]);
        const error = await caught(response.included(0.1, 0.02));
        expect(error).toBeInstanceOf(ak.AbstractionKitError);
        expect(error.code).toBe('TIMEOUT');
        expect(error.context).toBe(HASH);
        expect(error.cause).toBeUndefined();
        expect(polls()).toBeGreaterThanOrEqual(3);
        expect(polls()).toBeLessThanOrEqual(5);
    });

    test('the timeout is wall-clock time, however slow each poll is', async () => {
        // 100 ms per poll, 50 ms between polls, 300 ms budget. Counting only
        // the sleeps took 7 polls and more than a second.
        const { response, polls } = responseWith([null], 100);
        const started = Date.now();
        const error = await caught(response.included(0.3, 0.05));
        const elapsed = Date.now() - started;
        expect(error.code).toBe('TIMEOUT');
        expect(elapsed).toBeLessThan(800);
        expect(polls()).toBeLessThanOrEqual(4);
    });

    test('a timeout equal to the interval still polls once', async () => {
        // Fake timers: a real setTimeout can fire about 1 ms early against
        // Date.now(), which leaves a sliver of time and a second poll.
        jest.useFakeTimers();
        try {
            const { response, polls } = responseWith([null]);
            const result = caught(response.included(0.05, 0.05));
            await jest.advanceTimersByTimeAsync(50);
            const error = await result;
            expect(error.code).toBe('TIMEOUT');
            expect(polls()).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a failed poll does not end the wait', async () => {
        const { response, polls } = responseWith([new Error('502 Bad Gateway'), null, RECEIPT]);
        expect(await response.included(2, 0.02)).toBe(RECEIPT);
        expect(polls()).toBe(3);
    });

    test('when every poll fails, the timeout carries the last failure as its cause', async () => {
        const failure = new Error('connect ECONNREFUSED');
        const { response } = responseWith([failure]);
        const error = await caught(response.included(0.1, 0.02));
        expect(error.code).toBe('TIMEOUT');
        expect(error.cause).toBe(failure);
    });

    test('a failure followed by empty polls times out without a stale cause', async () => {
        const { response } = responseWith([new Error('blip'), null]);
        const error = await caught(response.included(0.1, 0.02));
        expect(error.code).toBe('TIMEOUT');
        expect(error.cause).toBeUndefined();
    });

    test.each([
        ['invalid params', -32602],
        ['method not found', -32601],
        ['invalid request', -32600],
    ])('a bundler error for %s ends the wait at once', async (_name, code) => {
        const failure = new ak.AbstractionKitError('BUNDLER_ERROR', 'bundler call failed', { errno: code });
        const { response, polls } = responseWith([failure]);
        const started = Date.now();
        const error = await caught(response.included(5, 0.02));
        expect(error).toBe(failure);
        expect(polls()).toBe(1);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('a raw transport error with a permanent code ends the wait at once', async () => {
        const failure = new ak.TransportRpcError(-32602, 'invalid hash');
        const { response, polls } = responseWith([failure]);
        expect(await caught(response.included(5, 0.02))).toBe(failure);
        expect(polls()).toBe(1);
    });

    test('a transient bundler error is retried', async () => {
        const failure = new ak.AbstractionKitError('BUNDLER_ERROR', 'bundler call failed', { errno: -32603 });
        const { response, polls } = responseWith([failure, RECEIPT]);
        expect(await response.included(2, 0.02)).toBe(RECEIPT);
        expect(polls()).toBe(2);
    });

    test('the last poll lands on the deadline', async () => {
        // 250 ms budget, 100 ms interval: polls at 100, 200 and 250 ms.
        const { response, polls } = responseWith([null, null, RECEIPT]);
        expect(await response.included(0.25, 0.1)).toBe(RECEIPT);
        expect(polls()).toBe(3);
    });

    test('a request still pending at the deadline ends the wait with TIMEOUT', async () => {
        // one 2 s request against a 200 ms budget
        const { response, polls } = responseWith([null], 2000);
        const started = Date.now();
        const error = await caught(response.included(0.2, 0.05));
        expect(error.code).toBe('TIMEOUT');
        expect(error.context).toBe(HASH);
        expect(Date.now() - started).toBeLessThan(600);
        expect(polls()).toBe(1);
    });

    test('a request that never settles still times out', async () => {
        let polls = 0;
        const bundler = {
            getUserOperationReceipt: () => {
                polls++;
                return new Promise(() => {});
            },
        };
        const response = new ak.SendUseroperationResponse(HASH, bundler, ak.ENTRYPOINT_V7);
        const error = await caught(response.included(0.15, 0.05));
        expect(error.code).toBe('TIMEOUT');
        expect(polls).toBe(1);
    });

    test('a pending request that times out keeps the earlier poll failure as the cause', async () => {
        const failure = new Error('502 Bad Gateway');
        let polls = 0;
        const bundler = {
            getUserOperationReceipt: async () => {
                polls++;
                if (polls === 1) throw failure;
                return new Promise(() => {});
            },
        };
        const response = new ak.SendUseroperationResponse(HASH, bundler, ak.ENTRYPOINT_V7);
        const error = await caught(response.included(0.2, 0.05));
        expect(error.code).toBe('TIMEOUT');
        expect(error.cause).toBe(failure);
    });

    test.each([
        ['a zero timeout', [0, 1]],
        ['a zero interval', [1, 0]],
        ['a negative timeout', [-1, 1]],
        ['a NaN timeout', [Number.NaN, 1]],
        ['a NaN interval', [1, Number.NaN]],
        ['a timeout shorter than the interval', [1, 2]],
    ])('%s is rejected before any poll', async (_name, args) => {
        const { response, polls } = responseWith([RECEIPT]);
        await expect(response.included(...args)).rejects.toThrow(RangeError);
        expect(polls()).toBe(0);
    });
});
