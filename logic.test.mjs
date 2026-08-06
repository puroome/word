// 순수 로직 단위 테스트 (브라우저/Firebase 불필요).
// 실행: node --experimental-default-type=module logic.test.mjs
import assert from 'node:assert/strict';

// --- 브라우저 전역 목(mock): 모듈 import는 최상위에서 브라우저 API를 안 쓰므로 호출 시점에만 필요 ---
globalThis.localStorage = {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; },
};

import { state } from './js/config.js';
import { api } from './js/api.js';
import { utils } from './js/utils.js';
import { quizMode } from './js/quiz.js';
import { statsStore } from './js/stats-store.js';

// --- 미니 테스트 러너 ---
let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); console.log('  ✅', name); pass++; }
    catch (e) { console.log('  ❌', name, '\n      ->', e.message); fail++; }
}
function group(title) { console.log('\n' + title); }

function resetStorage(unsynced = {}) {
    localStorage.clear();
    localStorage.setItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES, JSON.stringify(unsynced));
    // utils.getUnsyncedProgress 캐시 무력화를 위해 raw가 매번 달라지도록 보장됨
}

// =========================================================
group('utils.toLocalDateString / getLocalDateString');
test('정오 로컬 날짜는 타임존과 무관하게 같은 달력일', () => {
    const d = new Date(2024, 0, 15, 12, 0, 0); // 로컬 1/15 정오
    assert.equal(utils.toLocalDateString(d), '2024-01-15');
});
test('getLocalDateString === toLocalDateString(today)', () => {
    assert.equal(utils.getLocalDateString(), utils.toLocalDateString(new Date()));
});

group('utils.formatSeconds');
test('60초 미만은 0분', () => { assert.equal(utils.formatSeconds(59), '0분'); });
test('0/undefined → 0분', () => { assert.equal(utils.formatSeconds(0), '0분'); });
test('60 → 1분', () => { assert.equal(utils.formatSeconds(60), '1분'); });
test('3661 → 1시간 1분', () => { assert.equal(utils.formatSeconds(3661), '1시간 1분'); });
test('90061 → 1일 1시간 1분', () => { assert.equal(utils.formatSeconds(90061), '1일 1시간 1분'); });
test('86400 → 1일', () => { assert.equal(utils.formatSeconds(86400), '1일'); });

group('utils.levenshteinDistance');
test('동일 문자열 0', () => { assert.equal(utils.levenshteinDistance('cat', 'cat'), 0); });
test('한 글자 치환 1', () => { assert.equal(utils.levenshteinDistance('cat', 'bat'), 1); });
test('kitten→sitting 3', () => { assert.equal(utils.levenshteinDistance('kitten', 'sitting'), 3); });
test('빈 문자열', () => { assert.equal(utils.levenshteinDistance('', 'abc'), 3); });
test('limit 초과 시 조기 종료(limit+1)', () => { assert.equal(utils.levenshteinDistance('abcdef', 'xyz', 2), 3); });

group('utils.escapeRegExp');
test('특수문자를 리터럴로 이스케이프', () => {
    const re = new RegExp(utils.escapeRegExp('a.b*c'));
    assert.ok(re.test('a.b*c'));
    assert.ok(!re.test('axbxxc'));
});

test('HTML 특수문자를 안전하게 이스케이프', () => {
    assert.equal(utils.escapeHtml(`<tag>"'&`), '&lt;tag&gt;&quot;&#39;&amp;');
});
test('리치 HTML을 줄바꿈이 보존된 일반 텍스트로 변환', () => {
    assert.equal(
        utils.richHtmlToPlainText('<b>1. 첫 뜻</b><br><span style="color:red">2. 둘째 뜻</span>'),
        '1. 첫 뜻\n2. 둘째 뜻'
    );
});

group('utils.shuffleArray / pickRandomItems');
test('shuffleArray는 같은 원소 집합을 유지(순열)', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = utils.shuffleArray([...arr]);
    assert.deepEqual([...shuffled].sort((a, b) => a - b), arr);
});
test('pickRandomItems: 개수와 제외 필터 준수', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    const picked = utils.pickRandomItems(arr, 5, x => x > 50);
    assert.equal(picked.length, 5);
    assert.ok(picked.every(x => x <= 50), '제외 필터 위반');
    assert.equal(new Set(picked).size, 5, '중복 발생');
});
test('pickRandomItems: 제외 항목이 많아도 가능한 개수를 모두 반환', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    const picked = utils.pickRandomItems(arr, 5, x => x <= 95);
    assert.equal(picked.length, 5);
    assert.deepEqual([...picked].sort((a, b) => a - b), [96, 97, 98, 99, 100]);
});

group('statsStore 날짜별 통계');
test('기존 미동기화 통계를 지정한 날짜로 안전하게 이전', () => {
    localStorage.clear();
    localStorage.setItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME, '75');
    localStorage.setItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ, JSON.stringify({
        MULTIPLE_CHOICE_MEANING: { correct: 2, total: 3 }
    }));
    statsStore.migrateLegacyPending('2024-01-15');
    assert.deepEqual(statsStore.getPendingStudy(), { '2024-01-15': 75 });
    assert.deepEqual(statsStore.getPendingQuiz(), {
        '2024-01-15': { MULTIPLE_CHOICE_MEANING: { correct: 2, total: 3 } }
    });
    assert.equal(localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME), null);
    assert.equal(localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ), null);
});
test('동기화 도중 추가된 기록은 차감 후에도 보존', () => {
    localStorage.clear();
    statsStore.addStudySeconds('2024-01-15', 10);
    statsStore.addQuizResult('2024-01-15', 'FILL_IN_THE_BLANK', true);
    const snapshot = statsStore.snapshot();
    statsStore.addStudySeconds('2024-01-15', 5);
    statsStore.addQuizResult('2024-01-15', 'FILL_IN_THE_BLANK', false);
    statsStore.subtractSnapshot(snapshot);
    assert.deepEqual(statsStore.getPendingStudy(), { '2024-01-15': 5 });
    assert.deepEqual(statsStore.getPendingQuiz(), {
        '2024-01-15': { FILL_IN_THE_BLANK: { correct: 0, total: 1 } }
    });
});
test('서버 통계와 날짜별 미동기화 통계를 합산', () => {
    localStorage.clear();
    statsStore.addStudySeconds('2024-01-15', 30);
    statsStore.addQuizResult('2024-01-15', 'LISTENING_QUIZ', true);
    assert.deepEqual(
        statsStore.mergeStudyHistory({ '2024-01-15': 90 }),
        { '2024-01-15': 120 }
    );
    assert.deepEqual(
        statsStore.mergeQuizHistory({
            '2024-01-15': { LISTENING_QUIZ: { correct: 1, total: 2 } }
        }),
        { '2024-01-15': { LISTENING_QUIZ: { correct: 2, total: 3 } } }
    );
});

group('utils.getWordIndexMap');
test('같은 길이의 새 단어 목록으로 교체하면 인덱스도 갱신', () => {
    state.wordList = [{ word: 'apple' }];
    assert.equal(utils.getWordIndexMap().get('apple'), 'apple');
    state.wordList = [{ word: 'banana' }];
    const map = utils.getWordIndexMap();
    assert.equal(map.has('apple'), false);
    assert.equal(map.get('banana'), 'banana');
});

group('utils.getWordStatus (리팩토링과 무관하나 핵심 로직)');
test('네 유형 모두 correct → learned', () => {
    state.currentProgress = { foo: {
        MULTIPLE_CHOICE_MEANING: 'correct', FILL_IN_THE_BLANK: 'correct',
        MULTIPLE_CHOICE_DEFINITION: 'correct', LISTENING_QUIZ: 'correct',
    } };
    resetStorage();
    assert.equal(utils.getWordStatus('foo'), 'learned');
});
test('하나라도 incorrect → review', () => {
    state.currentProgress = { foo: { MULTIPLE_CHOICE_MEANING: 'correct', FILL_IN_THE_BLANK: 'incorrect' } };
    resetStorage();
    assert.equal(utils.getWordStatus('foo'), 'review');
});
test('일부만 correct → learning', () => {
    state.currentProgress = { foo: { MULTIPLE_CHOICE_MEANING: 'correct' } };
    resetStorage();
    assert.equal(utils.getWordStatus('foo'), 'learning');
});
test('기록 없음 → unseen', () => {
    state.currentProgress = {};
    resetStorage();
    assert.equal(utils.getWordStatus('nope'), 'unseen');
});

group('utils.getFavoriteWords');
test('favorite=true 단어만, 최신순', () => {
    state.currentProgress = {
        apple: { favorite: true, favoritedAt: 100 },
        banana: { favorite: false },
        cherry: { favorite: true, favoritedAt: 200 },
    };
    resetStorage();
    assert.deepEqual(utils.getFavoriteWords(), ['cherry', 'apple']);
});

group('utils.getMistakeReviewItems');
test('단어별로 실제 오답인 퀴즈 유형만 반환', () => {
    state.wordList = [
        { word: 'apple' },
        { word: 'banana' },
        { word: 'excluded', except: true }
    ];
    state.currentProgress = {
        apple: {
            MULTIPLE_CHOICE_MEANING: 'incorrect',
            FILL_IN_THE_BLANK: 'correct'
        },
        banana: {
            FILL_IN_THE_BLANK: 'incorrect',
            LISTENING_QUIZ: 'incorrect'
        },
        excluded: { MULTIPLE_CHOICE_MEANING: 'incorrect' }
    };
    resetStorage();
    assert.deepEqual(utils.getMistakeReviewItems(), [
        { word: 'apple', quizType: 'MULTIPLE_CHOICE_MEANING' },
        { word: 'banana', quizType: 'FILL_IN_THE_BLANK' },
        { word: 'banana', quizType: 'LISTENING_QUIZ' }
    ]);
});

// =========================================================
group('quiz._prepareClozeSentence (예문 파싱 추출 검증)');
test('표제어 포함 예문 → 정리된 첫 줄 반환', () => {
    const r = quizMode._prepareClozeSentence({ word: 'apple', sample: 'I ate an *apple* today.\nsecond' });
    assert.ok(r);
    assert.equal(r.firstLine, 'I ate an apple today.');
    assert.ok(r.placeholderRegex.test('apple'));
});
test('표제어 미포함 → null', () => {
    assert.equal(quizMode._prepareClozeSentence({ word: 'apple', sample: 'no fruit here' }), null);
});
test('예문 없음 → null', () => {
    assert.equal(quizMode._prepareClozeSentence({ word: 'apple', sample: '' }), null);
});

group('quiz.createMeaningQuiz / createBlankQuiz');
const sampleWords = [
    { word: 'a', index: 1, pos: 'n', meaning: 'ma', sample: 'this is a.' },
    { word: 'b', index: 2, pos: 'n', meaning: 'mb', sample: 'this is b.' },
    { word: 'c', index: 3, pos: 'n', meaning: 'mc', sample: 'this is c.' },
    { word: 'd', index: 4, pos: 'n', meaning: 'md', sample: 'this is d.' },
    { word: 'e', index: 5, pos: 'n', meaning: 'me', sample: 'this is e.' },
];
test('영한 퀴즈: 보기 4개, 정답=뜻 포함', () => {
    const q = quizMode.createMeaningQuiz(sampleWords[0], sampleWords);
    assert.equal(q.type, 'MULTIPLE_CHOICE_MEANING');
    assert.equal(q.answer, 'ma');
    assert.equal(q.choices.length, 4);
    assert.ok(q.choices.includes('ma'));
});
test('영한 퀴즈: 정답과 오답 모두 meaning 첫 줄만 사용', () => {
    const words = [
        { word: 'a', pos: 'n', meaning: '<b>1. 정답</b>\n2. 정답의 둘째 뜻' },
        { word: 'b', pos: 'n', meaning: '1. 오답 B<br>2. B의 둘째 뜻' },
        { word: 'c', pos: 'n', meaning: '1. 오답 C\n2. C의 둘째 뜻' },
        { word: 'd', pos: 'n', meaning: '1. 오답 D</div><div>2. D의 둘째 뜻' },
    ];
    const q = quizMode.createMeaningQuiz(words[0], words);
    assert.equal(q.answer, '1. 정답');
    assert.equal(q.choices.length, 4);
    assert.deepEqual(new Set(q.choices), new Set(['1. 정답', '1. 오답 B', '1. 오답 C', '1. 오답 D']));
    assert.ok(q.choices.every(choice => !choice.includes('\n') && !choice.includes('<')));
});
test('영한 퀴즈: 첫 줄 뜻이 같은 단어는 오답 후보에서 제외', () => {
    const words = [
        { word: 'a', pos: 'n', meaning: '같은 뜻\n정답의 둘째 뜻' },
        { word: 'b', pos: 'n', meaning: '같은 뜻\n오답의 둘째 뜻' },
        { word: 'c', pos: 'n', meaning: '뜻 C' },
        { word: 'd', pos: 'n', meaning: '뜻 D' },
        { word: 'e', pos: 'n', meaning: '뜻 E' },
    ];
    const q = quizMode.createMeaningQuiz(words[0], words);
    assert.equal(q.choices.length, 4);
    assert.equal(q.choices.filter(choice => choice === '같은 뜻').length, 1);
    assert.equal(new Set(q.choices).size, 4);
});
test('영한 퀴즈: 첫 줄 끝 쉼표·세미콜론·콜론만 제거하고 중간 기호는 유지', () => {
    assert.equal(quizMode._getFirstMeaningLine('크고, 아름답다,  \n둘째 뜻'), '크고, 아름답다');
    assert.equal(quizMode._getFirstMeaningLine('<b>첫째 뜻，</b><br>둘째 뜻'), '첫째 뜻');
    assert.equal(quizMode._getFirstMeaningLine('원인: 결과;  \n둘째 뜻'), '원인: 결과');
    assert.equal(quizMode._getFirstMeaningLine('<i>첫째 뜻；：</i><br>둘째 뜻'), '첫째 뜻');
});
test('빈칸 퀴즈: 표제어를 ___BLANK___로 치환', () => {
    const q = quizMode.createBlankQuiz(sampleWords[0], sampleWords);
    assert.equal(q.type, 'FILL_IN_THE_BLANK');
    assert.equal(q.answer, 'a');
    assert.ok(q.question.sentence_with_blank.includes('___BLANK___'));
});
test('빈칸·영영 TTS는 듣기용 sample 속도로 문제 내용을 전달', () => {
    const originalSpeak = api.speak;
    const calls = [];
    api.speak = (text, contentType) => {
        calls.push([text, contentType]);
        return Promise.resolve();
    };
    try {
        quizMode._playBlankCloze('I ate an ___BLANK___ today.');
        quizMode._playDefinition('a round fruit with red or green skin');
    } finally {
        api.speak = originalSpeak;
    }
    assert.deepEqual(calls, [
        ['I ate an ; blank ; today.', 'sample'],
        ['a round fruit with red or green skin', 'sample'],
    ]);
});
test('혼합 퀴즈 유형 선택은 사용자가 고른 유형 안에서만 동작', () => {
    quizMode.state.mixedQuizTypes = ['MULTIPLE_CHOICE_MEANING', 'LISTENING_QUIZ'];
    for (let i = 0; i < 20; i++) {
        assert.ok(quizMode.state.mixedQuizTypes.includes(quizMode._pickMixedQuizType()));
    }
    quizMode.state.mixedQuizTypes = [];
});
test('혼합 유형 버튼은 누를 때마다 선택 상태가 반전', () => {
    const attributes = { 'aria-pressed': 'false' };
    const button = {
        getAttribute(name) { return attributes[name]; },
        setAttribute(name, value) { attributes[name] = value; }
    };
    quizMode.toggleMixedType(button);
    assert.equal(attributes['aria-pressed'], 'true');
    quizMode.toggleMixedType(button);
    assert.equal(attributes['aria-pressed'], 'false');
});

group('quiz._collectQuizCandidates (후보 선별 추출 검증)');
function setupCandidates() {
    state.wordList = [
        { word: 'a', index: 1, pos: 'n', meaning: 'ma' },
        { word: 'b', index: 2, pos: 'n', meaning: 'mb', except: true },
        { word: 'c', index: 3, pos: 'n', meaning: 'mc' },
        { word: 'd', index: 4, pos: 'n', meaning: 'md' },
        { word: 'e', index: 5, pos: 'n', meaning: 'me' },
    ];
    quizMode.state.answeredWords = new Set(['c']);
    state.currentProgress = { d: { MULTIPLE_CHOICE_MEANING: 'correct' } };
    resetStorage();
}
test('일반 모드: except/answered/정답완료 단어 제외', () => {
    setupCandidates();
    quizMode.state.isPracticeMode = false;
    const { candidates } = quizMode._collectQuizCandidates('MULTIPLE_CHOICE_MEANING', { rangeOverride: { start: 1, end: 5 } });
    assert.deepEqual(candidates.map(w => w.word).sort(), ['a', 'e']);
});
test('복습(연습) 모드: 정답완료도 포함(except/answered만 제외)', () => {
    setupCandidates();
    quizMode.state.isPracticeMode = true;
    const { candidates } = quizMode._collectQuizCandidates('MULTIPLE_CHOICE_MEANING', { rangeOverride: { start: 1, end: 5 } });
    assert.deepEqual(candidates.map(w => w.word).sort(), ['a', 'd', 'e']);
});
test('범위 제한: 1-2만 보면 a만 후보(b는 except)', () => {
    setupCandidates();
    quizMode.state.isPracticeMode = false;
    const { candidates } = quizMode._collectQuizCandidates('MULTIPLE_CHOICE_MEANING', { rangeOverride: { start: 1, end: 2 } });
    assert.deepEqual(candidates.map(w => w.word).sort(), ['a']);
});

// =========================================================
console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
process.exit(fail === 0 ? 0 : 1);
