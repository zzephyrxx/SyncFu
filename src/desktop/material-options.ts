import type { Locale } from '../prototype/messages.ts';

const labels: Record<Locale, { solid: string; glass: string; help: string; level: string; soft: string; clear: string; softHelp: string; clearHelp: string }> = {
  'zh-CN': {
    solid: '实色', glass: '液态玻璃', help: '为导航和弹窗增添通透层次，正文与文件列表保持清晰。',
    level: '玻璃效果', soft: '柔和', clear: '通透',
    softHelp: '适度透出背景，玻璃边缘更柔和。', clearHelp: '更多背景透出，玻璃边缘更鲜明。',
  },
  'zh-TW': {
    solid: '實色', glass: '液態玻璃', help: '為導覽和彈窗增添通透層次，內文與檔案清單保持清晰。',
    level: '玻璃效果', soft: '柔和', clear: '通透',
    softHelp: '適度透出背景，玻璃邊緣更柔和。', clearHelp: '更多背景透出，玻璃邊緣更鮮明。',
  },
  en: {
    solid: 'Solid', glass: 'Liquid glass', help: 'Translucent navigation and dialogs, with clear text and file lists.',
    level: 'Glass appearance', soft: 'Soft', clear: 'Clear',
    softHelp: 'Gentle transparency with softer glass edges.', clearHelp: 'More transparency with more defined glass edges.',
  },
  ja: {
    solid: 'ソリッド', glass: 'リキッドガラス', help: 'ナビゲーションとダイアログに透明感を加え、本文とファイル一覧の読みやすさを保ちます。',
    level: 'ガラスの見た目', soft: 'ソフト', clear: 'クリア',
    softHelp: '背景がほどよく透け、ガラスの縁がやわらかく見えます。', clearHelp: '背景がより透けて見え、ガラスの縁がはっきりします。',
  },
  ko: {
    solid: '단색', glass: '리퀴드 글라스', help: '탐색 메뉴와 대화 상자에 투명감을 더하고 본문과 파일 목록은 선명하게 유지합니다.',
    level: '유리 효과', soft: '부드럽게', clear: '투명하게',
    softHelp: '배경이 은은하게 비치고 유리 테두리가 부드럽게 보입니다.', clearHelp: '배경이 더 많이 비치고 유리 테두리가 선명하게 보입니다.',
  },
};

export function materialLabels(locale: Locale) { return labels[locale]; }
