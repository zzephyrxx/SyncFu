import type { Locale } from '../prototype/messages.ts';

const labels: Record<Locale, { solid: string; glass: string; help: string }> = {
  'zh-CN': { solid: '实色', glass: '液态玻璃', help: '为导航和弹窗增添通透层次，正文与文件列表保持清晰。' },
  'zh-TW': { solid: '實色', glass: '液態玻璃', help: '為導覽和彈窗增添通透層次，內文與檔案清單保持清晰。' },
  en: { solid: 'Solid', glass: 'Liquid glass', help: 'Translucent navigation and dialogs, with clear text and file lists.' },
  ja: { solid: 'ソリッド', glass: 'リキッドガラス', help: 'ナビゲーションとダイアログに透明感を加え、本文とファイル一覧の読みやすさを保ちます。' },
  ko: { solid: '단색', glass: '리퀴드 글라스', help: '탐색 메뉴와 대화 상자에 투명감을 더하고 본문과 파일 목록은 선명하게 유지합니다.' },
};

export function materialLabels(locale: Locale) { return labels[locale]; }
