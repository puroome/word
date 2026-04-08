/**
 * @OnlyCurrentDoc
 *
 * Code.gs — 단어 앱 Google Apps Script 백엔드 (최적화 버전)
 *
 * 최적화 내역:
 *   SEC-1   : GEMINI_API_KEY 하드코딩 → PropertiesService 이관
 *   SEC-2   : setupProperties() 유틸리티 함수 추가
 *   OPT-1   : callGeminiApi() 공통 헬퍼로 Gemini 호출 2곳 중복 제거
 *   OPT-2   : callFirebaseRtdb() 공통 헬퍼로 Firebase 직접 호출 5곳 중복 제거
 *   OPT-3   : getSheet() 공통 헬퍼로 시트 접근 3곳 중복 제거
 *   OPT-4   : buildHeaderMap() 공통 헬퍼로 헤더 파싱 4곳 중복 제거
 *   OPT-5   : parseGeminiJson() 공통 헬퍼로 JSON 파싱 2곳 중복 제거
 *   OPT-6   : getWordsForSync()에서 map+filter 단일 순회로 통합
 *   BUG-1   : createWordInSheet() — insertRowAfter/Before 혼용 → insertRowAfter로 통일
 *   BUG-2   : updateWordDataInSheet() — Firebase PATCH 누락 → updateFieldsInFirebase 활용
 *   BUG-3   : performFullSyncInternal() — PUT 후 response 코드 미확인 → callFirebaseRtdb 적용
 *   FORMAT-1: 변수 선언 const/let 일관화, 불필요한 중간 변수 제거
 */

// ================================================================
// 0. 설정값 & 보안
// ================================================================

// [SEC-1] 민감키는 PropertiesService에만 저장.
//   FIREBASE_URL, FIREBASE_SECRET, GEMINI_API_KEY 3가지를 저장해야 합니다.
// [SEC-2] 아래 setupProperties()에 실제 값을 채워 1회 실행 후 이 주석 구간을 삭제하세요.

const GEMINI_MODEL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const WORDS_SHEET_NAME = 'Words';

/** Script Properties에서 Firebase 접속 정보를 가져오는 헬퍼 */
function getFirebaseConfig() {
  const props = PropertiesService.getScriptProperties();
  const url    = props.getProperty('FIREBASE_URL');
  const secret = props.getProperty('FIREBASE_SECRET');
  if (!url || !secret) throw new Error("FIREBASE_URL / FIREBASE_SECRET 이 설정되지 않았습니다. setupProperties()를 실행하세요.");
  return { url, secret };
}

/** Script Properties에서 Gemini API 키를 가져오는 헬퍼 */
function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다. setupProperties()를 실행하세요.");
  return key;
}

/**
 * [SEC-2] 최초 1회 실행하여 민감 정보를 PropertiesService에 저장.
 * 값을 입력한 뒤 GAS 편집기에서 직접 실행하세요.
 */
function setupProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'FIREBASE_URL'    : 'YOUR_FIREBASE_RTDB_URL_HERE',   // e.g. https://xxx.firebasedatabase.app
    'FIREBASE_SECRET' : 'YOUR_FIREBASE_SECRET_HERE',
    'GEMINI_API_KEY'  : 'YOUR_GEMINI_API_KEY_HERE',
  });
  SpreadsheetApp.getUi().alert('✅ Script Properties 설정 완료!');
}


// ================================================================
// 1. 라우팅 (doGet)
// ================================================================

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;

    switch (action) {
      case 'translate':             result = handleTranslate(e);           break;
      case 'generate_ai_examples':  result = handleGenerateAiExamples(e);  break;
      case 'fetch_word_info_from_ai': result = handleFetchWordInfoFromAi(e); break;
      case 'save_ai_sample':        result = handleSaveAiSample(e);        break;
      case 'update_word_data':      result = handleUpdateWordData(e);      break;
      case 'create_word':           result = handleCreateWord(e);          break;
      case 'delete_word':           result = handleDeleteWord(e);          break;
      default:
        throw new Error(`지원하지 않는 action: "${action}"`);
    }

    return jsonResponse(result);
  } catch (err) {
    console.error('[doGet] 오류:', err.message);
    return jsonResponse({ success: false, message: err.message });
  }
}

/** JSON ContentService 응답 생성 (공통) */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ================================================================
// 2. 공통 헬퍼
// ================================================================

/**
 * [OPT-3] 시트 접근 공통 헬퍼
 * @param {string} [sheetName]
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(sheetName = WORDS_SHEET_NAME) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error(`'${sheetName}' 시트를 찾을 수 없습니다.`);
  return sheet;
}

/**
 * [OPT-4] 헤더 행을 소문자+공백제거 key → 0-based index 맵으로 변환
 * @param {any[]} headerRow - getValues()[0] 결과
 * @returns {Object.<string, number>}
 */
function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    if (h) map[h.toString().trim().toLowerCase().replace(/\s/g, '')] = i;
  });
  return map;
}

/**
 * TextFinder를 이용해 단어 행 인덱스(1-based)를 검색
 * @returns {number} 1-based row index, 못 찾으면 -1
 */
function findRowByWord(sheet, wordColIndex, wordToFind) {
  if (!wordToFind) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const found = sheet
    .getRange(2, wordColIndex + 1, lastRow - 1, 1)
    .createTextFinder(wordToFind)
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : -1;
}

/**
 * [OPT-1] Gemini API 공통 호출 헬퍼
 * @param {string} prompt
 * @returns {string} 모델 응답 텍스트
 */
function callGeminiApi(prompt) {
  const apiKey = getGeminiApiKey();
  const response = UrlFetchApp.fetch(`${GEMINI_MODEL_URL}?key=${apiKey}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Gemini API 오류 ${response.getResponseCode()}: ${response.getContentText()}`);
  }
  return JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * [OPT-5] Gemini 응답 텍스트에서 JSON 파싱 (마크다운 코드블록 제거 포함)
 * @param {string} rawText
 * @returns {any}
 */
function parseGeminiJson(rawText) {
  const cleaned = rawText.replace(/```json\s*|```/g, '').trim();
  // { } 블록 추출 후 파싱
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  return JSON.parse(match[0]);
}

/**
 * [OPT-2] Firebase RTDB REST API 공통 호출 헬퍼
 * @param {string} path   - vocabulary/abc 형태 (선행 슬래시 없음)
 * @param {string} method - 'GET' | 'PUT' | 'PATCH' | 'DELETE'
 * @param {any}   [payload]
 * @returns {any} 파싱된 JSON 또는 null
 */
function callFirebaseRtdb(path, method, payload) {
  const { url, secret } = getFirebaseConfig();
  const options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(`${url}/${path}.json?auth=${secret}`, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Firebase 오류 ${code}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

/** Firebase 안전 키 변환 (., #, $, [, ], / → _) */
function toFirebaseKey(word) {
  return word.replace(/[.#$[\]/]/g, '_');
}

/** 단어 데이터를 Firebase의 해당 노드에 PATCH (기존 필드 보존) */
function patchWordInFirebase(word, fields) {
  try {
    callFirebaseRtdb(`vocabulary/${toFirebaseKey(word)}`, 'PATCH', fields);
  } catch (e) {
    console.warn(`Firebase PATCH 실패 (${word}):`, e.message);
  }
}

/** Firebase에서 단어 노드 삭제 */
function deleteWordFromFirebase(word) {
  try {
    callFirebaseRtdb(`vocabulary/${toFirebaseKey(word)}`, 'DELETE');
  } catch (e) {
    console.warn(`Firebase DELETE 실패 (${word}):`, e.message);
  }
}


// ================================================================
// 3. 번역
// ================================================================

function handleTranslate(e) {
  const text = e.parameter.text;
  if (!text) throw new Error('번역할 텍스트가 없습니다.');
  const translatedText = LanguageApp.translate(text, 'en', 'ko');
  return { success: true, translatedText };
}


// ================================================================
// 4. AI (Gemini) 기능
// ================================================================

/** [OPT-1 적용] generate_ai_examples */
function handleGenerateAiExamples(e) {
  const word  = e.parameter.word;
  const count = parseInt(e.parameter.count || '2', 10);
  if (!word) throw new Error('단어가 없습니다.');

  const prompt = `Word: "${word}"
Task: Write ${count} simple sentences suitable for high school students using this word.
Format: Return ONLY a JSON array of strings. Example: ["Sentence 1.", "Sentence 2."]
No markdown, no explanations.`;

  const results = parseGeminiJson(callGeminiApi(prompt));
  return { success: true, results: Array.isArray(results) ? results : [results] };
}

/** [OPT-1, OPT-5 적용] fetch_word_info_from_ai */
function handleFetchWordInfoFromAi(e) {
  const word = e.parameter.word;
  if (!word) throw new Error('단어가 없습니다.');

  const prompt = `Act as a linguistics expert for US high school students.
Analyze the English word: "${word}"

Output pure JSON with three fields:

1. "meaning":
   - Return an ARRAY of strings.
   - FORMATTING RULES:
     1. If there are multiple meanings, number them clearly (e.g., "1. ...", "2. ...").
     2. DO NOT use part-of-speech tags like (vt), (vi), (n), (adj).
     3. Instead, use the Korean particle to imply the verb type:
        * Transitive (Vt): MUST start with "~(Object)Particle" (e.g., "1. ~을 관찰하다").
        * Intransitive (Vi): Do not use a particle (e.g., "1. 살아남다").
        * If a word is both Vi and Vt, list BOTH separately.
     4. Mark (slang) or (informal) if applicable.

2. "explanation":
   - Generate structured text with KOREAN headers: [동의어], [반의어], [파생어], [용례], [심화].
   - FORMAT RULES:
     Rule 1 [동의어/반의어]: Group by specific meanings.
             Format: "word1, word2, ... : [Korean Definition]" (Max 7 words per group)
     Rule 2 [용례]: Collocations or Idioms. Format: "Expression : Korean Meaning".
     Rule 3 [심화]: High-frequency words sharing the SAME ETYMOLOGICAL ROOT.
             Format: "Word : Korean Meaning". Example: "preserve : ~을 보존하다"
     Rule 4: Insert an empty line between categories. Omit empty categories.

3. "samples": An array of English example sentences.
   - QUANTITY LOGIC:
     Case A: Single meaning -> 1 sentence.
     Case B: Distinct meanings -> 1 sentence per meaning (Max 5).
   - No translations.

Do not include Markdown code blocks. Just the JSON string.`;

  const result = parseGeminiJson(callGeminiApi(prompt));
  return { success: true, result };
}


// ================================================================
// 5. 시트 + Firebase 단어 조작
// ================================================================

/** save_ai_sample */
function handleSaveAiSample(e) {
  const word    = e.parameter.word;
  const aiText  = e.parameter.ai_text;
  if (!word || aiText === undefined) throw new Error('word, ai_text 파라미터가 필요합니다.');

  const sheet   = getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap  = buildHeaderMap(headers);

  if (colMap['word'] === undefined || colMap['aisample'] === undefined) {
    throw new Error('Word 또는 AISample 헤더를 찾을 수 없습니다.');
  }

  const rowIdx = findRowByWord(sheet, colMap['word'], word);
  if (rowIdx === -1) throw new Error(`시트에서 단어 '${word}'를 찾을 수 없습니다.`);

  sheet.getRange(rowIdx, colMap['aisample'] + 1).setValue(aiText);

  // Firebase: AISample 노드만 PUT (기존 필드 보존)
  patchWordInFirebase(word, { AISample: aiText ? { en: aiText, ko: '' } : null });

  return { success: true, message: '저장 및 동기화 완료' };
}

/** update_word_data */
function handleUpdateWordData(e) {
  const originalWord = e.parameter.original_word;
  if (!originalWord) throw new Error('original_word 파라미터가 필요합니다.');

  const sheet   = getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap  = buildHeaderMap(headers);

  const rowIdx = findRowByWord(sheet, colMap['word'], originalWord);
  if (rowIdx === -1) throw new Error(`시트에서 단어 '${originalWord}'를 찾을 수 없습니다.`);

  // 파라미터 key → 시트 헤더 key 매핑 (소문자+공백제거 기준)
  const fieldMap = {
    word:          'word',
    pos:           'pos',
    meaning:       'meaning',
    explanation:   'explanation',
    manual_sample: 'manualsample',
  };

  const firebaseUpdates = {};
  for (const [paramKey, colKey] of Object.entries(fieldMap)) {
    const value = e.parameter[paramKey];
    if (value === undefined || colMap[colKey] === undefined) continue;
    // Rich Text를 지원하는 필드는 setHtmlToCell, 나머지는 setValue
    const cell = sheet.getRange(rowIdx, colMap[colKey] + 1);
    if (['word', 'meaning', 'explanation'].includes(paramKey)) {
      setHtmlToCell(cell, value);
    } else {
      cell.setValue(value);
    }
    // Firebase 업데이트 데이터 구성 (manual_sample → sample)
    firebaseUpdates[paramKey === 'manual_sample' ? 'sample' : paramKey] = value;
  }

  // [BUG-2] Firebase 업데이트 — 단어 키 변경 시 이전 노드 삭제 후 새 키로 이전
  if (Object.keys(firebaseUpdates).length > 0) {
    const newWord = e.parameter.word;
    if (newWord && newWord !== originalWord) {
      // 기존 노드 내용 읽어와 새 키로 이전
      const existing = callFirebaseRtdb(`vocabulary/${toFirebaseKey(originalWord)}`, 'GET') || {};
      callFirebaseRtdb(`vocabulary/${toFirebaseKey(newWord)}`, 'PUT', { ...existing, ...firebaseUpdates });
      deleteWordFromFirebase(originalWord);
    } else {
      patchWordInFirebase(originalWord, firebaseUpdates);
    }
  }

  return { success: true, message: '단어 수정 및 동기화 완료' };
}

/** create_word — [BUG-1] insertRowAfter로 통일 */
function handleCreateWord(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    throw new Error('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
  }

  try {
    const word         = e.parameter.word;
    const afterWord    = e.parameter.after_word || '';
    const pos          = e.parameter.pos          || '';
    const meaning      = e.parameter.meaning      || '';
    const explanation  = e.parameter.explanation  || '';
    const manualSample = e.parameter.manual_sample || '';

    if (!word) throw new Error('단어가 누락되었습니다.');

    const sheet   = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap  = buildHeaderMap(headers);

    const newRow = new Array(headers.length).fill('');
    if (colMap['word']         !== undefined) newRow[colMap['word']]         = word;
    if (colMap['pos']          !== undefined) newRow[colMap['pos']]          = pos;
    if (colMap['meaning']      !== undefined) newRow[colMap['meaning']]      = meaning;
    if (colMap['explanation']  !== undefined) newRow[colMap['explanation']]  = explanation;
    if (colMap['manualsample'] !== undefined) newRow[colMap['manualsample']] = manualSample;

    // [BUG-1] insertRowAfter를 일관되게 사용 (원래 코드는 After/Before 혼용이었음)
    if (afterWord) {
      const afterRowIdx = findRowByWord(sheet, colMap['word'], afterWord);
      if (afterRowIdx !== -1) {
        sheet.insertRowAfter(afterRowIdx);
        sheet.getRange(afterRowIdx + 1, 1, 1, newRow.length).setValues([newRow]);
      } else {
        sheet.appendRow(newRow);
      }
    } else {
      sheet.appendRow(newRow);
    }

    SpreadsheetApp.flush();

    // 전체 동기화 (인덱스 재계산 포함)
    performFullSync(sheet);

    return { success: true, message: '생성 및 전체 동기화 완료' };
  } finally {
    lock.releaseLock();
  }
}

/** delete_word */
function handleDeleteWord(e) {
  const word = e.parameter.word;
  if (!word) throw new Error('삭제할 단어가 없습니다.');

  const sheet   = getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap  = buildHeaderMap(headers);

  const rowIdx = findRowByWord(sheet, colMap['word'], word);
  if (rowIdx === -1) throw new Error(`시트에서 단어 '${word}'를 찾을 수 없습니다.`);

  sheet.deleteRow(rowIdx);
  SpreadsheetApp.flush();

  // 전체 동기화 (인덱스 재계산 포함)
  performFullSync(sheet);

  return { success: true, message: '삭제 및 전체 동기화 완료' };
}


// ================================================================
// 6. Firebase 전체 동기화
// ================================================================

/**
 * [BUG-3, OPT-2 적용] 시트 전체 데이터를 Firebase vocabulary 노드에 PUT으로 동기화.
 * 삽입/삭제 후 인덱스 재계산이 필요한 경우에 사용.
 */
function performFullSync(sheet) {
  if (!sheet) sheet = getSheet();
  const { words, error, message } = readWordsFromSheet(sheet);
  if (error) throw new Error(message);

  const dataToSync = {};
  words.forEach((wordObj, idx) => {
    if (!wordObj.word) return;
    wordObj.index = idx;
    dataToSync[toFirebaseKey(wordObj.word)] = wordObj;
  });

  // [BUG-3] callFirebaseRtdb 활용으로 응답 코드 자동 검증
  callFirebaseRtdb('vocabulary', 'PUT', dataToSync);
}

/** 스프레드시트 메뉴에서 수동 실행 */
function syncSheetDataToFirebase() {
  try {
    performFullSync(getSheet());
    SpreadsheetApp.getUi().alert('동기화 완료!');
  } catch (e) {
    SpreadsheetApp.getUi().alert(`오류: ${e.message}`);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔥 Firebase 동기화')
    .addItem('지금 동기화하기', 'syncSheetDataToFirebase')
    .addToUi();
}


// ================================================================
// 7. 시트 데이터 읽기 (Rich Text → HTML)
// ================================================================

/**
 * [OPT-6] 시트에서 단어 데이터를 읽어 객체 배열 반환.
 * map + filter 를 단일 순회(forEach + push)로 통합하여 중간 배열 생성 최소화.
 * @returns {{ words: Object[], error?: boolean, message?: string }}
 */
function readWordsFromSheet(sheet) {
  try {
    if (!sheet) sheet = getSheet();
    const range    = sheet.getDataRange();
    const values   = range.getValues();
    const richData = range.getRichTextValues();

    const headerRow = values.shift();
    richData.shift();

    const colMap = buildHeaderMap(headerRow);
    const { word: wc, pos: pc, meaning: mc, manualsample: msc, aisample: asc, explanation: ec } = colMap;

    if ([wc, pc, mc].some(c => c === undefined)) {
      throw new Error('필수 헤더(Word, Pos, Meaning)가 없습니다.');
    }

    // [OPT-6] 단일 순회
    const words = [];
    values.forEach((row, idx) => {
      const rich    = richData[idx];
      const wordHtml = convertRichTextToHtml(rich[wc]);
      if (!wordHtml || !wordHtml.trim()) return; // 빈 행 건너뜀

      const manualSample = String(row[msc] || '');
      const aiSampleText = String(row[asc] || '');

      words.push({
        index:       idx,
        word:        wordHtml,
        pos:         String(row[pc]  || ''),
        meaning:     convertRichTextToHtml(rich[mc]),
        explanation: ec !== undefined ? convertRichTextToHtml(rich[ec]) : '',
        sample:      manualSample,
        AISample:    aiSampleText ? { en: aiSampleText, ko: '' } : null,
      });
    });

    return { words };
  } catch (e) {
    console.error('readWordsFromSheet 오류:', e.message);
    return { error: true, message: e.message };
  }
}


// ================================================================
// 8. Rich Text ↔ HTML 변환
// ================================================================

/**
 * GAS RichTextValue → HTML 문자열 변환
 * 지원: <b>, <i>, <u>, <span style="color:...">
 */
function convertRichTextToHtml(richTextValue) {
  if (!richTextValue) return '';
  let html = '';
  richTextValue.getRuns().forEach(run => {
    const style  = run.getTextStyle();
    let text = run.getText()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (style.isBold())      text = `<b>${text}</b>`;
    if (style.isItalic())    text = `<i>${text}</i>`;
    if (style.isUnderline()) text = `<u>${text}</u>`;

    const color = style.getForegroundColor();
    if (color && color !== '#000000') text = `<span style="color:${color}">${text}</span>`;

    html += text;
  });
  return html;
}

/**
 * HTML 문자열 → GAS RichTextValue 변환하여 셀에 설정
 * 지원: <b>, <i>, <u>, <span style="color:...">, <font color="...">,
 *       <br>, </div>, </p> (줄바꿈), HTML 엔티티
 */
function setHtmlToCell(cell, html) {
  if (!html) { cell.setValue(''); return; }

  // 줄바꿈 태그 → \n
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n');

  // 순수 텍스트 추출
  const rawText = withNewlines
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n'); // 연속 빈 줄 최대 2줄로 제한

  const builder = SpreadsheetApp.newRichTextValue().setText(rawText);

  // 공통 스타일 적용 헬퍼
  const applyStyle = (regex, styleFn) => {
    let m;
    while ((m = regex.exec(html)) !== null) {
      const innerText  = m[1] || m[2];
      const start = html.substring(0, m.index).replace(/<[^>]+>/g, '').length;
      const end   = start + innerText.replace(/<[^>]+>/g, '').length;
      if (end > start) {
        try { builder.setTextStyle(start, end, styleFn()); } catch (_) {}
      }
    }
  };

  applyStyle(/<b>(.*?)<\/b>/gi,    () => SpreadsheetApp.newTextStyle().setBold(true).build());
  applyStyle(/<i>(.*?)<\/i>/gi,    () => SpreadsheetApp.newTextStyle().setItalic(true).build());
  applyStyle(/<u>(.*?)<\/u>/gi,    () => SpreadsheetApp.newTextStyle().setUnderline(true).build());

  // 색상 태그: <span style="color:..."> 및 <font color="...">
  const colorRegexes = [
    /<span[^>]*style="[^"]*color:\s*([^";]+)[^"]*"[^>]*>(.*?)<\/span>/gi,
    /<font[^>]*color=['"]?([^'">\s]+)['"]?[^>]*>(.*?)<\/font>/gi,
  ];
  colorRegexes.forEach(regex => {
    let m;
    while ((m = regex.exec(html)) !== null) {
      const color     = m[1].trim();
      const innerText = m[2];
      const start = html.substring(0, m.index).replace(/<[^>]+>/g, '').length;
      const end   = start + innerText.replace(/<[^>]+>/g, '').length;
      if (end > start) {
        try { builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setForegroundColor(color).build()); } catch (_) {}
      }
    }
  });

  cell.setRichTextValue(builder.build());
}