import { state } from './config.js';
import { api } from './api.js';
import { utils } from './utils.js';

// Chart.js 동적 로딩을 위한 헬퍼 함수
const loadChartJs = () => {
    return new Promise((resolve, reject) => {
        if (window.Chart) return resolve(); // 이미 로드되어 있으면 즉시 반환
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
};

export const dashboard = {
    elements: {
        container: document.getElementById('dashboard-container'),
        content: document.getElementById('dashboard-content'),
        summary: document.getElementById('dashboard-summary'),
    },
    state: {
        // 주의: 차트 인스턴스들을 배열로 통합 관리여 destroyCharts가 자동 확장됨
        charts: [],
    },
    init() {
        document.addEventListener('wordListUpdated', () => {
            if (!this.elements.container.classList.contains('hidden')) {
                this.render();
            }
        });
    },
    destroyCharts() {
        this.state.charts.forEach(chart => chart?.destroy());
        this.state.charts = [];
    },
    async render() {
        if (!state.isWordListReady) {
            this.elements.content.innerHTML = `<div class="text-center p-10"><p class="text-gray-600">단어 목록을 먼저 불러와주세요.</p></div>`;
            return;
        }

        const wordList = state.wordList;
        const totalWords = wordList.length;
        const stages = {
            unseen: { name: '새 단어', count: 0, color: 'bg-gray-400' },
            learning: { name: '학습 중', count: 0, color: 'bg-blue-500' },
            review: { name: '복습 필요', count: 0, color: 'bg-orange-500' },
            learned: { name: '학습 완료', count: 0, color: 'bg-green-500' }
        };

        wordList.forEach(wordObj => {
            const status = utils.getWordStatus(wordObj.word);
            if (stages[status]) {
                stages[status].count++;
            }
        });

        let contentHTML = `<div class="bg-gray-50 p-4 rounded-lg shadow-inner text-center"><p class="text-lg text-gray-600">총 단어 수</p><p class="text-4xl font-bold text-gray-800">${totalWords}</p></div><div><h2 class="text-xl font-bold text-gray-700 mb-3 text-center">학습 단계별 분포</h2><div class="space-y-4">`;
        Object.values(stages).forEach(stage => {
            const percentage = totalWords > 0 ? ((stage.count / totalWords) * 100).toFixed(1) : 0;
            contentHTML += `<div class="w-full"><div class="flex justify-between items-center mb-1"><span class="text-base font-semibold text-gray-700">${stage.name}</span><span class="text-sm font-medium text-gray-500">${stage.count}개 (${percentage}%)</span></div><div class="w-full bg-gray-200 rounded-full h-4"><div class="${stage.color} h-4 rounded-full" style="width: ${percentage}%"></div></div></div>`;
        });
        contentHTML += `</div></div>`;
        this.elements.content.innerHTML = contentHTML;
        await this.renderSummary();
    },
    async renderSummary() {
        this.destroyCharts();

        // 여기서 Chart.js 로딩을 기다립니다.
        try {
            await loadChartJs();
        } catch (e) {
            console.error("Chart.js 로딩 실패:", e);
            return; // 라이브러리 로드 실패 시 차트 렌더링 중단
        }

        const studyHistory = await api.getStudyHistory();
        const quizHistory = await api.getQuizHistory();
        const today = new Date();

        const labels = [];
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const loopDate = new Date(today);
            loopDate.setDate(loopDate.getDate() - i);
            const dateString = loopDate.toISOString().slice(0, 10);
            labels.push(`${loopDate.getMonth() + 1}/${loopDate.getDate()}`);
            data.push(Math.round((studyHistory[dateString] || 0) / 60));
        }
        const studyTimeCtx = document.getElementById('study-time-chart')?.getContext('2d');
        if (studyTimeCtx) {
            this.state.charts.push(new Chart(studyTimeCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '학습 시간 (분)',
                        data: data,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, suggestedMax: 60 }
                    },
                    plugins: { legend: { display: false } }
                }
            }));
        }


        const totalQuizStats = {
            'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
            'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
            'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 },
        };

        for (let i = 0; i < 7; i++) {
            const loopDate = new Date(today);
            loopDate.setDate(loopDate.getDate() - i);
            const dateString = loopDate.toISOString().slice(0, 10);
            if (quizHistory[dateString]) {
                for (const type in totalQuizStats) {
                    if (quizHistory[dateString][type]) {
                        totalQuizStats[type].correct += quizHistory[dateString][type].correct || 0;
                        totalQuizStats[type].total += quizHistory[dateString][type].total || 0;
                    }
                }
            }
        }

        const createDoughnutChart = (elementId, labelId, labelText, stats) => {
            const ctx = document.getElementById(elementId)?.getContext('2d');
            if (!ctx) return;

            const correct   = stats.correct || 0;
            const total     = stats.total   || 0;
            const incorrect = total - correct;
            const accuracy  = total > 0 ? ((correct / total) * 100).toFixed(0) : 0;

            const labelEl = document.getElementById(labelId);
            if (labelEl) labelEl.textContent = `${labelText} (${correct}/${total})`;

            this.state.charts.push(new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: total > 0 ? ['정답', '오답'] : ['기록 없음'],
                    datasets: [{
                        data: total > 0 ? [correct, incorrect > 0 ? incorrect : 0.0001] : [0, 1],
                        backgroundColor: total > 0 ? ['#34D399', '#F87171'] : ['#E5E7EB', '#E5E7EB'],
                        hoverBackgroundColor: total > 0 ? ['#10B981', '#EF4444'] : ['#D1D5DB', '#D1D5DB'],
                        borderWidth: 0,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '70%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                    }
                },
                plugins: [{
                    id: 'doughnutLabel',
                    beforeDraw: (chart) => {
                        const { ctx, width, height } = chart;
                        ctx.restore();
                        const fontSize = (height / 100).toFixed(2);
                        ctx.font = `bold ${fontSize}em sans-serif`;
                        ctx.textBaseline = 'middle';
                        const text = total > 0 ? `${accuracy}%` : '-';
                        const textX = Math.round((width - ctx.measureText(text).width) / 2);
                        const textY = height / 2;
                        ctx.fillStyle = total > 0 ? '#374151' : '#9CA3AF';
                        ctx.fillText(text, textX, textY);
                        ctx.save();
                    }
                }]
            }));
        };
        createDoughnutChart('quiz1-chart', 'quiz1-label', '영한 뜻',  totalQuizStats['MULTIPLE_CHOICE_MEANING']);
        createDoughnutChart('quiz2-chart', 'quiz2-label', '빈칸 추론', totalQuizStats['FILL_IN_THE_BLANK']);
        createDoughnutChart('quiz3-chart', 'quiz3-label', '영영 풀이', totalQuizStats['MULTIPLE_CHOICE_DEFINITION']);


        const textSummaryContainer = document.getElementById('dashboard-text-summary');
        if (textSummaryContainer) {
            const getStatsForPeriod = (days) => {
                let totalSeconds = 0;
                const quizStats = {
                    'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
                    'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
                    'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 },
                };

                for (let i = 0; i < days; i++) {
                    const loopDate = new Date(today);
                    loopDate.setDate(loopDate.getDate() - i);
                    const dateString = loopDate.toISOString().slice(0, 10);
                    totalSeconds += studyHistory[dateString] || 0;
                    if (quizHistory[dateString]) {
                        for (const type in quizStats) {
                            if(quizHistory[dateString][type]) {
                                quizStats[type].correct += quizHistory[dateString][type].correct || 0;
                                quizStats[type].total += quizHistory[dateString][type].total || 0;
                            }
                        }
                    }
                }
                return { totalSeconds, quizStats };
            }

            const totalStudySeconds = Object.values(studyHistory).reduce((sum, dailySeconds) => sum + (dailySeconds || 0), 0);

            const quizHistoryTotal = {
                'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
                'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
                'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 },
            };
            if(quizHistory) {
                Object.values(quizHistory).forEach(daily => {
                     Object.entries(daily).forEach(([type, stats]) => {
                         if (quizHistoryTotal[type] && stats) {
                            quizHistoryTotal[type].correct += stats.correct || 0;
                            quizHistoryTotal[type].total += stats.total || 0;
                         }
                    });
                });
            }

            const stats30 = getStatsForPeriod(30);

            const createSummaryCardHTML = (title, totalSeconds, quizStats) => {
                const quizTypes = {
                    'MULTIPLE_CHOICE_MEANING': '영한 뜻',
                    'FILL_IN_THE_BLANK': '빈칸 추론',
                    'MULTIPLE_CHOICE_DEFINITION': '영영 풀이',
                };

                let quizHTML = '<div class="grid grid-cols-3 gap-1 text-center">';
                for (const type in quizTypes) {
                    const stats = quizStats[type] || { correct: 0, total: 0 };
                    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(0) : 0;
                    quizHTML += `
                        <div class="bg-white p-2 rounded-lg shadow-sm">
                            <p class="text-sm font-semibold text-gray-500">${quizTypes[type]}</p>
                            <p class="font-bold text-gray-800 text-xl">${accuracy}%</p>
                            <p class="text-xs text-gray-400">(${stats.correct}/${stats.total})</p>
                        </div>
                    `;
                }
                quizHTML += '</div>';

                return `
                    <div class="bg-gray-50 p-4 rounded-xl shadow-inner">
                        <h4 class="font-bold text-gray-700 mb-4 text-lg text-center">
                            ${title}
                            <span class="font-normal text-gray-500">(${utils.formatSeconds(totalSeconds)})</span>
                        </h4>
                        <div class="space-y-3">
                            ${quizHTML}
                        </div>
                    </div>
                `;
            };

            const card30Days = createSummaryCardHTML('최근 30일 기록', stats30.totalSeconds, stats30.quizStats);
            const cardTotal = createSummaryCardHTML('누적 총학습 기록', totalStudySeconds, quizHistoryTotal);

            textSummaryContainer.innerHTML = `
                <div class="space-y-6">
                    ${card30Days}
                    ${cardTotal}
                </div>
            `;
        }
    }
};
