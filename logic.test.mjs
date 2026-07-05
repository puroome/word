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
import { utils } from './js/utils.js';
import { quizMode } from './js/quiz.js';

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
test('빈칸 퀴즈: 표제어를 ___BLANK___로 치환', () => {
    const q = quizMode.createBlankQuiz(sampleWords[0], sampleWords);
    assert.equal(q.type, 'FILL_IN_THE_BLANK');
    assert.equal(q.answer, 'a');
    assert.ok(q.question.sentence_with_blank.includes('___BLANK___'));
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
