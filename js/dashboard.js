import { state } from './config.js';
import { api } from './api.js';
import { utils } from './utils.js';

export const dashboard = {
    elements: {
        container: document.getElementById('dashboard-container'),
        content: document.getElementById('dashboard-content'),
        // 필요 시 내부에서 동적으로 생성된 요소들을 참조하기 위해 비워둠
    },
    
    state: {
        charts: {
            studyTime: null,
            wordStatus: null,
            quizAccuracy: null
        }
    },

    init() {
        // 대시보드는 main.js에서 render()를 호출할 때마다 갱신되므로
        // 별도의 정적 이벤트 리스너가 많이 필요하지 않음.
        // 데이터 변경 시 자동 갱신을 원한다면 여기서 리스너 등록 가능.
        document.addEventListener('wordListUpdated', () => {
            if (!this.elements.container.classList.contains('hidden')) {
                this.render();
            }
        });
    },

    // 차트 초기화 (메모리 누수 방지 핵심)
    destroyCharts() {
        Object.keys(this.state.charts).forEach(key => {
            if (this.state.charts[key]) {
                this.state.charts[key].destroy();
                this.state.charts[key] = null;
            }
        });
    },

    async render() {
        if (!state.isWordListReady) {
            this.elements.content.innerHTML = `<div class="flex h-full items-center justify-center text-gray-500">데이터를 불러오는 중입니다...</div>`;
            return;
        }

        // 기존 차트 정리
        this.destroyCharts();

        // 1. 데이터 준비
        const studyHistory = await api.getStudyHistory(); // { '2023-10-01': 120, ... }
        const quizHistory = await api.getQuizHistory();   // { '2023-10-01': { 'TYPE': { total: 10, correct: 8 } } }
        
        // 단어 상태 집계
        let statusCounts = { unknown: 0, review: 0, correct: 0 };
        state.wordList.forEach(word => {
            const s = utils.getWordStatus(word.word);
            // 'unknown'은 기본값이므로 별도 카운팅 혹은 known/unknown 구분
            if (s === 'correct') statusCounts.correct++;
            else if (s === 'review') statusCounts.review++;
            else statusCounts.unknown++;
        });

        // 2. HTML 구조 생성 (Grid Layout)
        const html = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                        <span class="mr-2">⏰</span> 주간 학습 시간
                    </h3>
                    <div class="relative h-64">
                        <canvas id="chart-study-time"></canvas>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                        <span class="mr-2">📊</span> 단어 암기 현황
                    </h3>
                    <div class="relative h-64 flex justify-center">
                         <canvas id="chart-word-status"></canvas>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 md:col-span-2">
                    <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
                        <span class="mr-2">🎯</span> 퀴즈 유형별 정답률
                    </h3>
                    <div class="relative h-64">
                         <canvas id="chart-quiz-accuracy"></canvas>
                    </div>
                </div>
                
                <div class="bg-indigo-50 p-6 rounded-2xl shadow-inner md:col-span-2">
                    <h3 class="text-lg font-bold text-indigo-900 mb-2">💡 학습 인사이트</h3>
                    <p class="text-indigo-700 text-sm leading-relaxed" id="dashboard-insight-text">
                        데이터를 분석 중입니다...
                    </p>
                </div>
            </div>
        `;
        
        this.elements.content.innerHTML = html;

        // 3. 차트 그리기 (DOM 업데이트 후 실행)
        requestAnimationFrame(() => {
            this.drawStudyTimeChart(studyHistory);
            this.drawWordStatusChart(statusCounts);
            this.drawQuizAccuracyChart(quizHistory);
            this.generateInsight(studyHistory, quizHistory, statusCounts);
        });
    },

    // --- Chart Generators ---

    drawStudyTimeChart(history) {
        const ctx = document.getElementById('chart-study-time');
        if (!ctx) return;

        // 최근 7일 날짜 생성
        const labels = [];
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            labels.push(d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })); // "10월 1일"
            const seconds = history[dateStr] || 0;
            data.push((seconds / 60).toFixed(1)); // 분 단위 변환
        }

        this.state.charts.studyTime = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '학습 시간 (분)',
                    data: data,
                    backgroundColor: 'rgba(99, 102, 241, 0.6)', // Indigo-500
                    borderColor: 'rgba(99, 102, 241, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { display: false } },
                    x: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    },

    drawWordStatusChart(counts) {
        const ctx = document.getElementById('chart-word-status');
        if (!ctx) return;

        // 데이터가 아예 없으면 기본값 처리
        const total = counts.unknown + counts.review + counts.correct;
        const data = total === 0 ? [1, 0, 0] : [counts.unknown, counts.review, counts.correct];
        const bgColors = total === 0 
            ? ['#E5E7EB', '#E5E7EB', '#E5E7EB'] 
            : ['#9CA3AF', '#EF4444', '#10B981']; // Gray, Red, Green

        this.state.charts.wordStatus = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['미학습', '복습 필요', '암기 완료'],
                datasets: [{
                    data: data,
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } }
                }
            }
        });
    },

    drawQuizAccuracyChart(history) {
        const ctx = document.getElementById('chart-quiz-accuracy');
        if (!ctx) return;

        // 전체 기간 퀴즈 데이터 집계
        const stats = {
            'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
            'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
            'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 }
        };

        Object.values(history).forEach(dayData => {
            Object.keys(dayData).forEach(type => {
                if (stats[type]) {
                    stats[type].correct += dayData[type].correct || 0;
                    stats[type].total += dayData[type].total || 0;
                }
            });
        });

        const labels = ['뜻 고르기', '빈칸 채우기', '정의 맞추기'];
        const data = [
            stats['MULTIPLE_CHOICE_MEANING'].total ? (stats['MULTIPLE_CHOICE_MEANING'].correct / stats['MULTIPLE_CHOICE_MEANING'].total * 100) : 0,
            stats['FILL_IN_THE_BLANK'].total ? (stats['FILL_IN_THE_BLANK'].correct / stats['FILL_IN_THE_BLANK'].total * 100) : 0,
            stats['MULTIPLE_CHOICE_DEFINITION'].total ? (stats['MULTIPLE_CHOICE_DEFINITION'].correct / stats['MULTIPLE_CHOICE_DEFINITION'].total * 100) : 0,
        ];

        this.state.charts.quizAccuracy = new Chart(ctx, {
            type: 'bar', // 가로 막대 그래프 추천
            data: {
                labels: labels,
                datasets: [{
                    label: '정답률 (%)',
                    data: data,
                    backgroundColor: [
                        'rgba(59, 130, 246, 0.7)', // Blue
                        'rgba(16, 185, 129, 0.7)', // Green
                        'rgba(245, 158, 11, 0.7)'  // Yellow
                    ],
                    borderColor: [
                        'rgba(59, 130, 246, 1)',
                        'rgba(16, 185, 129, 1)',
                        'rgba(245, 158, 11, 1)'
                    ],
                    borderWidth: 1,
                    barPercentage: 0.6,
                }]
            },
            options: {
                indexAxis: 'y', // 가로형 막대
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { beginAtZero: true, max: 100, grid: { display: true } },
                    y: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.parsed.x.toFixed(1) + '%';
                            }
                        }
                    }
                }
            }
        });
    },

    generateInsight(studyHistory, quizHistory, statusCounts) {
        const textField = document.getElementById('dashboard-insight-text');
        if (!textField) return;

        const totalStudySeconds = Object.values(studyHistory).reduce((a, b) => a + b, 0);
        const totalWords = statusCounts.unknown + statusCounts.review + statusCounts.correct;
        const memorizedRatio = totalWords > 0 ? ((statusCounts.correct / totalWords) * 100).toFixed(0) : 0;

        let message = "";
        
        if (totalStudySeconds < 60) {
            message = "아직 학습 기록이 충분하지 않습니다. 오늘부터 조금씩 시작해보세요! 🏃‍♂️";
        } else if (memorizedRatio < 10) {
            message = `지금까지 총 ${utils.formatSeconds(totalStudySeconds)} 동안 학습하셨네요. 시작이 반입니다! 차근차근 암기 완료 단어를 늘려가 보세요.`;
        } else if (memorizedRatio < 50) {
            message = `훌륭합니다! 전체 단어의 ${memorizedRatio}%를 암기하셨습니다. 꾸준함이 가장 큰 무기입니다. 🔥`;
        } else {
            message = `대단해요! 과반수 이상의 단어를 마스터하셨습니다(${memorizedRatio}%). 이제 마스터 레벨에 도전해보세요! 🏆`;
        }

        // 오답 노트 추천
        if (statusCounts.review > 0) {
            message += `<br><br>💡 <strong>Tip:</strong> 현재 복습이 필요한 단어가 <strong>${statusCounts.review}개</strong> 있습니다. '오답 노트' 메뉴를 활용해 보세요.`;
        }

        textField.innerHTML = message;
    }
};
