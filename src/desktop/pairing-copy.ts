import type {Locale} from '../prototype/messages';
const copy={
  title:['连接设备','連接裝置','Connect a device','デバイスを接続','기기 연결'],
  description:['在同一局域网中，选择设备并输入配对码。','在同一區域網路中，選擇裝置並輸入配對碼。','Choose a device on your local network and enter its pairing code.','同じネットワークのデバイスを選び、ペアリングコードを入力します。','같은 로컬 네트워크의 기기를 선택하고 페어링 코드를 입력하세요.'],
  select:['选择附近设备','選擇附近裝置','Choose a nearby device','近くのデバイスを選択','주변 기기 선택'],
  scan:['自动发现局域网中的 SyncFu 设备','自動探索區域網路中的 SyncFu 裝置','SyncFu devices appear automatically on your local network','ローカルネットワークの SyncFu を自動検出','로컬 네트워크의 SyncFu 기기를 자동으로 찾습니다'],
  refresh:['刷新设备','重新整理裝置','Refresh devices','デバイスを更新','기기 새로고침'],
  empty:['尚未发现其他设备','尚未發現其他裝置','No other devices found yet','デバイスが見つかりません','아직 다른 기기를 찾지 못했습니다'],
  emptyHelp:['请在另一台设备打开 SyncFu，并连接同一 Wi-Fi 或局域网。','請在另一台裝置開啟 SyncFu，並連接相同 Wi-Fi 或區域網路。','Open SyncFu on the other device and connect both to the same Wi-Fi or LAN.','相手で SyncFu を開き、同じ Wi-Fi または LAN に接続してください。','다른 기기에서 SyncFu를 열고 같은 Wi-Fi 또는 LAN에 연결하세요.'],
  manual:['找不到设备？使用 IP 地址连接','找不到裝置？使用 IP 位址連接','Can’t find it? Connect using an IP address','見つからない場合は IP アドレスで接続','기기를 찾을 수 없나요? IP 주소로 연결'],
  manualHelp:['仅在自动发现不可用时使用；地址显示在另一台设备的“等待连接”页面。','僅在自動探索無法使用時使用；位址顯示於另一台裝置的「等待連接」頁面。','Use this when discovery is unavailable. Find the address under Receive on the other device.','自動検出できない場合に使用します。相手の「接続を待つ」にアドレスがあります。','자동 검색이 안 될 때 사용하세요. 상대 기기의 연결 기다리기 화면에서 주소를 확인하세요.'],
  codeHelp:['在对方的“等待连接”中查看 5 位配对码','在對方的「等待連接」中查看 5 位配對碼','Find the 5-digit pairing code under Receive on the other device','相手の「接続を待つ」で 5 桁のコードを確認','상대 기기의 연결 기다리기에서 5자리 코드를 확인하세요'],
  security:['配对需对方确认，文件夹访问权限单独授权。','配對需對方確認，資料夾存取權限另行授權。','The other device approves pairing. Folder access is granted separately.','相手の承認が必要です。フォルダへのアクセスは別途許可します。','상대 기기에서 페어링을 승인해야 하며 폴더 권한은 별도로 허용합니다.'],
  receiveHelp:['在另一台设备选择这台电脑，然后输入下方配对码。','在另一台裝置選擇這台電腦，然後輸入下方配對碼。','Select this computer on the other device, then enter the pairing code below.','相手でこのコンピュータを選び、下のコードを入力してください。','상대 기기에서 이 컴퓨터를 선택하고 아래 페어링 코드를 입력하세요.'],
  addresses:['本机连接地址','本機連接位址','This device’s addresses','このデバイスのアドレス','이 기기의 연결 주소'],
  request:['请求与你配对','要求與你配對','wants to pair with you','からの接続リクエスト','페어링 요청'],
  review:['确认要连接的设备后，允许配对。','確認要連接的裝置後，允許配對。','Check the requesting device, then allow pairing.','接続相手を確認してから許可してください。','요청한 기기를 확인한 후 페어링을 허용하세요.'],
  approvalWait:['正在完成连接，请保持窗口打开。最多等待 18 秒。','正在完成連接，請保持視窗開啟。最多等待 18 秒。','Finishing the connection. Keep this window open for up to 18 seconds.','接続を完了しています。最大 18 秒、この画面を開いたままお待ちください。','연결을 완료하는 중입니다. 최대 18초 동안 이 창을 열어 두세요.'],
  approvalTimeout:['连接确认超时。请重新发起配对，也可以关闭此窗口。','連接確認逾時。請重新發起配對，也可以關閉此視窗。','Connection confirmation timed out. Start pairing again or close this window.','接続確認がタイムアウトしました。再接続するか、この画面を閉じてください。','연결 확인 시간이 초과되었습니다. 다시 페어링하거나 이 창을 닫으세요.'],
  selected:['已选择','已選擇','Selected','選択済み','선택됨'],
  unavailable:['该设备已不在附近列表中，请重新选择设备或使用 IP 地址。','該裝置已不在附近清單中，請重新選擇裝置或使用 IP 位址。','This device is no longer nearby. Choose another device or use an IP address.','近くのデバイスから消えました。再選択するか IP アドレスを使ってください。','주변 목록에서 기기가 사라졌습니다. 다시 선택하거나 IP 주소를 사용하세요.'],
} as const;
export function pairingCopy(locale:Locale,key:keyof typeof copy){return copy[key][({'zh-CN':0,'zh-TW':1,en:2,ja:3,ko:4} as const)[locale]];}
