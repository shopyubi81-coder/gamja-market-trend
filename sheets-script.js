// ================================================
// 감자마켓 트렌드 대시보드 - Google Apps Script
// ================================================
// 사용법:
// 1. Google Sheets 새 파일 만들기 (sheets.new)
// 2. 확장 프로그램 → Apps Script
// 3. 이 코드 전체 붙여넣기 후 저장
// 4. 배포 → 새 배포 → 웹 앱
//    - 실행 계정: 나
//    - 액세스 권한: 모든 사용자 (익명 포함)
// 5. 배포 URL을 .env 의 GOOGLE_SHEETS_WEBHOOK 에 입력

const SHEET_NAME = '선별목록';
const HEADERS = ['날짜', '기간', '상품명', '플랫폼', '카테고리', '트렌드', '점수', '비고', 'MD 메모'];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      // 헤더 설정
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length)
        .setBackground('#FF6B2C')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    const { date, period, items, mdNote } = payload;
    const rows = items.map((item, i) => [
      date,
      period,
      item.name,
      item.platform,
      item.category,
      item.trend,
      item.score,
      item.note,
      i === 0 ? (mdNote || '') : ''  // 메모는 첫 행에만
    ]);

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, HEADERS.length).setValues(rows);

    // 열 너비 자동 조정
    sheet.autoResizeColumns(1, HEADERS.length);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, rowsAdded: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: '감자마켓 Sheets 연동 정상 작동 중' }))
    .setMimeType(ContentService.MimeType.JSON);
}
