import { state } from './config.js';
import { api } from './api.js';
import { utils } from './utils.js';

// Chart.js 동적 로드
const loadChartJs = () => new Promise((resolve, reject) => {
  if (window.Chart) return resolve();
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});

export const dashboard = {
  elements: {
    container: document.getElementById('dashboard-container'),
    content: document.getElementById('dashboard-content'),
    summary: document.getElementById('dashboard-summary'),
  },
  state: {
    studyTimeChart: null,
    quiz1Chart: null,
    quiz2Chart: null,
    quiz3Chart: null,
  },

  init() {
    document.addEventListener('wordListUpdated', () => {
      if (!this.elements.container.classList.contains('hidden')) this.render();
    });
  },

  destroyCharts() {
    if (this.state.studyTimeChart) this.state.studyTimeChart.destroy();
    if (this.state.quiz1Chart) this.state.quiz1Chart.destroy();
    if (this.state.quiz2Chart) this.state.quiz2Chart.destroy();
    if (this.state.quiz3Chart) this.state.quiz3Chart.destroy();
    this.state.studyTimeChart = null;
    this.state.quiz1Chart = null;
    this.state.quiz2Chart = null;
    this.state.quiz3Chart = null;
  },

  async render() {
    if (!state.isWordListReady) {
      this.elements.content.innerHTML =
        '<div class="text-center p-10"><p class="text-gray-600">단어 목록을 불러오는 중...</p></div>';
      return;
    }

    const wordList = state.wordList;
    const totalWords = wordList.length;
    const stages = {
      unseen:   { name: '미학습', count: 0, color: 'bg-gray-400' },
      learning: { name: '학습중', count: 0, color: 'bg-blue-500' },
      review:   { name: '복습필요', count: 0, color: 'bg-orange-500' },
      learned:  { name: '완료', count: 0, color: 'bg-green-500' },
    };

    wordList.forEach(wordObj => {
      const status = utils.getWordStatus(wordObj.word);
      if (stages[status]) stages[status].count++;
    });

    let contentHTML = `
      <div class="bg-gray-50 p-4 rounded-lg shadow-inner text-center">
        <p class="text-lg text-gray-600">전체 단어</p>
        <p class="text-4xl font-bold text-gray-800">${totalWords}</p>
      </div>
      <h2 class="text-xl font-bold text-gray-700 mb-3 text-center">학습 현황</h2>
      <div class="space-y-4">`;

    Object.values(stages).forEach(stage => {
      const percentage = totalWords > 0 ? (stage.count / totalWords * 100).toFixed(1) : 0;
      contentHTML += `
        <div class="w-full">
          <div class="flex justify-between items-center mb-1">
            <span class="text-base font-semibold text-gray-700">${stage.name}</span>
            <span class="text-sm font-medium text-gray-500">${stage.count}개 (${percentage}%)</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-4">
            <div class="${stage.color} h-4 rounded-full" style="width:${percentage}%"></div>
          </div>
        </div>`;
    });

    contentHTML += '</div>';
    this.elements.content.innerHTML = contentHTML;
    await this.renderSummary();
  },

  async renderSummary() {
    this.destroyCharts();

    // Chart.js 로드
    try {
      await loadChartJs();
    } catch(e) {
      console.error('Chart.js 로드 실패:', e);
      return;
    }

    // #8 fix: 순차 await → Promise.all 병렬 처리
    const [studyHistory, quizHistory] = await Promise.all([
      api.getStudyHistory(),
      api.getQuizHistory(),
    ]);

    const safeStudyHistory = studyHistory || {};
    const safeQuizHistory = quizHistory || {};
    const today = new Date();

    // 학습 시간 차트 (최근 7일)
    const labels = [];
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateString = d.toISOString().slice(0, 10);
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      data.push(Math.round((safeStudyHistory[dateString] || 0) / 60));
    }

    const studyTimeCtx = document.getElementById('study-time-chart')?.getContext('2d');
    if (studyTimeCtx) {
      this.state.studyTimeChart = new Chart(studyTimeCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '학습 시간(분)',
            data,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, suggestedMax: 60 } },
          plugins: { legend: { display: false } },
        },
      });
    }

    // 퀴즈 정확도 (최근 7일 누적)
    const totalQuizStats = {
      MULTIPLECHOICEMEANING:   { correct: 0, total: 0 },
      FILLINTHEBLANK:          { correct: 0, total: 0 },
      MULTIPLECHOICEDEFINITION:{ correct: 0, total: 0 },
    };

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateString = d.toISOString().slice(0, 10);
      if (safeQuizHistory[dateString]) {
        for (const type in totalQuizStats) {
          if (safeQuizHistory[dateString][type]) {
            totalQuizStats[type].correct += safeQuizHistory[dateString][type].correct || 0;
            totalQuizStats[type].total   += safeQuizHistory[dateString][type].total   || 0;
          }
        }
      }
    }

    const createDoughnutChart = (elementId, labelId, labelText, stats) => {
      const ctx = document.getElementById(elementId)?.getContext('2d');
      if (!ctx) return null;
      const correct   = stats.correct || 0;
      const total     = stats.total   || 0;
      const incorrect = total - correct;
      const accuracy  = total > 0 ? (correct / total * 100).toFixed(0) : 0;
      const labelEl   = document.getElementById(labelId);
      if (labelEl) labelEl.textContent = `${labelText} ${correct}/${total}`;

      return new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: total > 0 ? ['정답', '오답'] : ['없음'],
          datasets: [{
            data: total > 0
              ? [correct, incorrect > 0 ? incorrect : 0.0001]
              : [1],
            backgroundColor:      total > 0 ? ['#34D399', '#F87171'] : ['#E5E7EB'],
            hoverBackgroundColor: total > 0 ? ['#10B981', '#EF4444'] : ['#D1D5DB'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '70%',
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
        },
        plugins: [{
          id: 'doughnutLabel',
          beforeDraw(chart) {
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
          },
        }],
      });
    };

    this.state.quiz1Chart = createDoughnutChart(
      'quiz1-chart', 'quiz1-label', '뜻 맞히기', totalQuizStats.MULTIPLECHOICEMEANING
    );
    this.state.quiz2Chart = createDoughnutChart(
      'quiz2-chart', 'quiz2-label', '빈칸 채우기', totalQuizStats.FILLINTHEBLANK
    );
    this.state.quiz3Chart = createDoughnutChart(
      'quiz3-chart', 'quiz3-label', '정의 맞히기', totalQuizStats.MULTIPLECHOICEDEFINITION
    );

    // 텍스트 요약 카드
    const textSummaryContainer = document.getElementById('dashboard-text-summary');
    if (!textSummaryContainer) return;

    const getStatsForPeriod = days => {
      let totalSeconds = 0;
      const quizStats = {
        MULTIPLECHOICEMEANING:   { correct: 0, total: 0 },
        FILLINTHEBLANK:          { correct: 0, total: 0 },
        MULTIPLECHOICEDEFINITION:{ correct: 0, total: 0 },
      };
      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateString = d.toISOString().slice(0, 10);
        totalSeconds += safeStudyHistory[dateString] || 0;
        if (safeQuizHistory[dateString]) {
          for (const type in quizStats) {
            if (safeQuizHistory[dateString][type]) {
              quizStats[type].correct += safeQuizHistory[dateString][type].correct || 0;
              quizStats[type].total   += safeQuizHistory[dateString][type].total   || 0;
            }
          }
        }
      }
      return { totalSeconds, quizStats };
    };

    const totalStudySeconds = Object.values(safeStudyHistory)
      .reduce((sum, dailySeconds) => sum + (dailySeconds || 0), 0);

    const quizHistoryTotal = {
      MULTIPLECHOICEMEANING:   { correct: 0, total: 0 },
      FILLINTHEBLANK:          { correct: 0, total: 0 },
      MULTIPLECHOICEDEFINITION:{ correct: 0, total: 0 },
    };
    if (safeQuizHistory) {
      Object.values(safeQuizHistory).forEach(daily => {
        Object.entries(daily).forEach(([type, stats]) => {
          if (quizHistoryTotal[type] && stats) {
            quizHistoryTotal[type].correct += stats.correct || 0;
            quizHistoryTotal[type].total   += stats.total   || 0;
          }
        });
      });
    }

    const stats30 = getStatsForPeriod(30);

    const quizTypeNames = {
      MULTIPLECHOICEMEANING:    '뜻 맞히기',
      FILLINTHEBLANK:           '빈칸 채우기',
      MULTIPLECHOICEDEFINITION: '정의 맞히기',
    };

    const createSummaryCardHTML = (title, totalSeconds, quizStats) => {
      let quizHTML = '<div class="grid grid-cols-3 gap-1 text-center">';
      for (const type in quizTypeNames) {
        const stats = quizStats[type] || { correct: 0, total: 0 };
        const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : 0;
        quizHTML += `
          <div class="bg-white p-2 rounded-lg shadow-sm">
            <p class="text-sm font-semibold text-gray-500">${quizTypeNames[type]}</p>
            <p class="font-bold text-gray-800 text-xl">${accuracy}%</p>
            <p class="text-xs text-gray-400">${stats.correct}/${stats.total}</p>
          </div>`;
      }
      quizHTML += '</div>';
      return `
        <div class="bg-gray-50 p-4 rounded-xl shadow-inner">
          <h4 class="font-bold text-gray-700 mb-4 text-lg text-center">
            ${title}
            <span class="font-normal text-gray-500">${utils.formatSeconds(totalSeconds)}</span>
          </h4>
          <div class="space-y-3">${quizHTML}</div>
        </div>`;
    };

    const card30Days = createSummaryCardHTML('최근 30일', stats30.totalSeconds, stats30.quizStats);
    const cardTotal  = createSummaryCardHTML('전체 누적', totalStudySeconds, quizHistoryTotal);

    textSummaryContainer.innerHTML =
      `<div class="space-y-6">${card30Days}${cardTotal}</div>`;
  },
};
