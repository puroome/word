// ============================================================
// Code.gs — Google Apps Script (전체 리팩토링 버전)
// 변경 이력:
//   GAS-BUG-1  : translateText → translate action 개명
//   GAS-BUG-2  : == → === 통일
//   GAS-BUG-3  : permissionColIndex 데드 코드 제거
//   GAS-BUG-4  : 열 인덱스 하드코딩 → 동적 탐색
//   GAS-BUG-5  : PUT → PATCH (AISample 등 Firebase 기존 필드 보존)
//   GAS-BUG-6  : 열 수 6 고정 → getLastColumn()
//   GAS-CODE-1 : updateFirebaseVersion HTTP 응답 코드 확인
//   GAS-FORMAT-1: 코드 포맷팅 정리
//   GAS-SEC-1  : PropertiesService 활용 + setup 함수 제공
//   GAS-CRITICAL-1: 누락된 7개 action 구현
//     (translate, update_word_data, create_word, delete_word,
//      save_ai_sample, generate_ai_examples, fetch_word_info_from_ai)
// ============================================================

// --- 설정 상수 ---
const VOCAB_SHEET_ID  = "1VupSf-nBz5EFf-HQqKuwEPOiMvMtb8P2qhBdJwMT98Y";
const ADMIN_SHEET_ID  = "1EfDuQj4apF4WT6kSbQnJE0QRgxjFT2CxDEtbQdyCJdQ";
const FIREBASE_RTDB_URL = "https://wordapp-91c0a-default-rtdb.asia-southeast1.firebasedatabase.app/";
const GRADE_SHEETS    = ["1y", "2y", "3y"];

// [GAS-SEC-1] 민감 정보는 Script Properties에서 읽고, 없으면 아래 기본값으로 폴백
// 배포 후 setupProperties()를 한 번 실행하여 PropertiesService에 저장하세요.
const FIREBASE_SECRET_FALLBACK = "yflesjEHGDcA4B7xClzOBjqOPFs2eY1tsFTU3RCe"; // ⚠️ 설정 완료 후 이 줄 제거 권장
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function getFirebaseSecret() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_SECRET') || FIREBASE_SECRET_FALLBACK;
}

function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("GEMINI_API_KEY가 Script Properties에 설정되지 않았습니다. setupProperties()를 먼저 실행하세요.");
  return key;
}

/** [GAS-SEC-1] 최초 1회 실행하여 민감 정보를 안전하게 저장하는 설정 함수 */
function setupProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'FIREBASE_SECRET': FIREBASE_SECRET_FALLBACK, // 실제 시크릿 키로 교체
    'GEMINI_API_KEY':  'YOUR_GEMINI_API_KEY_HERE' // Gemini API 키 입력 후 실행
  });
  SpreadsheetApp.getUi().alert('✅ Script Properties 설정 완료!\n이제 소스코드의 FIREBASE_SECRET_FALLBACK 줄을 삭제하세요.');
}


// ============================================================
// 공통 헬퍼
// ============================================================

/** JSON 성공 응답 생성 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/** JSON 오류 응답 생성 */
function createErrorResponse(message, statusCode) {
  return createJsonResponse({ success: false, message: message });
}

/**
 * 열 이름 배열에서 특정 헤더의 1-based 열 인덱스를 반환
 * 없으면 -1 반환
 */
function getColIndex(headers, name) {
  const idx = headers.indexOf(name.toUpperCase());
  return idx >= 0 ? idx + 1 : -1; // 1-based, 없으면 -1
}

/**
 * 모든 학년 시트를 순회하며 단어를 찾아 위치 정보 반환
 * @returns {{ sheet, rowIndex, headers, data, grade } | null}
 */
function findWordInSheets(targetWord) {
  if (!targetWord) return null;
  const vocabSS = SpreadsheetApp.openById(VOCAB_SHEET_ID);
  const normalizedTarget = targetWord.trim().toLowerCase();

  for (const grade of GRADE_SHEETS) {
    const sheet = vocabSS.getSheetByName(grade);
    if (!sheet) continue;

    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().trim().toUpperCase());
    const wordCol = headers.indexOf('WORD'); // 0-based

    if (wordCol < 0) continue;

    for (let i = 1; i < data.length; i++) {
      const cellWord = data[i][wordCol] ? data[i][wordCol].toString().trim() : '';
      if (cellWord.toLowerCase() === normalizedTarget) {
        return { sheet, rowIndex: i + 1, headers, data, grade }; // rowIndex: 1-based
      }
    }
  }
  return null;
}

/**
 * Firebase RTDB REST API 호출 (공통)
 * @param {string} path   - Firebase 경로 (선행 슬래시 제외)
 * @param {string} method - 'GET' | 'PUT' | 'PATCH' | 'DELETE'
 * @param {object} [payload] - PUT/PATCH 시 전송할 데이터
 */
function callFirebase(path, method, payload) {
  const secret = getFirebaseSecret();
  const url    = `${FIREBASE_RTDB_URL}${path}.json?auth=${secret}`;
  const options = { method: method, contentType: 'application/json', muteHttpExceptions: true };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(url, options);
  const code     = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Firebase 오류 ${code}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

/**
 * Gemini API 호출 공통 헬퍼
 * @param {string} prompt
 * @returns {string} 모델 응답 텍스트
 */
function callGemini(prompt) {
  const apiKey  = getGeminiApiKey();
  const url     = `${GEMINI_API_ENDPOINT}?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Gemini API 오류 ${code}: ${response.getContentText()}`);
  }
  const result = JSON.parse(response.getContentText());
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}


// ============================================================
// 라우팅
// ============================================================
function doGet(e) {
  const action = e.parameter.action || '';
  try {
    switch (action) {                                    // [GAS-BUG-2] == → ===
      case 'translate':             return handleTranslate(e);
      case 'requestPermission':     return handleRequestPermission(e);
      case 'getStudentAdminData':   return handleGetStudentAdminData(e);
      case 'update_word_data':      return handleUpdateWordData(e);
      case 'create_word':           return handleCreateWord(e);
      case 'delete_word':           return handleDeleteWord(e);
      case 'save_ai_sample':        return handleSaveAiSample(e);
      case 'generate_ai_examples':  return handleGenerateAiExamples(e);
      case 'fetch_word_info_from_ai': return handleFetchWordInfoFromAi(e);
      default:
        return createErrorResponse(`알 수 없는 action: "${action}"`);
    }
  } catch (err) {
    console.error(`[doGet] action="${action}" 처리 중 오류:`, err.toString());
    return createErrorResponse(err.toString());
  }
}


// ============================================================
// Action 핸들러
// ============================================================

/** [GAS-BUG-1] translate (translateText → translate로 통일) */
function handleTranslate(e) {
  const text   = e.parameter.text   || '';
  const target = e.parameter.target || 'ko';
  const source = e.parameter.source || 'en';
  if (!text.trim()) return createErrorResponse('번역할 텍스트가 없습니다.');

  const translated = LanguageApp.translate(text, source, target);
  return createJsonResponse({ success: true, translated });
}

/** requestPermission */
function handleRequestPermission(e) {
  const email  = e.parameter.email  || '';
  const name   = e.parameter.name   || '';
  const reason = e.parameter.reason || '';

  if (!email) return createErrorResponse('이메일이 필요합니다.');

  const adminSS    = SpreadsheetApp.openById(ADMIN_SHEET_ID);
  const reqSheet   = adminSS.getSheetByName('permission_requests')
                     || adminSS.insertSheet('permission_requests');
  const timestamp  = new Date().toISOString();
  reqSheet.appendRow([timestamp, email, name, reason, 'PENDING']);
  return createJsonResponse({ success: true, message: '신청이 접수되었습니다.' });
}

/** getStudentAdminData — [GAS-BUG-3] permissionColIndex 제거, [GAS-BUG-4] 헤더 동적 탐색 */
function handleGetStudentAdminData(e) {
  const adminSS  = SpreadsheetApp.openById(ADMIN_SHEET_ID);
  const sheet    = adminSS.getSheetByName('students');
  if (!sheet) return createErrorResponse("'students' 시트를 찾을 수 없습니다.");

  // [GAS-BUG-4] 헤더를 동적으로 읽어 열 인덱스 결정
  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim().toUpperCase());
  const emailIdx  = headers.indexOf('EMAIL');
  const nameIdx   = headers.indexOf('NAME');
  const statusIdx = headers.indexOf('STATUS');

  if (emailIdx < 0 || nameIdx < 0 || statusIdx < 0) {
    return createErrorResponse('students 시트에 EMAIL/NAME/STATUS 열이 필요합니다.');
  }

  const students = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[emailIdx]) continue;
    students.push({
      email:  row[emailIdx].toString().trim(),
      name:   row[nameIdx].toString().trim(),
      status: row[statusIdx].toString().trim()
    });
  }
  return createJsonResponse({ success: true, students });
}

/** update_word_data — 스프레드시트에서 단어 정보 업데이트 */
function handleUpdateWordData(e) {
  const originalWord = e.parameter.original_word;
  if (!originalWord) return createErrorResponse('original_word 파라미터가 필요합니다.');

  const found = findWordInSheets(originalWord);
  if (!found) return createErrorResponse(`'${originalWord}' 단어를 시트에서 찾을 수 없습니다.`);

  const { sheet, rowIndex, headers } = found;
  // 파라미터 키 → 시트 헤더 매핑
  const fieldMap = {
    word:          'WORD',
    pos:           'POS',
    meaning:       'MEANING',
    explanation:   'EXPLANATION',
    manual_sample: 'SAMPLE'
  };

  let updated = false;
  for (const [paramKey, headerName] of Object.entries(fieldMap)) {
    if (e.parameter[paramKey] !== undefined) {
      const colIdx = getColIndex(headers, headerName);
      if (colIdx > 0) {
        sheet.getRange(rowIndex, colIdx).setValue(e.parameter[paramKey]);
        updated = true;
      }
    }
  }
  if (!updated) return createErrorResponse('업데이트할 필드가 없습니다.');

  // Firebase에도 PATCH (AISample 등 기존 필드 보존) — [GAS-BUG-5]
  try {
    const safeKey       = originalWord.replace(/[.#$[\]/]/g, '_');
    const firebaseData  = {};
    for (const [paramKey, headerName] of Object.entries(fieldMap)) {
      if (e.parameter[paramKey] !== undefined) {
        const fbKey = paramKey === 'manual_sample' ? 'sample' : paramKey;
        firebaseData[fbKey] = e.parameter[paramKey];
      }
    }
    if (e.parameter.word && e.parameter.word !== originalWord) {
      // 단어키 자체가 바뀐 경우: 기존 노드 삭제 후 새 키로 생성
      const existing = callFirebase(`vocabulary/${safeKey}`, 'GET');
      const newKey   = e.parameter.word.replace(/[.#$[\]/]/g, '_');
      const newData  = { ...(existing || {}), ...firebaseData };
      callFirebase(`vocabulary/${newKey}`, 'PUT', newData);
      callFirebase(`vocabulary/${safeKey}`, 'DELETE');
    } else {
      callFirebase(`vocabulary/${safeKey}`, 'PATCH', firebaseData);
    }
  } catch (err) {
    console.warn('Firebase 업데이트 실패 (시트 업데이트는 완료):', err.toString());
  }

  return createJsonResponse({ success: true });
}

/** create_word — 스프레드시트에 새 단어 행 추가 */
function handleCreateWord(e) {
  const word         = e.parameter.word;
  const pos          = e.parameter.pos          || '';
  const meaning      = e.parameter.meaning      || '';
  const explanation  = e.parameter.explanation  || '';
  const manualSample = e.parameter.manual_sample || '';
  const afterWord    = e.parameter.after_word    || null;

  if (!word) return createErrorResponse('word 파라미터가 필요합니다.');

  // 삽입 위치 결정: afterWord가 있으면 그 다음 행, 없으면 마지막
  let targetGrade = GRADE_SHEETS[0];
  let insertRow   = null;

  if (afterWord) {
    const found = findWordInSheets(afterWord);
    if (found) {
      targetGrade = found.grade;
      insertRow   = found.rowIndex + 1;
    }
  }

  const vocabSS = SpreadsheetApp.openById(VOCAB_SHEET_ID);
  const sheet   = vocabSS.getSheetByName(targetGrade);
  if (!sheet) return createErrorResponse(`'${targetGrade}' 시트를 찾을 수 없습니다.`);

  const headers    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toUpperCase());
  const idxMap     = {};
  headers.forEach((h, i) => { idxMap[h] = i; });

  // 새 행 데이터 구성
  const newRow = new Array(headers.length).fill('');
  if (idxMap['WORD']        !== undefined) newRow[idxMap['WORD']]        = word;
  if (idxMap['POS']         !== undefined) newRow[idxMap['POS']]         = pos;
  if (idxMap['MEANING']     !== undefined) newRow[idxMap['MEANING']]     = meaning;
  if (idxMap['EXPLANATION'] !== undefined) newRow[idxMap['EXPLANATION']] = explanation;
  if (idxMap['SAMPLE']      !== undefined) newRow[idxMap['SAMPLE']]      = manualSample;
  if (idxMap['INDEX']       !== undefined) newRow[idxMap['INDEX']]       = sheet.getLastRow(); // 임시 인덱스

  if (insertRow && insertRow <= sheet.getLastRow()) {
    sheet.insertRowBefore(insertRow);
    sheet.getRange(insertRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }

  // Firebase에도 PATCH — [GAS-BUG-5]
  try {
    const safeKey = word.replace(/[.#$[\]/]/g, '_');
    callFirebase(`vocabulary/${safeKey}`, 'PATCH', {
      word, pos, meaning, explanation, sample: manualSample, AISample: null
    });
  } catch (err) {
    console.warn('Firebase 생성 실패:', err.toString());
  }

  return createJsonResponse({ success: true });
}

/** delete_word — 스프레드시트에서 단어 행 삭제 */
function handleDeleteWord(e) {
  const word = e.parameter.word;
  if (!word) return createErrorResponse('word 파라미터가 필요합니다.');

  const found = findWordInSheets(word);
  if (!found) return createErrorResponse(`'${word}' 단어를 시트에서 찾을 수 없습니다.`);

  found.sheet.deleteRow(found.rowIndex);

  // Firebase에서도 삭제 — [GAS-BUG-5]
  try {
    const safeKey = word.replace(/[.#$[\]/]/g, '_');
    callFirebase(`vocabulary/${safeKey}`, 'DELETE');
  } catch (err) {
    console.warn('Firebase 삭제 실패:', err.toString());
  }

  return createJsonResponse({ success: true });
}

/** save_ai_sample — AI 예문을 스프레드시트 AISample 열에 저장 */
function handleSaveAiSample(e) {
  const word    = e.parameter.word;
  const aiText  = e.parameter.ai_text;
  if (!word || aiText === undefined) return createErrorResponse('word, ai_text 파라미터가 필요합니다.');

  const found = findWordInSheets(word);
  if (!found) return createErrorResponse(`'${word}' 단어를 시트에서 찾을 수 없습니다.`);

  const { sheet, rowIndex, headers } = found;
  // AISample 열 탐색, 없으면 새 열 생성
  let aiColIdx = getColIndex(headers, 'AISAMPLE');
  if (aiColIdx < 0) {
    aiColIdx = sheet.getLastColumn() + 1;
    sheet.getRange(1, aiColIdx).setValue('AISample');
  }
  sheet.getRange(rowIndex, aiColIdx).setValue(aiText);

  // Firebase PATCH — [GAS-BUG-5]
  try {
    const safeKey   = word.replace(/[.#$[\]/]/g, '_');
    const aiSample  = { en: aiText, ko: '' };
    callFirebase(`vocabulary/${safeKey}/AISample`, 'PUT', aiSample);
  } catch (err) {
    console.warn('Firebase AISample 저장 실패:', err.toString());
  }

  return createJsonResponse({ success: true });
}

/** generate_ai_examples — Gemini를 통해 영어 예문 생성 */
function handleGenerateAiExamples(e) {
  const word  = e.parameter.word;
  const count = parseInt(e.parameter.count || '5');
  if (!word) return createErrorResponse('word 파라미터가 필요합니다.');

  const prompt = `Generate ${count} natural English example sentences for the word "${word}".
Requirements:
- Each sentence should use "${word}" naturally
- Wrap "${word}" with asterisks like *${word}*
- Output ONLY the sentences, one per line, no numbering or extra text`;

  const rawText  = callGemini(prompt);
  const sentences = rawText.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, count);

  return createJsonResponse({ success: true, results: sentences });
}

/** fetch_word_info_from_ai — Gemini를 통해 단어 정보(뜻/설명/예문) 조회 */
function handleFetchWordInfoFromAi(e) {
  const word = e.parameter.word;
  if (!word) return createErrorResponse('word 파라미터가 필요합니다.');

  const prompt = `For the English word "${word}", provide:
1. Korean meaning (short, 2-4 words)
2. Brief English explanation (1-2 sentences)
3. Two natural example sentences using "${word}" (wrap with asterisks like *${word}*)

Respond ONLY in this exact JSON format (no markdown):
{
  "meaning": "한국어 뜻",
  "explanation": "English explanation here.",
  "samples": ["First example sentence with *${word}*.", "Second example sentence with *${word}*."]
}`;

  const rawText = callGemini(prompt);

  // JSON 파싱 시도
  let parsed;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON을 찾을 수 없습니다.');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return createErrorResponse(`AI 응답 파싱 실패: ${err.toString()}`);
  }

  return createJsonResponse({ success: true, result: parsed });
}


// ============================================================
// 스프레드시트 → Firebase 동기화
// ============================================================

/** 관리자가 수동으로 실행하는 전체 동기화 함수 */
function syncAllGrades() {
  for (const grade of GRADE_SHEETS) {
    try {
      processSyncForSheet(grade);
      console.log(`✅ ${grade} 동기화 완료`);
    } catch (err) {
      console.error(`❌ ${grade} 동기화 실패:`, err.toString());
    }
  }
}

/**
 * 특정 학년 시트 데이터를 Firebase에 동기화
 * [GAS-BUG-5] PATCH 사용: 기존 AISample 등 Firebase 전용 필드 보존
 * [GAS-BUG-6] getLastColumn() 사용: 열 수 하드코딩 제거
 */
function processSyncForSheet(grade) {
  const vocabSS = SpreadsheetApp.openById(VOCAB_SHEET_ID);
  const sheet   = vocabSS.getSheetByName(grade);
  if (!sheet) { console.warn(`시트 없음: ${grade}`); return; }

  // [GAS-BUG-6] getLastColumn()으로 실제 사용 중인 열 수 동적 파악
  const lastCol   = sheet.getLastColumn();
  const lastRow   = sheet.getLastRow();
  if (lastRow < 2) { console.warn(`${grade} 시트가 비어있음`); return; }

  const allData   = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers   = allData[0].map(h => h.toString().trim().toUpperCase());

  const wordCol   = headers.indexOf('WORD');
  const posCol    = headers.indexOf('POS');
  const meaningCol      = headers.indexOf('MEANING');
  const explanationCol  = headers.indexOf('EXPLANATION');
  const sampleCol       = headers.indexOf('SAMPLE');
  const indexCol        = headers.indexOf('INDEX');

  if (wordCol < 0 || meaningCol < 0) {
    throw new Error(`${grade} 시트에 WORD/MEANING 헤더가 없습니다.`);
  }

  // 단어별로 PATCH (기존 데이터와 병합, AISample 보존)
  for (let i = 1; i < allData.length; i++) {
    const row  = allData[i];
    const word = row[wordCol] ? row[wordCol].toString().trim() : '';
    if (!word) continue;

    const safeKey = word.replace(/[.#$[\]/]/g, '_');
    const wordData = {
      word:        word,
      pos:         posCol        >= 0 ? (row[posCol]        || '') : '',
      meaning:     meaningCol    >= 0 ? (row[meaningCol]    || '') : '',
      explanation: explanationCol >= 0 ? (row[explanationCol] || '') : '',
      sample:      sampleCol     >= 0 ? (row[sampleCol]     || '') : '',
      index:       indexCol      >= 0 ? (row[indexCol]      || i)  : i,
    };

    // [GAS-BUG-5] PATCH: AISample, favorite 등 Firebase 전용 필드 유지
    callFirebase(`${grade}/vocabulary/${safeKey}`, 'PATCH', wordData);
  }

  // 버전 타임스탬프 업데이트
  updateFirebaseVersion(grade);
}

/** Firebase에 마지막 업데이트 타임스탬프 기록 */
function updateFirebaseVersion(grade) {
  // [GAS-CODE-1] callFirebase 내부에서 응답 코드 이미 확인하므로 오류 발생 시 예외 throw
  callFirebase(`${grade}/meta/lastUpdated`, 'PUT', new Date().toISOString());
}