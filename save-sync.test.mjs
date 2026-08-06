import assert from 'node:assert/strict';

globalThis.localStorage = {
    _data: {},
    getItem(key) { return Object.hasOwn(this._data, key) ? this._data[key] : null; },
    setItem(key, value) { this._data[key] = String(value); },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; },
};

const { state } = await import('./js/config.js');
const { api } = await import('./js/api.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const auth = { currentUser: { getIdToken: async () => 'test-token' } };

function seedWord() {
    state.wordList = [{
        word: 'alpha',
        pos: 'n.',
        meaning: 'old',
        explanation: '',
        sample: 'old sample',
        index: 0,
    }];
    localStorage.clear();
    localStorage.setItem(
        state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE,
        JSON.stringify({ timestamp: 1, words: structuredClone(state.wordList) })
    );
}

async function testFirebaseMarkerWinsAndEmptySampleIsSent() {
    seedWord();
    let markerCallback;
    let unsubscribed = false;
    let fetchResolved = false;
    let requestedUrl = '';

    globalThis.window = {
        firebaseSDK: {
            ref: (_database, path) => ({ path }),
            onValue: (_reference, callback) => {
                markerCallback = callback;
                return () => { unsubscribed = true; };
            },
        },
    };
    api.init({}, {}, auth);

    globalThis.fetch = async url => {
        requestedUrl = String(url);
        const requestId = new URL(requestedUrl).searchParams.get('request_id');
        setTimeout(() => markerCallback({
            val: () => ({ requestId, completedAt: Date.now() }),
        }), 5);
        await delay(80);
        fetchResolved = true;
        return new Response(JSON.stringify({ success: true, debugTimings: {} }));
    };

    await api.updateWordDetails('alpha', {
        word: 'alpha',
        meaning: 'new',
        manual_sample: '',
    });

    assert.equal(fetchResolved, false, '늦은 Apps Script 응답을 기다리지 않아야 함');
    assert.equal(unsubscribed, true, '완료 후 Firebase 리스너를 해제해야 함');
    assert.equal(new URL(requestedUrl).searchParams.get('manual_sample'), '');
    assert.equal(state.wordList[0].meaning, 'new');
    assert.equal(state.wordList[0].sample, '');

    const cached = JSON.parse(localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE));
    assert.equal(cached.words[0].meaning, 'new');
    assert.equal(cached.words[0].sample, '');

    await delay(90); // 백그라운드 Apps Script 응답 처리까지 정리
}

async function testAppsScriptSuccessFallsBackWhenListenerFails() {
    seedWord();
    let unsubscribed = false;

    globalThis.window = {
        firebaseSDK: {
            ref: (_database, path) => ({ path }),
            onValue: (_reference, _callback, onError) => {
                queueMicrotask(() => onError(new Error('permission denied')));
                return () => { unsubscribed = true; };
            },
        },
    };
    api.init({}, {}, auth);
    globalThis.fetch = async () => new Response(JSON.stringify({
        success: true,
        debugTimings: { firebasePatchMs: 10 },
    }));

    await api.updateWordDetails('alpha', { meaning: 'fallback' });
    assert.equal(state.wordList[0].meaning, 'fallback');
    assert.equal(unsubscribed, true);
}

async function testExplicitServerFailureDoesNotUpdateLocalData() {
    seedWord();
    let unsubscribed = false;

    globalThis.window = {
        firebaseSDK: {
            ref: (_database, path) => ({ path }),
            onValue: () => () => { unsubscribed = true; },
        },
    };
    api.init({}, {}, auth);
    globalThis.fetch = async () => new Response(JSON.stringify({
        success: false,
        message: 'server rejected',
    }));

    await assert.rejects(
        api.updateWordDetails('alpha', { meaning: 'must not apply' }),
        /server rejected/
    );
    assert.equal(state.wordList[0].meaning, 'old');
    assert.equal(unsubscribed, true);
}

await testFirebaseMarkerWinsAndEmptySampleIsSent();
await testAppsScriptSuccessFallsBackWhenListenerFails();
await testExplicitServerFailureDoesNotUpdateLocalData();

console.log('\n===== 저장 동기화 테스트: 3 통과 / 0 실패 =====');
