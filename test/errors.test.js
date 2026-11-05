// Regression tests for AbstractionKitError.stringify(). It passed a key
// whitelist to JSON.stringify, which filters keys at every depth: any object
// `context` came out as `{}`, losing e.g. the user operation hash a bundler
// error carries. Offline.

const ak = require('../dist/index.cjs');

const { AbstractionKitError } = ak;
const parse = (error) => JSON.parse(error.stringify());

describe('AbstractionKitError.stringify', () => {
    test('an object context is serialized in full', () => {
        const error = new AbstractionKitError('BUNDLER_ERROR', 'x', {
            context: { method: 'eth_sendUserOperation', nested: { a: 1, list: [1, { b: 2 }] } },
        });
        expect(parse(error)).toEqual({
            name: 'AbstractionKitError',
            code: 'BUNDLER_ERROR',
            message: 'x',
            context: { method: 'eth_sendUserOperation', nested: { a: 1, list: [1, { b: 2 }] } },
        });
    });

    test('string and array contexts survive', () => {
        expect(parse(new AbstractionKitError('TIMEOUT', 'x', { context: '0xhash' })).context).toBe('0xhash');
        expect(parse(new AbstractionKitError('TIMEOUT', 'x', { context: ['a', { b: 1 }] })).context).toEqual([
            'a',
            { b: 1 },
        ]);
    });

    test('the cause chain keeps each level, including nested context', () => {
        const root = new Error('socket hang up');
        const inner = new AbstractionKitError('EXECUTION_REVERTED', 'AA23 reverted', {
            cause: root,
            errno: -32521,
            aaCode: 'AA23',
            context: { revertData: '0xdeadbeef' },
        });
        const outer = new AbstractionKitError('BUNDLER_ERROR', 'bundler call failed', {
            cause: inner,
            errno: -32521,
            aaCode: 'AA23',
            context: { useroperationhash: '0xabc' },
        });
        expect(parse(outer)).toEqual({
            name: 'AbstractionKitError',
            code: 'BUNDLER_ERROR',
            message: 'bundler call failed',
            errno: -32521,
            aaCode: 'AA23',
            context: { useroperationhash: '0xabc' },
            cause: {
                name: 'AbstractionKitError',
                code: 'EXECUTION_REVERTED',
                message: 'AA23 reverted',
                errno: -32521,
                aaCode: 'AA23',
                context: { revertData: '0xdeadbeef' },
                cause: { name: 'Error', message: 'socket hang up' },
            },
        });
    });

    test('a transport error cause keeps its code and data', () => {
        const cause = new ak.TransportRpcError(3, 'execution reverted', '0x08c379a0');
        const serialized = parse(new AbstractionKitError('NODE_ERROR', 'x', { cause }));
        expect(serialized.cause).toEqual({
            name: 'TransportRpcError',
            code: 3,
            message: 'execution reverted',
            data: '0x08c379a0',
        });
    });

    test('bigints in the context are serialized instead of throwing', () => {
        const error = new AbstractionKitError('BAD_DATA', 'x', { context: { nonce: 5n } });
        expect(parse(error).context).toEqual({ nonce: '5' });
    });

    test('a context that cannot be serialized is left out rather than throwing', () => {
        const circular = {};
        circular.self = circular;
        const error = new AbstractionKitError('BAD_DATA', 'x', { context: circular, aaCode: 'AA10' });
        expect(parse(error)).toEqual({ name: 'AbstractionKitError', code: 'BAD_DATA', message: 'x', aaCode: 'AA10' });
    });
});
