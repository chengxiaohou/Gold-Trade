// 内置默认代号表：股票代码 → 代号
// 用户可在编辑行时用「名称-代号」自定义，自定义代号优先于内置默认值
export const DEFAULT_NICKNAMES: Record<string, string> = {
  '600036.SH': '小招猫',       // 招商银行
  '601318.SH': '星星人',       // 中国平安
  '000858.SZ': '舞娘',         // 五粮液
  '600887.SH': '牛奶',         // 伊利
  '000538.SZ': '牙膏',         // 云南白药
  '000333.SZ': '丑的',         // 美的
  '000651.SZ': '蛤蜊',         // 格力
  '600690.SH': '裤衩兄弟',     // 海尔
  '601919.SH': '海上货拉拉',   // 中远海控
  '600941.SH': '电话，移不动', // 中国移动
  '600886.SH': '水系皮卡丘',   // 国投电力
  '600795.SH': '火系皮卡丘',   // 国电电力
  '601066.SH': '三哥',         // 中信建投
  '003816.SZ': '干净电',       // 中国广核
  '601985.SH': '变异电',       // 中国核电
  '600030.SH': '券商',         // 中信证券
};

// 取股票的代号：自定义代号优先，其次内置默认，都没有则返回空串
export function getNickname(code: string, customNickname?: string): string {
  if (customNickname && customNickname.trim()) {
    return customNickname.trim();
  }
  return DEFAULT_NICKNAMES[code] || '';
}
