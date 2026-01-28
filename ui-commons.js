// ================================================================
// js/ui-commons.js : UI 유틸리티, 대시보드, 사운드
// ================================================================

function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency }) {
    if (!app.state.audioContext) {
        console.warn("AudioContext not initialized. Cannot play beep.");
        return;
    }
    if (app.state.audioContext.state === 'suspended') {
        app.state.audioContext.resume();
    }

    const oscillator = app.state.audioContext.createOscillator();
    const gainNode = app.state.audioContext.createGain();
    const now = app.state.audioContext.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (endFrequency) {
        oscillator.frequency.linearRampToValueAtTime(endFrequency, now + duration);
    }

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.01);

    oscillator.connect(gainNode);
    gainNode.connect(app.state.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
}

function playSequence(soundDefinition) {
    if (soundDefinition.sequence && Array.isArray(soundDefinition.sequence)) {
        soundDefinition.sequence.forEach(note => {
            if (note.delay) {
                setTimeout(() => {
                    playSingleBeep(note);
                }, note.delay);
            } else {
                playSingleBeep(note);
            }
        });
    } else {
        playSingleBeep(soundDefinition);
    }
}

const correctBeep = {
    name: '또로롱 (물방울)',
    sequence: [
        { frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }
    ]
};

const incorrectBeep = {
    name: '삐빅 (경고)',
    sequence: [
        { frequency: 400, duration: 0.07, type: 'square', gain: 0.15 },
        { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }
    ]
};

const ui = {
    async copyToClipboard(text) {
        if (navigator.clipboard && text) {
            try { await navigator.clipboard.writeText(text); }
            catch (err) { console.warn("Clipboard write failed:", err); }
        }
    },
    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;

        const parts = text.split(/([a-zA-Z0-9'-]+)/g);

        parts.forEach(part => {
            if (/([a-zA-Z0-9'-]+)/.test(part) && window.learningMode && learningMode.nonInteractiveWords && !learningMode.nonInteractiveWords.has(part.toLowerCase())) {
                 const span = document.createElement('span');
                span.textContent = part;
                span.className = 'interactive-word';
                span.onclick = (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    clearTimeout(app.state.longPressTimer);
                    api.speak(part, 'word');
                    // this.copyToClipboard(part);
                };
                span.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (isForSampleSentence) e.stopPropagation();
                    this.showWordContextMenu(e, part);
                };
                 let touchMove = false;
                span.addEventListener('touchstart', (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    touchMove = false;
                    clearTimeout(app.state.longPressTimer);
                    app.state.longPressTimer = setTimeout(() => { if (!touchMove) { this.showWordContextMenu(e, part); } }, 700);
                }, { passive: true });
                span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(app.state.longPressTimer); });
                span.addEventListener('touchend', () => { clearTimeout(app.state.longPressTimer); });
                fragment.appendChild(span);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        });
        return fragment;
    },
    renderExplanationText(targetElement, text) {
        targetElement.innerHTML = '';
        if (!text || !text.trim()) return;
        const regex = /(\[.*?\])|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g;
        text.split('\n').forEach((line, lineIndex, lineArr) => {
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(line))) {
                if (match.index > lastIndex) {
                    targetElement.appendChild(document.createTextNode(line.substring(lastIndex, match.index)));
                }
                const [_, nonClickable, englishPhrase] = match;
                if (englishPhrase) {
                    const span = document.createElement('span');
                    span.textContent = englishPhrase;
                    if (window.learningMode && learningMode.nonInteractiveWords && !learningMode.nonInteractiveWords.has(englishPhrase.toLowerCase())) {
                        span.className = 'interactive-word';
                        span.onclick = () => {
                            clearTimeout(app.state.longPressTimer);
                            api.speak(englishPhrase, 'word');
                            // this.copyToClipboard(englishPhrase);
                        };
                        span.oncontextmenu = (e) => { e.preventDefault(); this.showWordContextMenu(e, englishPhrase); };
                        let touchMove = false;
                        span.addEventListener('touchstart', (e) => {
                            touchMove = false;
                            clearTimeout(app.state.longPressTimer);
                            app.state.longPressTimer = setTimeout(() => { if (!touchMove) this.showWordContextMenu(e, englishPhrase); }, 700);
                        }, { passive: true });
                        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(app.state.longPressTimer); });
                        span.addEventListener('touchend', () => { clearTimeout(app.state.longPressTimer); });
                    }
                    targetElement.appendChild(span);
                } else if (nonClickable) {
                    targetElement.appendChild(document.createTextNode(nonClickable));
                }
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < line.length) {
                targetElement.appendChild(document.createTextNode(line.substring(lastIndex)));
            }
            if (lineIndex < lineArr.length - 1) {
                targetElement.appendChild(document.createElement('br'));
            }
        });
    },
    displaySentences(sentences, containerElement) {
        containerElement.innerHTML = '';
        (sentences || []).filter(s => s && s.trim()).forEach(sentence => {
            const p = document.createElement('p');
            p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer';

            const showTranslation = async (event) => {
                app.state.activeTranslationTarget = p;
                const translatedText = await api.translate(p.textContent);
                if (app.state.activeTranslationTarget !== p) return;
                this.showTranslationTooltip(translatedText, event);
            };

            p.onclick = (e) => {
                if (e.target.closest('.sentence-content-area .interactive-word')) return;
                api.speak(p.textContent, 'sample');
                showTranslation(e);
            };

            p.addEventListener('mouseenter', (e) => {
                 if (e.target === p) {
                    clearTimeout(app.state.translationTimer);
                    app.state.activeTranslationTarget = p;
                    app.state.translationTimer = setTimeout(() => {
                        if (app.state.activeTranslationTarget === p) {
                            showTranslation(e);
                        }
                    }, 1000);
                 }
            });

            p.addEventListener('mouseleave', () => {
                clearTimeout(app.state.translationTimer);
                if (app.state.activeTranslationTarget === p) {
                    app.state.activeTranslationTarget = null;
                }
                this.hideTranslationTooltip();
            });

            const sentenceContent = document.createElement('span');
            sentenceContent.className = 'sentence-content-area';
            sentenceContent.style.cursor = 'text';

            sentenceContent.addEventListener('mouseenter', () => {
                clearTimeout(app.state.translationTimer);
                if (app.state.activeTranslationTarget === p) {
                    app.state.activeTranslationTarget = null;
                }
                this.hideTranslationTooltip();
            });

            const sentenceParts = sentence.split(/(\*.*?\*)/g);
            sentenceParts.forEach(part => {
                if (part.startsWith('*') && part.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.appendChild(this.createInteractiveFragment(part.slice(1, -1), true));
                    sentenceContent.appendChild(strong);
                } else if (part) {
                    sentenceContent.appendChild(this.createInteractiveFragment(part, true));
                }
            });
            p.appendChild(sentenceContent);
            containerElement.appendChild(p);
        });
    },
    showTranslationTooltip(text, event) {
        const tooltip = app.elements.translationTooltip;
        tooltip.textContent = text;
        tooltip.classList.remove('hidden');
        const rect = event.target.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        let left = rect.left;
        let top = rect.bottom + scrollTop + 5;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

         requestAnimationFrame(() => {
             const tooltipRect = tooltip.getBoundingClientRect();
             if (tooltipRect.right > window.innerWidth - 10) {
                 tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
             }
             if (left < 10) {
                 tooltip.style.left = '10px';
             }
         });
    },
    hideTranslationTooltip() {
        app.elements.translationTooltip.classList.add('hidden');
    },
    showWordContextMenu(event, word, options = {}) {
        event.preventDefault();
        const menu = app.elements.wordContextMenu;
        if (!menu) return;

        app.elements.searchAppContextBtn.style.display = options.hideAppSearch ? 'none' : 'block';

        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;

        menu.style.left = `0px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + menuRect.width > window.innerWidth - 10) {
                finalX = window.innerWidth - menuRect.width - 10;
            }
            if (y + menuRect.height > window.innerHeight - 10) {
                 finalY = window.innerHeight - menuRect.height - 10;
            }
             if (finalX < 10) finalX = 10;
             if (finalY < 10) finalY = 10;

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });

        const encodedWord = encodeURIComponent(word);

        app.elements.searchAppContextBtn.onclick = () => app.searchWordInLearningMode(word);
        
        app.elements.searchDaumContextBtn.onclick = () => { 
            window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dict_daum'); 
            this.hideWordContextMenu(); 
        };
        
        app.elements.searchNaverContextBtn.onclick = () => { 
            window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'dict_naver'); 
            this.hideWordContextMenu(); 
        };
        
        app.elements.searchEtymContextBtn.onclick = () => { 
            window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dict_etym'); 
            this.hideWordContextMenu(); 
        };
        
        app.elements.searchLongmanContextBtn.onclick = () => { 
            window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'dict_longman'); 
            this.hideWordContextMenu(); 
        };
    },
    hideWordContextMenu() {
        if (app.elements.wordContextMenu) {
             app.elements.wordContextMenu.classList.add('hidden');
        }
    }
};

const utils = {
    _getProgressRef() {
        if (!app.state.userId) return null;
        return doc(db, 'users', app.state.userId, 'progress', 'main');
    },
    addProgressUpdateToLocalSync(word, key, value) {
        try {
            const localKey = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) {
                unsynced[word] = {};
            }
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) {
            console.error("Error adding progress update to localStorage sync", e);
        }
    },
    levenshteinDistance(a = '', b = '') {
        const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i += 1) track[0][i] = i;
        for (let j = 0; j <= b.length; j += 1) track[j][0] = j;
        for (let j = 1; j <= b.length; j += 1) {
            for (let i = 1; i <= a.length; i += 1) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
            }
        }
        return track[b.length][a.length];
    },
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds < 60) return `0분`;
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        let result = '';
        if (d > 0) result += `${d}일 `;
        if (h > 0) result += `${h}시간 `;
        if (m > 0) result += `${m}분`;
        return result.trim() || '0분';
    },
    getWordStatus(word) {
        let localStatus = {};
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word]) {
                localStatus = unsynced[word];
            }
        } catch(e) { console.warn("Error reading local progress:", e); }

        const progress = { ...(app.state.currentProgress[word] || {}), ...localStatus };

        if (Object.keys(progress).length === 0) return 'unseen';

        const statuses = ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION'].map(type => progress[type] || 'unseen');
        if (statuses.includes('incorrect')) return 'review';
        if (statuses.every(s => s === 'correct')) return 'learned';
        if (statuses.some(s => s === 'correct')) return 'learning';
        return 'unseen';
    },
    isFavorite(word) {
        let isFav = app.state.currentProgress[word]?.favorite || false;
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word] && unsynced[word].favorite !== undefined) {
                isFav = unsynced[word].favorite;
            }
        } catch (e) { console.warn("Error reading local favorite status:", e); }
        return isFav;
    },
    getFavoriteWords() {
        let localUpdates = {};
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
        } catch (e) { console.warn("Error reading local favorites:", e); }

        const allProgress = app.state.currentProgress;
        const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);

        const favoriteWords = [];
        combinedKeys.forEach(word => {
            const serverState = allProgress[word] || {};
            const localState = localUpdates[word] || {};
            const combinedState = {
                 ...serverState,
                 favorite: localState.favorite !== undefined ? localState.favorite : serverState.favorite,
                 favoritedAt: localState.favoritedAt !== undefined ? localState.favoritedAt : serverState.favoritedAt
             };

            if (combinedState.favorite === true) {
                 favoriteWords.push({ word: word, time: combinedState.favoritedAt || 0 });
            }
        });

        return favoriteWords.sort((a, b) => b.time - a.time).map(item => item.word);
    }
};

const dashboard = {
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
            if (!this.elements.container.classList.contains('hidden')) {
                this.render();
            }
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
        if (!app.state.isWordListReady) {
            this.elements.content.innerHTML = `<div class="text-center p-10"><p class="text-gray-600">단어 목록을 먼저 불러와주세요.</p></div>`;
            return;
        }

        const wordList = app.state.wordList;
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
        const studyHistory = await api.getStudyHistory();
        const quizHistory = await api.getQuizHistory();
        const today = new Date();

        const labels = [];
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateString = d.toISOString().slice(0, 10);
            labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
            data.push(Math.round((studyHistory[dateString] || 0) / 60));
        }
        const studyTimeCtx = document.getElementById('study-time-chart')?.getContext('2d');
        if (studyTimeCtx) {
            this.state.studyTimeChart = new Chart(studyTimeCtx, {
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
            });
        }


        const totalQuizStats = {
            'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
            'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
            'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 },
        };

        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateString = d.toISOString().slice(0, 10);
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
            if (!ctx) return null;

            const correct = stats.correct || 0;
            const total = stats.total || 0;
            const incorrect = total - correct;
            const accuracy = total > 0 ? ((correct / total) * 100).toFixed(0) : 0;

            const labelEl = document.getElementById(labelId);
            if (labelEl) {
                labelEl.textContent = `${labelText} (${correct}/${total})`;
            }

            return new Chart(ctx, {
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
            });
        };
        this.state.quiz1Chart = createDoughnutChart('quiz1-chart', 'quiz1-label', '영한 뜻', totalQuizStats['MULTIPLE_CHOICE_MEANING']);
        this.state.quiz2Chart = createDoughnutChart('quiz2-chart', 'quiz2-label', '빈칸 추론', totalQuizStats['FILL_IN_THE_BLANK']);
        this.state.quiz3Chart = createDoughnutChart('quiz3-chart', 'quiz3-label', '영영 풀이', totalQuizStats['MULTIPLE_CHOICE_DEFINITION']);


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
                    const d = new Date(today);
                    d.setDate(d.getDate() - i);
                    const dateString = d.toISOString().slice(0, 10);
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
