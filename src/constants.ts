// BOSS直聘 筛选项代码表（已验证）

export interface Option {
  value: string;
  label: string;
}

export const SALARY_OPTIONS: Option[] = [
  { value: "", label: "薪资不限" },
  { value: "402", label: "3K以下" },
  { value: "403", label: "3-5K" },
  { value: "404", label: "5-10K" },
  { value: "405", label: "10-20K" },
  { value: "406", label: "20-50K" },
  { value: "407", label: "50K以上" },
];

export const EXPERIENCE_OPTIONS: Option[] = [
  { value: "", label: "经验不限" },
  { value: "108", label: "在校生" },
  { value: "102", label: "应届生" },
  { value: "101", label: "经验不限" },
  { value: "103", label: "1年以内" },
  { value: "104", label: "1-3年" },
  { value: "105", label: "3-5年" },
  { value: "106", label: "5-10年" },
  { value: "107", label: "10年以上" },
];

export const DEGREE_OPTIONS: Option[] = [
  { value: "", label: "学历不限" },
  { value: "209", label: "初中及以下" },
  { value: "208", label: "中专/中技" },
  { value: "206", label: "高中" },
  { value: "202", label: "大专" },
  { value: "203", label: "本科" },
  { value: "204", label: "硕士" },
  { value: "205", label: "博士" },
];

export const SCALE_OPTIONS: Option[] = [
  { value: "", label: "规模不限" },
  { value: "301", label: "0-20人" },
  { value: "302", label: "20-99人" },
  { value: "303", label: "100-499人" },
  { value: "304", label: "500-999人" },
  { value: "305", label: "1000-9999人" },
  { value: "306", label: "10000人以上" },
];

export const STAGE_OPTIONS: Option[] = [
  { value: "", label: "融资不限" },
  { value: "801", label: "未融资" },
  { value: "802", label: "天使轮" },
  { value: "803", label: "A轮" },
  { value: "804", label: "B轮" },
  { value: "805", label: "C轮" },
  { value: "806", label: "D轮及以上" },
  { value: "807", label: "已上市" },
  { value: "808", label: "不需要融资" },
];

export const INDUSTRY_OPTIONS: Option[] = [
  { value: "", label: "行业不限" },
  { value: "1001", label: "互联网" },
  { value: "1002", label: "电子商务" },
  { value: "1003", label: "金融" },
  { value: "1004", label: "游戏" },
  { value: "1005", label: "企业服务" },
  { value: "1006", label: "教育培训" },
  { value: "1007", label: "社交网络" },
  { value: "1008", label: "医疗健康" },
  { value: "1009", label: "生活服务" },
  { value: "1010", label: "广告营销" },
];

export const DEFAULT_TEMPLATE =
  "您好，我对{公司}的{职位}很感兴趣，想进一步了解岗位职责和团队情况，方便沟通一下吗？";

export const CHAT_URL = "https://www.zhipin.com/web/geek/chat";
export const JOB_SEARCH_URL = "https://www.zhipin.com/web/geek/jobs";

/** 风控关键词（出现在 message 中即视为触发风控） */
export const RISK_PATTERN = /环境存在异常|访问频繁|操作太频繁|安全校验|滑块|验证/;

/** 更宽的风控/需人工处理文本特征（用于错误原因匹配） */
export const RISK_TEXT_PATTERN =
  /环境存在异常|访问频繁|操作太频繁|安全校验|安全验证|验证码|滑块|登录查看完整内容|未登录|登录已过期|code\s*31|code\s*37/i;

/** JD 词云停用词 */
export const STOPWORDS = new Set([
  "工作", "职责", "岗位", "职位", "任职", "要求", "描述", "内容", "能力", "经验",
  "优先", "以上", "以下", "相关", "负责", "进行", "以及", "熟悉", "具备", "公司",
  "团队", "参与", "完成", "独立", "良好", "沟通", "产品", "业务", "项目", "平台",
  "较强", "学习", "合作", "精神", "意识", "基础", "掌握", "了解", "使用", "开发",
  "本科", "学历", "不限", "周岁", "我们", "你将", "你的", "能够", "具有", "优秀",
  "解决", "问题", "方案", "设计", "分析", "推动", "落地", "需求", "系统", "技术",
  "等者", "有者", "者优", "年内", "年及", "岁至", "不限", "经验者", "优先者",
  "the", "and", "with", "for", "you", "our", "are", "will", "have", "has",
]);
