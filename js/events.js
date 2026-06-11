// 앱 전역 커스텀 이벤트 디스패치를 한곳에 모은 헬퍼.
// 리스너 등록(addEventListener)은 main.js에 그대로 둔다 — 여기서는 발신만 담당.
export const emit = {
    toast(message, isError = false) {
        window.dispatchEvent(new CustomEvent('showToast', { detail: { message, isError } }));
    },
    navigate(mode, options = {}) {
        window.dispatchEvent(new CustomEvent('navigate', { detail: { mode, options } }));
    },
    imeWarning() {
        window.dispatchEvent(new CustomEvent('showImeWarning'));
    },
    sync() {
        window.dispatchEvent(new CustomEvent('syncRequest'));
    },
    searchWord(word) {
        document.dispatchEvent(new CustomEvent('searchWord', { detail: word }));
    },
};
