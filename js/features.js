import { api } from './api.js';
import { utils } from './utils.js';
import { statsStore } from './stats-store.js';

export const features = {
    elements: {},

    init() {
        this.elements.summary = document.getElementById('today-summary');
    },

    async render() {
        if (!this.elements.summary) return;
        const today = utils.getLocalDateString();
        const [remoteStudyHistory, remoteQuizHistory] = await Promise.all([
            api.getStudyHistory(),
            api.getQuizHistory()
        ]);
        const studyHistory = statsStore.mergeStudyHistory(remoteStudyHistory);
        const quizHistory = statsStore.mergeQuizHistory(remoteQuizHistory);
        const minutes = Math.floor(Number(studyHistory[today] || 0) / 60);
        const quizTotal = Object.values(quizHistory[today] || {})
            .reduce((sum, stats) => sum + Number(stats.total || 0), 0);

        let streak = 0;
        const cursor = new Date();
        while (true) {
            const date = utils.toLocalDateString(cursor);
            const studied = Number(studyHistory[date] || 0) > 0;
            if (!studied && date === today) {
                cursor.setDate(cursor.getDate() - 1);
                continue;
            }
            if (!studied) break;
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        this.elements.summary.textContent =
            `🔥 ${streak}일 연속 · 오늘 ${minutes}분 · 퀴즈 ${quizTotal}문제`;
    }
};
