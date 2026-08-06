import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');

function createContext() {
    const operations = [];
    const firebaseCalls = [];
    const cells = new Map();

    const context = vm.createContext({
        console,
        Date,
        JSON,
        Object,
        String,
        Number,
        RegExp,
        Error,
        LockService: {
            getScriptLock: () => ({
                waitLock: () => operations.push('lock:wait'),
                releaseLock: () => operations.push('lock:release'),
            }),
        },
        SpreadsheetApp: {
            flush: () => operations.push('sheet:flush'),
        },
    });

    vm.runInContext(source, context);

    const sheet = {
        getRange: (_row, column) => {
            if (!cells.has(column)) {
                cells.set(column, {
                    setValue(value) {
                        operations.push(`sheet:set:${column}:${String(value)}`);
                    },
                });
            }
            return cells.get(column);
        },
    };

    context.__getSheetContext = () => ({
        sheet,
        colMap: {
            word: 0,
            pos: 1,
            meaning: 2,
            explanation: 3,
            manualsample: 4,
        },
    });
    context.__findRowByWord = () => 2;
    context.__setHtmlToCell = (cell, value) => cell.setValue(value);
    context.__callFirebaseRtdb = (path, method, payload) => {
        operations.push(`firebase:${method}:${path}`);
        firebaseCalls.push({ path, method, payload });
        if (method === 'GET') {
            return {
                word: 'alpha',
                meaning: 'old',
                sample: 'old sample',
                index: 7,
            };
        }
        return null;
    };

    vm.runInContext(`
        getSheetContext = __getSheetContext;
        findRowByWord = __findRowByWord;
        setHtmlToCell = __setHtmlToCell;
        callFirebaseRtdb = __callFirebaseRtdb;
        patchWordInFirebase = function(word, fields) {
            return callFirebaseRtdb('vocabulary/' + toFirebaseKey(word), 'PATCH', fields);
        };
    `, context);

    return { context, operations, firebaseCalls };
}

{
    const { context, operations, firebaseCalls } = createContext();
    const result = context.handleUpdateWordData({
        parameter: {
            original_word: 'alpha',
            word: 'alpha',
            meaning: 'new meaning',
            manual_sample: '',
            request_id: 'req_normal_1',
        },
    });

    assert.equal(result.success, true);
    const flushIndex = operations.indexOf('sheet:flush');
    const firebaseIndex = operations.findIndex(value => value.startsWith('firebase:PATCH'));
    assert.ok(flushIndex >= 0 && firebaseIndex > flushIndex, '시트 flush 후 Firebase를 써야 함');

    assert.equal(firebaseCalls.length, 1);
    assert.equal(firebaseCalls[0].path, 'vocabulary/alpha');
    assert.equal(firebaseCalls[0].payload.meaning, 'new meaning');
    assert.equal(firebaseCalls[0].payload.sample, '');
    assert.equal(firebaseCalls[0].payload._sync.requestId, 'req_normal_1');
}

{
    const { context, operations, firebaseCalls } = createContext();
    const result = context.handleUpdateWordData({
        parameter: {
            original_word: 'alpha',
            word: 'beta',
            meaning: 'renamed meaning',
            request_id: 'req_rename_1',
        },
    });

    assert.equal(result.success, true);
    assert.equal(firebaseCalls.length, 2, '이름 변경은 GET 1회 + 원자적 PATCH 1회여야 함');
    assert.deepEqual(
        firebaseCalls.map(call => [call.path, call.method]),
        [['vocabulary/alpha', 'GET'], ['vocabulary', 'PATCH']]
    );

    const atomicPayload = firebaseCalls[1].payload;
    assert.equal(atomicPayload.alpha, null);
    assert.equal(atomicPayload.beta.word, 'beta');
    assert.equal(atomicPayload.beta.meaning, 'renamed meaning');
    assert.equal(atomicPayload.beta.index, 7);
    assert.equal(atomicPayload.beta._sync.requestId, 'req_rename_1');

    const flushIndex = operations.indexOf('sheet:flush');
    const atomicPatchIndex = operations.indexOf('firebase:PATCH:vocabulary');
    assert.ok(atomicPatchIndex > flushIndex, '시트 flush 후 Firebase 이름 이전을 해야 함');
}

console.log('===== Apps Script 저장 순서 테스트: 2 통과 / 0 실패 =====');
