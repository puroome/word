import { state } from './config.js';
import { utils } from './utils.js';

function readJson(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
        console.warn(`통계 데이터가 손상되어 초기화합니다: ${key}`, error);
        return {};
    }
}

function writeJson(key, value) {
    if (Object.keys(value).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export const statsStore = {
    migrateLegacyPending(today = utils.getLocalDateString()) {
        const legacySeconds = Math.max(
            0,
            parseInt(localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0', 10) || 0
        );
        if (legacySeconds > 0) {
            const pending = this.getPendingStudy();
            pending[today] = Number(pending[today] || 0) + legacySeconds;
            writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME_BY_DATE, pending);
            localStorage.removeItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME);
        }

        const legacyQuiz = readJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ);
        if (Object.keys(legacyQuiz).length > 0) {
            const pending = this.getPendingQuiz();
            if (!pending[today]) pending[today] = {};
            Object.entries(legacyQuiz).forEach(([type, stats]) => {
                if (!stats || typeof stats !== 'object') return;
                if (!pending[today][type]) pending[today][type] = { correct: 0, total: 0 };
                pending[today][type].correct += Number(stats.correct || 0);
                pending[today][type].total += Number(stats.total || 0);
            });
            writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ_BY_DATE, pending);
            localStorage.removeItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ);
        }
    },

    getPendingStudy() {
        return readJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME_BY_DATE);
    },

    getPendingQuiz() {
        return readJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ_BY_DATE);
    },

    addStudySeconds(date, seconds) {
        const amount = Math.max(0, Math.floor(Number(seconds) || 0));
        if (!date || amount < 1) return;
        const pending = this.getPendingStudy();
        pending[date] = Number(pending[date] || 0) + amount;
        writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME_BY_DATE, pending);
    },

    addQuizResult(date, quizType, isCorrect) {
        if (!date || !quizType) return;
        const pending = this.getPendingQuiz();
        if (!pending[date]) pending[date] = {};
        if (!pending[date][quizType]) pending[date][quizType] = { correct: 0, total: 0 };
        pending[date][quizType].total += 1;
        if (isCorrect) pending[date][quizType].correct += 1;
        writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ_BY_DATE, pending);
    },

    snapshot() {
        this.migrateLegacyPending();
        return {
            study: clone(this.getPendingStudy()),
            quiz: clone(this.getPendingQuiz())
        };
    },

    subtractSnapshot(snapshot) {
        const currentStudy = this.getPendingStudy();
        Object.entries(snapshot.study || {}).forEach(([date, seconds]) => {
            currentStudy[date] = Math.max(0, Number(currentStudy[date] || 0) - Number(seconds || 0));
            if (currentStudy[date] === 0) delete currentStudy[date];
        });
        writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME_BY_DATE, currentStudy);

        const currentQuiz = this.getPendingQuiz();
        Object.entries(snapshot.quiz || {}).forEach(([date, daily]) => {
            if (!currentQuiz[date]) return;
            Object.entries(daily || {}).forEach(([type, stats]) => {
                if (!currentQuiz[date][type]) return;
                currentQuiz[date][type].correct = Math.max(
                    0,
                    Number(currentQuiz[date][type].correct || 0) - Number(stats.correct || 0)
                );
                currentQuiz[date][type].total = Math.max(
                    0,
                    Number(currentQuiz[date][type].total || 0) - Number(stats.total || 0)
                );
                if (currentQuiz[date][type].total === 0) delete currentQuiz[date][type];
            });
            if (Object.keys(currentQuiz[date]).length === 0) delete currentQuiz[date];
        });
        writeJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ_BY_DATE, currentQuiz);
    },

    mergeStudyHistory(remote = {}) {
        const merged = { ...remote };
        Object.entries(this.getPendingStudy()).forEach(([date, seconds]) => {
            merged[date] = Number(merged[date] || 0) + Number(seconds || 0);
        });
        return merged;
    },

    mergeQuizHistory(remote = {}) {
        const merged = clone(remote || {});
        Object.entries(this.getPendingQuiz()).forEach(([date, daily]) => {
            if (!merged[date]) merged[date] = {};
            Object.entries(daily || {}).forEach(([type, stats]) => {
                if (!merged[date][type]) merged[date][type] = { correct: 0, total: 0 };
                merged[date][type].correct =
                    Number(merged[date][type].correct || 0) + Number(stats.correct || 0);
                merged[date][type].total =
                    Number(merged[date][type].total || 0) + Number(stats.total || 0);
            });
        });
        return merged;
    }
};
